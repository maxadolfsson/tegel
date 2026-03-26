#!/usr/bin/env node
/**
 * Token Pipeline Status
 *
 * Quick snapshot of audit data freshness, key metrics, and suggestions.
 * Think `git status` for the token pipeline.
 *
 * Usage:
 *   node tokens/scripts/status.js
 *   npm run audit:status
 */

import { readFileSync, readdirSync, readlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_DIR = join(ROOT_DIR, 'tokens', 'audit');

// ── ANSI colors (respects NO_COLOR) ─────────────────────────

const noColor = !!process.env.NO_COLOR;
const C = {
  green: noColor ? '' : '\x1b[32m',
  yellow: noColor ? '' : '\x1b[33m',
  red: noColor ? '' : '\x1b[31m',
  dim: noColor ? '' : '\x1b[2m',
  bold: noColor ? '' : '\x1b[1m',
  cyan: noColor ? '' : '\x1b[36m',
  reset: noColor ? '' : '\x1b[0m',
};

// ── Staleness thresholds (days) ──────────────────────────────

const THRESHOLDS = {
  fullAudit: { fresh: 3, stale: 7 },
  colors: { fresh: 1, stale: 3 },
  palette: { fresh: 3, stale: 7 },
  quickCover: { fresh: 7, stale: 14 },
};

const COMMANDS = {
  fullAudit: 'npm run audit:tokens',
  colors: 'npm run audit:figma:colors',
  palette: 'npm run audit:tokens:palette',
  quickCover: 'npm run audit:tokens:quick',
};

// ── Utilities ────────────────────────────────────────────────

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function parseRunTimestamp(name) {
  const m = String(name).match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
}

function formatAge(date) {
  if (!date) return 'unknown';
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function ageDays(date) {
  if (!date) return Infinity;
  return (Date.now() - date.getTime()) / 86400000;
}

function freshnessColor(date, threshold) {
  const days = ageDays(date);
  if (days <= threshold.fresh) return C.green;
  if (days <= threshold.stale) return C.yellow;
  return C.red;
}

function freshnessLabel(date, threshold) {
  const days = ageDays(date);
  if (days <= threshold.fresh) return 'fresh';
  if (days <= threshold.stale) return 'stale';
  return 'old';
}

function pad(str, len) {
  return String(str).padEnd(len);
}

// ── Data readers ─────────────────────────────────────────────

function getLatestRun() {
  const data = readJson(join(AUDIT_DIR, 'latest-run.json'));
  if (!data?.runId) return null;
  return { runId: data.runId, date: parseRunTimestamp(data.runId) };
}

function getLatestColors() {
  try {
    const target = readlinkSync(join(AUDIT_DIR, 'latest-colors'));
    const date = parseRunTimestamp(target);
    return { dirName: target, date };
  } catch {
    return null;
  }
}

function getLatestPalette() {
  try {
    const dirs = readdirSync(AUDIT_DIR).filter((d) => d.endsWith('-palette'));
    if (!dirs.length) return null;
    dirs.sort().reverse();
    const latest = dirs[0];
    return { dirName: latest, date: parseRunTimestamp(latest) };
  } catch {
    return null;
  }
}

function getQuickCoverage() {
  const data = readJson(join(AUDIT_DIR, 'quick-audit-covered.json'));
  if (!data) return null;
  const slugs = Array.isArray(data.coveredSlugs) ? data.coveredSlugs : [];
  const date = data.updated ? new Date(data.updated) : null;
  return { count: slugs.length, date };
}

function getHealthMetrics(runId) {
  if (!runId) return null;
  const data = readJson(join(AUDIT_DIR, runId, '_taxonomy-health.json'));
  if (!data?.health) return null;
  const h = data.health;
  return {
    complianceRate: h.namingCompliance?.complianceRate ?? null,
    validCount: h.namingCompliance?.valid ?? null,
    totalVars: h.namingCompliance?.totalVariables ?? null,
    hardcodedTotal: h.hardcodedDebt?.totalHardcoded ?? null,
    hardcodedComponents: h.hardcodedDebt?.componentsAffected ?? null,
    mismatchTotal: h.coverageGaps?.totalMismatches ?? null,
    mismatchWeb: h.coverageGaps?.webComponentGaps ?? null,
    mismatchLite: h.coverageGaps?.tegelLiteGaps ?? null,
  };
}

function getCluster() {
  const data = readJson(join(AUDIT_DIR, 'audit-cluster.json'));
  return Array.isArray(data?.componentSlugs) ? data.componentSlugs : [];
}

function getLibraries() {
  const data = readJson(join(AUDIT_DIR, 'figma-libraries.json'));
  return Array.isArray(data?.libraries) ? data.libraries.map((l) => l.label) : [];
}

// ── Output ───────────────────────────────────────────────────

function printRow(label, detail, date, threshold) {
  const color = date ? freshnessColor(date, threshold) : C.dim;
  const dot = date ? `${color}●${C.reset} ${freshnessLabel(date, threshold)}` : `${C.dim}● not found${C.reset}`;
  const age = date ? `(${formatAge(date)})` : '';
  console.log(`  ${pad(label, 15)}${pad(detail, 24)}${pad(age, 18)}${dot}`);
}

function main() {
  console.log(`\n${C.bold}Token Pipeline Status${C.reset}`);
  console.log('=====================\n');

  const run = getLatestRun();
  const colors = getLatestColors();
  const palette = getLatestPalette();
  const quick = getQuickCoverage();

  printRow('Full audit', run?.runId || '-', run?.date, THRESHOLDS.fullAudit);
  printRow('Figma colors', colors?.dirName || '-', colors?.date, THRESHOLDS.colors);
  printRow('Palette', palette?.dirName || '-', palette?.date, THRESHOLDS.palette);
  printRow('Quick coverage', quick ? `${quick.count}/32 slugs` : '-', quick?.date, THRESHOLDS.quickCover);

  // Metrics
  const metrics = getHealthMetrics(run?.runId);
  if (metrics) {
    console.log(`\n${C.bold}Metrics${C.reset} ${C.dim}(from ${run.runId})${C.reset}`);
    if (metrics.complianceRate !== null) {
      console.log(`  Naming compliance   ${metrics.complianceRate}% (${metrics.validCount}/${metrics.totalVars} variables)`);
    }
    if (metrics.hardcodedTotal !== null) {
      console.log(`  Hardcoded values    ${metrics.hardcodedTotal} across ${metrics.hardcodedComponents} components`);
    }
    if (metrics.mismatchTotal !== null) {
      console.log(`  Variant mismatches  ${metrics.mismatchTotal} (${metrics.mismatchWeb} web, ${metrics.mismatchLite} lite)`);
    }
  }

  // Config
  const cluster = getCluster();
  const libs = getLibraries();
  console.log('');
  if (cluster.length) console.log(`${C.dim}Cluster${C.reset}   ${cluster.join(', ')}`);
  if (libs.length) console.log(`${C.dim}Libraries${C.reset} ${libs.join(', ')}`);

  // Suggestion
  const sources = [
    { key: 'fullAudit', date: run?.date, label: 'Full audit' },
    { key: 'colors', date: colors?.date, label: 'Figma colors' },
    { key: 'palette', date: palette?.date, label: 'Palette' },
    { key: 'quickCover', date: quick?.date, label: 'Quick coverage' },
  ];

  let stalest = null;
  let maxRatio = 0;
  for (const s of sources) {
    const days = ageDays(s.date);
    const threshold = THRESHOLDS[s.key];
    const ratio = days / threshold.stale;
    if (ratio > maxRatio) {
      maxRatio = ratio;
      stalest = s;
    }
  }

  console.log('');
  if (stalest && maxRatio > 1) {
    const days = Math.floor(ageDays(stalest.date));
    const detail = stalest.date
      ? `${stalest.label} is ${days} day${days === 1 ? '' : 's'} old`
      : `${stalest.label} has never been run`;
    console.log(`${C.yellow}Suggestion${C.reset}`);
    console.log(`  → ${detail} — run: ${C.cyan}${COMMANDS[stalest.key]}${C.reset}`);
  } else {
    console.log(`${C.green}All data sources are fresh.${C.reset}`);
  }

  console.log('');
}

main();
