#!/usr/bin/env node
/**
 * Variant Matrix Extraction (Phase 3)
 *
 * Extracts component props/variants from Web Components (.tsx) and
 * Tegel Lite (.scss), then cross-references with token coverage.
 *
 * Run from project root: node tokens/scripts/extract-variant-matrix.js
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { componentSlug } from './audit-css-variables.js';
import { loadAuditIgnore } from './audit-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');

/* ------------------------------------------------------------------ */
/*  File discovery                                                     */
/* ------------------------------------------------------------------ */

function findFiles(dir, pattern) {
  const files = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...findFiles(fullPath, pattern));
      else if (entry.isFile() && pattern.test(entry.name)) files.push(fullPath);
    }
  } catch { /* skip */ }
  return files;
}

/* ------------------------------------------------------------------ */
/*  Web Component prop extraction (@Prop with union types)             */
/* ------------------------------------------------------------------ */

// Props that are HTML attributes or non-visual — skip for token coverage
const NON_VISUAL_PROPS = new Set([
  'type', 'name', 'value', 'form', 'target', 'href', 'method', 'action',
  'autocomplete', 'autofocus', 'placeholder', 'tabindex', 'role', 'lang',
  'animation', 'modeVariant',
]);

function extractWebComponentProps(componentDir) {
  const tsxFiles = findFiles(componentDir, /\.tsx$/);
  const props = {};

  for (const file of tsxFiles) {
    const content = readFileSync(file, 'utf-8');
    // Match: @Prop() propName: 'val1' | 'val2' | ... or @Prop({...}) propName?: 'val1' | 'val2'
    const propRegex = /@Prop\([^)]*\)\s+([\w]+)\??\s*:\s*([^;=]+)/g;
    let match;
    while ((match = propRegex.exec(content)) !== null) {
      const propName = match[1];
      const typeStr = match[2].trim();

      // Extract union string literals: 'value1' | 'value2' | ...
      const unionValues = [];
      const litRegex = /'([^']+)'/g;
      let litMatch;
      while ((litMatch = litRegex.exec(typeStr)) !== null) {
        unionValues.push(litMatch[1]);
      }

      if (unionValues.length >= 2 && !NON_VISUAL_PROPS.has(propName)) {
        props[propName] = {
          values: unionValues,
          file: relative(ROOT_DIR, file),
        };
      }
    }

    // Also check for boolean disabled prop
    if (/@Prop\([^)]*\)\s+disabled\s*:\s*boolean/.test(content)) {
      props._hasDisabled = true;
    }
  }

  return props;
}

/* ------------------------------------------------------------------ */
/*  Tegel Lite variant extraction (BEM modifiers)                      */
/* ------------------------------------------------------------------ */

function extractTegelLiteVariants(componentDir) {
  const scssFiles = findFiles(componentDir, /\.scss$/);
  const variants = new Set();
  const slug = componentSlug(componentDir.split('/').pop());

  for (const file of scssFiles) {
    const content = readFileSync(file, 'utf-8');
    // Match BEM modifiers: .tl-{component}--{variant} or &--{variant}
    const bemRegex = /\.tl-[\w-]+--(\w[\w-]*)/g;
    let match;
    while ((match = bemRegex.exec(content)) !== null) {
      variants.add(match[1]);
    }
    // Also match &--{variant} (SCSS nesting shorthand)
    const nestRegex = /&--(\w[\w-]*)/g;
    while ((match = nestRegex.exec(content)) !== null) {
      variants.add(match[1]);
    }
  }

  return [...variants].sort();
}

/* ------------------------------------------------------------------ */
/*  Token coverage extraction                                          */
/* ------------------------------------------------------------------ */

function extractComponentTokens(slug) {
  const tokenFile = join(ROOT_DIR, 'tokens', 'scss', 'component', `${slug}.scss`);
  const tokenSet = new Set();
  try {
    const content = readFileSync(tokenFile, 'utf-8');
    const varRegex = /--(component-[\w-]+)/g;
    let match;
    while ((match = varRegex.exec(content)) !== null) {
      tokenSet.add(`--${match[1]}`);
    }
  } catch { /* no token file */ }
  return [...tokenSet].sort();
}

/** Check which variant values appear in any token variable name. */
function checkTokenVariantCoverage(tokens, propValues) {
  const coverage = {};
  for (const val of propValues) {
    // Check if any token contains the variant value as a segment
    const valLower = val.toLowerCase();
    coverage[val] = tokens.some((t) => {
      const parts = t.replace(/^--component-/, '').split('-');
      return parts.includes(valLower);
    });
  }
  return coverage;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

function extractVariantMatrix() {
  console.log('Extracting variant matrix...');

  const ignoredSlugs = loadAuditIgnore();
  const filterRaw = process.env.AUDIT_COMPONENTS;
  const filterSlugs = filterRaw
    ? new Set(filterRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
    : null;

  const webDir = join(ROOT_DIR, 'packages/core/src/components');
  const liteDir = join(ROOT_DIR, 'packages/core/src/tegel-lite/components');

  // Discover web component directories
  const webComponents = new Map();
  try {
    for (const entry of readdirSync(webDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const slug = componentSlug(entry.name);
      if (ignoredSlugs.has(slug)) continue;
      if (filterSlugs && !filterSlugs.has(slug)) continue;
      webComponents.set(slug, join(webDir, entry.name));
    }
  } catch { /* */ }

  // Discover Tegel Lite component directories
  const liteComponents = new Map();
  try {
    for (const entry of readdirSync(liteDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const slug = componentSlug(entry.name);
      if (ignoredSlugs.has(slug)) continue;
      if (filterSlugs && !filterSlugs.has(slug)) continue;
      liteComponents.set(slug, join(liteDir, entry.name));
    }
  } catch { /* */ }

  // Merge slugs
  const allSlugs = new Set([...webComponents.keys(), ...liteComponents.keys()]);
  const components = [];

  for (const slug of [...allSlugs].sort()) {
    const webProps = webComponents.has(slug) ? extractWebComponentProps(webComponents.get(slug)) : {};
    const hasDisabled = webProps._hasDisabled || false;
    delete webProps._hasDisabled;

    const liteVariants = liteComponents.has(slug) ? extractTegelLiteVariants(liteComponents.get(slug)) : [];
    const componentTokens = extractComponentTokens(slug);

    // Build coverage for each prop's values
    const tokenVariantCoverage = {};
    const mismatches = [];
    for (const [propName, propInfo] of Object.entries(webProps)) {
      tokenVariantCoverage[propName] = checkTokenVariantCoverage(componentTokens, propInfo.values);
      for (const [val, covered] of Object.entries(tokenVariantCoverage[propName])) {
        if (!covered) {
          mismatches.push({ type: 'no-token', prop: propName, variant: val, source: 'web-component' });
        }
      }
    }

    // Check Tegel Lite variants not in tokens
    for (const v of liteVariants) {
      const inTokens = componentTokens.some((t) => t.includes(v));
      if (!inTokens) {
        mismatches.push({ type: 'no-token', variant: v, source: 'tegel-lite' });
      }
    }

    components.push({
      component: slug,
      webComponentProps: webProps,
      hasDisabledProp: hasDisabled,
      tegelLiteVariants: liteVariants,
      componentTokens,
      tokenVariantCoverage,
      mismatches,
    });
  }

  const generated = new Date().toISOString();
  const data = { generated, components };

  // Write output
  const runId = process.env.AUDIT_RUN_ID || JSON.parse(readFileSync(join(AUDIT_BASE_DIR, 'latest-run.json'), 'utf-8')).runId;
  const outputDir = join(AUDIT_BASE_DIR, runId);
  mkdirSync(outputDir, { recursive: true });

  const jsonPath = join(outputDir, '_variant-matrix.json');
  writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`✓ Created ${jsonPath}`);

  const mdPath = join(outputDir, '_variant-matrix.md');
  writeFileSync(mdPath, generateMarkdown(data));
  console.log(`✓ Created ${mdPath}`);

  const withProps = components.filter((c) => Object.keys(c.webComponentProps).length > 0);
  const withMismatches = components.filter((c) => c.mismatches.length > 0);
  console.log(`\n${withProps.length} components with variant props, ${withMismatches.length} with token gaps`);

  return data;
}

function generateMarkdown(data) {
  let md = `# Variant Matrix\n\nGenerated: ${data.generated}\n\n`;

  for (const comp of data.components) {
    const propCount = Object.keys(comp.webComponentProps).length;
    if (propCount === 0 && comp.tegelLiteVariants.length === 0 && comp.componentTokens.length === 0) continue;

    md += `## ${comp.component}\n\n`;

    if (propCount > 0) {
      md += `### Web Component Props\n\n`;
      for (const [name, info] of Object.entries(comp.webComponentProps)) {
        md += `- **${name}**: ${info.values.map((v) => `\`${v}\``).join(' | ')}\n`;
      }
      md += '\n';
    }

    if (comp.tegelLiteVariants.length > 0) {
      md += `### Tegel Lite Variants\n\n`;
      md += comp.tegelLiteVariants.map((v) => `\`${v}\``).join(', ') + '\n\n';
    }

    if (comp.componentTokens.length > 0) {
      md += `### Component Tokens (${comp.componentTokens.length})\n\n`;
      comp.componentTokens.forEach((t) => { md += `- \`${t}\`\n`; });
      md += '\n';
    }

    if (comp.mismatches.length > 0) {
      md += `### Token Gaps (${comp.mismatches.length})\n\n`;
      for (const m of comp.mismatches) {
        md += `- ${m.source}: \`${m.variant}\` (${m.prop || 'variant'}) — no matching token\n`;
      }
      md += '\n';
    }

    md += '---\n\n';
  }

  return md;
}

const invokedAsMain = process.argv[1] && resolve(process.cwd(), process.argv[1]) === join(__dirname, 'extract-variant-matrix.js');
if (invokedAsMain) {
  extractVariantMatrix();
}

export { extractVariantMatrix };
