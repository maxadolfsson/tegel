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
 *   - PER-SIDE STROKE WEIGHT: the PLUGIN API field names (strokeTopWeight,
 *     strokeBottomWeight, strokeLeftWeight, strokeRightWeight) are NOT returned by
 *     REST -- measured, all four absent on a 643-node sample. Reading them here
 *     yields undefined and, coerced, ZERO: every stroke reports as zero-weight.
 *     That trap cost a false confirmation once and the warning stays.
 *     REST's own key is `individualStrokeWeights`, which IS returned, and this
 *     script reads BINDINGS on it (below). So: trustworthy on stroke-weight
 *     BINDING TARGETS, still blind to resolved per-side VALUES. Refined
 *     2026-09-02 -- the earlier blanket "not exposed" was too broad for a
 *     binding audit's own purpose.
 *   - A BOUND FIELD NEED NOT CARRY A RESOLVED VALUE. Of two nodes bound on
 *     `individualStrokeWeights`, the bound set was NOT a subset of the 75 nodes
 *     carrying the field. Never pre-filter to "nodes that have the property"
 *     before enumerating bindings -- that filter drops bound nodes. Same shape as
 *     filtering paint visibility while ignoring node visibility.
 *   - The same paint can be reported more than once. Distinct-node counts are the
 *     figure to trust; paint-occurrence counts are reported beside them so a
 *     divergence between the two is visible rather than hidden.
 *
 * So the honest scope, in the gates session's wording so the two do not drift:
 * SOURCE-TREE BINDINGS -- exact on colour, reportable on geometry and typography
 * bindings, unable to resolve their values, blind inside remote instances. Text
 * styles are a SECOND MECHANISM and are reported in a parallel three-state table,
 * never as a histogram row. Cross-checked
 * against a Plugin API sweep of the same set 2026-08-31 — source-tree figures agree
 * exactly (30 component/table, 24 delegated, 12 + 12 semantic).
 *
 * Usage:
 *   node tokens/scripts/audit-canvas-bindings.js --file <fileKey> --node <nodeId> --slug table
 *   node tokens/scripts/audit-canvas-bindings.js --file <k> --node <n> --slug table \
 *        --control <nodeId>=component/table/border/divider-default
 *   # aim a control at a NON-COLOUR family -- <nodeId>.<field>=<variableName>
 *   node tokens/scripts/audit-canvas-bindings.js --file <k> --node <n> --slug table \
 *        --control 14047:48411.rectangleCornerRadii=component/table/border/radius-default
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

/**
 * NON-COLOUR BINDING FAMILIES, read from a node's OWN `boundVariables` map rather
 * than from a paint's. Added 2026-09-02 at the design lead's ask: radius, stroke
 * weight, typography and text styles were shipping unverified, and colour fills and
 * strokes were the only families any gate covered.
 *
 * `fills` and `strokes` are DELIBERATELY ABSENT from this map. They appear in a
 * node's `boundVariables` too, but measured on a 643-node sample they resolve to
 * EXACTLY the same 436 nodes as the paint-level walk -- zero in either direction.
 * Including them here would double-count every colour binding in the report.
 *
 * Also absent, and not an oversight: `visible`, `opacity`, `size`, `characters`,
 * `itemSpacing` and the padding fields. Layout, sizing and spacing were not part of
 * the ask and are NOT swept -- see "Not covered" in the report.
 */
const NON_COLOUR_FIELDS = {
  rectangleCornerRadii: 'radius',
  topLeftRadius: 'radius',
  topRightRadius: 'radius',
  bottomLeftRadius: 'radius',
  bottomRightRadius: 'radius',
  // REST's key. The Plugin API's per-side names are absent from REST entirely --
  // see the stroke-weight note in the header before trusting any zero here.
  individualStrokeWeights: 'strokeWeight',
  strokeWeight: 'strokeWeight',
  fontFamily: 'typography',
  fontWeight: 'typography',
  fontSize: 'typography',
  lineHeight: 'typography',
  letterSpacing: 'typography',
};

export const FAMILIES = ['radius', 'strokeWeight', 'typography'];

const TYPOGRAPHY_FIELDS = Object.entries(NON_COLOUR_FIELDS)
  .filter(([, family]) => family === 'typography')
  .map(([field]) => field);

/**
 * A node's boundVariables entry comes in THREE shapes and they are not documented
 * together anywhere. Measured on one Table variant, 2026-09-02:
 *
 *   single alias   {type:'VARIABLE_ALIAS', id:'…'}
 *   array          fontSize: [{type:'VARIABLE_ALIAS', id:'…'}]
 *   KEYED MAP      rectangleCornerRadii: {RECTANGLE_TOP_LEFT_CORNER_RADIUS: {…}, …}
 *
 * Handling only the first two produced ZERO radius bindings on a variant carrying
 * 230 of them, and the report said so in words. An unhandled shape does not throw
 * here -- it reads as "nothing bound", which is the most expensive way to be wrong.
 * Returns [{subField, ref}]; subField is null for the shapes that have no sub-key.
 */
export function aliasesOf(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.filter((x) => x && x.id).map((ref) => ({ subField: null, ref }));
  if (value.id) return [{ subField: null, ref: value }];
  return Object.entries(value)
    .filter(([, x]) => x && x.id)
    .map(([subField, ref]) => ({ subField, ref }));
}

/**
 * Bucket labels are colour-worded because colour came first. A radius bound to
 * `spacing/…` is not a "colour semantic", so relabel at render time for the
 * non-colour families. Display only — the bucket keys stay one vocabulary.
 */
function familyLabel(bucket) {
  return bucket === 'color/* (semantic)' ? 'semantic or primitive (not componentised)' : bucket;
}

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
export function analyse(rootNode, varNames, slug, controls = {}, maps = {}, ignoreList = []) {
  // Exact layer/section names to skip, alongside the `IGNORE/` prefix convention.
  const ignoreNames = new Set(ignoreList);
  const components = maps.components || {};
  const componentSets = maps.componentSets || {};
  const styleNames = maps.styles || {};

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

  // One histogram per non-colour family, same bucket vocabulary as colour so a
  // gap reads the same way whichever property family it turns up in.
  const families = {};
  for (const f of FAMILIES) {
    families[f] = {};
    for (const b of BUCKETS) {
      families[f][b] = { sourceTree: { hits: 0, nodes: new Set() }, nestedInstance: { hits: 0, nodes: new Set() } };
    }
  }
  // A text style is a STYLE ID, not a variable name, so it sits in no token
  // namespace and CANNOT be bucketed by one -- folding it into the histogram would
  // make `component/{slug}/*` meaningless. Reporting contract, ruled by the gates
  // session: a parallel three-state table, not a histogram row. The state that a
  // single "typography: N" figure would hide is a component whose text is entirely
  // on shared styles and bound to no type variable at all.
  // Subtrees excluded by the `IGNORE/` name prefix. Not a bucket -- these are not
  // measured at all, so they cannot be a count of anything. Named so the report can
  // state WHAT was skipped, which is the only way a reader can tell a scoped sweep
  // from an incomplete one.
  const ignored = { roots: [] };
  const textStyles = {
    // KEYED BY STYLE ID, NOT BY NAME. Style names collide across libraries at scale
    // -- `Headline/06` is published by nine of them, `Headline/07` by eight
    // including four marked do-not-use, and `remote: true` is identical across every
    // one. Keying by name merged two subscribed styles into one row: counts summed,
    // and `remote` frozen from whichever was seen first. Not firing on Table today
    // (all three styles key-matched to one library) but the exposure is measured.
    byStyle: {},
    textNodes: 0,
    missing: 0,
    missingNodes: [],
    states: { sharedStyleOnly: 0, typeVariablesOnly: 0, both: 0, neither: 0 },
    // Remote-styled TEXT nodes split by scope. This is the number that sizes a
    // rebind: nested instances repeat their source's style, so the actionable
    // count is the SOURCE-TREE one. A single total conflates "4,785 places to fix"
    // with "N sources whose fix cascades", and those are different jobs.
    remoteByScope: { sourceTree: 0, nestedInstance: 0 },
    // THE (B) CHECK. Figma's own panel writes `component/body/01 · 14/16(B)` when a
    // text style is applied AND a local font sits on top of it. REST cannot read a
    // style's own definition, so there is no expected value to compare against.
    // What it CAN do is check consistency: one style id resolving to more than one
    // font across the swept nodes means some of those nodes deviate.
    //
    // Measured 2026-09-02: 1,280 cell text nodes rendered Bold 700 on
    // `component/body/01` while the same style rendered Regular 400 in the source.
    // A weight-based rule cannot catch that without also flagging every designed
    // SemiBold heading; a consistency rule catches it and ignores the headings.
    //
    // ⚠ ITS LIMIT, and it is a real one: if EVERY node on a style is overridden the
    // same way, this sees one font and reports nothing. It detects disagreement,
    // never wrongness.
    //
    // ⚠ Family names are compared CASE-INSENSITIVELY. Nodes in this file store
    // `traton type text` where the installed family is `TRATON Type Text`, so a
    // case-sensitive compare reported all 2,945 swept segments as deviations —
    // every one false. That lowercase family is also why font writes on those nodes
    // fail silently: the family cannot be loaded.
    fontsByStyle: {},
  };

  function resolve(paint) {
    const ref = paint.boundVariables && paint.boundVariables.color;
    if (!ref || !ref.id) return null;
    // An id with no entry is NOT unbound — it is a binding we failed to resolve.
    // Saying so is the difference between a gap and a blind spot.
    return varNames[ref.id] === undefined ? `UNRESOLVED(${ref.id})` : varNames[ref.id];
  }

  function visit(node, insideInstance, path) {
    // `IGNORE/` prefix = the design lead has marked this subtree out of scope on the
    // canvas itself (Max, 2026-09-08). Skipped whole, and RECORDED rather than
    // silently dropped -- every other exclusion in this file is visible for the same
    // reason: a discarded subtree that leaves no trace cannot be audited.
    if (typeof node.name === 'string' && node.name.startsWith('IGNORE/')) {
      ignored.roots.push({ id: node.id, name: node.name, type: node.type, why: 'IGNORE/ prefix' });
      return;
    }
    // Named exclusions via --ignore. Same machinery as the prefix, different
    // trigger: a section can be legitimately out of scope WITHOUT being renamed,
    // because its name carries meaning elsewhere. `—— Review` is the case that
    // prompted this (Max, 2026-09-08) -- it holds decision-log prose and WCAG
    // research text, so its styles and bindings are documentation, not component
    // debt, and it also hosts the `Internal/Decision Log` instance whose INTERNAL
    // radius bindings would otherwise read as four gaps on Table.
    // Passed at the call site rather than hardcoded: the name is per-cluster, and a
    // shared gate must not carry one cluster's layer names.
    if (ignoreNames.has(node.name)) {
      ignored.roots.push({ id: node.id, name: node.name, type: node.type, why: '--ignore' });
      return;
    }
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

    // NON-COLOUR BINDINGS, from the node's own boundVariables map. A node can carry
    // several at once -- four corner radii, five type properties -- so every field
    // is its own site rather than the node being counted once.
    const bvs = node.boundVariables || {};
    for (const [field, family] of Object.entries(NON_COLOUR_FIELDS)) {
      if (bvs[field] === undefined) continue;
      for (const { subField, ref } of aliasesOf(bvs[field])) {
        const name = varNames[ref.id] === undefined ? `UNRESOLVED(${ref.id})` : varNames[ref.id];
        const prop = subField ? `${field}.${subField}` : field;
        const bucket = isHelperInstance(node)
          ? 'helper furniture (excluded)'
          : (name.startsWith('UNRESOLVED(') ? 'UNRESOLVED (remote)' : bucketOf(name, slug));

        families[family][bucket][scope].hits += 1;
        families[family][bucket][scope].nodes.add(node.id);

        const key = `${name} :: ${prop} :: ${path} > ${node.name} [${node.type}]`;
        if (!sites[key]) sites[key] = { variable: name, property: prop, family, bucket, scope, nodes: new Set() };
        sites[key].nodes.add(node.id);

        // A control can be aimed at a FAMILY, not just at a paint:
        //   --control <nodeId>.<field>=<variableName>
        // Without this the known-answer control covered the colour path only, so a
        // run could report radius 0 / strokeWeight 0 / typography 0 with the control
        // PASSING and the control saying nothing about any of them. Those three are
        // exactly where a silent zero already happened once, when 230 radius
        // bindings read as zero because a keyed map was handled as an array.
        const ckey = `${node.id}.${field}`;
        if (controls[ckey]) {
          controlResults.push({
            node: ckey,
            expected: controls[ckey],
            actual: name,
            pass: name === controls[ckey],
          });
        }
      }
    }

    // A text style is a STYLE, not a variable -- a different mechanism entirely, so
    // it gets a tally rather than a bucket. The actionable figure is the number of
    // TEXT nodes carrying NO style, which is raw type that cannot follow the system.
    if (node.type === 'TEXT') {
      textStyles.textNodes += 1;
      const sid = node.styles && node.styles.text;
      if (sid) {
        const st = styleNames[sid] || {};
        const sname = st.name || `(unnamed ${sid})`;
        // `remote` is the tell that matters and REST does expose it. A remote text
        // style's internals are NOT in this file, so whether it binds type
        // variables cannot be read here -- and a remote style carrying static type
        // renders one brand's typeface in the other brand's modes. Remote is a
        // FLAG TO CHASE, never a defect on its own.
        if (!textStyles.byStyle[sid]) {
          textStyles.byStyle[sid] = {
            name: sname,
            // The published style key is the ONLY thing that answers "which
            // library". The name cannot, and `remote` only says "subscribed".
            styleKey: st.key || null,
            remote: st.remote === true,
            count: 0,
          };
        }
        textStyles.byStyle[sid].count += 1;
        if (st.remote === true) textStyles.remoteByScope[scope] += 1;

        // The (B) check's raw material: what font does this node actually render,
        // per style id. Family lowercased; weight kept exact, since weight is the
        // thing that deviates.
        const ns = node.style || {};
        if (ns.fontFamily || ns.fontWeight) {
          const rendered = String(ns.fontFamily || '(unknown family)').toLowerCase()
            + ' / weight ' + (ns.fontWeight === undefined ? '(unknown)' : ns.fontWeight);
          if (!textStyles.fontsByStyle[sid]) textStyles.fontsByStyle[sid] = {};
          textStyles.fontsByStyle[sid][rendered] = (textStyles.fontsByStyle[sid][rendered] || 0) + 1;
        }
      } else {
        textStyles.missing += 1;
        // Capped, and the cap is stated in the report rather than silently applied.
        if (textStyles.missingNodes.length < 40) {
          textStyles.missingNodes.push({ id: node.id, where: `${path} > ${node.name}` });
        }
      }

      // The three-state classification. `both` is reported separately rather than
      // folded into either single state: a node can genuinely carry a style AND
      // type variables, and forcing three exclusive buckets would either
      // double-count it or drop it. Silence about an overlap is the thing the
      // parallel table exists to prevent.
      const hasStyle = Boolean(sid);
      const hasTypeVars = TYPOGRAPHY_FIELDS.some((f) => aliasesOf((node.boundVariables || {})[f]).length > 0);
      if (hasStyle && hasTypeVars) textStyles.states.both += 1;
      else if (hasStyle) textStyles.states.sharedStyleOnly += 1;
      else if (hasTypeVars) textStyles.states.typeVariablesOnly += 1;
      else textStyles.states.neither += 1;
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
  const famOut = {};
  for (const f of FAMILIES) {
    famOut[f] = {};
    for (const b of BUCKETS) {
      famOut[f][b] = {
        sourceTree: { hits: families[f][b].sourceTree.hits, distinctNodes: families[f][b].sourceTree.nodes.size },
        nestedInstance: { hits: families[f][b].nestedInstance.hits, distinctNodes: families[f][b].nestedInstance.nodes.size },
      };
    }
  }

  const siteList = Object.entries(sites)
    // Node ids are kept, not dropped: without them you cannot construct a
    // --control for the next run, and an unusable control is an absent one.
    .map(([where, v]) => ({ where, ...v, count: v.nodes.size, nodes: [...v.nodes] }))
    .sort((a, b) => b.count - a.count);

  return {
    buckets: out,
    families: famOut,
    textStyles,
    ignored,
    sites: siteList,
    distinctNodes: Object.keys(distinct).length,
    controlResults,
  };
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
  const ign = (result.ignored && result.ignored.roots) || [];
  if (ign.length) {
    L.push(`**${ign.length} subtree(s) SKIPPED by the \`IGNORE/\` prefix**, whole and unmeasured:`);
    for (const r of ign) L.push(`- \`${r.name}\` (${r.type} ${r.id})`);
    L.push('');
    L.push('They contribute to no figure below. A scoped sweep and an incomplete one');
    L.push('read identically unless the skipped set is named, so it is named here.');
    L.push('');
  }
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
  L.push('Semantic, INTERNAL and unbound bindings on the component\'s own nodes — paints AND');
  L.push('the non-colour families, which is why the Family column exists. These are the');
  L.push('actionable ones; nested-instance repeats of the same source binding are not.');
  L.push('');
  if (!sourceGaps.length) {
    L.push('_None._');
  } else {
    L.push('| Nodes | Family | Bucket | Variable | Where |');
    L.push('|---:|---|---|---|---|');
    for (const s of sourceGaps.slice(0, 60)) {
      const where = s.where.split(' :: ').slice(2).join(' :: ');
      // A non-colour site carries `family`; a paint does not. Relabel through the
      // same helper the family histogram uses, because the bucket VOCABULARY is
      // shared and its fallback key is literally `color/* (semantic)` -- so an
      // unrelabelled typography site printed here reads as a colour problem. It did:
      // `type/system/body/01/*` bindings appeared under `color/* (semantic)` in the
      // 2026-09-08 Table sweep and had to be explained rather than read.
      const fam = s.family || 'colour';
      const bucket = s.family ? familyLabel(s.bucket) : s.bucket;
      L.push(`| ${s.count} | ${fam} | ${bucket} | \`${s.variable}\` | ${where} |`);
    }
    if (sourceGaps.length > 60) L.push('');
    if (sourceGaps.length > 60) L.push(`_${sourceGaps.length - 60} further sites in findings.json — not truncated there._`);
  }
  L.push('');
  L.push('## Non-colour binding families');
  L.push('');
  L.push('Radius, stroke weight and typography, read from each node\'s own `boundVariables`');
  L.push('map. Distinct nodes per family; a node carrying four corner radii counts once here');
  L.push('and four times in the site list.');
  L.push('');
  L.push('**Both scopes are shown, and that is not cosmetic.** A variant\'s own layers carry');
  L.push('few of these bindings; the great majority sit inside nested instances. Printing the');
  L.push('source-tree column alone rendered an empty table and the words "every family is');
  L.push('zero" on a variant holding 230 radius bindings — caught 2026-09-02, before use.');
  L.push('');
  L.push('| Family | Binding target | Source tree (nodes) | Nested instance (nodes) |');
  L.push('|---|---|---:|---:|');
  let famAny = 0;
  for (const f of FAMILIES) {
    for (const b of BUCKETS) {
      const r = result.families[f][b];
      if (!r.sourceTree.distinctNodes && !r.nestedInstance.distinctNodes) continue;
      famAny += r.sourceTree.distinctNodes + r.nestedInstance.distinctNodes;
      L.push(`| ${f} | \`${familyLabel(b).replace('{slug}', slug || '{slug}')}\` | ${r.sourceTree.distinctNodes} | ${r.nestedInstance.distinctNodes} |`);
    }
  }
  if (!famAny) L.push('| _(none)_ | | 0 | 0 |');
  L.push('');
  if (!famAny) {
    L.push('**No non-colour binding was found in either scope.** Read that as "nothing is');
    L.push('bound", NOT as "nothing needs to be" — an unbound radius is invisible to a table');
    L.push('that only sees bindings.');
    L.push('');
  }

  // A family reporting zero with no control aimed at it is UNVALIDATED, not clean.
  // This is the exact configuration that already produced a confident zero once.
  const controlledFamilies = new Set(result.controlResults
    .map((c) => String(c.node).split('.')[1])
    .filter(Boolean)
    .map((f) => NON_COLOUR_FIELDS[f])
    .filter(Boolean));
  const zeroUncontrolled = FAMILIES.filter((f) => {
    const total = BUCKETS.reduce((s, b) => s
      + result.families[f][b].sourceTree.distinctNodes
      + result.families[f][b].nestedInstance.distinctNodes, 0);
    return total === 0 && !controlledFamilies.has(f);
  });
  if (zeroUncontrolled.length) {
    L.push(`⚠ **Zero and UNVALIDATED: ${zeroUncontrolled.join(', ')}.**`);
    L.push('');
    L.push('No control was aimed at these families, so their zero is untested rather than');
    L.push('clean — and a zero from an unhandled data shape is indistinguishable from a true');
    L.push('absence. That has already happened here once: 230 radius bindings read as zero');
    L.push('because a corner-keyed map was handled as an array. Aim one:');
    L.push('');
    L.push('```');
    L.push('--control <nodeId>.<field>=<variableName>');
    L.push('```');
    L.push('');
  }

  const famGaps = result.sites.filter((s) => s.family && s.scope === 'sourceTree'
    && (s.bucket === 'color/* (semantic)' || s.bucket === 'INTERNAL/*'));
  L.push(`### Non-colour gaps — ${famGaps.length} distinct sites`);
  L.push('');
  L.push('Bound, but not to one of this component\'s own tokens.');
  L.push('');
  if (!famGaps.length) {
    L.push('_None._');
  } else {
    L.push('| Nodes | Family | Property | Variable | Where |');
    L.push('|---:|---|---|---|---|');
    for (const s of famGaps.slice(0, 40)) {
      const where = s.where.split(' :: ').slice(2).join(' :: ');
      L.push(`| ${s.count} | ${s.family} | \`${s.property}\` | \`${s.variable}\` | ${where} |`);
    }
    if (famGaps.length > 40) {
      L.push('');
      L.push(`_${famGaps.length - 40} further sites in findings.json — not truncated there._`);
    }
  }
  L.push('');

  const ts = result.textStyles;
  L.push('## Text styles');
  L.push('');
  L.push('**A text style is a style id, not a variable name.** It sits in no token namespace,');
  L.push('so it cannot be bucketed by one and is deliberately NOT a histogram row — folding');
  L.push('it in would make `component/{slug}/*` meaningless. This is the parallel table.');
  L.push('');
  L.push(`**${ts.textNodes} TEXT nodes · ${Object.keys(ts.byStyle).length} distinct styles · ${ts.missing} with no style REPORTED BY REST.**`);
  L.push('');
  if (ts.missing) {
    L.push('> ⚠ **The no-style figure is a CANDIDATE LIST, not a finding. It requires Plugin');
    L.push('> API confirmation before it is reported to anyone.** Measured 2026-09-08 on');
    L.push('> `Table/Column #1`: REST reported 10 TEXT nodes with 4 carrying no style; a');
    L.push('> Plugin API read of the same node returned 9 TEXT nodes with **0** missing —');
    L.push('> 1 on `component/title/01`, 8 on `component/body/01`, which is exactly what the');
    L.push('> shipped SCSS specifies. **Both the node count and the style count differed, so');
    L.push('> the two transports are not reading the same subtree.**');
    L.push('>');
    L.push('> ⚠ **WHY they disagree is UNDECIDED, and two explanations survive. They are not');
    L.push('> compatible and neither is established:**');
    L.push('> 1. **REST cannot resolve instance internals** — so the four never existed and');
    L.push('>    the record was wrong for five days.');
    L.push('> 2. **The instance was reset in the UI on 2026-09-07** — so the four did exist,');
    L.push('>    are now gone, and the record was right until the state changed. This fits');
    L.push('>    the node-count difference (10 → 9) without further assumption.');
    L.push('>');
    L.push('> **Both retire the designer task; only one makes the earlier record wrong.**');
    L.push('> Do not write either as settled. `[#9/g]` asserted the first while citing the');
    L.push('> second as fitting — an observation and an explanation sharing a sentence when');
    L.push('> only one of them was measured.');
    L.push('>');
    L.push('> This is the same class as the icon exclusion in the header: REST cannot be');
    L.push('> trusted on instance internals, and text styles inside instances are instance');
    L.push('> internals. **Four sessions treated the REST figure as a defect and it cost a');
    L.push('> designer task, a proposed canvas fix and an hour of triage.**');
    L.push('');
  }
  L.push('### How each TEXT node gets its type');
  L.push('');
  L.push('The state a single "typography: N" figure would hide is the first row: text');
  L.push('entirely on shared styles, bound to no type variable at all.');
  L.push('');
  L.push('| State | TEXT nodes |');
  L.push('|---|---:|');
  L.push(`| Shared text style only, no type variables | ${ts.states.sharedStyleOnly} |`);
  L.push(`| Typography variables only, no text style | ${ts.states.typeVariablesOnly} |`);
  L.push(`| Both a text style and typography variables | ${ts.states.both} |`);
  L.push(`| Neither — raw type | ${ts.states.neither} |`);
  L.push('');
  if (ts.states.both) {
    L.push('**The `both` row is not folded into either single state.** A node carrying a style');
    L.push('and type variables together is a real condition, and which one wins is not');
    L.push('established here.');
    L.push('');
  }
  if (Object.keys(ts.byStyle).length) {
    const entries = Object.entries(ts.byStyle).sort((a, b) => b[1].count - a[1].count);
    const remoteNodes = entries.filter(([, v]) => v.remote).reduce((s, [, v]) => s + v.count, 0);
    L.push(`**${remoteNodes} of ${ts.textNodes} TEXT nodes sit on a REMOTE text style** —`);
    L.push(`**${ts.remoteByScope.sourceTree} in the source tree, ${ts.remoteByScope.nestedInstance} inside nested instances.**`);
    L.push('');
    L.push('The source-tree figure is the one that sizes a change: a nested instance repeats');
    L.push('its source\'s style, so rebinding a source cascades. Reading only the total');
    L.push('confuses "this many places to fix" with "this many sources whose fix carries".');
    L.push('');
    L.push('**The published key is the actionable column, not the name.** A style name does');
    L.push('not identify its library — `Headline/06` is published by nine libraries and');
    L.push('`Headline/07` by eight, four of them marked do-not-use, and `remote: true` reads');
    L.push('identically for every one. Match the key to answer "which library".');
    L.push('');
    L.push('| Style | Published key | TEXT nodes | Source |');
    L.push('|---|---|---:|---|');
    for (const [, v] of entries) {
      L.push(`| \`${v.name}\` | ${v.styleKey ? `\`${v.styleKey}\`` : '_(local, no published key)_'} | ${v.count} | ${v.remote ? '**remote library**' : 'local'} |`);
    }
    L.push('');
  }
  if (ts.missing) {
    L.push(`### Unstyled TEXT nodes — ${ts.missing}`);
    L.push('');
    for (const m of ts.missingNodes) L.push(`- \`${m.id}\` — ${m.where}`);
    if (ts.missing > ts.missingNodes.length) {
      L.push('');
      L.push(`_Listing capped at ${ts.missingNodes.length}; ${ts.missing - ts.missingNodes.length} more counted but not listed._`);
    }
    L.push('');
  }
  L.push('### The (B) check — one style, more than one rendered font');
  L.push('');
  L.push('Figma\'s panel writes `component/body/01 · 14/16(B)` when a style is applied AND a');
  L.push('local font sits on top of it. There is no expected value to compare against here,');
  L.push('so this checks consistency instead: a style resolving to more than one font across');
  L.push('the swept nodes means some of them deviate. **It detects disagreement, never');
  L.push('wrongness** — if every node on a style is overridden identically it reports nothing.');
  L.push('');
  const inconsistent = Object.entries(ts.fontsByStyle || {}).filter(([, m]) => Object.keys(m).length > 1);
  if (!inconsistent.length) {
    L.push(`_No style renders more than one font. ${Object.keys(ts.fontsByStyle || {}).length} style(s) checked._`);
  } else {
    L.push('| Style | Rendered font | Nodes |');
    L.push('|---|---|---:|');
    for (const [sid, fonts] of inconsistent) {
      const label = (ts.byStyle[sid] && ts.byStyle[sid].name) || sid;
      const sorted = Object.entries(fonts).sort((a, b) => b[1] - a[1]);
      sorted.forEach(([font, n], i) => {
        L.push(`| ${i === 0 ? '`' + label + '`' : ''} | ${font}${i === 0 ? ' _(most common)_' : ' **← deviates**'} | ${n} |`);
      });
    }
    L.push('');
    L.push('**The most common rendering is treated as the style\'s own and the rest as');
    L.push('deviations.** That is a heuristic, not a reading of the style definition — check');
    L.push('the majority is actually right before acting on the minority.');
  }
  L.push('');
  L.push('**A style name here is not proof the style binds variables.** A remote style can');
  L.push('carry static type that renders one brand\'s typeface in the other brand\'s modes,');
  L.push('and this tally cannot see inside it. Resolve per brand before any cross-brand');
  L.push('claim about type.');
  L.push('');

  L.push('## Not covered');
  L.push('');
  L.push('- **Anything in the `UNRESOLVED (remote)` row** — bound inside a library instance,');
  L.push('  to a variable this file does not hold locally. Not unbound, not verified: not');
  L.push('  measured. **Icons live here**, so a non-zero count means icon bindings are');
  L.push('  unaudited by this script and need a Plugin API pass.');
  L.push('- **Resolved per-side stroke weight VALUES** — the Plugin API\'s `strokeTopWeight`');
  L.push('  and its three siblings are absent from REST, and reading them yields zero for');
  L.push('  every stroke. Bindings on `individualStrokeWeights` ARE covered above; the');
  L.push('  numbers behind them are not.');
  L.push('- **Padding, spacing, sizing, layout and effects** — not swept. Radius, stroke');
  L.push('  weight, typography and text styles are; those four were the ask.');
  L.push('- **Whether a bound value is the RIGHT one.** Bucketing catches "not');
  L.push('  componentised". A radius bound to the wrong component token passes as clean.');
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

  // `IGNORE/` subtrees are skipped WHOLE -- the prefix is a design-lead scope call
  // made on the canvas. The assertions that matter are the two silent-failure modes:
  // a skipped subtree must contribute NOTHING, and it must still be NAMED.
  const ignoreTree = {
    id: '4:1', name: 'Table', type: 'FRAME', fills: [],
    children: [
      { id: '4:2', name: 'Keep me', type: 'TEXT', fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:2' } } }] },
      {
        id: '4:3', name: 'IGNORE/test: zebra + expandable', type: 'SECTION', fills: [],
        children: [
          { id: '4:4', name: 'Buried', type: 'TEXT', fills: [{ type: 'SOLID' }] },
          { id: '4:5', name: 'Also buried', type: 'TEXT', fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:9' } } }] },
        ],
      },
    ],
  };
  const rIgn = analyse(ignoreTree, varNames, 'table', {}, {});
  assert.equal(rIgn.ignored.roots.length, 1, 'the skipped subtree is recorded, not silently dropped');
  assert.equal(rIgn.ignored.roots[0].name, 'IGNORE/test: zebra + expandable');
  assert.equal(rIgn.ignored.roots[0].why, 'IGNORE/ prefix', 'the report must be able to say WHY it was skipped');
  assert.equal(rIgn.buckets.UNBOUND.sourceTree.distinctNodes, 0, 'an unbound paint inside IGNORE/ is NOT a gap');
  assert.equal(rIgn.textStyles.textNodes, 1, 'TEXT nodes inside IGNORE/ are not counted either');
  assert.equal(rIgn.buckets['color/* (semantic)'].sourceTree.distinctNodes, 1, 'and the kept sibling still counts');

  // --ignore does the same job by exact name, for a section that must keep its name.
  // The kept sibling assertion is the one that matters: an exclusion that also drops
  // in-scope nodes is indistinguishable from a correct one in the totals alone.
  const rNamed = analyse(ignoreTree, varNames, 'table', {}, {}, ['Keep me']);
  assert.equal(rNamed.ignored.roots.length, 2, 'prefix and named exclusions accumulate in one list');
  assert.equal(rNamed.ignored.roots.some((r) => r.why === '--ignore'), true, 'and are distinguishable by reason');
  assert.equal(rNamed.buckets['color/* (semantic)'].sourceTree.distinctNodes, 0, 'the named node is now excluded too');
  const rNamedNoop = analyse(ignoreTree, varNames, 'table', {}, {}, ['Not on this canvas']);
  assert.equal(rNamedNoop.ignored.roots.length, 1, 'an --ignore name that matches nothing excludes nothing');
  assert.equal(rNamedNoop.buckets['color/* (semantic)'].sourceTree.distinctNodes, 1, 'and leaves the census intact');

  // several roots in one pass must sum, not overwrite
  const rMulti = analyse([setTree, tree], varNames, 'table');
  assert.equal(rMulti.buckets['component/{slug}/*'].sourceTree.distinctNodes, 2, 'roots accumulate');
  assert.equal(rMulti.buckets['color/* (semantic)'].nestedInstance.distinctNodes, 1, 'nested scope survives a multi-root sweep');

  // a failing control must be visible
  const r3 = analyse(tree, varNames, 'table', { '0:1': 'component/table/background/footer-default' });
  assert.equal(r3.controlResults[0].pass, false, 'wrong expectation fails the control');

  // --- all three boundVariables shapes. An unhandled shape reads as "nothing
  // bound", which is why each one is pinned here rather than trusted. ---
  assert.equal(aliasesOf({ type: 'VARIABLE_ALIAS', id: 'v1' }).length, 1, 'single alias');
  assert.equal(aliasesOf([{ id: 'v1' }, { id: 'v2' }]).length, 2, 'array of aliases');
  assert.equal(aliasesOf({ RECTANGLE_TOP_LEFT_CORNER_RADIUS: { id: 'v1' }, RECTANGLE_TOP_RIGHT_CORNER_RADIUS: { id: 'v2' } }).length, 2, 'map keyed by sub-field');
  assert.equal(aliasesOf({ RECTANGLE_TOP_LEFT_CORNER_RADIUS: { id: 'v1' } })[0].subField, 'RECTANGLE_TOP_LEFT_CORNER_RADIUS', 'sub-field survives into the report');
  assert.deepEqual(aliasesOf(null), [], 'absent is empty, not a crash');
  assert.deepEqual(aliasesOf('nonsense'), [], 'an unexpected scalar is empty, not a crash');
  assert.deepEqual(aliasesOf({ FOO: { noIdHere: true } }), [], 'entries without an id are dropped');

  // --- non-colour families, text styles, and the double-count regression ---
  const nc = {
    id: '4:1', name: 'Card', type: 'COMPONENT',
    boundVariables: {
      // THE REAL SHAPE: a map keyed by corner, not an array. Handling only arrays
      // reported zero radius bindings on a variant that had 230.
      rectangleCornerRadii: {
        RECTANGLE_TOP_LEFT_CORNER_RADIUS: { type: 'VARIABLE_ALIAS', id: 'VariableID:3' },
        RECTANGLE_TOP_RIGHT_CORNER_RADIUS: { type: 'VARIABLE_ALIAS', id: 'VariableID:3' },
        RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS: { type: 'VARIABLE_ALIAS', id: 'VariableID:3' },
        RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS: { type: 'VARIABLE_ALIAS', id: 'VariableID:3' },
      },
      individualStrokeWeights: { type: 'VARIABLE_ALIAS', id: 'VariableID:4' },
      // node-level colour keys: the paint walk already counts these bindings, so
      // they must be IGNORED here. If this ever regresses, every colour binding
      // in the report doubles.
      fills: [{ type: 'VARIABLE_ALIAS', id: 'VariableID:1' }],
      strokes: [{ type: 'VARIABLE_ALIAS', id: 'VariableID:1' }],
    },
    fills: [{ type: 'SOLID', boundVariables: { color: { id: 'VariableID:1' } } }],
    children: [
      {
        id: '4:2', name: 'Label', type: 'TEXT', fills: [], styles: { text: 'S:aaa' },
        boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'VariableID:5' } },
      },
      { id: '4:3', name: 'Raw label', type: 'TEXT', fills: [] },

    ],
  };
  const names2 = {
    'VariableID:1': 'component/table/background/header-default',
    'VariableID:3': 'component/table/radius/cell-default',
    'VariableID:4': 'border-width/thin',
    'VariableID:5': 'type/body/01',
  };
  const rn = analyse(nc, names2, 'table', {}, { styles: { 'S:aaa': { name: 'Detail/02', remote: true } } });

  assert.equal(rn.families.radius['component/{slug}/*'].sourceTree.distinctNodes, 1, 'four corner radii are one node');
  assert.equal(rn.families.radius['component/{slug}/*'].sourceTree.hits, 4, 'and four binding sites');
  assert.equal(rn.families.strokeWeight['color/* (semantic)'].sourceTree.distinctNodes, 1, 'stroke weight on a primitive is a gap');
  assert.equal(rn.families.typography['color/* (semantic)'].sourceTree.distinctNodes, 1, 'type on a non-component variable is a gap');
  assert.equal(rn.families.typography['component/{slug}/*'].sourceTree.distinctNodes, 0, 'and is not also counted as componentised');

  assert.equal(rn.buckets['component/{slug}/*'].sourceTree.paints, 1, 'node-level fills/strokes are ignored, never added to the paint count');
  assert.equal(rn.buckets['component/{slug}/*'].sourceTree.distinctNodes, 1, 'the painted node is counted once');

  assert.equal(rn.textStyles.textNodes, 2);
  assert.equal(rn.textStyles.missing, 1, 'the unstyled TEXT node is the actionable gap');
  assert.equal(rn.textStyles.byStyle['S:aaa'].count, 1, 'style id resolved to a name through the styles map');
  assert.equal(rn.textStyles.byStyle['S:aaa'].name, 'Detail/02');
  assert.equal(rn.textStyles.byStyle['S:aaa'].remote, true, 'and its remote flag is carried through — the tell for static type');
  const rnLocal = analyse(nc, names2, 'table', {}, { styles: { 'S:aaa': { name: 'component/body/01', remote: false } } });
  assert.equal(rnLocal.textStyles.byStyle['S:aaa'].remote, false, 'a local style is not flagged remote');
  const rnUnknown = analyse(nc, names2, 'table', {}, {});
  assert.equal(Object.values(rnUnknown.textStyles.byStyle)[0].remote, false, 'an unresolvable style is not GUESSED remote — absence is not evidence');

  // THE COLLISION THIS KEYING EXISTS FOR: two DIFFERENT subscribed styles sharing a
  // name must stay two rows. Keyed by name they merged — counts summed and `remote`
  // frozen from whichever was seen first, which is how a deprecated library would
  // hide behind a good one.
  const collide = analyse(
    { id: '9:1', name: 'R', type: 'FRAME', fills: [], children: [
      { id: '9:2', name: 'A', type: 'TEXT', fills: [], styles: { text: 'S:one' } },
      { id: '9:3', name: 'B', type: 'TEXT', fills: [], styles: { text: 'S:two' } },
    ] },
    names2, 'table', {},
    { styles: {
      'S:one': { name: 'Headline/06', remote: true, key: 'aaaa1111' },
      'S:two': { name: 'Headline/06', remote: false, key: null },
    } }
  );
  assert.equal(Object.keys(collide.textStyles.byStyle).length, 2, 'same name, two ids, two rows');
  assert.equal(collide.textStyles.byStyle['S:one'].remote, true);
  assert.equal(collide.textStyles.byStyle['S:two'].remote, false, 'the local one is not tainted by its remote namesake');
  assert.equal(collide.textStyles.byStyle['S:one'].styleKey, 'aaaa1111', 'the published key is carried — the only thing that names a library');
  assert.equal(collide.textStyles.remoteByScope.sourceTree, 1, 'and only the remote one counts as remote');

  // THE (B) CHECK. Two nodes on one style rendering different weights is the
  // condition; the same weight under different family CASING is not.
  const bCheck = analyse(
    { id: 'b:1', name: 'R', type: 'FRAME', fills: [], children: [
      { id: 'b:2', name: 'A', type: 'TEXT', fills: [], styles: { text: 'S:body' }, style: { fontFamily: 'TRATON Type Text', fontWeight: 400 } },
      { id: 'b:3', name: 'B', type: 'TEXT', fills: [], styles: { text: 'S:body' }, style: { fontFamily: 'TRATON Type Text', fontWeight: 700 } },
      // same style, same weight, family differs only by case -> NOT a deviation
      { id: 'b:4', name: 'C', type: 'TEXT', fills: [], styles: { text: 'S:title' }, style: { fontFamily: 'TRATON Type Text', fontWeight: 600 } },
      { id: 'b:5', name: 'D', type: 'TEXT', fills: [], styles: { text: 'S:title' }, style: { fontFamily: 'traton type text', fontWeight: 600 } },
    ] },
    names2, 'table', {},
    { styles: { 'S:body': { name: 'component/body/01' }, 'S:title': { name: 'component/title/01' } } }
  );
  assert.equal(Object.keys(bCheck.textStyles.fontsByStyle['S:body']).length, 2, 'one style rendering two weights is flagged');
  assert.equal(Object.keys(bCheck.textStyles.fontsByStyle['S:title']).length, 1, 'family casing alone is NOT a deviation — this produced 2,945 false positives once');
  assert.equal(bCheck.textStyles.fontsByStyle['S:title']['traton type text / weight 600'], 2, 'and both casings fold into one bucket');

  // a family-aimed control: --control <nodeId>.<field>=<variableName>
  const famCtl = analyse(nc, names2, 'table', { '4:1.individualStrokeWeights': 'border-width/thin' });
  const hit = famCtl.controlResults.find((c) => c.node === '4:1.individualStrokeWeights');
  assert.ok(hit, 'a control aimed at a non-colour field is evaluated at all');
  assert.equal(hit.pass, true, 'and passes when the binding matches');
  const famCtlBad = analyse(nc, names2, 'table', { '4:1.rectangleCornerRadii': 'component/table/radius/WRONG' });
  assert.equal(famCtlBad.controlResults[0].pass, false, 'a wrong expectation on a family control fails visibly');

  // The three-state table. `4:2` has a style AND a fontSize variable; `4:3` has
  // neither. The row that a single "typography: N" would hide is sharedStyleOnly,
  // so it is asserted explicitly rather than inferred from a total.
  assert.equal(rn.textStyles.states.both, 1, 'style + type variable is its own state, not folded away');
  assert.equal(rn.textStyles.states.neither, 1, 'raw type is counted');
  assert.equal(rn.textStyles.states.sharedStyleOnly, 0);
  assert.equal(rn.textStyles.states.typeVariablesOnly, 0);
  const stateSum = Object.values(rn.textStyles.states).reduce((a, b) => a + b, 0);
  assert.equal(stateSum, rn.textStyles.textNodes, 'every TEXT node lands in exactly one state — no node dropped, none counted twice');

  // A node on a shared style with NO type variables is the state the ruling exists
  // for: a component whose text is entirely on shared styles would otherwise pass.
  const sharedOnly = analyse(
    { id: '7:1', name: 'T', type: 'TEXT', fills: [], styles: { text: 'S:bbb' } },
    names2, 'table', {}, { styles: { 'S:bbb': { name: 'Detail/02', remote: true } } }
  );
  assert.equal(sharedOnly.textStyles.states.sharedStyleOnly, 1, 'shared-style-only is visible as its own state');
  assert.equal(sharedOnly.textStyles.remoteByScope.sourceTree, 1, 'a remote-styled node on the component itself is source tree');
  assert.equal(sharedOnly.textStyles.remoteByScope.nestedInstance, 0, 'and not double-counted as nested');
  // and the same node one level inside an instance must land in the other column
  const remoteNested = analyse(
    { id: '8:1', name: 'Root', type: 'COMPONENT', fills: [], children: [{
      id: '8:2', name: 'Chip', type: 'INSTANCE', fills: [], children: [
        { id: '8:3', name: 'T', type: 'TEXT', fills: [], styles: { text: 'S:bbb' } },
      ],
    }] },
    names2, 'table', {}, { styles: { 'S:bbb': { name: 'Detail/02', remote: true } } }
  );
  assert.equal(remoteNested.textStyles.remoteByScope.nestedInstance, 1, 'a remote-styled node inside an instance is nested');
  assert.equal(remoteNested.textStyles.remoteByScope.sourceTree, 0, 'and is not attributed to the component itself');
  assert.equal(sharedOnly.families.typography['component/{slug}/*'].sourceTree.distinctNodes, 0, 'and contributes nothing to the typography histogram');
  assert.equal(rn.textStyles.missingNodes[0].id, '4:3', 'and the unstyled node is named so it can be found');

  // A non-colour binding inside a nested instance must land in the nested scope,
  // never be dropped. On a real variant almost ALL of them are nested, so a
  // source-only reading of this data reports zero on a component full of bindings.
  const nested = {
    id: '6:1', name: 'Root', type: 'COMPONENT', fills: [],
    children: [{
      id: '6:2', name: 'Chip', type: 'INSTANCE', fills: [],
      boundVariables: { rectangleCornerRadii: { type: 'VARIABLE_ALIAS', id: 'VariableID:3' } },
      children: [{
        id: '6:3', name: 'Text', type: 'TEXT', fills: [],
        boundVariables: { fontSize: { type: 'VARIABLE_ALIAS', id: 'VariableID:5' } },
      }],
    }],
  };
  const rn3 = analyse(nested, names2, 'table');
  // The INSTANCE node itself is SOURCE TREE -- placing it is the component's own
  // doing, so a binding on it is the component's own. Only what lives INSIDE it is
  // nested. Same rule the colour walk already uses; asserted here so the two
  // families can never drift apart on it.
  assert.equal(rn3.families.radius['component/{slug}/*'].sourceTree.distinctNodes, 1, 'radius on the instance node itself is source tree');
  assert.equal(rn3.families.radius['component/{slug}/*'].nestedInstance.distinctNodes, 0, 'and is not double-counted as nested');
  assert.equal(rn3.families.typography['color/* (semantic)'].nestedInstance.distinctNodes, 1, 'type on a layer INSIDE the instance is nested');
  assert.equal(rn3.families.typography['color/* (semantic)'].sourceTree.distinctNodes, 0, 'and not attributed to the component itself');

  // an unresolvable non-colour binding must not read as a component token
  const rn2 = analyse(
    { id: '5:1', name: 'X', type: 'FRAME', fills: [], boundVariables: { fontSize: { id: 'VariableID:999' } } },
    names2, 'table'
  );
  assert.equal(rn2.families.typography['UNRESOLVED (remote)'].sourceTree.hits, 1, 'unresolved non-colour binding gets the blind-spot bucket');

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
  const maps = { components: {}, componentSets: {}, styles: {} };
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
        // Style ids resolve to names only through this map; without it every text
        // style reports as "(unnamed …)" and the tally is unreadable.
        Object.assign(maps.styles, entry.styles || {});
      } else missing.push(id);
    }
  }
  if (missing.length) {
    // Never sweep a partial set silently — a smaller total reads as less debt.
    console.error(`Not present in file ${fileKey}: ${missing.join(', ')}`);
    console.error('Ids are file-scoped and collide across files — re-derive them in THIS file.');
    process.exit(1);
  }

  // --ignore "Name" or --ignore "A,B" — exact names, skipped whole and recorded.
  const ignoreList = (arg('--ignore') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const result = analyse(roots, varNames, slug, controls, maps, ignoreList);
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
  // Both scopes, always. A source-only line reads as "nothing bound" on a variant
  // whose bindings all live in nested instances.
  for (const f of FAMILIES) {
    const sum = (scope, keys) => keys.reduce((s, k) => s + result.families[f][k][scope].distinctNodes, 0);
    const gapKeys = ['color/* (semantic)', 'INTERNAL/*'];
    // TOTAL is printed alongside own/gap deliberately. Without it a family whose
    // bindings are all DELEGATED or all helper furniture prints "0 own 0 gap" and
    // reads as "nothing bound" -- which is how strokeWeight's 2 delegated bindings
    // looked like a zero. Third variant of the same reporting failure in this file:
    // a column narrower than the claim made from it.
    const all = sum('sourceTree', BUCKETS) + sum('nestedInstance', BUCKETS);
    console.log(`${f.padEnd(26)} source ${String(sum('sourceTree', ['component/{slug}/*'])).padStart(6)} own ${String(sum('sourceTree', gapKeys)).padStart(4)} gap   nested ${String(sum('nestedInstance', ['component/{slug}/*'])).padStart(6)} own ${String(sum('nestedInstance', gapKeys)).padStart(4)} gap   total ${String(all).padStart(6)}`);
  }
  const ts = result.textStyles;
  console.log(`${'text styles'.padEnd(26)} ${ts.textNodes} TEXT nodes, ${Object.keys(ts.byStyle).length} styles, ${ts.missing} unstyled`);

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
