#!/usr/bin/env node
/**
 * Aggregate Audit Report Generator + Bridge Input Assembly (Phase 6)
 *
 * Reads outputs from all audit phases and generates:
 * 1. Per-component audit reports (JSON + MD)
 * 2. Aggregate taxonomy health report
 * 3. Bridge-ready input blocks per component
 *
 * Run from project root: node tokens/scripts/generate-audit-report.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');

/* ------------------------------------------------------------------ */
/*  Data loading helpers                                               */
/* ------------------------------------------------------------------ */

function loadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function getOutputDir() {
  const runId = process.env.AUDIT_RUN_ID
    || loadJson(join(AUDIT_BASE_DIR, 'latest-run.json'))?.runId;
  if (!runId) throw new Error('No AUDIT_RUN_ID or latest-run.json found');
  return { runId, outputDir: join(AUDIT_BASE_DIR, runId) };
}

/* ------------------------------------------------------------------ */
/*  Per-component data collection                                      */
/* ------------------------------------------------------------------ */

function collectComponentData(slug, outputDir) {
  const data = {};

  // 1. Variable inventory + mapping (per-component JSON from baseline audit)
  const compJson = loadJson(join(outputDir, `${slug}.json`));
  if (compJson) {
    data.inventory = {
      webComponent: compJson.webComponent,
      tegelLite: compJson.tegelLite,
    };
  }

  // 2. Hardcoded scan
  const hardcodedData = loadJson(join(outputDir, '_hardcoded-scan.json'));
  if (hardcodedData) {
    const comp = hardcodedData.components?.find((c) => c.component === slug);
    if (comp) {
      data.hardcodedScan = {
        totalHardcoded: comp.totalHardcoded,
        summary: comp.summary,
        files: comp.files,
      };
    }
  }

  // 3. Variant matrix
  const variantData = loadJson(join(outputDir, '_variant-matrix.json'));
  if (variantData) {
    const comp = variantData.components?.find((c) => c.component === slug);
    if (comp) {
      data.variantMatrix = {
        webComponentProps: comp.webComponentProps,
        hasDisabledProp: comp.hasDisabledProp,
        tegelLiteVariants: comp.tegelLiteVariants,
        componentTokens: comp.componentTokens,
        tokenVariantCoverage: comp.tokenVariantCoverage,
        mismatches: comp.mismatches,
      };
    }
  }

  // 4. Taxonomy naming
  const namingData = loadJson(join(outputDir, '_taxonomy-naming.json'));
  if (namingData) {
    const comp = namingData.components?.find((c) => c.component === slug);
    if (comp) {
      data.taxonomyNaming = {
        variableCount: comp.variableCount,
        valid: comp.valid,
        violations: comp.violations,
      };
    }
  }

  // 5. Alias chains (component-level tokens in chain data)
  const aliasData = loadJson(join(outputDir, '_alias-chains.json'));
  if (aliasData) {
    data.aliasChains = {
      themes: aliasData.themes,
      issues: aliasData.issues,
      chainDepth: aliasData.chainDepth,
    };
  }

  // 6. Overlap analysis
  const overlapData = loadJson(join(outputDir, '_overlap-analysis.json'));
  if (overlapData) {
    const comp = overlapData.components?.find((c) => (c.slug || c.component) === slug);
    if (comp) {
      data.overlap = comp;
    }
  }

  // 7. Figma snapshot (if available)
  const figmaSnapshot = loadJson(join(AUDIT_BASE_DIR, 'figma-snapshot.json'));
  if (figmaSnapshot) {
    const compFigma = figmaSnapshot.components?.find((c) => c.slug === slug || c.component === slug);
    if (compFigma) {
      data.figmaTarget = compFigma;
    }
  }

  return data;
}

/* ------------------------------------------------------------------ */
/*  Bridge input block assembly                                        */
/* ------------------------------------------------------------------ */

function assembleBridgeInput(slug, data) {
  const lines = [];

  lines.push(`## Component: ${slug}`);
  lines.push('');

  // --- Code (current) ---
  lines.push('### Code (current)');
  lines.push('');

  // Web component variables
  if (data.inventory?.webComponent) {
    const wc = data.inventory.webComponent;
    lines.push(`**Web Component Variables** (${wc.variables?.length || 0})`);
    if (wc.variables?.length > 0) {
      for (const v of wc.variables) {
        lines.push(`- \`${v}\``);
      }
    }
    lines.push('');
  } else {
    lines.push('**Web Component Variables**: none');
    lines.push('');
  }

  // Tegel Lite variables
  if (data.inventory?.tegelLite) {
    const tl = data.inventory.tegelLite;
    lines.push(`**Tegel Lite Variables** (${tl.variables?.length || 0})`);
    if (tl.variables?.length > 0) {
      for (const v of tl.variables) {
        lines.push(`- \`${v}\``);
      }
    }
    lines.push('');
  } else {
    lines.push('**Tegel Lite Variables**: none');
    lines.push('');
  }

  // Component tokens (from tokens/scss/component/)
  if (data.variantMatrix?.componentTokens?.length > 0) {
    lines.push(`**Component Tokens** (${data.variantMatrix.componentTokens.length})`);
    for (const t of data.variantMatrix.componentTokens) {
      lines.push(`- \`${t}\``);
    }
    lines.push('');
  }

  // Overlap
  if (data.overlap?.analysis?.summary) {
    const s = data.overlap.analysis.summary;
    lines.push(`**Overlap**: Web-only=${s.webOnlyCount || 0}, Lite-only=${s.tegelLiteOnlyCount || 0}, Shared=${s.overlapCount || 0}`);
    lines.push('');
  }

  // Variant/prop coverage
  if (data.variantMatrix?.webComponentProps) {
    lines.push('**Variant Props (from API)**');
    for (const [prop, info] of Object.entries(data.variantMatrix.webComponentProps)) {
      lines.push(`- ${prop}: ${info.values.map((v) => `\`${v}\``).join(' | ')}`);
    }
    lines.push('');
  }

  // Disabled state
  const hasDisabled = data.variantMatrix?.hasDisabledProp || false;
  lines.push(`**Disabled state in API**: ${hasDisabled ? 'yes' : 'no'}`);

  // Border radius
  const hasBorderRadius = data.variantMatrix?.componentTokens?.some((t) => t.includes('border-radius')) || false;
  lines.push(`**Border-radius in tokens**: ${hasBorderRadius ? 'yes' : 'no'}`);
  lines.push('');

  // Hardcoded values summary
  if (data.hardcodedScan) {
    const hs = data.hardcodedScan;
    lines.push(`**Hardcoded Values**: ${hs.totalHardcoded} (colors: ${hs.summary?.colors || 0}, dimensions: ${hs.summary?.dimensions || 0}, typography: ${hs.summary?.typography || 0})`);
    lines.push('');
  }

  // Naming violations
  if (data.taxonomyNaming) {
    const tn = data.taxonomyNaming;
    lines.push(`**Taxonomy Naming**: ${tn.variableCount} vars, ${tn.valid} valid, ${tn.violations?.length || 0} violations`);
    if (tn.violations?.length > 0) {
      const ruleCount = {};
      for (const v of tn.violations) {
        ruleCount[v.rule] = (ruleCount[v.rule] || 0) + 1;
      }
      for (const [rule, count] of Object.entries(ruleCount)) {
        lines.push(`  - ${rule}: ${count}`);
      }
    }
    lines.push('');
  }

  // --- Figma (target) ---
  if (data.figmaTarget) {
    lines.push('### Figma (target)');
    lines.push('');
    lines.push(`**Status**: Available`);
    if (data.figmaTarget.variables) {
      lines.push(`**Figma Variables**: ${data.figmaTarget.variables.length}`);
      for (const v of data.figmaTarget.variables) {
        lines.push(`- \`${v.name || v}\``);
      }
    }
    if (data.figmaTarget.delta) {
      const delta = data.figmaTarget.delta;
      lines.push(`**Delta**: +${delta.added?.length || 0} added, -${delta.removed?.length || 0} removed, ~${delta.changed?.length || 0} changed`);
    }
    lines.push('');
  }

  // --- Flags ---
  lines.push('### Flags');
  lines.push('');
  lines.push(`- hasFigmaTarget: ${data.figmaTarget ? 'true' : 'false'}`);
  if (data.figmaTarget?.delta) {
    const delta = data.figmaTarget.delta;
    const intent = delta.classification || (delta.added?.length > delta.removed?.length ? 'extended' : delta.removed?.length > delta.added?.length ? 'simplified' : 'unchanged');
    lines.push(`- designerIntent: ${intent}`);
  }

  // Token variant mismatches as review items
  const reviewItems = [];
  if (data.variantMatrix?.mismatches?.length > 0) {
    reviewItems.push(`${data.variantMatrix.mismatches.length} variant/token mismatches`);
  }
  if (data.taxonomyNaming?.violations?.length > 0) {
    reviewItems.push(`${data.taxonomyNaming.violations.length} naming violations`);
  }
  if (reviewItems.length > 0) {
    lines.push(`- reviewNeeded: [${reviewItems.join(', ')}]`);
  }
  lines.push('');

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Aggregate taxonomy health                                          */
/* ------------------------------------------------------------------ */

function computeTaxonomyHealth(outputDir, componentSlugs) {
  const naming = loadJson(join(outputDir, '_taxonomy-naming.json'));
  const alias = loadJson(join(outputDir, '_alias-chains.json'));
  const hardcoded = loadJson(join(outputDir, '_hardcoded-scan.json'));
  const variant = loadJson(join(outputDir, '_variant-matrix.json'));

  const health = {
    namingCompliance: null,
    coverageGaps: null,
    aliasChainHealth: null,
    brandParity: null,
    hardcodedDebt: null,
  };

  if (naming) {
    health.namingCompliance = {
      totalVariables: naming.totalVariables,
      valid: naming.valid,
      violations: naming.totalViolations,
      complianceRate: naming.totalVariables > 0
        ? Math.round((naming.valid / naming.totalVariables) * 100) : 0,
      ruleBreakdown: naming.ruleBreakdown,
      propertyGrouping: naming.propertyGrouping,
    };
  }

  if (variant) {
    const allMismatches = variant.components?.flatMap((c) => c.mismatches) || [];
    const webMismatches = allMismatches.filter((m) => m.source === 'web-component');
    const liteMismatches = allMismatches.filter((m) => m.source === 'tegel-lite');
    health.coverageGaps = {
      totalMismatches: allMismatches.length,
      webComponentGaps: webMismatches.length,
      tegelLiteGaps: liteMismatches.length,
      componentsWithGaps: variant.components?.filter((c) => c.mismatches?.length > 0).length || 0,
    };
  }

  if (alias) {
    health.aliasChainHealth = {
      maxChainDepth: alias.chainDepth?.max,
      avgChainDepth: alias.chainDepth?.average,
      issues: alias.issues?.length || 0,
      issueTypes: alias.issues?.reduce((acc, i) => {
        acc[i.issue] = (acc[i.issue] || 0) + 1;
        return acc;
      }, {}),
    };
    health.brandParity = {
      tokensInAllThemes: alias.brandParity?.allThemes,
      scaniaOnly: alias.brandParity?.scaniaOnly?.length || 0,
      tratonOnly: alias.brandParity?.tratonOnly?.length || 0,
    };
  }

  if (hardcoded) {
    health.hardcodedDebt = {
      totalHardcoded: hardcoded.totalHardcodedValues,
      byType: hardcoded.aggregateSummary,
      componentsAffected: hardcoded.components?.filter((c) => c.totalHardcoded > 0).length || 0,
    };
  }

  return health;
}

/* ------------------------------------------------------------------ */
/*  Markdown generation                                                */
/* ------------------------------------------------------------------ */

function generateHealthMarkdown(health, componentReports) {
  let md = `# Taxonomy Health Report\n\n`;

  // Naming compliance
  if (health.namingCompliance) {
    const nc = health.namingCompliance;
    md += `## Naming Compliance\n\n`;
    md += `- Variables: ${nc.totalVariables}\n`;
    md += `- Valid: ${nc.valid} (${nc.complianceRate}%)\n`;
    md += `- Violations: ${nc.violations}\n\n`;
    if (nc.ruleBreakdown) {
      md += `| Rule | Count |\n|------|-------|\n`;
      for (const [rule, count] of Object.entries(nc.ruleBreakdown).sort(([, a], [, b]) => b - a)) {
        md += `| ${rule} | ${count} |\n`;
      }
      md += '\n';
    }
  }

  // Coverage gaps
  if (health.coverageGaps) {
    const cg = health.coverageGaps;
    md += `## Coverage Gaps\n\n`;
    md += `- Total variant/token mismatches: ${cg.totalMismatches}\n`;
    md += `- Web component gaps: ${cg.webComponentGaps}\n`;
    md += `- Tegel Lite gaps: ${cg.tegelLiteGaps}\n`;
    md += `- Components with gaps: ${cg.componentsWithGaps}\n\n`;
  }

  // Alias chain health
  if (health.aliasChainHealth) {
    const ac = health.aliasChainHealth;
    md += `## Alias Chain Health\n\n`;
    md += `- Max chain depth: ${ac.maxChainDepth}\n`;
    md += `- Avg chain depth: ${ac.avgChainDepth}\n`;
    md += `- Issues: ${ac.issues}\n\n`;
  }

  // Brand parity
  if (health.brandParity) {
    const bp = health.brandParity;
    md += `## Brand Parity\n\n`;
    md += `- Tokens in all themes: ${bp.tokensInAllThemes}\n`;
    md += `- Scania-only: ${bp.scaniaOnly}\n`;
    md += `- Traton-only: ${bp.tratonOnly}\n\n`;
  }

  // Hardcoded debt
  if (health.hardcodedDebt) {
    const hd = health.hardcodedDebt;
    md += `## Hardcoded Value Debt\n\n`;
    md += `- Total hardcoded values: ${hd.totalHardcoded}\n`;
    md += `- Components affected: ${hd.componentsAffected}\n`;
    if (hd.byType) {
      md += `- By type: ${Object.entries(hd.byType).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`;
    }
    md += '\n';
  }

  // Per-component summaries
  md += `## Component Summary\n\n`;
  md += `| Component | Web Vars | Lite Vars | Tokens | Hardcoded | Naming Valid | Naming Violations |\n`;
  md += `|-----------|----------|-----------|--------|-----------|-------------|-------------------|\n`;
  for (const r of componentReports) {
    md += `| ${r.slug} | ${r.webVarCount} | ${r.liteVarCount} | ${r.tokenCount} | ${r.hardcodedCount} | ${r.namingValid} | ${r.namingViolations} |\n`;
  }
  md += '\n';

  return md;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

function generateAuditReport() {
  console.log('Generating aggregate audit report...');

  const { runId, outputDir } = getOutputDir();

  // Determine component slugs
  const filterRaw = process.env.AUDIT_COMPONENTS;
  let slugs;
  if (filterRaw) {
    slugs = filterRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  } else {
    // Discover from per-component JSON files in the audit output dir
    const overlapData = loadJson(join(outputDir, '_overlap-analysis.json'));
    if (overlapData?.components) {
      slugs = overlapData.components.map((c) => c.slug || c.component).sort();
    } else {
      // Fall back to variable inventory
      const invData = loadJson(join(outputDir, '_variable-inventory.json'));
      const allSlugs = new Set();
      if (invData?.webComponents) invData.webComponents.forEach((c) => allSlugs.add(c.component));
      if (invData?.tegelLite) invData.tegelLite.forEach((c) => allSlugs.add(c.component));
      slugs = [...allSlugs].sort();
    }
  }

  if (!slugs || slugs.length === 0) {
    console.error('No component slugs found in audit output.');
    return;
  }

  console.log(`Processing ${slugs.length} components...`);

  // Collect per-component data and generate bridge inputs
  const bridgeBlocks = [];
  const componentReports = [];

  for (const slug of slugs) {
    const data = collectComponentData(slug, outputDir);

    // Build bridge input block
    const bridgeInput = assembleBridgeInput(slug, data);
    bridgeBlocks.push(bridgeInput);

    // Summary row data
    componentReports.push({
      slug,
      webVarCount: data.inventory?.webComponent?.variables?.length || 0,
      liteVarCount: data.inventory?.tegelLite?.variables?.length || 0,
      tokenCount: data.variantMatrix?.componentTokens?.length || 0,
      hardcodedCount: data.hardcodedScan?.totalHardcoded || 0,
      namingValid: data.taxonomyNaming?.valid || 0,
      namingViolations: data.taxonomyNaming?.violations?.length || 0,
    });
  }

  // Compute taxonomy health
  const health = computeTaxonomyHealth(outputDir, slugs);

  // --- Write outputs ---

  // 1. Taxonomy health report (JSON + MD) — written to run root with _ prefix
  const healthJsonPath = join(outputDir, '_taxonomy-health.json');
  writeFileSync(healthJsonPath, JSON.stringify({ generated: new Date().toISOString(), runId, health, componentReports }, null, 2));
  console.log(`✓ Created ${healthJsonPath}`);

  const healthMdPath = join(outputDir, '_taxonomy-health.md');
  writeFileSync(healthMdPath, generateHealthMarkdown(health, componentReports));
  console.log(`✓ Created ${healthMdPath}`);

  // 2. Ready-to-paste bridge prompt files (prompt template + component data)
  const promptTemplatePath = join(ROOT_DIR, 'tokens', 'docs', 'BRIDGE_GENERATION_PROMPT.md');
  let promptTemplate = null;
  try {
    promptTemplate = readFileSync(promptTemplatePath, 'utf-8');
  } catch {
    console.log('⚠ Bridge prompt template not found at tokens/docs/BRIDGE_GENERATION_PROMPT.md — skipping prompt files');
  }

  if (promptTemplate) {
    const placeholder = '[PASTE TOKEN ANALYSIS HERE]';
    let promptCount = 0;
    for (let i = 0; i < slugs.length; i++) {
      const assembled = promptTemplate.replace(placeholder, bridgeBlocks[i]);
      const promptPath = join(outputDir, `${slugs[i]}-bridge-prompt.md`);
      writeFileSync(promptPath, assembled);
      promptCount++;
    }
    console.log(`✓ Created ${promptCount} ready-to-paste bridge prompt files`);
  }

  console.log(`\nReport complete. Output: tokens/audit/${runId}/`);

  return { health, componentReports, bridgeBlocks };
}

const invokedAsMain = process.argv[1] && resolve(process.cwd(), process.argv[1]) === join(__dirname, 'generate-audit-report.js');
if (invokedAsMain) {
  generateAuditReport();
}

export { generateAuditReport };
