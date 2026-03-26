#!/usr/bin/env node
/**
 * Compare brand palette in global styles vs token catalog.
 *
 * Supports multiple brands (scania, traton) via --brand flag.
 *
 * Focus:
 * - Palette usage in packages/core/src/global/global.scss (tds-* palette).
 * - Primitive + semantic tokens in tokens/scss/{brand}/*.scss.
 * - Normalize prefixes and compare by normalized names and color values.
 *
 * Usage:
 *   node tokens/scripts/compare-palette-to-tokens.js                  # default: all brands
 *   node tokens/scripts/compare-palette-to-tokens.js --brand scania   # single brand
 *   node tokens/scripts/compare-palette-to-tokens.js --brand traton   # single brand
 *
 * Output:
 * - JSON report: tokens/audit/<runId>-palette/{brand}-palette-vs-tokens.json
 * - Markdown report: tokens/audit/<runId>-palette/{brand}-palette-vs-tokens.md
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, '..', '..');
const AUDIT_BASE_DIR = join(ROOT_DIR, 'tokens', 'audit');
const GLOBAL_SCSS = join(ROOT_DIR, 'packages', 'core', 'src', 'global', 'global.scss');

const SUPPORTED_BRANDS = ['scania', 'traton'];

const BRAND_PREFIX_MAP = {
  scania: { varPrefix: 'tds-', tokenPrefix: 'scania-color-' },
  traton: { varPrefix: 'tds-', tokenPrefix: 'traton-color-' },
};

// ── CLI args ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let brand = 'all';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--brand' && args[i + 1]) brand = args[++i];
  }
  return { brand };
}

function getTokenScssFiles(brand) {
  const dir = join(ROOT_DIR, 'tokens', 'scss', brand);
  return ['primitive.scss', 'color-light.scss', 'color-dark.scss'].map((f) => join(dir, f));
}

// ── Shared utilities ──────────────────────────────────────────

function resolveAuditOutputDir() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const runId = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}-palette`;

  const outputDir = join(AUDIT_BASE_DIR, runId);
  mkdirSync(outputDir, { recursive: true });

  return { outputDir, runId };
}

function normalizePaletteName(rawName, brand) {
  if (!rawName) return '';
  let name = String(rawName).trim();

  if (name.startsWith('--')) name = name.slice(2);

  let lower = name.toLowerCase();

  const prefixes = BRAND_PREFIX_MAP[brand] || BRAND_PREFIX_MAP.scania;
  if (lower.startsWith(prefixes.varPrefix)) {
    lower = lower.slice(prefixes.varPrefix.length);
  } else if (lower.startsWith(prefixes.tokenPrefix)) {
    lower = lower.slice(prefixes.tokenPrefix.length);
  }

  return lower;
}

function isColorValue(value) {
  if (!value) return false;
  const v = String(value).trim();
  if (!v) return false;
  const colorPattern = /(^#[0-9a-f]{3,8}\b)|\brgba?\s*\(|\bhsla?\s*\(/i;
  return colorPattern.test(v);
}

function normalizeColorValue(value) {
  if (!value) return '';
  let v = String(value).trim();
  v = v.replace(/\s+/g, ' ');
  v = v.replace(/#[0-9a-f]{3,8}\b/gi, (m) => m.toUpperCase());
  return v;
}

function readText(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch (e) {
    throw new Error(`Failed to read ${path}: ${e.message}`);
  }
}

// ── Extraction ────────────────────────────────────────────────

function extractGlobalPaletteUsage(brand) {
  const scss = readText(GLOBAL_SCSS);
  const varPattern = /var\(\s*(--[a-z0-9-]+)\s*[^)]*\)/gi;
  const seen = new Map();

  let match;
  while ((match = varPattern.exec(scss)) !== null) {
    const rawName = match[1];
    if (!rawName.toLowerCase().startsWith('--tds-')) continue;

    const normalizedName = normalizePaletteName(rawName, brand);
    if (!seen.has(normalizedName)) {
      seen.set(normalizedName, {
        source: 'global',
        rawNames: new Set([rawName]),
        normalizedName,
      });
    } else {
      seen.get(normalizedName).rawNames.add(rawName);
    }
  }

  return [...seen.values()].map((entry) => ({
    source: entry.source,
    normalizedName: entry.normalizedName,
    rawNames: [...entry.rawNames],
    colorValues: [],
  }));
}

function extractTokenColors(brand) {
  const results = [];
  const files = getTokenScssFiles(brand);

  files.forEach((filePath) => {
    let scss;
    try {
      scss = readText(filePath);
    } catch {
      console.warn(`  Warning: ${filePath} not found, skipping.`);
      return;
    }

    const varDefPattern = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let match;

    while ((match = varDefPattern.exec(scss)) !== null) {
      const rawName = match[1];
      const rawValue = match[2].trim();
      if (!isColorValue(rawValue)) continue;

      const normalizedName = normalizePaletteName(rawName, brand);
      const normalizedColor = normalizeColorValue(rawValue);

      results.push({
        source: 'tokens',
        file: filePath.replace(`${ROOT_DIR}/`, ''),
        rawName,
        normalizedName,
        rawValue,
        normalizedColor,
      });
    }
  });

  return results;
}

// ── Comparison ────────────────────────────────────────────────

function comparePaletteToTokens(globalUsage, tokenColors) {
  const globalByName = new Map();
  const tokensByName = new Map();

  globalUsage.forEach((entry) => {
    globalByName.set(entry.normalizedName, entry);
  });

  tokenColors.forEach((entry) => {
    const list = tokensByName.get(entry.normalizedName) || [];
    list.push(entry);
    tokensByName.set(entry.normalizedName, list);
  });

  const allNames = new Set([...globalByName.keys(), ...tokensByName.keys()]);

  const overlap = [];
  const globalOnly = [];
  const tokensOnly = [];

  allNames.forEach((name) => {
    const g = globalByName.get(name);
    const t = tokensByName.get(name);

    if (g && t) {
      overlap.push({
        normalizedName: name,
        global: g.rawNames,
        tokens: t.map((v) => v.rawName),
        colorValues: [...new Set(t.map((v) => v.normalizedColor))],
      });
    } else if (g && !t) {
      globalOnly.push({
        normalizedName: name,
        vars: g.rawNames,
        colorValues: [],
      });
    } else if (!g && t) {
      tokensOnly.push({
        normalizedName: name,
        vars: [...new Set(t.map((v) => v.rawName))],
        colorValues: [...new Set(t.map((v) => v.normalizedColor))],
      });
    }
  });

  const byColor = new Map();
  tokenColors.forEach((entry) => {
    const list = byColor.get(entry.normalizedColor) || [];
    list.push(entry);
    byColor.set(entry.normalizedColor, list);
  });

  const sameColorDifferentName = [];
  byColor.forEach((entries, color) => {
    const names = [...new Set(entries.map((e) => e.normalizedName))];
    if (names.length <= 1) return;
    sameColorDifferentName.push({
      colorValue: color,
      tokenNames: names,
      rawVars: [...new Set(entries.map((e) => e.rawName))],
    });
  });

  sameColorDifferentName.sort((a, b) => a.colorValue.localeCompare(b.colorValue));

  return { overlap, globalOnly, tokensOnly, sameColorDifferentName };
}

// ── Reports ───────────────────────────────────────────────────

function generateJsonReport(brand, data, outputDir) {
  const generated = new Date().toISOString();
  const tokenFiles = getTokenScssFiles(brand).map((p) => p.replace(`${ROOT_DIR}/`, ''));

  const report = {
    generated,
    brand,
    sources: {
      global: 'packages/core/src/global/global.scss',
      tokens: tokenFiles,
    },
    summary: {
      overlapCount: data.overlap.length,
      globalOnlyCount: data.globalOnly.length,
      tokensOnlyCount: data.tokensOnly.length,
      sameColorDifferentNameCount: data.sameColorDifferentName.length,
    },
    overlap: data.overlap,
    globalOnly: data.globalOnly,
    tokensOnly: data.tokensOnly,
    sameColorDifferentName: data.sameColorDifferentName,
  };

  const jsonPath = join(outputDir, `${brand}-palette-vs-tokens.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  return { report, jsonPath };
}

function generateMarkdownReport(brand, report, outputDir) {
  const { generated, sources, summary } = report;
  const brandTitle = brand.charAt(0).toUpperCase() + brand.slice(1);

  let md = '';
  md += `# ${brandTitle} palette vs tokens\n\n`;
  md += `Generated: ${generated}  \n`;
  md += `Brand: **${brandTitle}**  \n`;
  md += `Global source: \`${sources.global}\`  \n`;
  md += `Token sources:\n`;
  sources.tokens.forEach((src) => {
    md += `- \`${src}\`\n`;
  });
  md += '\n';

  md += '## Summary\n\n';
  md += `- **Overlap (same normalized name)**: ${summary.overlapCount}\n`;
  md += `- **Global-only palette names**: ${summary.globalOnlyCount}\n`;
  md += `- **Tokens-only names**: ${summary.tokensOnlyCount}\n`;
  md += `- **Same color used by multiple token names**: ${summary.sameColorDifferentNameCount}\n\n`;

  if (report.overlap.length > 0) {
    md += '## Overlap\n\n';
    report.overlap
      .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName))
      .forEach((entry) => {
        const colors = entry.colorValues.length ? ` – colors: ${entry.colorValues.join(', ')}` : '';
        md += `- \`${entry.normalizedName}\` → global: ${entry.global
          .map((v) => `\`${v}\``)
          .join(', ')}; tokens: ${entry.tokens.map((v) => `\`${v}\``).join(', ')}${colors}\n`;
      });
    md += '\n';
  }

  if (report.globalOnly.length > 0) {
    md += '## Global-only palette names\n\n';
    report.globalOnly
      .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName))
      .forEach((entry) => {
        md += `- \`${entry.normalizedName}\` → ${entry.vars.map((v) => `\`${v}\``).join(', ')}\n`;
      });
    md += '\n';
  }

  if (report.tokensOnly.length > 0) {
    md += '## Tokens-only names\n\n';
    report.tokensOnly
      .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName))
      .forEach((entry) => {
        const colors = entry.colorValues.length ? ` – colors: ${entry.colorValues.join(', ')}` : '';
        md += `- \`${entry.normalizedName}\` → ${entry.vars.map((v) => `\`${v}\``).join(', ')}${colors}\n`;
      });
    md += '\n';
  }

  if (report.sameColorDifferentName.length > 0) {
    md += '## Same color, different token names (tokens side)\n\n';
    report.sameColorDifferentName.forEach((entry) => {
      md += `- ${entry.colorValue} → names: ${entry.tokenNames
        .map((n) => `\`${n}\``)
        .join(', ')} (vars: ${entry.rawVars.map((v) => `\`${v}\``).join(', ')})\n`;
    });
    md += '\n';
  }

  const mdPath = join(outputDir, `${brand}-palette-vs-tokens.md`);
  writeFileSync(mdPath, md);

  return mdPath;
}

// ── Main ──────────────────────────────────────────────────────

function runForBrand(brand, outputDir, runId) {
  console.log(`\nComparing palette for brand: ${brand}`);

  const globalUsage = extractGlobalPaletteUsage(brand);
  const tokenColors = extractTokenColors(brand);
  const comparison = comparePaletteToTokens(globalUsage, tokenColors);

  const { report, jsonPath } = generateJsonReport(brand, comparison, outputDir);
  const mdPath = generateMarkdownReport(brand, report, outputDir);

  console.log(`  JSON -> ${jsonPath}`);
  console.log(`  MD   -> ${mdPath}`);
}

function main() {
  const { brand } = parseArgs();
  const { outputDir, runId } = resolveAuditOutputDir();
  console.log(`Palette audit catalog: tokens/audit/${runId}/`);

  const brands = brand === 'all' ? SUPPORTED_BRANDS : [brand];

  for (const b of brands) {
    if (!SUPPORTED_BRANDS.includes(b)) {
      console.error(`Error: Unknown brand "${b}". Supported: ${SUPPORTED_BRANDS.join(', ')}`);
      process.exit(1);
    }
    runForBrand(b, outputDir, runId);
  }

  console.log('\nDone.');
}

if (process.argv[1] && process.argv[1].endsWith('compare-palette-to-tokens.js')) {
  main();
}

export {
  normalizePaletteName,
  isColorValue,
  normalizeColorValue,
  extractGlobalPaletteUsage,
  extractTokenColors,
  comparePaletteToTokens,
  generateJsonReport,
  generateMarkdownReport,
  resolveAuditOutputDir,
};
