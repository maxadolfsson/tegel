#!/usr/bin/env node
/**
 * Fix Overlay Variable Values in Figma
 *
 * Renames and deletes were done via Plugin API. This script sets the
 * correct values on the remaining 2 variables via REST API.
 *
 * Variables (already renamed):
 *   - component/overlay/background/default (COLOR): #000000 light, #15181d dark
 *   - component/overlay/opacity/default (FLOAT): 60 light, 84 dark
 *
 * Usage:
 *   node tokens/scripts/fix-overlay-variables.js                  # preview
 *   node tokens/scripts/fix-overlay-variables.js --push           # execute
 *
 * Env: FIGMA_API_KEY
 */

import { figmaFetch } from './lib/figma-rest.js';

const API_KEY = process.env.FIGMA_API_KEY;
const FIGMA_API = 'https://api.figma.com';
// Branch keys are not committed — this repo's public fork would publish them.
// Cluster #4 (Card/Overlay/Modal/Scrollbar) branch key: cluster-roadmap.md, private work repo.
// Supply with --branch <key> or FIGMA_BRANCH_KEY.
const BRANCH_KEY = process.env.FIGMA_BRANCH_KEY;

// Mode IDs
const TRATON_LIGHT = '68:0';
const TRATON_DARK = '572:1';
const SCANIA_LIGHT = '26148:0';
const SCANIA_DARK = '26148:2';

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { branch: BRANCH_KEY, push: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--branch' && args[i + 1]) parsed.branch = args[++i];
    else if (args[i] === '--push') parsed.push = true;
  }
  if (!parsed.branch) {
    console.error(
      'No branch key. Pass --branch <key> or set FIGMA_BRANCH_KEY.\n' +
        'Cluster #4 branch key lives in cluster-roadmap.md in the private work repo.',
    );
    process.exit(1);
  }
  return parsed;
}

function hexToRgba(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
    a: 1,
  };
}

async function fetchVariables(fileKey) {
  const res = await figmaFetch(`${FIGMA_API}/v1/files/${fileKey}/variables/local`, {
    headers: { 'X-Figma-Token': API_KEY },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.meta || data;
}

async function postVariables(fileKey, payload) {
  const res = await figmaFetch(`${FIGMA_API}/v1/files/${fileKey}/variables`, {
    method: 'POST',
    headers: { 'X-Figma-Token': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Post failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  if (!API_KEY) { console.error('Error: FIGMA_API_KEY not set.'); process.exit(1); }

  const { branch, push: shouldPush } = parseArgs();
  const dryRun = !shouldPush;
  const fileKey = branch;

  console.log(`${dryRun ? 'PREVIEW' : 'PUSH'}: Fix overlay variable values`);
  console.log(`  File: ${fileKey} (branch)`);
  if (dryRun) console.log('  Mode: preview only — add --push to write\n');

  // Fetch existing variables
  console.log('Fetching existing variables...');
  const meta = await fetchVariables(fileKey);
  const variables = meta.variables || {};

  // Find overlay vars by name
  const overlayVars = {};
  for (const [id, v] of Object.entries(variables)) {
    if (v.name.startsWith('component/overlay/')) {
      overlayVars[v.name] = { id, ...v };
    }
  }

  console.log(`  Found ${Object.keys(overlayVars).length} overlay variable(s):`);
  for (const [name, v] of Object.entries(overlayVars)) {
    console.log(`    ${name} (${v.id})`);
  }
  console.log('');

  const bgVar = overlayVars['component/overlay/background/default'];
  const opVar = overlayVars['component/overlay/opacity/default'];

  if (!bgVar) { console.error('ERROR: background/default not found'); process.exit(1); }
  if (!opVar) { console.error('ERROR: opacity/default not found'); process.exit(1); }

  // Build mode value updates
  const black = hexToRgba('#000000');
  const grey900 = hexToRgba('#15181d');

  const variableModeValues = [
    // Background: #000000 light, #15181d dark
    { variableId: bgVar.id, modeId: TRATON_LIGHT, value: black },
    { variableId: bgVar.id, modeId: TRATON_DARK, value: grey900 },
    { variableId: bgVar.id, modeId: SCANIA_LIGHT, value: black },
    { variableId: bgVar.id, modeId: SCANIA_DARK, value: grey900 },
    // Opacity: 60 light, 84 dark
    { variableId: opVar.id, modeId: TRATON_LIGHT, value: 60 },
    { variableId: opVar.id, modeId: TRATON_DARK, value: 84 },
    { variableId: opVar.id, modeId: SCANIA_LIGHT, value: 60 },
    { variableId: opVar.id, modeId: SCANIA_DARK, value: 84 },
  ];

  console.log('Actions:');
  console.log(`  SET background: Light=#000000, Dark=#15181d (TRATON + Scania)`);
  console.log(`  SET opacity: Light=60, Dark=84 (TRATON + Scania)`);
  console.log(`  Total: ${variableModeValues.length} mode values\n`);

  if (dryRun) {
    console.log('── Preview payload ──');
    console.log(JSON.stringify({ variableModeValues }, null, 2));
    console.log('─────────────────────');
    console.log('\nPreview complete. No changes made.');
    console.log('To push, re-run with --push');
    return;
  }

  console.log('Pushing to Figma...');
  await postVariables(fileKey, { variableModeValues });
  console.log(`Done. Set ${variableModeValues.length} mode values.`);
}

main().catch(err => { console.error(err); process.exit(1); });
