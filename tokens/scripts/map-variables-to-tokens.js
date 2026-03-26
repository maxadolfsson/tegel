#!/usr/bin/env node
/**
 * Map Variables to Tokens Script
 *
 * Maps discovered CSS variables to token structure.
 * Outputs to tokens/audit/ (human-readable markdown + machine-readable JSON).
 *
 * Run from project root: node tokens/scripts/map-variables-to-tokens.js
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { auditCssVariables, componentSlug } from './audit-css-variables.js';
import { loadAuditIgnore, loadOverlapAssumptions } from './audit-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const TOKENS_JSON_DIR = join(ROOT_DIR, 'tokens', 'json');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');

/** Audit/mapping format version – bump when structure changes (aggregate only) */
const AUDIT_FORMAT_VERSION = '1.0';

/** Parse AUDIT_COMPONENTS env (comma-separated slugs) for quick-audit filtering. */
function getAuditComponentFilter() {
  const raw = process.env.AUDIT_COMPONENTS;
  if (!raw || typeof raw !== 'string') return null;
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** Resolve audit output dir: use same catalog as inventory (latest-run.json) or new run id */
function resolveAuditOutputDir() {
  const latestRunPath = join(AUDIT_BASE_DIR, 'latest-run.json');
  let runId;
  try {
    const latest = JSON.parse(readFileSync(latestRunPath, 'utf-8'));
    runId = latest.runId;
  } catch {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    runId = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
  const outputDir = join(AUDIT_BASE_DIR, runId);
  mkdirSync(outputDir, { recursive: true });
  return { outputDir, runId };
}

/**
 * Load existing tokens to check for matches
 */
function loadExistingTokens() {
  const tokens = {
    primitives: {},
    semantic: {}
  };

  try {
    const primitivePath = join(TOKENS_JSON_DIR, 'primitive/default.json');
    if (readFileSync(primitivePath, 'utf-8')) {
      tokens.primitives = JSON.parse(readFileSync(primitivePath, 'utf-8'));
    }
  } catch (error) {
    console.warn('Could not load primitive tokens:', error.message);
  }

  try {
    const semanticFiles = ['scania-light.json', 'scania-dark.json', 'traton-light.json', 'traton-dark.json'];
    semanticFiles.forEach(file => {
      try {
        const filePath = join(TOKENS_JSON_DIR, 'semantic', file);
        const content = readFileSync(filePath, 'utf-8');
        tokens.semantic[file.replace('.json', '')] = JSON.parse(content);
      } catch (error) {
        // Skip if file doesn't exist
      }
    });
  } catch (error) {
    console.warn('Could not load semantic tokens:', error.message);
  }

  return tokens;
}

/**
 * Extract token paths from token object recursively
 */
function extractTokenPaths(obj, prefix = '') {
  const paths = [];

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && '$value' in value) {
      paths.push(currentPath);
    } else if (value && typeof value === 'object') {
      paths.push(...extractTokenPaths(value, currentPath));
    }
  }

  return paths;
}

/**
 * Map CSS variable to token structure
 */
function mapVariableToToken(variableName, existingTokens) {
  const mapping = {
    variable: variableName,
    suggestedTokenPath: null,
    tokenLayer: 'unknown',
    confidence: 'low',
    notes: []
  };

  if (variableName.startsWith('tds-')) {
    const rest = variableName.replace('tds-', '');

    if (rest.includes('-')) {
      const parts = rest.split('-');
      const component = parts[0];

      mapping.tokenLayer = 'component';
      mapping.suggestedTokenPath = `component.${component}.${parts.slice(1).join('.')}`;
      mapping.confidence = 'high';
      mapping.notes.push(`Component variable for ${component}`);
    } else {
      mapping.tokenLayer = 'semantic';
      mapping.suggestedTokenPath = `semantic.color.${rest}`;
      mapping.confidence = 'medium';
    }
  }

  if (variableName.startsWith('button-') || variableName.startsWith('card-')) {
    const component = variableName.split('-')[0];
    const rest = variableName.split('-').slice(1).join('.');

    mapping.tokenLayer = 'component';
    mapping.suggestedTokenPath = `component.${component}.${rest}`;
    mapping.confidence = 'high';
    mapping.notes.push(`Tegel Lite component variable`);
  }

  if (
    variableName.startsWith('color-') ||
    variableName.startsWith('dimension-') ||
    variableName.startsWith('background-') ||
    variableName.startsWith('foreground-')
  ) {
    mapping.tokenLayer = 'semantic';
    mapping.suggestedTokenPath = `semantic.${variableName.replace(/-/g, '.')}`;
    mapping.confidence = 'medium';
    mapping.notes.push('Semantic token reference');
  }

  const tokenPaths = [
    ...extractTokenPaths(existingTokens.primitives, 'primitive'),
    ...Object.keys(existingTokens.semantic).flatMap(theme =>
      extractTokenPaths(existingTokens.semantic[theme], `semantic.${theme}`)
    )
  ];

  const matchingToken = tokenPaths.find(
    path =>
      path.toLowerCase().includes(variableName.toLowerCase()) ||
      variableName.toLowerCase().includes(path.split('.').pop().toLowerCase())
  );

  if (matchingToken) {
    mapping.existingToken = matchingToken;
    mapping.confidence = 'high';
    mapping.notes.push(`Matches existing token: ${matchingToken}`);
  }

  return mapping;
}

/**
 * Generate mapping document. Uses canonical slug for component so aliases (e.g. radiobutton + radio-button) merge.
 */
function generateMapping(auditData, existingTokens, toCanonicalSlug) {
  const toCanonical = toCanonicalSlug || ((s) => s);
  const mapping = {
    auditFormatVersion: AUDIT_FORMAT_VERSION,
    generated: new Date().toISOString(),
    summary: {
      totalVariables: 0,
      mappedToPrimitive: 0,
      mappedToSemantic: 0,
      mappedToComponent: 0,
      unmapped: 0
    },
    variables: []
  };

  auditData.webComponents.forEach(comp => {
    const canonical = toCanonical(componentSlug(comp.component));
    comp.variables.forEach(variable => {
      const varMapping = mapVariableToToken(variable, existingTokens);
      varMapping.component = canonical;
      varMapping.source = 'web-component';
      varMapping.filePath = comp.filePath;

      mapping.variables.push(varMapping);
      mapping.summary.totalVariables++;

      if (varMapping.tokenLayer === 'primitive') mapping.summary.mappedToPrimitive++;
      else if (varMapping.tokenLayer === 'semantic') mapping.summary.mappedToSemantic++;
      else if (varMapping.tokenLayer === 'component') mapping.summary.mappedToComponent++;
      else mapping.summary.unmapped++;
    });
  });

  auditData.tegelLite.forEach(comp => {
    const canonical = toCanonical(componentSlug(comp.component));
    comp.variables.forEach(variable => {
      const varMapping = mapVariableToToken(variable, existingTokens);
      varMapping.component = canonical;
      varMapping.source = 'tegel-lite';
      varMapping.filePath = comp.filePath;

      mapping.variables.push(varMapping);
      mapping.summary.totalVariables++;

      if (varMapping.tokenLayer === 'primitive') mapping.summary.mappedToPrimitive++;
      else if (varMapping.tokenLayer === 'semantic') mapping.summary.mappedToSemantic++;
      else if (varMapping.tokenLayer === 'component') mapping.summary.mappedToComponent++;
      else mapping.summary.unmapped++;
    });
  });

  return mapping;
}

/**
 * Main function
 */
function mapVariablesToTokens() {
  const { outputDir: AUDIT_OUTPUT_DIR, runId } = resolveAuditOutputDir();
  console.log(`Audit catalog: tokens/audit/${runId}/`);

  console.log('Loading existing tokens...');
  const existingTokens = loadExistingTokens();

  console.log('Auditing CSS variables...');
  const { componentSlugAliases } = loadOverlapAssumptions();
  const auditData = auditCssVariables();
  const filterSlugs = getAuditComponentFilter();
  const ignoredSlugs = loadAuditIgnore();
  const toCanonical = (slug) => componentSlugAliases[slug] ?? slug;

  if (filterSlugs) {
    auditData.webComponents = (auditData.webComponents || []).filter((c) =>
      filterSlugs.has(toCanonical(componentSlug(c.component)))
    );
    auditData.tegelLite = (auditData.tegelLite || []).filter((c) =>
      filterSlugs.has(toCanonical(componentSlug(c.component)))
    );
    console.log(`Filtered to ${filterSlugs.size} component(s): ${[...filterSlugs].sort().join(', ')}`);
  } else if (ignoredSlugs.size > 0) {
    auditData.webComponents = (auditData.webComponents || []).filter(
      (c) => !ignoredSlugs.has(componentSlug(c.component))
    );
    auditData.tegelLite = (auditData.tegelLite || []).filter(
      (c) => !ignoredSlugs.has(componentSlug(c.component))
    );
    console.log(`Excluded ${ignoredSlugs.size} ignored component(s): ${[...ignoredSlugs].sort().join(', ')}`);
  }

  console.log('Mapping variables to tokens...');
  const mapping = generateMapping(auditData, existingTokens, (slug) => toCanonical(slug));

  const mappingPath = join(AUDIT_OUTPUT_DIR, '_variable-mapping.json');
  writeFileSync(mappingPath, JSON.stringify(mapping, null, 2));
  console.log(`✓ Created ${mappingPath}`);

  let markdown = `# Variable to Token Mapping\n\n`;
  markdown += `Generated: ${mapping.generated}  \n`;
  markdown += `Audit format version: ${mapping.auditFormatVersion}\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `- **Total Variables**: ${mapping.summary.totalVariables}\n`;
  markdown += `- **Mapped to Component**: ${mapping.summary.mappedToComponent}\n`;
  markdown += `- **Mapped to Semantic**: ${mapping.summary.mappedToSemantic}\n`;
  markdown += `- **Mapped to Primitive**: ${mapping.summary.mappedToPrimitive}\n`;
  markdown += `- **Unmapped**: ${mapping.summary.unmapped}\n\n`;
  markdown += `---\n\n`;

  const byComponent = {};
  mapping.variables.forEach(v => {
    if (!byComponent[v.component]) {
      byComponent[v.component] = [];
    }
    byComponent[v.component].push(v);
  });

  Object.entries(byComponent).forEach(([component, vars]) => {
    markdown += `## ${component}\n\n`;
    vars.forEach(v => {
      markdown += `### \`--${v.variable}\`\n\n`;
      markdown += `- **Layer**: ${v.tokenLayer}\n`;
      markdown += `- **Suggested Path**: \`${v.suggestedTokenPath || 'N/A'}\`\n`;
      markdown += `- **Confidence**: ${v.confidence}\n`;
      if (v.existingToken) {
        markdown += `- **Existing Token**: \`${v.existingToken}\`\n`;
      }
      if (v.notes.length > 0) {
        markdown += `- **Notes**: ${v.notes.join('; ')}\n`;
      }
      markdown += `\n`;
    });
    markdown += `---\n\n`;
  });

  const markdownPath = join(AUDIT_OUTPUT_DIR, '_variable-mapping.md');
  writeFileSync(markdownPath, markdown);
  console.log(`✓ Created ${markdownPath}`);

  return { mappingPath, markdownPath };
}

// Run only when this file is the entry point (not when imported)
const invokedAsMain = process.argv[1] && resolve(process.cwd(), process.argv[1]) === join(__dirname, 'map-variables-to-tokens.js');
if (invokedAsMain) {
  mapVariablesToTokens();
}

export { mapVariablesToTokens, mapVariableToToken };
