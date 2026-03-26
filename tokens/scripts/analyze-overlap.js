#!/usr/bin/env node
/**
 * Analyze Overlap Script (Phase 2)
 *
 * Cross-references CSS variables from web components vs tegel-lite.
 * Outputs: overlap (what to keep) and what to consider.
 * Writes to the same audit run folder as inventory/mapping; summary stats are
 * extensible for future data points (optimisations, overlaps, etc.).
 *
 * Run from project root: node tokens/scripts/analyze-overlap.js
 * Uses tokens/audit/latest-run.json to determine which run folder to write to.
 * Run after generate-variable-inventory (and optionally map-variables-to-tokens).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadOverlapAssumptions } from './audit-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');

/** Normalize variable name for comparison: lowercase, strip common prefixes */
function normalizeVarName(name) {
  const lower = String(name).toLowerCase();
  if (lower.startsWith('tds-')) return lower.slice(4);
  if (lower.startsWith('tl-')) return lower.slice(3);
  return lower;
}

/** Apply component alias to first segment of normalized name. */
function canonicalVarName(normalized, componentAliases) {
  const segments = normalized.split('-').filter(Boolean);
  if (segments.length === 0) return normalized;
  const first = segments[0];
  const canonicalFirst = componentAliases[first] ?? first;
  return [canonicalFirst, ...segments.slice(1)].join('-');
}

/** Return set of match keys: canonical name plus property-equivalent alternates (for last segment). */
function getMatchKeys(normalized, componentAliases, propertyEquivalences) {
  const canonical = canonicalVarName(normalized, componentAliases);
  const keys = new Set([canonical]);
  const segments = canonical.split('-').filter(Boolean);
  if (segments.length >= 1) {
    const lastSeg = segments[segments.length - 1];
    const equivs = propertyEquivalences[lastSeg];
    if (Array.isArray(equivs)) {
      for (const e of equivs) {
        keys.add([...segments.slice(0, -1), e].join('-'));
      }
    }
  }
  return [...keys];
}

/** Same slug as generate-variable-inventory.js */
function componentSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/^tl-/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'component';
}

/**
 * Build component index: canonical slug -> { webComponent?, tegelLite?, mergedSlugs }.
 * When componentSlugAliases is provided, slugs are normalized to the canonical form (e.g. radiobutton -> radio-button)
 * and merged; mergedSlugs lists original slugs that were aliased into this canonical one.
 */
function indexByComponent(inventory, componentSlugAliases = {}) {
  const bySlug = new Map();
  function ensure(canonical) {
    if (!bySlug.has(canonical)) bySlug.set(canonical, { webComponent: null, tegelLite: null, mergedSlugs: [] });
    return bySlug.get(canonical);
  }
  (inventory.webComponents || []).forEach((comp) => {
    const slug = componentSlug(comp.component);
    const canonical = componentSlugAliases[slug] ?? slug;
    const entry = ensure(canonical);
    entry.webComponent = comp;
    if (slug !== canonical && !entry.mergedSlugs.includes(slug)) entry.mergedSlugs.push(slug);
  });
  (inventory.tegelLite || []).forEach((comp) => {
    const slug = componentSlug(comp.component);
    const canonical = componentSlugAliases[slug] ?? slug;
    const entry = ensure(canonical);
    entry.tegelLite = comp;
    if (slug !== canonical && !entry.mergedSlugs.includes(slug)) entry.mergedSlugs.push(slug);
  });
  return bySlug;
}

/**
 * Compute overlap for one component (has both web and tegel-lite).
 * Uses component aliases and property equivalences from assumptions.
 * Returns { overlap, webOnly, tegelLiteOnly, keep, consider }.
 */
function analyzeComponentOverlap(webVars, tegelLiteVars, assumptions = {}) {
  const { componentAliases = {}, propertyEquivalences = {} } = assumptions;

  const keyToVars = new Map();
  function ensure(key) {
    if (!keyToVars.has(key)) keyToVars.set(key, { web: [], tl: [] });
    return keyToVars.get(key);
  }

  webVars.forEach((v) => {
    const norm = normalizeVarName(v);
    for (const key of getMatchKeys(norm, componentAliases, propertyEquivalences)) {
      ensure(key).web.push(v);
    }
  });
  tegelLiteVars.forEach((v) => {
    const norm = normalizeVarName(v);
    for (const key of getMatchKeys(norm, componentAliases, propertyEquivalences)) {
      ensure(key).tl.push(v);
    }
  });

  const overlappingWeb = new Set();
  const overlappingTl = new Set();
  keyToVars.forEach((entry, key) => {
    if (entry.tl.length > 0) entry.web.forEach((w) => overlappingWeb.add(w));
    if (entry.web.length > 0) entry.tl.forEach((t) => overlappingTl.add(t));
  });

  const webOnlyVars = webVars.filter((v) => !overlappingWeb.has(v));
  const tlOnlyVars = tegelLiteVars.filter((v) => !overlappingTl.has(v));

  const webOnlyNormalized = webOnlyVars.map((v) => ({
    normalized: canonicalVarName(normalizeVarName(v), componentAliases),
    web: v
  }));
  const tlOnlyNormalized = tlOnlyVars.map((v) => ({
    normalized: canonicalVarName(normalizeVarName(v), componentAliases),
    tegelLite: v
  }));

  const overlap = [];
  const seenPairs = new Set();
  keyToVars.forEach((entry, key) => {
    if (entry.web.length > 0 && entry.tl.length > 0) {
      const w = entry.web[0];
      const t = entry.tl[0];
      const pairKey = `${w}\n${t}`;
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        overlap.push({ normalized: key, web: w, tegelLite: t });
      }
    }
  });

  const keep = overlap.map((o) => ({
    recommendation: 'keep',
    normalized: o.normalized,
    web: o.web,
    tegelLite: o.tegelLite,
    note: 'Present in both sources; align on a single token.'
  }));

  const consider = [
    ...webOnlyNormalized.map(({ normalized, web }) => ({
      recommendation: 'consider',
      source: 'web-only',
      normalized,
      web,
      tegelLite: null,
      note: 'Only in web component; consider adding to tegel-lite or deprecating.'
    })),
    ...tlOnlyNormalized.map(({ normalized, tegelLite }) => ({
      recommendation: 'consider',
      source: 'tegel-lite-only',
      normalized,
      web: null,
      tegelLite,
      note: 'Only in tegel-lite; consider adding to web or deprecating.'
    }))
  ];

  return {
    overlap,
    webOnly: webOnlyNormalized,
    tegelLiteOnly: tlOnlyNormalized,
    keep,
    consider,
    summary: {
      overlapCount: overlap.length,
      webOnlyCount: webOnlyNormalized.length,
      tegelLiteOnlyCount: tlOnlyNormalized.length,
      keepCount: keep.length,
      considerCount: consider.length
    }
  };
}

/**
 * Resolve audit output dir from latest-run.json (same as mapping script).
 */
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
 * Generate overlap analysis report (markdown).
 */
function generateOverlapMarkdown(report) {
  let md = `# Overlap Analysis (Web vs Tegel Lite)\n\n`;
  md += `Generated: ${report.generated}  \n`;
  md += `Audit format version: ${report.auditFormatVersion || '1.0'}\n\n`;

  md += `## Summary\n\n`;
  const s = report.summary;
  md += `- **Components with both sources**: ${s.componentsWithBothSources}\n`;
  md += `- **Total overlap (same normalized name)**: ${s.totalOverlapCount}\n`;
  md += `- **Web-only variables**: ${s.totalWebOnlyCount}\n`;
  md += `- **Tegel Lite-only variables**: ${s.totalTegelLiteOnlyCount}\n`;
  md += `- **Recommendations – keep**: ${s.totalKeepCount}\n`;
  md += `- **Recommendations – consider**: ${s.totalConsiderCount}\n`;
  md += `\n`;
  md += `*Summary structure is extensible; we can add more data points later (e.g. optimisations, overlap metrics).*\n\n`;
  md += `---\n\n`;

  report.components.forEach((comp) => {
    if (!comp.bothSources) {
      md += `## ${comp.slug}\n\n`;
      md += `Only one source (web or tegel-lite). No overlap to report.\n\n`;
      return;
    }

    const a = comp.analysis;
    md += `## ${comp.slug}\n\n`;
    md += `**Overlap**: ${a.summary.overlapCount}  \n`;
    md += `**Web-only**: ${a.summary.webOnlyCount}  \n`;
    md += `**Tegel Lite-only**: ${a.summary.tegelLiteOnlyCount}\n\n`;

    const mergedSlugs = comp.mergedSlugs || [];
    if (mergedSlugs.length > 0) {
      md += `**Merged from**: ${mergedSlugs.map((s) => `\`${s}\``).join(', ')} (component slug alias → canonical \`${comp.slug}\`).  \n`;
    }
    md += `**Assumptions**: Variable matching uses component aliases and property equivalences from \`tokens/audit/overlap-assumptions.json\`.\n\n`;

    if (a.keep.length > 0) {
      md += `### Keep (in both)\n\n`;
      a.keep.forEach((k) => {
        md += `- \`--${k.web}\` (web) ↔ \`--${k.tegelLite}\` (tegel-lite) → \`${k.normalized}\`\n`;
      });
      md += `\n`;
    }

    if (a.consider.length > 0) {
      md += `### Consider\n\n`;
      a.consider.forEach((c) => {
        if (c.source === 'web-only') {
          md += `- **Web-only**: \`--${c.web}\` → ${c.note}\n`;
        } else {
          md += `- **Tegel Lite-only**: \`--${c.tegelLite}\` → ${c.note}\n`;
        }
      });
      md += `\n`;
    }

    md += `---\n\n`;
  });

  return md;
}

/**
 * Main: read inventory from latest run, analyze overlap, write reports.
 */
function analyzeOverlap() {
  const { outputDir, runId } = resolveAuditOutputDir();
  console.log(`Audit catalog: tokens/audit/${runId}/`);

  const inventoryPath = join(outputDir, '_variable-inventory.json');
  let inventory;
  try {
    inventory = JSON.parse(readFileSync(inventoryPath, 'utf-8'));
  } catch (e) {
    console.error('Could not read _variable-inventory.json. Run npm run audit:tokens first.');
    process.exit(1);
  }

  // Backwards compatibility: older runs used "tegelLight" instead of "tegelLite"
  if (!inventory.tegelLite && inventory.tegelLight) {
    inventory.tegelLite = inventory.tegelLight;
  }

  const assumptions = loadOverlapAssumptions();
  const bySlug = indexByComponent(inventory, assumptions.componentSlugAliases);
  const generated = new Date().toISOString();
  const auditFormatVersion = inventory.auditFormatVersion || '1.0';

  const components = [];
  let totalOverlapCount = 0;
  let totalWebOnlyCount = 0;
  let totalTegelLiteOnlyCount = 0;
  let totalKeepCount = 0;
  let totalConsiderCount = 0;
  let componentsWithBothSources = 0;

  [...bySlug.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([slug, { webComponent, tegelLite, mergedSlugs }]) => {
      const bothSources = !!(webComponent && tegelLite);
      if (bothSources) componentsWithBothSources++;

      const entry = {
        slug,
        bothSources,
        mergedSlugs: mergedSlugs || [],
        analysis: null
      };

      if (bothSources) {
        const webVars = webComponent.variables || [];
        const tlVars = tegelLite.variables || [];
        const analysis = analyzeComponentOverlap(webVars, tlVars, assumptions);
        entry.analysis = analysis;
        totalOverlapCount += analysis.summary.overlapCount;
        totalWebOnlyCount += analysis.summary.webOnlyCount;
        totalTegelLiteOnlyCount += analysis.summary.tegelLiteOnlyCount;
        totalKeepCount += analysis.summary.keepCount;
        totalConsiderCount += analysis.summary.considerCount;
      }

      components.push(entry);
    });

  const report = {
    auditFormatVersion,
    generated,
    summary: {
      componentsWithBothSources,
      totalOverlapCount,
      totalWebOnlyCount,
      totalTegelLiteOnlyCount,
      totalKeepCount,
      totalConsiderCount
      // Extensible: add totalOptimisationCandidates, overlapPercent, etc. later
    },
    components
  };

  const jsonPath = join(outputDir, '_overlap-analysis.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`✓ Created ${jsonPath}`);

  const markdown = generateOverlapMarkdown(report);
  const mdPath = join(outputDir, '_overlap-analysis.md');
  writeFileSync(mdPath, markdown);
  console.log(`✓ Created ${mdPath}`);

  return { jsonPath, mdPath };
}

const invokedAsMain =
  process.argv[1] && resolve(process.cwd(), process.argv[1]) === join(__dirname, 'analyze-overlap.js');
if (invokedAsMain) {
  analyzeOverlap();
}

export {
  analyzeOverlap,
  analyzeComponentOverlap,
  normalizeVarName,
  canonicalVarName,
  getMatchKeys,
  loadOverlapAssumptions,
  indexByComponent
};
