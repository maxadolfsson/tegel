#!/usr/bin/env node
/**
 * Generate Variable Inventory Script
 *
 * Generates a comprehensive inventory report of all CSS variables.
 * Outputs to tokens/audit/ (human-readable markdown + machine-readable JSON).
 *
 * Run from project root: node tokens/scripts/generate-variable-inventory.js
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { auditCssVariables, componentSlug } from './audit-css-variables.js';
import { loadAuditIgnore, loadOverlapAssumptions } from './audit-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');

/** Audit output format version – bump when structure changes (aggregate files only) */
const AUDIT_FORMAT_VERSION = '1.0';

/** Run id for this audit (YYYYMMDD-HHmmss) – used as catalog folder name */
function getRunId() {
  const d = new Date();
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${Y}${M}${D}-${h}${m}${s}`;
}

/**
 * Parse AUDIT_COMPONENTS env (comma-separated slugs) for quick-audit filtering.
 */
function getAuditComponentFilter() {
  const raw = process.env.AUDIT_COMPONENTS;
  if (!raw || typeof raw !== 'string') return null;
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/**
 * Generate per-component JSON (one file per component).
 * Timestamp only (no auditFormatVersion) for ease of comparing runs.
 */
function generateComponentJson(componentName, webData, tegelLiteData, generated) {
  return {
    generated,
    component: componentName,
    webComponent: webData || null,
    tegelLite: tegelLiteData || null
  };
}

/**
 * Generate per-component markdown (timestamp only for comparing runs)
 */
function generateComponentMarkdown(componentName, webData, tegelLiteData, generated) {
  let md = `# ${componentName}\n\n`;
  md += `Generated: ${generated}  \n\n`;

  md += `## Web component\n\n`;
  if (webData) {
    md += `**File**: \`${webData.filePath}\`\n\n`;
    md += `**Variables** (${webData.variables.length}):\n\n`;
    webData.variables.forEach(v => {
      md += `- \`--${v}\`\n`;
    });
    if (webData.references.length > 0) {
      md += `\n**References** (${webData.references.length}):\n\n`;
      webData.references.forEach(r => {
        md += `- \`--${r}\`\n`;
      });
    }
    md += `\n**Contexts**: ${webData.contexts.join(', ')}\n\n`;
  } else {
    md += `No \`*-vars.scss\` file found; variables may be defined in the component's main \`.scss\`.\n\n`;
  }

  if (tegelLiteData) {
    md += `## Tegel Lite\n\n`;
    md += `**File**: \`${tegelLiteData.filePath}\`\n\n`;
    md += `**Variables** (${tegelLiteData.variables.length}):\n\n`;
    tegelLiteData.variables.forEach(v => {
      md += `- \`--${v}\`\n`;
    });
    if (tegelLiteData.references.length > 0) {
      md += `\n**References** (${tegelLiteData.references.length}):\n\n`;
      tegelLiteData.references.forEach(r => {
        md += `- \`--${r}\`\n`;
      });
    }
    md += `\n**Contexts**: ${tegelLiteData.contexts.join(', ')}\n`;
  }

  return md;
}

/**
 * Generate markdown inventory report
 */
function generateMarkdownInventory(data) {
  let markdown = `# CSS Variable Inventory\n\n`;
  markdown += `Generated: ${data.timestamp}  \n`;
  markdown += `Audit format version: ${data.auditFormatVersion || AUDIT_FORMAT_VERSION}\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `- **Web Components**: ${data.webComponents.length} components\n`;
  markdown += `- **Tegel Lite**: ${data.tegelLite.length} components\n`;

  // Count unique variables
  const allWebVars = new Set();
  const allTegelLiteVars = new Set();

  data.webComponents.forEach(comp => {
    comp.variables.forEach(v => allWebVars.add(v));
  });

  data.tegelLite.forEach(comp => {
    comp.variables.forEach(v => allTegelLiteVars.add(v));
  });

  markdown += `- **Unique Web Component Variables**: ${allWebVars.size}\n`;
  markdown += `- **Unique Tegel Lite Variables**: ${allTegelLiteVars.size}\n\n`;

  markdown += `---\n\n`;
  markdown += `## Web Components\n\n`;

  data.webComponents.forEach(comp => {
    markdown += `### ${comp.component}\n\n`;
    markdown += `**File**: \`${comp.filePath}\`\n\n`;
    markdown += `**Variables** (${comp.variables.length}):\n\n`;

    comp.variables.forEach(v => {
      markdown += `- \`--${v}\`\n`;
    });

    if (comp.references.length > 0) {
      markdown += `\n**References** (${comp.references.length}):\n\n`;
      comp.references.forEach(r => {
        markdown += `- \`--${r}\`\n`;
      });
    }

    markdown += `\n**Contexts**: ${comp.contexts.join(', ')}\n`;
    markdown += `\n---\n\n`;
  });

  markdown += `## Tegel Lite Components\n\n`;

  data.tegelLite.forEach(comp => {
    markdown += `### ${comp.component}\n\n`;
    markdown += `**File**: \`${comp.filePath}\`\n\n`;
    markdown += `**Variables** (${comp.variables.length}):\n\n`;

    comp.variables.forEach(v => {
      markdown += `- \`--${v}\`\n`;
    });

    if (comp.references.length > 0) {
      markdown += `\n**References** (${comp.references.length}):\n\n`;
      comp.references.forEach(r => {
        markdown += `- \`--${r}\`\n`;
      });
    }

    markdown += `\n**Contexts**: ${comp.contexts.join(', ')}\n`;
    markdown += `\n---\n\n`;
  });

  return markdown;
}

/**
 * Generate JSON inventory (include version in payload)
 */
function generateJsonInventory(data) {
  const payload = {
    auditFormatVersion: AUDIT_FORMAT_VERSION,
    generated: data.timestamp,
    ...data
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Build a map of canonical component slug -> { webComponent?, tegelLite? }.
 * Uses componentSlugAliases so e.g. radiobutton and radio-button merge under radio-button.
 */
function indexByComponent(auditData, componentSlugAliases = {}) {
  const bySlug = new Map();
  function ensure(canonical) {
    if (!bySlug.has(canonical)) bySlug.set(canonical, { webComponent: null, tegelLite: null });
    return bySlug.get(canonical);
  }
  (auditData.webComponents || []).forEach((comp) => {
    const slug = componentSlug(comp.component);
    const canonical = componentSlugAliases[slug] ?? slug;
    const entry = ensure(canonical);
    entry.webComponent = comp;
  });
  (auditData.tegelLite || []).forEach((comp) => {
    const slug = componentSlug(comp.component);
    const canonical = componentSlugAliases[slug] ?? slug;
    const entry = ensure(canonical);
    entry.tegelLite = comp;
  });
  return bySlug;
}

/**
 * Resolve audit output dir: use AUDIT_RUN_ID env if set (same run as mapping script), else new run id.
 * Writes latest-run.json so map-variables-to-tokens can write to the same catalog.
 */
function resolveOutputDir() {
  const runId = process.env.AUDIT_RUN_ID || getRunId();
  const outputDir = join(AUDIT_BASE_DIR, runId);
  mkdirSync(outputDir, { recursive: true });
  if (!process.env.AUDIT_RUN_ID) {
    const generated = new Date().toISOString();
    writeFileSync(
      join(AUDIT_BASE_DIR, 'latest-run.json'),
      JSON.stringify({ runId, generated }, null, 2)
    );
  }
  return { outputDir, runId };
}

/**
 * Main function
 */
function generateInventory() {
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
  auditData.auditFormatVersion = AUDIT_FORMAT_VERSION;
  const generated = new Date().toISOString();
  auditData.timestamp = generated;

  const { outputDir: AUDIT_OUTPUT_DIR, runId } = resolveOutputDir();
  console.log(`Audit catalog: tokens/audit/${runId}/`);

  console.log('Generating markdown inventory...');
  const markdown = generateMarkdownInventory(auditData);
  const markdownPath = join(AUDIT_OUTPUT_DIR, '_variable-inventory.md');
  writeFileSync(markdownPath, markdown);
  console.log(`✓ Created ${markdownPath}`);

  console.log('Generating JSON inventory...');
  const json = generateJsonInventory(auditData);
  const jsonPath = join(AUDIT_OUTPUT_DIR, '_variable-inventory.json');
  writeFileSync(jsonPath, json);
  console.log(`✓ Created ${jsonPath}`);

  const byComponent = indexByComponent(auditData, componentSlugAliases);
  const componentNames = [...byComponent.keys()].sort();

  console.log(`Generating ${componentNames.length} per-component files...`);
  componentNames.forEach(slug => {
    const { webComponent, tegelLite } = byComponent.get(slug);
    const compJson = generateComponentJson(slug, webComponent, tegelLite, generated);
    writeFileSync(join(AUDIT_OUTPUT_DIR, `${slug}.json`), JSON.stringify(compJson, null, 2));
  });
  console.log(`✓ Created tokens/audit/${runId}/{${componentNames.join(', ')}}.json`);

  return { markdownPath, jsonPath, componentFiles: componentNames, runId };
}

// Run only when this file is the entry point (not when imported)
const invokedAsMain = process.argv[1] && resolve(process.cwd(), process.argv[1]) === join(__dirname, 'generate-variable-inventory.js');
if (invokedAsMain) {
  generateInventory();
}

export { generateInventory, generateMarkdownInventory, generateJsonInventory };
