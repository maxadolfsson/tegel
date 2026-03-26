#!/usr/bin/env node
/**
 * Hardcoded Value Scanner (Phase 1)
 *
 * Scans component SCSS files for hardcoded values (colors, dimensions, etc.)
 * that are not using CSS custom properties (var()) or SCSS variables ($).
 *
 * Run from project root: node tokens/scripts/scan-hardcoded-values.js
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { componentSlug } from './audit-css-variables.js';
import { loadAuditIgnore } from './audit-config.js';

/** Recursively find SCSS files matching a pattern. */
function findScssFiles(dir, pattern) {
  const files = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...findScssFiles(fullPath, pattern));
      else if (entry.isFile() && pattern.test(entry.name)) files.push(fullPath);
    }
  } catch { /* skip unreadable dirs */ }
  return files;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');

/* ------------------------------------------------------------------ */
/*  Classification helpers                                             */
/* ------------------------------------------------------------------ */

const SAFE_VALUES = new Set([
  'none', 'inherit', 'initial', 'unset', 'auto', 'transparent', 'currentcolor',
  'normal', 'bold', 'block', 'inline', 'inline-block', 'inline-flex', 'flex',
  'grid', 'hidden', 'visible', 'absolute', 'relative', 'fixed', 'sticky',
  'static', 'pointer', 'default', 'nowrap', 'wrap', 'center', 'left', 'right',
  'top', 'bottom', 'both', 'row', 'column', 'content-box', 'border-box',
  'break-word', 'collapse', 'separate', 'solid', 'dashed', 'dotted',
  'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear',
  'not-allowed', 'text', 'ellipsis', 'clip', 'contain', 'cover',
]);

/** True when the entire value is var() references, SCSS vars, safe keywords, or zero. */
function isValueSafe(value) {
  // Strip comments
  let v = value.replace(/\/\*.*?\*\//g, '').trim();
  if (!v) return true;

  // Pure var() reference (possibly with fallback)
  if (/^var\(/.test(v) && !hasHardcodedPart(v)) return true;

  // Pure SCSS variable reference ($foo or $foo-bar)
  if (/^\$[\w-]+$/.test(v)) return true;

  // Pure zero (with or without unit)
  if (/^0(px|rem|em|%|vh|vw|ms|s)?$/.test(v)) return true;

  // Safe keyword
  if (SAFE_VALUES.has(v.toLowerCase())) return true;

  // Pure calc() using only vars / SCSS vars
  if (/^calc\(/.test(v) && !hasHardcodedPart(v)) return true;

  return false;
}

/** Check if a value string has hardcoded parts mixed with var() or on its own. */
function hasHardcodedPart(value) {
  // Remove var(...) chunks (including nested) and SCSS vars
  let stripped = value.replace(/var\([^)]*\)/g, '').replace(/\$[\w-]+/g, '').trim();
  // Remove safe keywords and operators
  stripped = stripped.replace(/[+\-*/(),]/g, ' ').trim();
  if (!stripped) return false;
  // Check remaining tokens for hardcoded values
  const tokens = stripped.split(/\s+/).filter(Boolean);
  return tokens.some((t) => !SAFE_VALUES.has(t.toLowerCase()) && !/^0(px|rem|em|%)?$/.test(t));
}

/** Classify a hardcoded token into a type bucket. */
function classifyValue(value) {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return 'color';
  if (/^(rgb|rgba|hsl|hsla)\(/.test(v)) return 'color';
  if (/\d+(px|rem|em|vh|vw|vmin|vmax|ch|ex)/.test(v)) return 'dimension';
  if (/\d+%/.test(v)) return 'dimension';
  if (/\d+(ms|s)\b/.test(v)) return 'dimension';
  if (/^(font-family|font-weight)$/.test(v)) return 'typography'; // property-level, handled below
  if (/^0?\.\d+$/.test(v) || /^[01]$/.test(v)) return 'opacity';
  return 'dimension'; // default bucket for numeric leftovers
}

/** Classify a property+value pair. */
function classifyEntry(property, value) {
  const p = property.toLowerCase();
  if (p === 'opacity') return 'opacity';
  if (p.includes('font-family')) return 'typography';
  if (p.includes('font-weight') && /\d/.test(value)) return 'typography';
  if (p.includes('font-size') || p.includes('line-height')) return 'typography';
  if (p.includes('shadow')) return 'shadow';
  if (p.includes('color') || p.includes('background') || p.includes('border-color') || p.includes('fill') || p.includes('outline-color')) {
    if (/^#|^(rgb|rgba|hsl|hsla)\(/.test(value.trim())) return 'color';
  }
  return classifyValue(value);
}

/* ------------------------------------------------------------------ */
/*  SCSS scanning                                                      */
/* ------------------------------------------------------------------ */

/**
 * Scan a single SCSS file for hardcoded values in CSS property declarations.
 * Returns array of { line, property, value, type }.
 */
function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const results = [];
  let inBlockComment = false;
  let inMixinOrFunction = false;
  let braceDepthAtMixin = -1;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Track block comments
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
        line = line.slice(line.indexOf('*/') + 2);
      } else {
        continue;
      }
    }
    if (line.includes('/*')) {
      // Check if it closes on the same line
      const before = line.slice(0, line.indexOf('/*'));
      const after = line.slice(line.indexOf('/*'));
      if (after.includes('*/')) {
        line = before + after.slice(after.indexOf('*/') + 2);
      } else {
        inBlockComment = true;
        line = before;
      }
    }

    // Strip line comments
    const commentIdx = line.indexOf('//');
    if (commentIdx >= 0) {
      // Avoid stripping // inside strings or urls
      const beforeComment = line.slice(0, commentIdx);
      if ((beforeComment.split("'").length - 1) % 2 === 0 && (beforeComment.split('"').length - 1) % 2 === 0) {
        line = beforeComment;
      }
    }

    // Track brace depth for @mixin/@function skipping
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
    }

    // Detect @mixin / @function blocks to skip
    if (/^\s*@(mixin|function)\b/.test(line)) {
      inMixinOrFunction = true;
      braceDepthAtMixin = braceDepth - 1; // depth before the opening brace
    }
    if (inMixinOrFunction && braceDepth <= braceDepthAtMixin) {
      inMixinOrFunction = false;
      braceDepthAtMixin = -1;
    }

    // Skip @media, @keyframes, @include, @use, @import, @extend, @mixin, @function lines
    if (/^\s*@(media|keyframes|include|use|import|extend|mixin|function|if|else|each|for|while|return|warn|error|debug)\b/.test(line)) {
      continue;
    }

    // Skip SCSS variable declarations ($var: value)
    if (/^\s*\$[\w-]+\s*:/.test(line)) {
      continue;
    }

    // Match CSS property declarations: `property: value;` or `property: value`
    const propMatch = line.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*;?\s*$/);
    if (!propMatch) continue;

    const [, property, rawValue] = propMatch;

    // Skip pseudo-selectors and SCSS nesting that look like properties
    if (property.startsWith('&') || property.startsWith('.') || property.startsWith('#')) continue;
    // Skip @-rules disguised as properties
    if (property.startsWith('@')) continue;

    // Clean the value (remove trailing ; and !important)
    const value = rawValue.replace(/\s*!important\s*$/, '').replace(/;\s*$/, '').trim();

    if (!value) continue;
    if (isValueSafe(value)) continue;

    const type = classifyEntry(property, value);
    results.push({ line: i + 1, property, value, type });
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Aggregation                                                        */
/* ------------------------------------------------------------------ */

function deriveComponentSlug(filePath) {
  // Web components: packages/core/src/components/{name}/
  let m = filePath.match(/components\/([^/]+)\//);
  if (m) return componentSlug(m[1]);
  // Tegel Lite: packages/core/src/tegel-lite/components/{name}/
  m = filePath.match(/tegel-lite\/components\/([^/]+)\//);
  if (m) return componentSlug(m[1]);
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/*  Output                                                             */
/* ------------------------------------------------------------------ */

function generateMarkdown(data) {
  let md = `# Hardcoded Value Scan\n\n`;
  md += `Generated: ${data.generated}\n`;
  md += `Files scanned: ${data.totalFiles}\n`;
  md += `Total hardcoded values: ${data.totalHardcodedValues}\n\n`;

  md += `## Aggregate Summary\n\n`;
  md += `| Type | Count |\n|------|-------|\n`;
  for (const [type, count] of Object.entries(data.aggregateSummary)) {
    md += `| ${type} | ${count} |\n`;
  }
  md += '\n---\n\n';

  for (const comp of data.components) {
    if (comp.totalHardcoded === 0) continue;
    md += `## ${comp.component}\n\n`;
    md += `Hardcoded values: ${comp.totalHardcoded} (`;
    md += Object.entries(comp.summary).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(', ');
    md += `)\n\n`;

    for (const f of comp.files) {
      if (f.hardcodedValues.length === 0) continue;
      md += `**${f.file}**\n\n`;
      md += `| Line | Property | Value | Type |\n|------|----------|-------|------|\n`;
      for (const hv of f.hardcodedValues) {
        md += `| ${hv.line} | \`${hv.property}\` | \`${hv.value}\` | ${hv.type} |\n`;
      }
      md += '\n';
    }
    md += '---\n\n';
  }

  return md;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

function scanHardcodedValues() {
  console.log('Scanning for hardcoded values...');

  const ignoredSlugs = loadAuditIgnore();
  const filterRaw = process.env.AUDIT_COMPONENTS;
  const filterSlugs = filterRaw
    ? new Set(filterRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
    : null;

  // Discover all component SCSS files (not just *-vars.scss)
  const webDir = join(ROOT_DIR, 'packages/core/src/components');
  const liteDir = join(ROOT_DIR, 'packages/core/src/tegel-lite/components');
  const allFiles = [
    ...findScssFiles(webDir, /\.scss$/),
    ...findScssFiles(liteDir, /\.scss$/),
  ];

  console.log(`Found ${allFiles.length} SCSS files to scan`);

  // Group by component slug
  const byComponent = new Map();
  for (const f of allFiles) {
    const slug = deriveComponentSlug(relative(ROOT_DIR, f));
    if (ignoredSlugs.has(slug)) continue;
    if (filterSlugs && !filterSlugs.has(slug)) continue;
    if (!byComponent.has(slug)) byComponent.set(slug, []);
    byComponent.get(slug).push(f);
  }

  const aggregateSummary = { colors: 0, dimensions: 0, typography: 0, shadows: 0, opacity: 0 };
  let totalHardcoded = 0;
  const components = [];

  for (const [slug, files] of [...byComponent.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const summary = { colors: 0, dimensions: 0, typography: 0, shadows: 0, opacity: 0 };
    const fileResults = [];

    for (const f of files) {
      const hits = scanFile(f);
      if (hits.length > 0) {
        fileResults.push({
          file: relative(ROOT_DIR, f),
          hardcodedValues: hits,
        });
        for (const h of hits) {
          const bucket = h.type === 'color' ? 'colors'
            : h.type === 'shadow' ? 'shadows'
            : h.type === 'typography' ? 'typography'
            : h.type === 'opacity' ? 'opacity'
            : 'dimensions';
          summary[bucket]++;
          aggregateSummary[bucket]++;
          totalHardcoded++;
        }
      }
    }

    components.push({
      component: slug,
      files: fileResults,
      totalHardcoded: fileResults.reduce((s, f) => s + f.hardcodedValues.length, 0),
      summary,
    });
  }

  const generated = new Date().toISOString();
  const data = {
    generated,
    totalFiles: allFiles.length,
    totalHardcodedValues: totalHardcoded,
    aggregateSummary,
    components,
  };

  // Write output
  const runId = process.env.AUDIT_RUN_ID || JSON.parse(readFileSync(join(AUDIT_BASE_DIR, 'latest-run.json'), 'utf-8')).runId;
  const outputDir = join(AUDIT_BASE_DIR, runId);
  mkdirSync(outputDir, { recursive: true });

  const jsonPath = join(outputDir, '_hardcoded-scan.json');
  writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`✓ Created ${jsonPath}`);

  const mdPath = join(outputDir, '_hardcoded-scan.md');
  writeFileSync(mdPath, generateMarkdown(data));
  console.log(`✓ Created ${mdPath}`);

  console.log(`\nTotal: ${totalHardcoded} hardcoded values across ${components.filter((c) => c.totalHardcoded > 0).length} components`);

  return data;
}

// Run only when this file is the entry point
const invokedAsMain = process.argv[1] && resolve(process.cwd(), process.argv[1]) === join(__dirname, 'scan-hardcoded-values.js');
if (invokedAsMain) {
  scanHardcodedValues();
}

export { scanHardcodedValues };
