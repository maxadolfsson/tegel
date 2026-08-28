/**
 * Read Figma variables over REST, including extended (child) collection values.
 *
 * Why this exists: `valuesByMode` on a variable only ever holds its OWN
 * collection's modes. Child-collection values (Scania) are not on the variable
 * at all -- they live on the child collection as `variableOverrides`, keyed by
 * variable ID then by long-form mode ID. Both the Plugin API getter and a naive
 * reading of this endpoint miss them, which is what made them look unreachable.
 * See memory: figma-extended-collection-write-path (section 2).
 *
 * Brands are DERIVED from the response, not configured. A third brand joining as
 * its own child collection needs no change here and no registry entry.
 *
 * Usage:
 *   import { fetchVariables, indexVariables } from './lib/fetch-variables-rest.js';
 *   const payload = await fetchVariables(fileKey, { apiKey: process.env.FIGMA_API_KEY });
 *   const { brands, variables, orphanOverrides } = indexVariables(payload);
 *
 * CLI:
 *   node tokens/scripts/lib/fetch-variables-rest.js --file <fileKey> [--match component/dropdown]
 *   node tokens/scripts/lib/fetch-variables-rest.js --self-check
 */

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { figmaFetch } from './figma-rest.js';

/** GET the file's local variables. Thin wrapper -- all parsing lives in indexVariables. */
export async function fetchVariables(fileKey, { apiKey } = {}) {
  if (!fileKey) throw new Error('fetchVariables: fileKey is required');
  if (!apiKey) throw new Error('fetchVariables: apiKey is required (FIGMA_API_KEY)');

  const url = `https://api.figma.com/v1/files/${fileKey}/variables/local`;
  const res = await figmaFetch(url, { headers: { 'X-Figma-Token': apiKey } });

  if (!res.ok) {
    // Read the body before blaming the transport: `Token expired` means rotate
    // the PAT, `Invalid token` means it is missing or malformed. A lapsed PAT
    // once got misattributed to the sandbox for months.
    const body = (await res.text()).slice(0, 200);
    throw new Error(`Figma REST ${res.status} for ${fileKey}: ${body}`);
  }
  return res.json();
}

/**
 * Turn the raw payload into { brands, variables, orphanOverrides }.
 *
 * Pure -- no network, no env. This is the part worth testing, and --self-check
 * exercises it against a fixture.
 *
 * brands:    [{ key, name, collectionId, isChild, modes: [{ id, name }] }]
 *            `key` is the slugified collection name, stable enough to use
 *            downstream without hardcoding any brand.
 * variables: [{ id, name, collectionId, resolvedType, values, missingModes }]
 *            `values` is keyed `"<brandKey>:<modeName>"`, so a 4-mode token
 *            reads { 'traton:Light': …, 'traton:Dark': …, 'scania:Light': …,
 *            'scania:Dark': … }. `missingModes` lists the brand:mode pairs with
 *            no value -- the N-mode-universal check, brand-specific by
 *            construction rather than a generic INVESTIGATE.
 */
export function indexVariables(payload) {
  const meta = payload?.meta ?? {};
  const rawCollections = meta.variableCollections ?? {};
  const rawVariables = meta.variables ?? {};

  // Subscribed (remote) copies of the same collections exist in the file with
  // their own ids and their own override sets. Matching by collection NAME
  // alone picks the wrong one, so filter on remote first.
  const localCollections = Object.entries(rawCollections).filter(
    ([, c]) => c?.remote === false,
  );

  const brands = localCollections.map(([collectionId, c]) => ({
    key: slug(c.name),
    name: c.name,
    collectionId,
    // A child collection's modes each name the parent mode they extend. That is
    // the signal, not "has overrides" -- a child with nothing overridden yet is
    // still a child. Derived, so brand 3 needs no code change here.
    isChild: (c.modes ?? []).some((m) => m.parentModeId),
    // Mode ids are used verbatim on both sides: a child collection's modeId is
    // already the long-form key its variableOverrides are keyed by.
    modes: (c.modes ?? []).map((m) => ({ id: m.modeId, name: m.name })),
  }));

  const byCollectionId = new Map(brands.map((b) => [b.collectionId, b]));

  // Child values, flattened to variableId -> { "brand:Mode": value }.
  // An override pointing at a variable that no longer exists is an orphan:
  // deleting a variable strands its child override and REST cannot remove it.
  // Counting these separately keeps audits from over-reporting coverage.
  const childValues = new Map();
  const orphanOverrides = [];

  for (const [collectionId, c] of localCollections) {
    const brand = byCollectionId.get(collectionId);
    const modeName = new Map(brand.modes.map((m) => [m.id, m.name]));

    for (const [variableId, perMode] of Object.entries(c.variableOverrides ?? {})) {
      if (!rawVariables[variableId]) {
        orphanOverrides.push({ collectionId, collectionName: c.name, variableId });
        continue;
      }
      const target = childValues.get(variableId) ?? {};
      for (const [modeKey, value] of Object.entries(perMode ?? {})) {
        target[`${brand.key}:${modeName.get(modeKey) ?? modeKey}`] = value;
      }
      childValues.set(variableId, target);
    }
  }

  const nameById = new Map(
    Object.entries(rawVariables).map(([id, v]) => [id, v.name]),
  );

  const variables = Object.entries(rawVariables)
    .filter(([, v]) => v?.remote === false)
    .map(([id, v]) => {
      const home = byCollectionId.get(v.variableCollectionId);
      const values = {};

      // Home-collection modes come off the variable itself.
      for (const [modeId, value] of Object.entries(v.valuesByMode ?? {})) {
        const name = home?.modes.find((m) => m.id === modeId)?.name ?? modeId;
        values[`${home?.key ?? 'unknown'}:${name}`] = value;
      }
      Object.assign(values, childValues.get(id) ?? {});

      // Expected coverage = this variable's OWN collection modes, plus every
      // child collection extending it. NOT other top-level collections -- a
      // component token is not expected to carry a Primitive mode.
      const expected = [home, ...brands.filter((b) => b.isChild)]
        .filter(Boolean)
        .flatMap((b) => b.modes.map((m) => `${b.key}:${m.name}`));

      return {
        id,
        name: v.name,
        collectionId: v.variableCollectionId,
        collectionName: home?.name,
        resolvedType: v.resolvedType,
        values: resolveAliases(values, nameById),
        missingModes: expected.filter((k) => !(k in values)),
      };
    });

  return { brands, variables, orphanOverrides };
}

/** Annotate alias values with the target's name -- names are what audits report. */
function resolveAliases(values, nameById) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] =
      value?.type === 'VARIABLE_ALIAS'
        ? { ...value, aliasOf: nameById.get(value.id) ?? null }
        : value;
  }
  return out;
}

function slug(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// --- self-check ------------------------------------------------------------
// One fixture, no network. Covers the things that would silently break: child
// values found at all, remote copies excluded, orphan overrides split out,
// per-brand missing-mode reporting, and sibling top-level collections NOT being
// counted as expected coverage.
//
// Mode-id shapes here are copied from a real /variables/local response, not
// invented: a child collection's modeId IS the long-form
// `VariableCollectionId:<child>/<mode>` key its overrides are keyed by, and each
// child mode names the parent mode it extends. An earlier fixture guessed short
// ids, so it passed against code that could not match a single real override.

function selfCheck() {
  const payload = {
    meta: {
      variableCollections: {
        'VariableCollectionId:3:2': {
          name: 'TRATON',
          remote: false,
          modes: [
            { modeId: '68:0', name: 'Light' },
            { modeId: '572:1', name: 'Dark' },
          ],
        },
        'VariableCollectionId:21617:446': {
          name: 'Scania',
          remote: false,
          modes: [
            {
              modeId: 'VariableCollectionId:21617:446/21617:1',
              name: 'Light',
              parentModeId: '68:0',
            },
            {
              modeId: 'VariableCollectionId:21617:446/21617:2',
              name: 'Dark',
              parentModeId: '572:1',
            },
          ],
          variableOverrides: {
            'VariableID:1': {
              'VariableCollectionId:21617:446/21617:1': { r: 0, g: 0, b: 1 },
              'VariableCollectionId:21617:446/21617:2': { r: 0, g: 0, b: 0.5 },
            },
            'VariableID:2': {
              'VariableCollectionId:21617:446/21617:1': { r: 1, g: 0, b: 0 },
            },
            'VariableID:gone': {
              'VariableCollectionId:21617:446/21617:1': { r: 0, g: 0, b: 0 },
            },
          },
        },
        // A sibling top-level collection. Its mode must NOT show up as expected
        // coverage on a component token living in TRATON.
        'VariableCollectionId:5:5': {
          name: 'Primitive',
          remote: false,
          modes: [{ modeId: '5:0', name: 'Default' }],
        },
        // Subscribed copy: same name, different id. Must be ignored entirely.
        'VariableCollectionId:99:99': {
          name: 'Scania',
          remote: true,
          modes: [
            { modeId: 'VariableCollectionId:99:99/99:1', name: 'Light', parentModeId: '68:0' },
          ],
          variableOverrides: {
            'VariableID:1': {
              'VariableCollectionId:99:99/99:1': { r: 9, g: 9, b: 9 },
            },
          },
        },
      },
      variables: {
        'VariableID:1': {
          name: 'component/dropdown/background/default',
          remote: false,
          variableCollectionId: 'VariableCollectionId:3:2',
          resolvedType: 'COLOR',
          valuesByMode: { '68:0': { r: 1, g: 1, b: 1 }, '572:1': { r: 0, g: 0, b: 0 } },
        },
        'VariableID:2': {
          name: 'component/dropdown/border/default',
          remote: false,
          variableCollectionId: 'VariableCollectionId:3:2',
          resolvedType: 'COLOR',
          valuesByMode: {
            '68:0': { type: 'VARIABLE_ALIAS', id: 'VariableID:1' },
            '572:1': { r: 0, g: 0, b: 0 },
          },
        },
      },
    },
  };

  const { brands, variables, orphanOverrides } = indexVariables(payload);

  assert.deepEqual(
    brands.map((b) => `${b.key}${b.isChild ? ' (child)' : ''}`),
    ['traton', 'scania (child)', 'primitive'],
    'collections derived from the response, remote copy excluded, child flagged',
  );

  const full = variables.find((v) => v.name.endsWith('background/default'));
  assert.deepEqual(
    Object.keys(full.values).sort(),
    ['scania:Dark', 'scania:Light', 'traton:Dark', 'traton:Light'],
    'child values are found and merged onto the variable',
  );
  assert.deepEqual(
    full.missingModes,
    [],
    'a 4-mode token reports nothing missing -- and no primitive:Default',
  );
  assert.deepEqual(full.values['scania:Light'], { r: 0, g: 0, b: 1 });

  const partial = variables.find((v) => v.name.endsWith('border/default'));
  assert.deepEqual(
    partial.missingModes,
    ['scania:Dark'],
    'missing modes are reported per brand, not as a generic gap',
  );
  assert.equal(
    partial.values['traton:Light'].aliasOf,
    'component/dropdown/background/default',
    'alias values carry the target name',
  );

  assert.deepEqual(
    orphanOverrides.map((o) => o.variableId),
    ['VariableID:gone'],
    'override for a deleted variable is split out, not counted as coverage',
  );

  console.log('self-check OK — 7 assertions');
}

// --- CLI -------------------------------------------------------------------

async function main(argv) {
  if (argv.includes('--self-check')) return selfCheck();

  const fileKey = argv[argv.indexOf('--file') + 1];
  const match = argv.includes('--match') ? argv[argv.indexOf('--match') + 1] : null;
  if (!argv.includes('--file') || !fileKey) {
    console.error('Usage: fetch-variables-rest.js --file <fileKey> [--match <substring>]');
    console.error('       fetch-variables-rest.js --self-check');
    process.exit(1);
  }

  const { brands, variables, orphanOverrides } = indexVariables(
    await fetchVariables(fileKey, { apiKey: process.env.FIGMA_API_KEY }),
  );

  console.log(`brands: ${brands.map((b) => `${b.name}${b.isChild ? '*' : ''}`).join(', ')} (* = extended)`);
  console.log(`variables: ${variables.length}   orphan overrides: ${orphanOverrides.length}`);

  const shown = match ? variables.filter((v) => v.name.includes(match)) : [];
  for (const v of shown.sort((a, b) => a.name.localeCompare(b.name))) {
    const gap = v.missingModes.length ? `  MISSING ${v.missingModes.join(', ')}` : '';
    console.log(`  ${v.name}  [${Object.keys(v.values).length} modes]${gap}`);
  }
  if (match) console.log(`matched ${shown.length} of ${variables.length}`);
}

// pathToFileURL, not `file://${argv[1]}` -- this checkout's path contains a `~`,
// which percent-encodes to %7E in a file URL, so string concatenation never matches.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
