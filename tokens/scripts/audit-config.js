/**
 * Shared audit config (ignore list, overlap assumptions, etc.).
 * Used by run-quick-audit, generate-variable-inventory, map-variables-to-tokens, and analyze-overlap.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_IGNORE_PATH = join(__dirname, '..', 'audit', 'audit-ignore.json');
const OVERLAP_ASSUMPTIONS_PATH = join(__dirname, '..', 'audit', 'overlap-assumptions.json');

/**
 * Load set of component slugs to ignore (quick audit + full audit).
 * Returns empty Set if file missing or invalid.
 */
function loadAuditIgnore() {
  try {
    const data = JSON.parse(readFileSync(AUDIT_IGNORE_PATH, 'utf-8'));
    const list = Array.isArray(data.ignoredSlugs) ? data.ignoredSlugs : [];
    return new Set(list.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Load overlap assumptions (component slug aliases, variable aliases, property equivalences).
 * Used so quick audit and inventory treat e.g. radiobutton + radio-button as one canonical component.
 */
function loadOverlapAssumptions() {
  try {
    const data = JSON.parse(readFileSync(OVERLAP_ASSUMPTIONS_PATH, 'utf-8'));
    return {
      componentSlugAliases: data.componentSlugAliases && typeof data.componentSlugAliases === 'object' ? data.componentSlugAliases : {},
      componentAliases: data.componentAliases && typeof data.componentAliases === 'object' ? data.componentAliases : {},
      propertyEquivalences: data.propertyEquivalences && typeof data.propertyEquivalences === 'object' ? data.propertyEquivalences : {}
    };
  } catch {
    return { componentSlugAliases: {}, componentAliases: {}, propertyEquivalences: {} };
  }
}

export { loadAuditIgnore, loadOverlapAssumptions, AUDIT_IGNORE_PATH, OVERLAP_ASSUMPTIONS_PATH };
