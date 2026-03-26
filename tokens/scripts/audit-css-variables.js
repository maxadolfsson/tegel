#!/usr/bin/env node
/**
 * Audit CSS Variables Script
 *
 * Extracts all CSS custom properties (variables) from component SCSS files
 * Supports both web components (*-vars.scss) and tegel-lite (*vars.scss)
 *
 * Run from project root: node tokens/scripts/audit-css-variables.js
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// tokens/scripts -> project root
const ROOT_DIR = join(__dirname, '..', '..');

// Patterns to match CSS variable declarations
const VAR_PATTERN = /--([a-zA-Z0-9-]+)\s*:/g;
const VAR_IN_VAR_PATTERN = /var\(--([a-zA-Z0-9-]+)\)/g;

/** Normalized component slug (shared with inventory/mapping for filtering). */
function componentSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/^tl-/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'component';
}

/**
 * Recursively find all SCSS files matching the pattern
 */
function findScssFiles(dir, pattern) {
  const files = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...findScssFiles(fullPath, pattern));
      } else if (entry.isFile() && pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Skip directories that don't exist or can't be read
  }

  return files;
}

/**
 * Extract CSS variables from a file
 */
function extractVariables(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const variables = new Set();
  const references = new Set();

  // Reset global regex state so each file is scanned from the start
  VAR_PATTERN.lastIndex = 0;
  VAR_IN_VAR_PATTERN.lastIndex = 0;

  // Extract variable declarations
  let match;
  while ((match = VAR_PATTERN.exec(content)) !== null) {
    variables.add(match[1]);
  }

  // Extract variable references (used in var())
  while ((match = VAR_IN_VAR_PATTERN.exec(content)) !== null) {
    references.add(match[1]);
  }

  // Extract theme/context information: collect all themes present in the file
  const lines = content.split('\n');
  const contexts = [];
  const themes = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('.tds-mode-light') || line.includes(':root')) {
      themes.add('light');
    }
    if (line.includes('.tds-mode-dark')) {
      themes.add('dark');
    }
    if (line.includes('.scania')) {
      contexts.push('scania');
    } else if (line.includes('.traton')) {
      contexts.push('traton');
    }
  }

  // theme: single value for backwards compatibility (first theme, or 'all' if both/multiple)
  const themeList = [...themes].sort();
  const theme =
    themeList.length === 0 ? 'root' : themeList.length >= 2 ? 'all' : themeList[0];

  return {
    filePath: relative(ROOT_DIR, filePath),
    variables: Array.from(variables),
    references: Array.from(references),
    contexts: contexts.length > 0 ? contexts : ['all'],
    theme,
    themes: themeList.length > 0 ? themeList : ['root']
  };
}

/**
 * Main audit function
 */
function auditCssVariables() {
  const results = {
    webComponents: [],
    tegelLite: [],
    timestamp: new Date().toISOString()
  };

  // Find web component vars files
  const webComponentDir = join(ROOT_DIR, 'packages/core/src/components');
  const webComponentFiles = findScssFiles(webComponentDir, /-vars\.scss$/);

  console.log(`Found ${webComponentFiles.length} web component var files`);

  for (const file of webComponentFiles) {
    const componentName = file.match(/components\/([^/]+)\//)?.[1] || 'unknown';
    const data = extractVariables(file);
    results.webComponents.push({
      component: componentName,
      ...data
    });
  }

  // Find tegel-lite vars files
  const tegelLiteDir = join(ROOT_DIR, 'packages/core/src/tegel-lite/components');
  const tegelLiteFiles = findScssFiles(tegelLiteDir, /vars\.scss$/);

  console.log(`Found ${tegelLiteFiles.length} tegel-lite var files`);

  for (const file of tegelLiteFiles) {
    const componentName = file.match(/components\/([^/]+)\//)?.[1] || 'unknown';
    const data = extractVariables(file);
    results.tegelLite.push({
      component: componentName.replace('tl-', ''),
      ...data
    });
  }

  return results;
}

// Run audit only when this file is the entry point (not when imported)
const invokedAsMain = process.argv[1] && resolve(process.cwd(), process.argv[1]) === join(__dirname, 'audit-css-variables.js');
if (invokedAsMain) {
  const results = auditCssVariables();
  console.log(JSON.stringify(results, null, 2));
}

export { auditCssVariables, extractVariables, componentSlug };
