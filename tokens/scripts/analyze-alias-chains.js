#!/usr/bin/env node
/**
 * Token Alias Chain Analyzer (Phase 2)
 *
 * Analyzes token reference chains in source JSON ({reference} syntax) and
 * export JSON (com.figma.aliasData), validates integrity, and reports
 * brand parity across themes.
 *
 * Run from project root: node tokens/scripts/analyze-alias-chains.js
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');
const TOKENS_DIR = join(ROOT_DIR, 'tokens', 'json');

const THEMES = ['scania-light', 'scania-dark', 'traton-light', 'traton-dark'];

/* ------------------------------------------------------------------ */
/*  Token walking                                                      */
/* ------------------------------------------------------------------ */

/** Recursively walk a token JSON tree, yielding { path, node } for each token ($type+$value). */
function walkTokens(obj, prefix = '') {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) continue; // skip $type, $value, $extensions, $themes, $metadata
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && '$type' in value && '$value' in value) {
      results.push({ path, node: value });
    } else if (value && typeof value === 'object') {
      results.push(...walkTokens(value, path));
    }
  }
  return results;
}

/** Resolve a dot-path in a nested object. */
function resolvePath(obj, dotPath) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/* ------------------------------------------------------------------ */
/*  Source token analysis ({reference} syntax)                         */
/* ------------------------------------------------------------------ */

function analyzeSourceTheme(themeName) {
  const filePath = join(TOKENS_DIR, 'semantic', `${themeName}.json`);
  let data;
  try { data = JSON.parse(readFileSync(filePath, 'utf-8')); }
  catch { return { tokens: [], issues: [], error: `File not found: ${filePath}` }; }

  let primData;
  try { primData = JSON.parse(readFileSync(join(TOKENS_DIR, 'primitive', 'default.json'), 'utf-8')); }
  catch { primData = {}; }

  const tokens = walkTokens(data);
  const issues = [];

  for (const { path, node } of tokens) {
    const val = node.$value;
    if (typeof val !== 'string') continue;

    // Check for {reference} syntax
    const refMatch = val.match(/^\{(.+)\}$/);
    if (!refMatch) continue; // literal value, not aliased

    const target = refMatch[1];
    // Try resolving in primitives first, then in same file
    const resolvedPrim = resolvePath(primData, target);
    const resolvedSelf = resolvePath(data, target);

    if (!resolvedPrim && !resolvedSelf) {
      issues.push({ theme: themeName, tokenPath: path, issue: 'dangling-reference', target });
    }
  }

  return { tokens, issues };
}

/* ------------------------------------------------------------------ */
/*  Export token analysis (Figma alias data)                           */
/* ------------------------------------------------------------------ */

function analyzeExportTheme(themeName) {
  const filePath = join(TOKENS_DIR, 'export', 'semantic', `${themeName}.json`);
  let data;
  try { data = JSON.parse(readFileSync(filePath, 'utf-8')); }
  catch { return { tokens: [], aliasedCount: 0, issues: [], error: `File not found: ${filePath}` }; }

  const tokens = walkTokens(data);
  let aliasedCount = 0;
  const issues = [];

  for (const { path, node } of tokens) {
    const ext = node.$extensions;
    if (!ext) continue;
    const aliasData = ext['com.figma.aliasData'];
    if (!aliasData) continue;
    aliasedCount++;

    if (!aliasData.targetVariableName) {
      issues.push({ theme: themeName, tokenPath: path, issue: 'missing-alias-target-name' });
    }
  }

  return { tokens, aliasedCount, issues };
}

/* ------------------------------------------------------------------ */
/*  Cross-reference: source vs export                                  */
/* ------------------------------------------------------------------ */

function crossReferenceTheme(themeName) {
  const srcPath = join(TOKENS_DIR, 'semantic', `${themeName}.json`);
  const expPath = join(TOKENS_DIR, 'export', 'semantic', `${themeName}.json`);
  let srcData, expData;
  try { srcData = JSON.parse(readFileSync(srcPath, 'utf-8')); } catch { return []; }
  try { expData = JSON.parse(readFileSync(expPath, 'utf-8')); } catch { return []; }

  const srcTokens = walkTokens(srcData);
  const expTokens = walkTokens(expData);
  const expMap = new Map(expTokens.map(({ path, node }) => [path, node]));
  const issues = [];

  for (const { path, node } of srcTokens) {
    const val = node.$value;
    if (typeof val !== 'string' || !val.startsWith('{')) continue;

    const expNode = expMap.get(path);
    if (!expNode) continue; // Structural difference between source/export formats — skip

    // Check that Figma alias target name aligns with source reference
    const sourceRef = val.replace(/^\{|\}$/g, '');
    const aliasData = expNode.$extensions?.['com.figma.aliasData'];
    if (aliasData?.targetVariableName) {
      // Figma uses slash-separated names: "scania/color/grey/00"
      // Source uses dot-separated: "scania.color.grey.00"
      const figmaPath = aliasData.targetVariableName.replace(/\//g, '.');
      if (figmaPath !== sourceRef) {
        issues.push({
          theme: themeName,
          tokenPath: path,
          issue: 'alias-mismatch',
          sourceRef,
          figmaRef: figmaPath,
        });
      }
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/*  Chain depth calculation                                            */
/* ------------------------------------------------------------------ */

function computeChainDepths(themeName) {
  const srcPath = join(TOKENS_DIR, 'semantic', `${themeName}.json`);
  const primPath = join(TOKENS_DIR, 'primitive', 'default.json');
  let srcData, primData;
  try { srcData = JSON.parse(readFileSync(srcPath, 'utf-8')); } catch { return { max: 0, average: 0, depths: {} }; }
  try { primData = JSON.parse(readFileSync(primPath, 'utf-8')); } catch { primData = {}; }

  const tokens = walkTokens(srcData);
  const depths = {};
  const memo = new Map();

  function getDepth(path, visited = new Set()) {
    if (memo.has(path)) return memo.get(path);
    if (visited.has(path)) return 0; // circular
    visited.add(path);

    const node = resolvePath(srcData, path);
    if (!node || typeof node !== 'object' || !node.$value) {
      // Try primitives
      const primNode = resolvePath(primData, path);
      if (primNode) { memo.set(path, 0); return 0; }
      memo.set(path, 0);
      return 0;
    }

    const val = node.$value;
    if (typeof val !== 'string' || !val.startsWith('{')) {
      memo.set(path, 0);
      return 0;
    }

    const target = val.replace(/^\{|\}$/g, '');
    const d = 1 + getDepth(target, visited);
    memo.set(path, d);
    return d;
  }

  for (const { path } of tokens) {
    depths[path] = getDepth(path);
  }

  const values = Object.values(depths);
  const max = values.length > 0 ? Math.max(...values) : 0;
  const average = values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : 0;

  return { max, average, depths };
}

/* ------------------------------------------------------------------ */
/*  Brand parity                                                       */
/* ------------------------------------------------------------------ */

function computeBrandParity() {
  const themePaths = {};
  for (const theme of THEMES) {
    const filePath = join(TOKENS_DIR, 'semantic', `${theme}.json`);
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      themePaths[theme] = new Set(walkTokens(data).map((t) => t.path));
    } catch {
      themePaths[theme] = new Set();
    }
  }

  const allPaths = new Set();
  for (const paths of Object.values(themePaths)) {
    for (const p of paths) allPaths.add(p);
  }

  const allThemes = [];
  const scaniaOnly = [];
  const tratonOnly = [];
  const themeSpecific = Object.fromEntries(THEMES.map((t) => [t, []]));

  for (const path of [...allPaths].sort()) {
    const inThemes = THEMES.filter((t) => themePaths[t].has(path));
    if (inThemes.length === THEMES.length) {
      allThemes.push(path);
    } else {
      const isScania = inThemes.every((t) => t.startsWith('scania'));
      const isTraton = inThemes.every((t) => t.startsWith('traton'));
      if (isScania && inThemes.length > 0) scaniaOnly.push(path);
      else if (isTraton && inThemes.length > 0) tratonOnly.push(path);
      for (const t of inThemes) {
        if (inThemes.length < THEMES.length) themeSpecific[t].push(path);
      }
    }
  }

  return { allThemes: allThemes.length, scaniaOnly, tratonOnly, themeSpecific };
}

/* ------------------------------------------------------------------ */
/*  Output                                                             */
/* ------------------------------------------------------------------ */

function generateMarkdown(result) {
  let md = `# Token Alias Chain Analysis\n\n`;
  md += `Generated: ${result.generated}\n\n`;

  md += `## Theme Summary\n\n`;
  md += `| Theme | Tokens | Aliased | Issues |\n|-------|--------|---------|--------|\n`;
  for (const [theme, info] of Object.entries(result.themes)) {
    md += `| ${theme} | ${info.totalTokens} | ${info.aliasedTokens} | ${info.issues} |\n`;
  }

  md += `\n## Chain Depth\n\n`;
  md += `- Max: ${result.chainDepth.max}\n`;
  md += `- Average: ${result.chainDepth.average}\n\n`;

  md += `## Brand Parity\n\n`;
  md += `- Tokens in all themes: ${result.brandParity.allThemes}\n`;
  md += `- Scania-only: ${result.brandParity.scaniaOnly.length}\n`;
  md += `- Traton-only: ${result.brandParity.tratonOnly.length}\n\n`;

  if (result.brandParity.scaniaOnly.length > 0) {
    md += `### Scania-only tokens\n\n`;
    result.brandParity.scaniaOnly.forEach((p) => { md += `- \`${p}\`\n`; });
    md += '\n';
  }
  if (result.brandParity.tratonOnly.length > 0) {
    md += `### Traton-only tokens\n\n`;
    result.brandParity.tratonOnly.forEach((p) => { md += `- \`${p}\`\n`; });
    md += '\n';
  }

  if (result.issues.length > 0) {
    md += `## Issues (${result.issues.length})\n\n`;
    md += `| Theme | Token | Issue | Detail |\n|-------|-------|-------|--------|\n`;
    for (const issue of result.issues) {
      const detail = issue.target || issue.sourceRef || issue.detail || '';
      md += `| ${issue.theme} | \`${issue.tokenPath}\` | ${issue.issue} | ${detail} |\n`;
    }
  } else {
    md += `## Issues\n\nNo issues found.\n`;
  }

  return md;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

function analyzeAliasChains() {
  console.log('Analyzing token alias chains...');

  const allIssues = [];
  const themeSummaries = {};
  let globalMaxDepth = 0;
  let globalAvgDepth = 0;
  let themeCount = 0;

  for (const theme of THEMES) {
    const src = analyzeSourceTheme(theme);
    const exp = analyzeExportTheme(theme);
    const crossIssues = crossReferenceTheme(theme);
    const chainInfo = computeChainDepths(theme);

    const themeIssues = [...src.issues, ...exp.issues, ...crossIssues];
    allIssues.push(...themeIssues);

    themeSummaries[theme] = {
      totalTokens: src.tokens.length,
      aliasedTokens: exp.aliasedCount,
      issues: themeIssues.length,
    };

    if (chainInfo.max > globalMaxDepth) globalMaxDepth = chainInfo.max;
    globalAvgDepth += chainInfo.average;
    themeCount++;

    console.log(`  ${theme}: ${src.tokens.length} tokens, ${exp.aliasedCount} aliased, ${themeIssues.length} issues`);
  }

  const brandParity = computeBrandParity();

  const generated = new Date().toISOString();
  const result = {
    generated,
    themes: themeSummaries,
    issues: allIssues,
    chainDepth: {
      max: globalMaxDepth,
      average: themeCount > 0 ? Math.round((globalAvgDepth / themeCount) * 100) / 100 : 0,
    },
    brandParity,
    figmaDelta: null,
  };

  // Write output
  const runId = process.env.AUDIT_RUN_ID || JSON.parse(readFileSync(join(AUDIT_BASE_DIR, 'latest-run.json'), 'utf-8')).runId;
  const outputDir = join(AUDIT_BASE_DIR, runId);
  mkdirSync(outputDir, { recursive: true });

  const jsonPath = join(outputDir, '_alias-chains.json');
  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  console.log(`✓ Created ${jsonPath}`);

  const mdPath = join(outputDir, '_alias-chains.md');
  writeFileSync(mdPath, generateMarkdown(result));
  console.log(`✓ Created ${mdPath}`);

  console.log(`\nTotal issues: ${allIssues.length}`);

  return result;
}

const invokedAsMain = process.argv[1] && resolve(process.cwd(), process.argv[1]) === join(__dirname, 'analyze-alias-chains.js');
if (invokedAsMain) {
  analyzeAliasChains();
}

export { analyzeAliasChains };
