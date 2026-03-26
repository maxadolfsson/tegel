#!/usr/bin/env node
/**
 * Fetch Figma Colors — Styles + Variables
 *
 * Hits the Figma REST API to retrieve:
 *   1. Published Color Styles  (GET /v1/files/:key/styles)
 *   2. Local Color Variables    (GET /v1/files/:key/variables/local)
 *
 * Outputs to tokens/audit/{timestamp}-colors/.
 *
 * Usage:
 *   node tokens/scripts/fetch-figma-colors.js                          # all registered libraries (default)
 *   node tokens/scripts/fetch-figma-colors.js --file <key>             # single file by key
 *   node tokens/scripts/fetch-figma-colors.js --file <key> --label x   # single file with custom label
 *   node tokens/scripts/fetch-figma-colors.js --branch <branchKey>     # use branch for all libraries
 *
 * Env:
 *   FIGMA_API_KEY   — Personal access token (required)
 *   FIGMA_FILE_KEY  — File key (fallback if no --file or --all)
 */

import { writeFileSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');
const REGISTRY_PATH = join(AUDIT_BASE_DIR, 'figma-libraries.json');

const API_KEY = process.env.FIGMA_API_KEY;
const FIGMA_API = 'https://api.figma.com';

// ── CLI args ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { file: null, label: null, branch: null, all: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) parsed.file = args[++i];
    else if (args[i] === '--label' && args[i + 1]) parsed.label = args[++i];
    else if (args[i] === '--branch' && args[i + 1]) parsed.branch = args[++i];
    else if (args[i] === '--all') parsed.all = true;
  }
  return parsed;
}

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

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) return null;
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
}

// ── Figma API ─────────────────────────────────────────────────

async function figmaGet(path) {
  const url = `${FIGMA_API}${path}`;
  const res = await fetch(url, {
    headers: { 'X-Figma-Token': API_KEY },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API ${res.status} for ${path}: ${body}`);
  }
  return res.json();
}

async function fetchStyles(fileKey) {
  const data = await figmaGet(`/v1/files/${fileKey}/styles`);
  const styles = (data.meta?.styles ?? []).filter(
    (s) => s.style_type === 'FILL'
  );
  return styles.map((s) => ({
    key: s.key,
    name: s.name,
    description: s.description || '',
    nodeId: s.node_id,
    type: 'style',
  }));
}

async function fetchVariables(fileKey) {
  const data = await figmaGet(`/v1/files/${fileKey}/variables/local`);

  const collections = data.meta?.variableCollections ?? {};
  const variables = data.meta?.variables ?? {};

  const collectionNames = {};
  for (const [id, col] of Object.entries(collections)) {
    collectionNames[id] = col.name;
    collectionNames[`${id}:modes`] = col.modes;
  }

  const results = [];
  for (const [id, v] of Object.entries(variables)) {
    if (v.resolvedType !== 'COLOR') continue;

    const modes = collectionNames[`${v.variableCollectionId}:modes`] || [];
    const values = {};
    for (const [modeId, val] of Object.entries(v.valuesByMode ?? {})) {
      const modeName =
        modes.find((m) => m.modeId === modeId)?.name ?? modeId;
      if (val.type === 'VARIABLE_ALIAS') {
        const aliasVar = variables[val.id];
        values[modeName] = {
          alias: true,
          aliasName: aliasVar?.name ?? val.id,
          aliasId: val.id,
        };
      } else {
        values[modeName] = {
          r: Math.round((val.r ?? 0) * 255),
          g: Math.round((val.g ?? 0) * 255),
          b: Math.round((val.b ?? 0) * 255),
          a: val.a ?? 1,
          hex: rgbToHex(val.r, val.g, val.b),
        };
      }
    }

    results.push({
      id,
      name: v.name,
      collection: collectionNames[v.variableCollectionId] || 'Unknown',
      description: v.description || '',
      hiddenFromPublishing: v.hiddenFromPublishing ?? false,
      scopes: v.scopes ?? [],
      values,
      type: 'variable',
    });
  }

  return results;
}

function rgbToHex(r, g, b) {
  const toHex = (f) =>
    Math.round(Math.min(1, Math.max(0, f)) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ── Markdown Report ───────────────────────────────────────────

function generateMarkdown(fileKey, label, branch, styles, variables) {
  const lines = [];
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const title = label ? `Figma Color Inventory — ${label}` : 'Figma Color Inventory';
  lines.push(`# ${title} (REST API)`);
  lines.push('');
  const branchNote = branch ? ` (branch: \`${branch}\`)` : '';
  lines.push(`Fetched from file \`${fileKey}\`${branchNote} at ${now}.`);
  lines.push('');

  // ── Styles section ──
  lines.push(`## Color Styles (${styles.length})`);
  lines.push('');
  if (styles.length) {
    lines.push('| # | Name | Description | Node ID |');
    lines.push('|---|------|-------------|---------|');
    styles.forEach((s, i) => {
      lines.push(
        `| ${i + 1} | ${s.name} | ${s.description} | \`${s.nodeId}\` |`
      );
    });
  } else {
    lines.push('_No published color styles found._');
  }
  lines.push('');

  // ── Variables section ──
  const collectionList = [...new Set(variables.map((v) => v.collection))];
  const published = variables.filter((v) => !v.hiddenFromPublishing);
  const hidden = variables.filter((v) => v.hiddenFromPublishing);

  lines.push(
    `## Color Variables (${variables.length} total, ${published.length} published, ${hidden.length} hidden)`
  );
  lines.push('');

  for (const col of collectionList) {
    const vars = variables.filter((v) => v.collection === col);
    lines.push(`### Collection: ${col} (${vars.length} variables)`);
    lines.push('');

    const modeNames = vars.length ? Object.keys(vars[0].values) : [];
    const modeHeaders = modeNames.map((m) => ` ${m} |`).join('');
    const modeDashes = modeNames.map(() => ' --- |').join('');

    lines.push(`| # | Name | Published | Scopes |${modeHeaders}`);
    lines.push(`|---|------|-----------|--------|${modeDashes}`);

    vars.forEach((v, i) => {
      const pub = v.hiddenFromPublishing ? 'no' : 'yes';
      const scopes = v.scopes.join(', ') || '-';
      const modeCols = modeNames
        .map((m) => {
          const val = v.values[m];
          if (!val) return ' - |';
          if (val.alias) return ` -> ${val.aliasName} |`;
          return ` \`${val.hex}\` |`;
        })
        .join('');
      lines.push(`| ${i + 1} | ${v.name} | ${pub} | ${scopes} |${modeCols}`);
    });
    lines.push('');
  }

  lines.push('---');
  lines.push(
    `**${styles.length} styles + ${variables.length} variables = ${styles.length + variables.length} total color definitions.**`
  );
  lines.push('');

  return lines.join('\n');
}

// ── File Output ───────────────────────────────────────────────

function updateSymlink(target, linkPath) {
  if (existsSync(linkPath)) unlinkSync(linkPath);
  symlinkSync(target, linkPath);
}

function writeOutput(label, branch, runId, outDir, fileKey, styles, variables) {
  const prefix = label ? `${label}_` : '';
  const branchTag = branch ? '-branch' : '';
  const baseName = `${prefix}figma-colors${branchTag}`;

  // JSON
  const json = {
    fetchedAt: new Date().toISOString(),
    runId,
    fileKey,
    label: label || null,
    branch: branch || null,
    styles,
    variables,
  };
  const jsonPath = join(outDir, `${baseName}.json`);
  writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  console.log(`  JSON  -> ${jsonPath}`);

  // Markdown
  const md = generateMarkdown(fileKey, label, branch, styles, variables);
  const mdPath = join(outDir, `${baseName}.md`);
  writeFileSync(mdPath, md);
  console.log(`  MD    -> ${mdPath}`);
}

// ── Main ──────────────────────────────────────────────────────

async function fetchOne(fileKey, label, branch, outDir) {
  const effectiveKey = branch || fileKey;
  const displayLabel = label || fileKey;
  const branchNote = branch ? ` (branch: ${branch})` : '';

  console.log(`\nFetching "${displayLabel}"${branchNote}...`);

  const [styles, variables] = await Promise.all([
    fetchStyles(effectiveKey),
    fetchVariables(effectiveKey),
  ]);

  console.log(`  Color styles:    ${styles.length}`);
  console.log(`  Color variables: ${variables.length}`);

  writeOutput(label, branch, null, outDir, fileKey, styles, variables);
}

async function main() {
  if (!API_KEY) {
    console.error('Error: FIGMA_API_KEY env var is required.');
    process.exit(1);
  }

  const args = parseArgs();
  const runId = getRunId();
  const registry = loadRegistry();

  // Create timestamped output directory: tokens/audit/{runId}-colors/
  const runDir = `${runId}-colors`;
  const outDir = join(AUDIT_BASE_DIR, runDir);
  mkdirSync(outDir, { recursive: true });

  console.log(`Color fetch: tokens/audit/${runDir}/`);

  if (args.file) {
    // Single file mode (explicit --file override)
    const fileKey = args.file;
    let label = args.label || null;
    const branch = args.branch || null;

    if (!label && registry?.libraries) {
      const match = registry.libraries.find((l) => l.fileKey === fileKey);
      if (match) label = match.label;
    }

    await fetchOne(fileKey, label, branch, outDir);
  } else {
    // Default: fetch all registered libraries
    if (!registry?.libraries?.length) {
      console.error('Error: No libraries registered in figma-libraries.json.');
      console.error('  Use --file <key> to fetch a specific file, or add entries to the registry.');
      process.exit(1);
    }
    for (const lib of registry.libraries) {
      const branch = lib.branch || args.branch || null;
      await fetchOne(lib.fileKey, lib.label, branch, outDir);
    }
  }

  // Directory symlink: latest-colors -> {runId}-colors
  const latestLink = join(AUDIT_BASE_DIR, 'latest-colors');
  updateSymlink(runDir, latestLink);
  console.log(`\n  latest-colors -> ${runDir}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
