#!/usr/bin/env node
/**
 * Prune old audit run folders, keeping only the last N runs (or remove all).
 *
 * Usage: node tokens/scripts/prune-audit-runs.js [N]
 *   N = number of runs to keep (default 3). Only timestamped dirs (YYYYMMDD-HHmmss, quick-YYYYMMDD-HHmmss) are counted.
 *   N = 0 or "all" → remove all run folders (prune all).
 * Does not remove latest-run.json, quick-audit-covered.json, overlap-assumptions.json, audit-ignore.json, or .gitkeep.
 */

import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_BASE_DIR = join(__dirname, '..', 'audit');

const arg = process.argv[2];
const pruneAll = arg === '0' || String(arg).toLowerCase() === 'all';
const KEEP = pruneAll ? 0 : Math.max(0, parseInt(arg, 10) || 3);

const entries = readdirSync(AUDIT_BASE_DIR, { withFileTypes: true });
const runDirs = entries
  .filter((e) => e.isDirectory())
  .map((e) => ({
    name: e.name,
    path: join(AUDIT_BASE_DIR, e.name),
    mtime: statSync(join(AUDIT_BASE_DIR, e.name)).mtimeMs
  }))
  .sort((a, b) => b.mtime - a.mtime);

const toRemove = pruneAll ? runDirs : runDirs.slice(KEEP);

if (toRemove.length === 0) {
  console.log(pruneAll ? 'No audit run folders to remove.' : `No audit runs to prune (keeping last ${KEEP}).`);
  process.exit(0);
}

if (pruneAll) {
  console.log(`Removing all ${toRemove.length} audit run folder(s):`);
} else {
  console.log(`Pruning ${toRemove.length} old run(s), keeping last ${KEEP}:`);
}
toRemove.forEach((d) => {
  console.log(`  - ${d.name}`);
  rmSync(d.path, { recursive: true });
});
console.log('Done.');
