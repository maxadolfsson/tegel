#!/usr/bin/env node
/**
 * Full Audit Runner
 *
 * Runs the complete token audit pipeline on ALL components (no filter).
 * Produces a single timestamped directory with every phase output.
 *
 * Run from project root: npm run audit:tokens
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');

function getRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function runScript(scriptName, env) {
  const scriptPath = join(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT_DIR,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${scriptName} exited with ${result.status}`);
  }
}

function main() {
  const runId = getRunId();
  mkdirSync(AUDIT_BASE_DIR, { recursive: true });
  writeFileSync(
    join(AUDIT_BASE_DIR, 'latest-run.json'),
    JSON.stringify({ runId, generated: new Date().toISOString() }, null, 2),
  );

  console.log(`Full audit: all components\n`);

  const env = { AUDIT_RUN_ID: runId };

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

  console.log(`\n✓ Full audit done. Output: tokens/audit/${runId}/`);
}

main();
