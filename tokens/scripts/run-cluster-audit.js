#!/usr/bin/env node
/**
 * Cluster Audit Runner
 *
 * Runs the token audit on a curated set of components (cluster). Slugs come from
 * tokens/audit/audit-cluster.json (componentSlugs array) if present and non-empty,
 * otherwise from CLI args: npm run audit:tokens:cluster -- button text-field chip
 * or from env AUDIT_COMPONENTS (comma-separated).
 *
 * Run from project root: npm run audit:tokens:cluster [slug1 slug2 ...]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');
const CLUSTER_CONFIG_PATH = join(AUDIT_BASE_DIR, 'audit-cluster.json');

function getRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function loadClusterSlugs() {
  try {
    const data = JSON.parse(readFileSync(CLUSTER_CONFIG_PATH, 'utf-8'));
    const list = Array.isArray(data.componentSlugs) ? data.componentSlugs : [];
    return list.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
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

function main() {
  let slugs = loadClusterSlugs();
  if (slugs.length === 0) {
    const fromArgs = process.argv.slice(2).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    if (fromArgs.length > 0) {
      slugs = fromArgs;
    } else {
      const fromEnv = process.env.AUDIT_COMPONENTS;
      if (fromEnv && typeof fromEnv === 'string') {
        slugs = fromEnv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      }
    }
  }

  if (slugs.length === 0) {
    console.error('No component slugs provided.');
    console.error('  Option 1: Edit tokens/audit/audit-cluster.json and set "componentSlugs": ["button", "text-field", ...]');
    console.error('  Option 2: npm run audit:tokens:cluster -- button text-field chip');
    console.error('  Option 3: AUDIT_COMPONENTS=button,text-field,chip npm run audit:tokens:cluster');
    process.exit(1);
  }

  const runId = `${getRunId()}-cluster`;
  mkdirSync(AUDIT_BASE_DIR, { recursive: true });
  writeFileSync(
    join(AUDIT_BASE_DIR, 'latest-run.json'),
    JSON.stringify({ runId, generated: new Date().toISOString() }, null, 2)
  );

  console.log(`Cluster audit: ${slugs.length} component(s): ${slugs.join(', ')}\n`);

  const env = {
    AUDIT_RUN_ID: runId,
    AUDIT_COMPONENTS: slugs.join(',')
  };

  // Phase 0: Figma color snapshot (optional — skips if FIGMA_API_KEY not set)
  if (process.env.FIGMA_API_KEY) {
    try {
      runScript('fetch-figma-colors.js', { ...env, FIGMA_FILE_KEY: process.env.FIGMA_FILE_KEY || '' });
    } catch (e) {
      console.warn(`  Warning: Figma fetch failed (${e.message}). Continuing without Figma data.`);
    }
  } else {
    console.log('  Skipping Phase 0 (Figma fetch) — FIGMA_API_KEY not set.\n');
  }

  runScript('generate-variable-inventory.js', env);
  runScript('map-variables-to-tokens.js', env);
  runScript('analyze-overlap.js', env);
  runScript('scan-hardcoded-values.js', env);
  runScript('analyze-alias-chains.js', env);
  runScript('extract-variant-matrix.js', env);
  runScript('validate-taxonomy-naming.js', env);
  runScript('generate-audit-report.js', env);

  console.log(`\n✓ Cluster audit done. Output: tokens/audit/${runId}/`);
}

main();
