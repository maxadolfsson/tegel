#!/usr/bin/env node
/**
 * Quick Audit Runner (Phase 2)
 *
 * Runs the token audit on 3 random components for faster trials.
 * Skips components already covered in previous quick-audit runs so you never
 * get the same component twice until all have been covered (then resets).
 *
 * Run from project root: npm run audit:tokens:quick
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { auditCssVariables, componentSlug } from './audit-css-variables.js';
import { loadAuditIgnore, loadOverlapAssumptions } from './audit-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');
const QUICK_COVERED_PATH = join(AUDIT_BASE_DIR, 'quick-audit-covered.json');
const QUICK_COUNT = 3;

function getRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function loadQuickCovered() {
  try {
    const data = JSON.parse(readFileSync(QUICK_COVERED_PATH, 'utf-8'));
    return new Set(Array.isArray(data.coveredSlugs) ? data.coveredSlugs : []);
  } catch {
    return new Set();
  }
}

function saveQuickCovered(coveredSet) {
  mkdirSync(AUDIT_BASE_DIR, { recursive: true });
  writeFileSync(
    QUICK_COVERED_PATH,
    JSON.stringify(
      { coveredSlugs: [...coveredSet].sort(), updated: new Date().toISOString() },
      null,
      2
    )
  );
}

/** Fisher–Yates shuffle then take first n */
function pickRandom(set, n) {
  const arr = [...set];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

function runScript(scriptName, env) {
  const scriptPath = join(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT_DIR,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${scriptName} exited with ${result.status}`);
  }
}

/** Return canonical slug (merge aliases e.g. radiobutton -> radio-button). */
function toCanonicalSlug(slug, componentSlugAliases) {
  return componentSlugAliases[slug] ?? slug;
}

/** Return set of raw slugs that map to this canonical (for ignore check). */
function rawSlugsForCanonical(canonical, componentSlugAliases) {
  const raw = new Set([canonical]);
  Object.entries(componentSlugAliases || {}).forEach(([k, v]) => {
    if (v === canonical) raw.add(k);
  });
  return raw;
}

function main() {
  console.log('Quick audit: selecting 3 random components (skipping already covered)...\n');

  const { componentSlugAliases } = loadOverlapAssumptions();
  const auditData = auditCssVariables();
  const allSlugs = new Set();
  (auditData.webComponents || []).forEach((c) => allSlugs.add(toCanonicalSlug(componentSlug(c.component), componentSlugAliases)));
  (auditData.tegelLite || []).forEach((c) => allSlugs.add(toCanonicalSlug(componentSlug(c.component), componentSlugAliases)));

  if (allSlugs.size === 0) {
    console.error('No components found. Check packages/core paths.');
    process.exit(1);
  }

  const ignored = loadAuditIgnore();
  if (ignored.size > 0) {
    console.log(`Ignoring ${ignored.size} component(s): ${[...ignored].sort().join(', ')}\n`);
  }

  const isIgnored = (canonical) => {
    const raws = rawSlugsForCanonical(canonical, componentSlugAliases);
    return [...raws].some((r) => ignored.has(r));
  };

  let covered = loadQuickCovered();
  let remaining = new Set([...allSlugs].filter((s) => !covered.has(s) && !isIgnored(s)));

  if (remaining.size === 0) {
    console.log('All components have been quick-audited. Resetting covered list for this run.\n');
    covered = new Set();
    remaining = new Set([...allSlugs].filter((s) => !ignored.has(s)));
  }
  if (remaining.size === 0) {
    console.error('No components left to audit (all ignored or already covered).');
    process.exit(1);
  }

  const pickCount = Math.min(QUICK_COUNT, remaining.size);
  const chosen = pickRandom(remaining, pickCount);

  console.log(`Chosen: ${chosen.join(', ')}\n`);

  const runId = `quick-${getRunId()}`;
  const outputDir = join(AUDIT_BASE_DIR, runId);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(AUDIT_BASE_DIR, 'latest-run.json'),
    JSON.stringify({ runId, generated: new Date().toISOString() }, null, 2)
  );

  const env = {
    AUDIT_RUN_ID: runId,
    AUDIT_COMPONENTS: chosen.join(',')
  };

  runScript('generate-variable-inventory.js', env);
  runScript('map-variables-to-tokens.js', env);
  runScript('analyze-overlap.js', env);
  runScript('scan-hardcoded-values.js', env);
  runScript('analyze-alias-chains.js', env);
  runScript('extract-variant-matrix.js', env);
  runScript('validate-taxonomy-naming.js', env);
  runScript('generate-audit-report.js', env);

  chosen.forEach((s) => covered.add(s));
  saveQuickCovered(covered);

  console.log(`\n✓ Quick audit done. Output: tokens/audit/${runId}/`);
  console.log(`  Covered so far: ${covered.size}/${allSlugs.size} components.`);
}

main();
