#!/usr/bin/env node
/**
 * Canvas binding sweep — what the canvas is bound TO, not whether it is bound.
 *
 * Why this exists: five sessions on cluster #9 hand-wrote this sweep and all five
 * reached the same predicate — "does this paint have a variable binding?" — which
 * returns true for a component token, a semantic, and an INTERNAL variable alike.
 * It passes under every outcome, so it verifies nothing about token layering. It
 * reported "canvas binding complete" on a component whose text and icons were
 * entirely on semantics. No script in tokens/scripts/ read `boundVariables` at all,
 * so there was nothing to reuse and the predicate got re-invented each time.
 *
 * The fix is that a result is a HISTOGRAM OVER RESOLVED VARIABLE NAMES, never a
 * bound/unbound count:
 *
 *   component/{slug}/*   this component's own tokens
 *   component/*          another component's tokens — delegated, usually correct
 *   color/* (semantic)   bound, but not componentised — the gap that hid
 *   INTERNAL/*           never a valid alias target
 *   UNBOUND              raw value
 *
 * Two counting traps, both of which look correct from inside:
 *
 *   OVER-COUNT: nested instances repeat a source binding once per instance. On
 *   cluster #9 that inflated semantic paints ~4x and made them read as ambient
 *   system noise rather than a fixable source-level gap. Hence sourceTree vs
 *   nestedInstance, always separated.
 *
 *   UNDER-COUNT: filtering out INSTANCE children to avoid counting delegated
 *   Button/Dropdown interiors also filters out the component's OWN icons, which
 *   live inside icon instances. That hid 35 icon sites. Hence delegated paints are
 *   bucketed, never dropped.
 *
 * Read-only. Never writes to Figma. REST, because the Plugin API is MCP-only and
 * cannot be driven from a repo script.
 *
 * KNOWN REST LIMITS — real, and not worked around here:
 *   - REMOTE INSTANCE INTERNALS CANNOT BE RESOLVED. A paint inside an instance of a
 *     library component is bound to a variable id this file does not hold locally,
 *     so it comes back as UNRESOLVED (remote) rather than by name. Measured on
 *     Table/Header/Cell: 48 of 120 nested paints. THE CONSEQUENCE IS SPECIFIC AND
 *     IT MATTERS -- icons live inside remote icon instances, so this script would
 *     NOT have found cluster #9's 35 semantic icon sites. Icons need the Plugin API.
 *     UNRESOLVED is its own bucket precisely so it can never be read as "unbound"
 *     (a gap) or as "fine" (no gap). It means "not measured here".
 *   - Per-side stroke weights are not exposed. Geometry coverage is partial; this
 *     script is trustworthy on colour binding targets and silent on stroke weight.
 *   - The same paint can be reported more than once. Distinct-node counts are the
 *     figure to trust; paint-occurrence counts are reported beside them so a
 *     divergence between the two is visible rather than hidden.
 *
 * So the honest scope: SOURCE-TREE COLOUR BINDINGS, which is where the actionable
 * gaps are, since nested instances mostly repeat a source binding. Cross-checked
 * against a Plugin API sweep of the same set 2026-08-31 — source-tree figures agree
 * exactly (30 component/table, 24 delegated, 12 + 12 semantic).
 *
 * Usage:
 *   node tokens/scripts/audit-canvas-bindings.js --file <fileKey> --node <nodeId> --slug table
 *   node tokens/scripts/audit-canvas-bindings.js --file <k> --node <n> --slug table \
 *        --control <nodeId>=component/table/border/divider-default
 *   node tokens/scripts/audit-canvas-bindings.js --self-check
 *
 * RUNTIME: one REST request per root, sequential. Measured on cluster #9 — all 12
 * Table source sets exceeded a 2-minute shell timeout and was killed mid-run; the
 * four sets touched by one pass finished comfortably. So either scope --node to the
 * sets you actually changed, or give the call several minutes. Do NOT reach for
 * --chunk to speed it up: chunking groups roots into one request and a dozen Table
 * sets already exceeded the shared lib's 64 MB curl buffer, which fails as
 * "maxBuffer length exceeded" rather than as a timeout. Chunk size 1 is the safe
 * default for that reason, and slow-but-completing beats fast-but-truncated when
 * the output is a debt count.
 *
 * --control is a known-answer assertion: a node whose binding you already know.
 * It validates that the scan reads bindings correctly. It does NOT validate that
 * the scan read the right node — pass a node reached by traversal, and never an
 * id carried from another file, because ids collide across files.
 *
 * Writes tokens/audit/<timestamp>-canvas-bindings/{findings.md,findings.json}.
 */

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { figmaFetch } from './lib/figma-rest.js';
import { fetchVariables, indexVariables } from './lib/fetch-variables-rest.js';

const BUCKETS = [
  'component/{slug}/*',
  'component/* (delegated)',
  'color/* (semantic)',
  'INTERNAL/*',
  'UNBOUND',
  // Bound to a variable this file does not hold locally -- almost always inside a
  // remote library instance. NOT unbound, and NOT a gap: it is a blind spot. Kept
  // as its own bucket so it can never be mistaken for either.
  'UNRESOLVED (remote)',
  // Paints on Helper/* instances -- slot placeholders, focus-visible markers. They
  // render only inside the library, never in consumer output, and no component owns
  // them. Design-lead ruling 2026-08-31: furniture, excluded by kind. Bucketed
  // rather than dropped, because a silently discarded paint cannot be audited and
  // every other exclusion in this file is visible.
  'helper furniture (excluded)',
];

/** Which bucket a resolved variable name falls in. Pure — the part worth testing. */
export function bucketOf(name, slug) {
  if (name === null || name === undefined) return 'UNBOUND';
  if (slug && name.startsWith(`component/${slug}/`)) return 'component/{slug}/*';
  if (name.startsWith('component/')) return 'component/* (delegated)';
  // Anchored: an unanchored /INTERNAL/ test also matches PAINT: and other
  // substrings. Two of cluster #9's wrong numbers came from unanchored matching.
  if (name.startsWith('INTERNAL/')) return 'INTERNAL/*';
  return 'color/* (semantic)';
}

/**
 * Walk a REST node payload and histogram every SOLID paint by binding target.
 *
 * Pure — no network, no env. `varNames` maps variable id to name.
 * Returns { buckets, sites, distinctNodes, controlResults }.
 */
export function analyse(rootNode, varNames, slug, controls = {}, maps = {}) {
  const components = maps.components || {};
  const componentSets = maps.componentSets || {};

  /**
   * Is this node a Helper/* instance? Resolved through
   * componentId -> component.componentSetId -> componentSet.name, because the
   * LAYER name is unreliable: the toolbar's slot markers are renamed to
   * "Slot #1"/"Slot #2" and a name-prefix test misses them entirely.
   */
  function isHelperInstance(node) {
    if (node.type !== 'INSTANCE') return false;
    const comp = components[node.componentId];
    const setName = comp && comp.componentSetId ? (componentSets[comp.componentSetId] || {}).name : null;
    if (setName) return setName.startsWith('Helper/');
    // No maps (unit fixtures, or a payload without them): fall back to the layer
    // name, which catches the un-renamed majority.
    return node.name.startsWith('Helper/');
  }

  const buckets = {};
  const sites = {};
  const distinct = {};
  const controlResults = [];

  for (const b of BUCKETS) {
    buckets[b] = { sourceTree: { paints: 0, nodes: new Set() }, nestedInstance: { paints: 0, nodes: new Set() } };
  }

  function resolve(paint) {
    const ref = paint.boundVariables && paint.boundVariables.color;
    if (!ref || !ref.id) return null;
    // An id with no entry is NOT unbound — it is a binding we failed to resolve.
    // Saying so is the difference between a gap and a blind spot.
    return varNames[ref.id] === undefined ? `UNRESOLVED(${ref.id})` : varNames[ref.id];
  }

  function visit(node, insideInstance, path) {
    const scope = insideInstance ? 'nestedInstance' : 'sourceTree';
    // A COMPONENT_SET carries a default fill that Figma paints behind the variant
    // grid. It is editor furniture, not part of the component, and no designer can
    // see or act on it -- same class as the cornerRadius:5 artifact these sets also
    // carry. Counting it reports one false unbound paint per set swept.
    const groups = node.type === 'COMPONENT_SET'
      ? []
      : [['fill', node.fills], ['stroke', node.strokes]];

    for (const [prop, arr] of groups) {
      if (!Array.isArray(arr)) continue;
      arr.forEach((paint, i) => {
        if (!paint || paint.type !== 'SOLID' || paint.visible === false) return;
        const name = resolve(paint);
        const label = name === null ? 'UNBOUND' : name;
        const bucket = isHelperInstance(node)
          ? 'helper furniture (excluded)'
          : (name && name.startsWith('UNRESOLVED(') ? 'UNRESOLVED (remote)' : bucketOf(name, slug));

        buckets[bucket][scope].paints += 1;
        buckets[bucket][scope].nodes.add(node.id);

        const key = `${label} :: ${prop} :: ${path} > ${node.name} [${node.type}]`;
        if (!sites[key]) sites[key] = { variable: label, property: prop, bucket, scope, nodes: new Set() };
        sites[key].nodes.add(node.id);

        distinct[node.id] = true;

        if (controls[node.id]) {
          controlResults.push({
            node: node.id,
            expected: controls[node.id],
            actual: label,
            pass: label === controls[node.id],
          });
        }
        void i;
      });
    }

    const kids = node.children || [];
    const nextInside = insideInstance || node.type === 'INSTANCE';
    for (const kid of kids) visit(kid, nextInside, `${path} > ${node.name}`);
  }

  // A root is never "inside an instance" relative to itself. Several roots are
  // swept in one pass because the unit of work is the component set, not the page:
  // sweeping a whole page instead would count page-level instances as source tree.
  for (const root of Array.isArray(rootNode) ? rootNode : [rootNode]) visit(root, false, '');

  const out = {};
  for (const b of BUCKETS) {
    out[b] = {
      sourceTree: { paints: buckets[b].sourceTree.paints, distinctNodes: buckets[b].sourceTree.nodes.size },
      nestedInstance: { paints: buckets[b].nestedInstance.paints, distinctNodes: buckets[b].nestedInstance.nodes.size },
    };
  }
  const siteList = Object.entries(sites)
    // Node ids are kept, not dropped: without them you cannot construct a
    // --control for the next run, and an unusable control is an absent one.
    .map(([where, v]) => ({ where, ...v, count: v.nodes.size, nodes: [...v.nodes] }))
    .sort((a, b) => b.count - a.count);

  return { buckets: out, sites: siteList, distinctNodes: Object.keys(distinct).length, controlResults };
}

function renderMarkdown({ fileKey, nodeId, slug, result, generatedAt }) {
  const L = [];
  L.push('# Canvas binding sweep');
  L.push('');
  const roots = result.rootsSwept || [];
  L.push(`File \`${fileKey}\` · slug \`${slug || '(none)'}\` · ${generatedAt}`);
  L.push('');
  L.push(`**${roots.length || 1} root(s) swept:** ${roots.length ? roots.map((r) => `\`${r.name}\` (${r.id})`).join(' · ') : `\`${nodeId}\``}`);
  L.push('');
  L.push('**A binding is bucketed by what it resolves to, never by whether it exists.**');
  L.push('Trust the distinct-node columns; REST can report one paint more than once.');
  L.push('');
  L.push('| Binding target | Source tree (nodes) | Source tree (paints) | Nested instance (nodes) | Nested instance (paints) |');
  L.push('|---|---:|---:|---:|---:|');
  for (const b of BUCKETS) {
    const r = result.buckets[b];
    const label = b.replace('{slug}', slug || '{slug}');
    L.push(`| \`${label}\` | ${r.sourceTree.distinctNodes} | ${r.sourceTree.paints} | ${r.nestedInstance.distinctNodes} | ${r.nestedInstance.paints} |`);
  }
  L.push('');

  if (result.controlResults.length) {
    const failed = result.controlResults.filter((c) => !c.pass);
    L.push(`## Known-answer control — ${failed.length ? 'FAILED' : 'passed'}`);
    L.push('');
    for (const c of result.controlResults) {
      L.push(`- \`${c.node}\` expected \`${c.expected}\`, read \`${c.actual}\` — ${c.pass ? 'pass' : '**FAIL**'}`);
    }
    L.push('');
  } else {
    L.push('## Known-answer control — NOT RUN');
    L.push('');
    L.push('No `--control` given. The totals above are unvalidated: a scan that reads the');
    L.push('wrong field returns plausible numbers. Pass `--control <nodeId>=<variableName>`.');
    L.push('');
  }

  const gaps = result.sites.filter((s) => s.bucket === 'color/* (semantic)' || s.bucket === 'INTERNAL/*' || s.bucket === 'UNBOUND');
  const sourceGaps = gaps.filter((s) => s.scope === 'sourceTree');
  L.push(`## Source-tree gaps — ${sourceGaps.length} distinct sites`);
  L.push('');
  L.push('Semantic, INTERNAL and unbound paints on the component\'s own nodes. These are');
  L.push('the actionable ones; nested-instance repeats of the same source binding are not.');
  L.push('');
  if (!sourceGaps.length) {
    L.push('_None._');
  } else {
    L.push('| Nodes | Bucket | Variable | Where |');
    L.push('|---:|---|---|---|');
    for (const s of sourceGaps.slice(0, 60)) {
      const where = s.where.split(' :: ').slice(2).join(' :: ');
      L.push(`| ${s.count} | ${s.bucket} | \`${s.variable}\` | ${where} |`);
    }
    if (sourceGaps.length > 60) L.push('');
    if (sourceGaps.length > 60) L.push(`_${sourceGaps.length - 60} further sites in findings.json — not truncated there._`);
  }
  L.push('');
  L.push('## Not covered');
  L.push('');
  L.push('- **Anything in the `UNRESOLVED (remote)` row** — bound inside a library instance,');
  L.push('  to a variable this file does not hold locally. Not unbound, not verified: not');
  L.push('  measured. **Icons live here**, so a non-zero count means icon bindings are');
  L.push('  unaudited by this script and need a Plugin API pass.');
  L.push('- **Per-side stroke weights** — REST does not expose them. Geometry is partial.');
  L.push('- **Non-colour bindings** (padding, spacing, sizing, typography) are not swept here.');
  L.push('- **Target identity** — a control validates the scan, not that the node is the live');
  L.push('  one. Reach roots by traversal; ids collide across files.');
  return `${L.join('\n')}\n`;
}

function selfCheck() {
  // bucketing, including the substring traps that produced real wrong numbers
  assert.equal(bucketOf('component/table/text/cell-default', 'table'), 'component/{slug}/*');
  assert.equal(bucketOf('component/button/background/x', 'table'), 'component/* (delegated)');
  assert.equal(bucketOf('color/text/strong', 'table'), 'color/* (semantic)');
  assert.equal(bucketOf('INTERNAL/color__wip/UNSORTED/background/surface/300', 'table'), 'INTERNAL/*');
  assert.equal(bucketOf(null, 'table'), 'UNBOUND');
  // a semantic whose name merely CONTAINS the word internal is not INTERNAL
  assert.equal(bucketOf('color/border/internal-ish', 'table'), 'color/* (semantic)');
  // slug must not match a different component sharing a prefix
  assert.equal(bucketOf('component/table-of-contents/text/x', 'table'), 'component/* (delegated)');

  const varNames = { 'VariableID:1': 'component/table/background/header-default', 'VariableID:2': 'color/text/strong' };
  const tree = {
    id: '0:1', name: 'Root', type: 'COMPONENT',
    fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:1' } } }],
    children: [
      { id: '0:2', name: 'Label', type: 'TEXT', fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:2' } } }] },
      { id: '0:3', name: 'Raw', type: 'RECTANGLE', fills: [{ type: 'SOLID' }] },
      {
        id: '0:4', name: 'icon', type: 'INSTANCE', fills: [],
        children: [{ id: '0:5', name: 'Vector', type: 'VECTOR', fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:2' } } }] }],
      },
      { id: '0:6', name: 'Hidden', type: 'RECTANGLE', fills: [{ type: 'SOLID', visible: false, boundVariables: { color: { id: 'VariableID:2' } } }] },
    ],
  };
  const r = analyse(tree, varNames, 'table', { '0:1': 'component/table/background/header-default' });

  assert.equal(r.buckets['component/{slug}/*'].sourceTree.distinctNodes, 1, 'root component token counted once');
  assert.equal(r.buckets['color/* (semantic)'].sourceTree.distinctNodes, 1, 'only the TEXT node — the icon is nested');
  assert.equal(r.buckets['color/* (semantic)'].nestedInstance.distinctNodes, 1, 'the icon inside the INSTANCE is bucketed, not dropped');
  assert.equal(r.buckets.UNBOUND.sourceTree.distinctNodes, 1, 'raw fill counted; invisible paint skipped');
  assert.equal(r.controlResults.length, 1);
  assert.equal(r.controlResults[0].pass, true);

  // an unresolvable id must NOT silently read as unbound-with-a-known-answer
  const r2 = analyse(
    { id: '1:1', name: 'X', type: 'FRAME', fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:999' } } }] },
    varNames, 'table'
  );
  assert.match(r2.sites[0].variable, /^UNRESOLVED\(/, 'missing variable is reported as unresolved, not as unbound');
  assert.equal(r2.buckets['UNRESOLVED (remote)'].sourceTree.paints, 1, 'unresolved gets its own bucket');
  assert.equal(r2.buckets.UNBOUND.sourceTree.paints, 0, 'and is never folded into unbound — that would read as a gap');
  assert.ok(r2.sites[0].nodes.includes('1:1'), 'node ids survive into the report so --control is constructible');

  // a COMPONENT_SET's own fill is editor furniture and must not read as an unbound gap
  const setTree = {
    id: '2:1', name: 'Some/Set', type: 'COMPONENT_SET',
    fills: [{ type: 'SOLID' }],
    children: [{ id: '2:2', name: 'V=A', type: 'COMPONENT', fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:1' } } }] }],
  };
  const rSet = analyse(setTree, varNames, 'table');
  assert.equal(rSet.buckets.UNBOUND.sourceTree.paints, 0, "COMPONENT_SET's own fill is not counted");
  assert.equal(rSet.buckets['component/{slug}/*'].sourceTree.distinctNodes, 1, 'its variants still are');

  // Helper/* instances are furniture. The RENAMED case is the one that matters:
  // identity must come from the component set, not the layer name.
  const helperTree = {
    id: '3:1', name: 'Table/Toolbar', type: 'COMPONENT', fills: [],
    children: [
      { id: '3:2', name: 'Slot #1', type: 'INSTANCE', componentId: 'c1', fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:2' } } }] },
      { id: '3:3', name: 'Helper/Content slot', type: 'INSTANCE', componentId: 'c1', fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:2' } } }] },
      { id: '3:4', name: 'Title', type: 'TEXT', fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:2' } } }] },
    ],
  };
  const helperMaps = { components: { c1: { componentSetId: 's1' } }, componentSets: { s1: { name: 'Helper/Content slot' } } };
  const rHelp = analyse(helperTree, varNames, 'table', {}, helperMaps);
  assert.equal(rHelp.buckets['helper furniture (excluded)'].sourceTree.distinctNodes, 2, 'both helper instances excluded, renamed one included');
  assert.equal(rHelp.buckets['color/* (semantic)'].sourceTree.distinctNodes, 1, 'the real text node is still a gap');

  // without the maps, the renamed instance can only be caught by layer name
  const rNoMaps = analyse(helperTree, varNames, 'table', {}, {});
  assert.equal(rNoMaps.buckets['helper furniture (excluded)'].sourceTree.distinctNodes, 1, 'name fallback catches the un-renamed one only');

  // several roots in one pass must sum, not overwrite
  const rMulti = analyse([setTree, tree], varNames, 'table');
  assert.equal(rMulti.buckets['component/{slug}/*'].sourceTree.distinctNodes, 2, 'roots accumulate');
  assert.equal(rMulti.buckets['color/* (semantic)'].nestedInstance.distinctNodes, 1, 'nested scope survives a multi-root sweep');

  // a failing control must be visible
  const r3 = analyse(tree, varNames, 'table', { '0:1': 'component/table/background/footer-default' });
  assert.equal(r3.controlResults[0].pass, false, 'wrong expectation fails the control');

  console.log('self-check OK');
}

async function main(argv) {
  if (argv.includes('--self-check')) return selfCheck();

  const arg = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const fileKey = arg('--file');
  const nodeId = arg('--node');
  const slug = arg('--slug');
  const controlArgs = argv.reduce((acc, a, i) => (a === '--control' ? [...acc, argv[i + 1]] : acc), []);

  if (!fileKey || !nodeId) {
    console.error('Usage: --file <fileKey> --node <nodeId> [--slug <component>] [--control <nodeId>=<variableName>]');
    console.error('       --self-check');
    process.exit(1);
  }
  const apiKey = process.env.FIGMA_API_KEY;
  if (!apiKey) {
    console.error('FIGMA_API_KEY not set. It belongs in ~/.zshenv, not ~/.zshrc — a');
    console.error('non-interactive shell does not source .zshrc, and an empty header');
    console.error('reads back from Figma as "Invalid token" rather than as absent.');
    process.exit(1);
  }

  const controls = {};
  for (const c of controlArgs) {
    const eq = (c || '').indexOf('=');
    if (eq < 1) { console.error(`--control expects <nodeId>=<variableName>, got: ${c}`); process.exit(1); }
    controls[c.slice(0, eq)] = c.slice(eq + 1);
  }

  const { variables } = indexVariables(await fetchVariables(fileKey, { apiKey }));
  const varNames = {};
  for (const v of variables) varNames[v.id] = v.name;

  const ids = nodeId.split(',').map((s) => s.trim()).filter(Boolean);
  // One request per id. A dozen component sets in a single call overflows the
  // shared lib's curl maxBuffer, and raising that would change behaviour for every
  // other script that imports it. Chunk size 1 keeps each response small and makes
  // a failure name the set it belongs to.
  const chunkSize = Number(arg('--chunk')) > 0 ? Number(arg('--chunk')) : 1;
  const roots = [];
  const missing = [];
  const maps = { components: {}, componentSets: {} };
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(chunk.join(','))}`;
    const res = await figmaFetch(url, { headers: { 'X-Figma-Token': apiKey }, timeoutSeconds: 300 });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Figma ${res.status} on ${chunk.join(',')}: ${body.slice(0, 300)}`);
      console.error('403 with "Token expired" means rotate the PAT; "Invalid token" means the key is missing or malformed.');
      process.exit(1);
    }
    const payload = await res.json();
    for (const id of chunk) {
      const entry = payload.nodes && payload.nodes[id];
      if (entry && entry.document) {
        roots.push(entry.document);
        // These maps are per-entry, so they must be merged across chunks or a
        // Helper instance in a later chunk resolves against an empty map.
        Object.assign(maps.components, entry.components || {});
        Object.assign(maps.componentSets, entry.componentSets || {});
      } else missing.push(id);
    }
  }
  if (missing.length) {
    // Never sweep a partial set silently — a smaller total reads as less debt.
    console.error(`Not present in file ${fileKey}: ${missing.join(', ')}`);
    console.error('Ids are file-scoped and collide across files — re-derive them in THIS file.');
    process.exit(1);
  }

  const result = analyse(roots, varNames, slug, controls, maps);
  result.rootsSwept = roots.map((r) => ({ id: r.id, name: r.name, type: r.type }));
  const failed = result.controlResults.filter((c) => !c.pass);

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outDir = join('tokens', 'audit', `${stamp}-canvas-bindings`);
  mkdirSync(outDir, { recursive: true });
  const md = renderMarkdown({ fileKey, nodeId, slug, result, generatedAt: new Date().toISOString() });
  writeFileSync(join(outDir, 'findings.md'), md);
  writeFileSync(join(outDir, 'findings.json'), `${JSON.stringify(result, null, 2)}\n`);

  for (const b of BUCKETS) {
    const r = result.buckets[b];
    console.log(`${b.replace('{slug}', slug || '{slug}').padEnd(26)} source ${String(r.sourceTree.distinctNodes).padStart(6)} nodes   nested ${String(r.nestedInstance.distinctNodes).padStart(6)} nodes`);
  }
  console.log(`\n${outDir}/findings.md`);
  if (!result.controlResults.length) console.log('WARNING: no --control given, totals are unvalidated.');
  if (failed.length) { console.error(`CONTROL FAILED on ${failed.length} node(s) — do not trust these totals.`); process.exit(2); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
