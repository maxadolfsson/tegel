#!/usr/bin/env node
/**
 * Taxonomy Naming Validator (Phase 4)
 *
 * Validates component token variable names against the Semantic Bridge
 * Framework v1.3 naming rules.
 *
 * Run from project root: node tokens/scripts/validate-taxonomy-naming.js
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadAuditIgnore } from './audit-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');

/* ------------------------------------------------------------------ */
/*  v1.3 Framework rules                                               */
/* ------------------------------------------------------------------ */

// Allowed property groups (property-first position after component name)
const VALID_PROPERTIES = new Set([
  'background', 'text', 'border', 'icon',
]);

// Ambiguous property names that should be replaced with specific ones
const AMBIGUOUS_PROPERTIES = new Set([
  'color', 'foreground', 'fill', 'stroke',
]);

// Allowed state suffixes
const VALID_STATES = new Set(['default', 'hover', 'active']);

// Forbidden implementation detail words (Rule 1: Semantic Over Appearance)
const FORBIDDEN_APPEARANCE = new Set([
  'filled', 'outlined', 'ghost', 'gradient', 'expressive', 'decorative',
  'flat', 'raised', 'elevated', 'floating', 'contained',
]);

// Known purpose values (Rule 8)
const KNOWN_PURPOSES = new Set([
  'success', 'warning', 'error', 'info', 'neutral',
  'danger', 'primary', 'secondary', // commonly used
]);

// Special tokens with their own rules
const SPECIAL_PATTERNS = {
  disabledOpacity: /^--component-[\w]+-disabled-opacity$/,
  borderRadius: /^--component-[\w]+-border-radius$/,
};

/* ------------------------------------------------------------------ */
/*  Variable extraction from component SCSS                            */
/* ------------------------------------------------------------------ */

function extractComponentVariables(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const variables = new Set();
  const varRegex = /--(component-[\w-]+)/g;
  let match;
  while ((match = varRegex.exec(content)) !== null) {
    variables.add(`--${match[1]}`);
  }
  return [...variables].sort();
}

/* ------------------------------------------------------------------ */
/*  Name parsing                                                       */
/* ------------------------------------------------------------------ */

/**
 * Parse a component token variable name into its segments.
 * Pattern: --component-{component}-{property}-{[purpose-]}{[option-]}{state}
 */
function parseTokenName(varName) {
  // Strip --component- prefix
  const body = varName.replace(/^--component-/, '');
  const segments = body.split('-');

  if (segments.length < 2) {
    return { component: segments[0] || '', segments, raw: varName };
  }

  return {
    component: segments[0],
    segments: segments.slice(1), // everything after component name
    raw: varName,
  };
}

/* ------------------------------------------------------------------ */
/*  Validation rules                                                   */
/* ------------------------------------------------------------------ */

function validateVariable(varName) {
  const violations = [];
  const parsed = parseTokenName(varName);

  // Special tokens — validate format only
  if (SPECIAL_PATTERNS.disabledOpacity.test(varName)) {
    return violations; // valid special token
  }
  if (SPECIAL_PATTERNS.borderRadius.test(varName)) {
    return violations; // valid special token
  }

  const segs = parsed.segments;
  if (segs.length === 0) {
    violations.push({ rule: 'too-short', detail: 'No segments after component name' });
    return violations;
  }

  // Rule: check for forbidden appearance words
  for (const seg of segs) {
    if (FORBIDDEN_APPEARANCE.has(seg)) {
      violations.push({
        rule: 'semantic-over-appearance',
        detail: `'${seg}' is an implementation detail, not a semantic name`,
      });
    }
  }

  // Rule: check for focus tokens (Rule 3: no -focus tokens)
  if (segs.includes('focus') || segs.includes('focused')) {
    violations.push({
      rule: 'no-focus-tokens',
      detail: 'Focus is handled globally; focus tokens should not exist',
    });
  }

  // Rule: disabled must only be disabled-opacity (Rule 5)
  if (segs.includes('disabled') && !SPECIAL_PATTERNS.disabledOpacity.test(varName)) {
    violations.push({
      rule: 'disabled-opacity-only',
      detail: 'Disabled styling must use opacity only (--component-{comp}-disabled-opacity)',
    });
  }

  // Rule: property-first grouping (Rule 2)
  const firstSeg = segs[0];
  const hasValidProperty = VALID_PROPERTIES.has(firstSeg);
  const hasAmbiguousProperty = AMBIGUOUS_PROPERTIES.has(firstSeg);

  if (hasAmbiguousProperty) {
    violations.push({
      rule: 'ambiguous-property',
      detail: `'${firstSeg}' is ambiguous; use 'background', 'text', 'border', or 'icon'`,
    });
  } else if (!hasValidProperty && !KNOWN_PURPOSES.has(firstSeg) && firstSeg !== 'disabled') {
    // Check if it might be a purpose before property (valid pattern: property-purpose-state)
    // or if property is entirely missing
    const hasPropertyAnywhere = segs.some((s) => VALID_PROPERTIES.has(s));
    if (hasPropertyAnywhere) {
      violations.push({
        rule: 'property-not-first',
        detail: `Property should come directly after component name; found '${firstSeg}' first`,
      });
    } else if (!AMBIGUOUS_PROPERTIES.has(firstSeg)) {
      violations.push({
        rule: 'missing-property',
        detail: `Expected property (background/text/border/icon) after component name; got '${firstSeg}'`,
      });
    }
  }

  // Rule: explicit state suffix (Rule 3)
  const lastSeg = segs[segs.length - 1];
  const hasExplicitState = VALID_STATES.has(lastSeg);
  // Check if any segment is a state but not in last position
  for (let i = 0; i < segs.length - 1; i++) {
    if (VALID_STATES.has(segs[i]) && segs[i] !== 'default') {
      // States like "hover" in middle positions could be valid in compound tokens
      // Only flag if it's clearly a state word not at the end
    }
  }

  if (!hasExplicitState) {
    // Not necessarily a violation for compound tokens, but flag as warning
    violations.push({
      rule: 'missing-state-suffix',
      detail: `No explicit state suffix (-default/-hover/-active); last segment is '${lastSeg}'`,
    });
  }

  // Rule: detect duplicate segments (naming smell)
  const segCounts = {};
  for (const seg of segs) {
    segCounts[seg] = (segCounts[seg] || 0) + 1;
    if (segCounts[seg] > 1) {
      violations.push({
        rule: 'duplicate-segment',
        detail: `Segment '${seg}' appears ${segCounts[seg]} times in the name`,
      });
    }
  }

  return violations;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

function validateTaxonomyNaming() {
  console.log('Validating taxonomy naming...');

  const ignoredSlugs = loadAuditIgnore();
  const filterRaw = process.env.AUDIT_COMPONENTS;
  const filterSlugs = filterRaw
    ? new Set(filterRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
    : null;

  const tokenDir = join(ROOT_DIR, 'tokens', 'scss', 'component');
  let files;
  try {
    files = readdirSync(tokenDir).filter((f) => f.endsWith('.scss'));
  } catch {
    console.error(`Token directory not found: ${tokenDir}`);
    return { components: [], totalVariables: 0, valid: 0, violations: [] };
  }

  const allViolations = [];
  const components = [];
  let totalVariables = 0;
  let totalValid = 0;
  const propertyGrouping = { background: 0, text: 0, border: 0, icon: 0, other: 0 };
  const ruleBreakdown = {};

  for (const file of files.sort()) {
    const slug = file.replace('.scss', '');
    if (ignoredSlugs.has(slug)) continue;
    if (filterSlugs && !filterSlugs.has(slug)) continue;

    const filePath = join(tokenDir, file);
    const variables = extractComponentVariables(filePath);
    totalVariables += variables.length;

    const compViolations = [];
    let compValid = 0;

    for (const varName of variables) {
      const violations = validateVariable(varName);
      if (violations.length === 0) {
        compValid++;
        totalValid++;
      } else {
        for (const v of violations) {
          const entry = { variable: varName, ...v };
          compViolations.push(entry);
          allViolations.push({ component: slug, ...entry });
          ruleBreakdown[v.rule] = (ruleBreakdown[v.rule] || 0) + 1;
        }
      }

      // Track property grouping
      const parsed = parseTokenName(varName);
      const firstSeg = parsed.segments[0];
      if (VALID_PROPERTIES.has(firstSeg)) {
        propertyGrouping[firstSeg]++;
      } else {
        propertyGrouping.other++;
      }
    }

    components.push({
      component: slug,
      file: relative(ROOT_DIR, filePath),
      variables,
      variableCount: variables.length,
      valid: compValid,
      violations: compViolations,
    });
  }

  const generated = new Date().toISOString();
  const data = {
    generated,
    totalVariables,
    valid: totalValid,
    totalViolations: allViolations.length,
    ruleBreakdown,
    propertyGrouping,
    components,
  };

  // Write output
  const runId = process.env.AUDIT_RUN_ID || JSON.parse(readFileSync(join(AUDIT_BASE_DIR, 'latest-run.json'), 'utf-8')).runId;
  const outputDir = join(AUDIT_BASE_DIR, runId);
  mkdirSync(outputDir, { recursive: true });

  const jsonPath = join(outputDir, '_taxonomy-naming.json');
  writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`✓ Created ${jsonPath}`);

  const mdPath = join(outputDir, '_taxonomy-naming.md');
  writeFileSync(mdPath, generateMarkdown(data));
  console.log(`✓ Created ${mdPath}`);

  console.log(`\n${totalVariables} variables, ${totalValid} valid, ${allViolations.length} violations`);

  return data;
}

function generateMarkdown(data) {
  let md = `# Taxonomy Naming Validation\n\n`;
  md += `Generated: ${data.generated}\n`;
  md += `Total variables: ${data.totalVariables}\n`;
  md += `Valid: ${data.valid}\n`;
  md += `Violations: ${data.totalViolations}\n\n`;

  md += `## Rule Breakdown\n\n`;
  md += `| Rule | Count |\n|------|-------|\n`;
  for (const [rule, count] of Object.entries(data.ruleBreakdown).sort(([, a], [, b]) => b - a)) {
    md += `| ${rule} | ${count} |\n`;
  }
  md += '\n';

  md += `## Property Grouping\n\n`;
  md += `| Group | Count |\n|-------|-------|\n`;
  for (const [group, count] of Object.entries(data.propertyGrouping)) {
    if (count > 0) md += `| ${group} | ${count} |\n`;
  }
  md += '\n---\n\n';

  for (const comp of data.components) {
    if (comp.variableCount === 0) continue;
    md += `## ${comp.component}\n\n`;
    md += `Variables: ${comp.variableCount}, Valid: ${comp.valid}, Violations: ${comp.violations.length}\n\n`;

    if (comp.violations.length > 0) {
      md += `| Variable | Rule | Detail |\n|----------|------|--------|\n`;
      for (const v of comp.violations) {
        md += `| \`${v.variable}\` | ${v.rule} | ${v.detail} |\n`;
      }
      md += '\n';
    } else {
      md += 'All variables pass validation.\n\n';
    }

    md += '---\n\n';
  }

  return md;
}

const invokedAsMain = process.argv[1] && resolve(process.cwd(), process.argv[1]) === join(__dirname, 'validate-taxonomy-naming.js');
if (invokedAsMain) {
  validateTaxonomyNaming();
}

export { validateTaxonomyNaming };
