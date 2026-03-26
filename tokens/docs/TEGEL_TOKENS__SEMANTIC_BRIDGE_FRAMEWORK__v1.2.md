# TEGEL TOKENS - SEMANTIC BRIDGE FRAMEWORK
**VERSION: 1.2 [LOCKED/Minor Update: Strict Execution Mode Added]**

---

## Purpose

This framework defines how semantic bridge tokens are generated for Tegel components.

The goals are to:

- Create a cross-library, brand-agnostic abstraction layer  
- Preserve backward compatibility  
- Minimise token surface area without sacrificing structural stability  
- Enable brand-level archetype flexibility  
- Maintain long-term semantic consistency across all components  

This framework is considered **LOCKED v1.2**.  
Changes must be deliberate and systemic.

v1.2 update:
- Introduced STRICT FRAMEWORK EXECUTION MODE.
- Clarifies bridge = semantic contract only.
- Prevents value wiring, mapping, or implementation explanation.

---

# Core Principles

---

## 1. Semantic Over Appearance

Token names must describe:

- Purpose (semantic meaning)  
- Option (component-level semantic configuration)  
- Property (background, text, border, icon)  
- State (default, hover, active)  

Token names must NOT encode:

- filled  
- outlined  
- ghost  
- gradient  
- expressive  
- decorative implementation details  

Archetypes are brand decisions, not system contracts.

---

## 2. Stable Semantic Bridge Layer (Property-First)

All components expose a semantic bridge following this structure:

    --component-{component}-{property}-{[purpose-]}{[option-]}{state}

This ensures grouping in tools and codebases follows:

    component
      background
      border
      icon
      text

The bridge:

- Is cross-library (Web + Lite)  
- Is brand-agnostic  
- Does not break legacy tokens  
- Acts as abstraction over implementation tokens  

Legacy tokens remain implementation layers and are aliased.

---

## 3. Explicit State Model

Allowed states:

- -default  
- -hover  
- -active  

Rules:

- -default suffix is always explicit  
- No implicit default state  
- No -focus tokens (focus handled globally)  
- Sparse state coverage per property is allowed  
- No perfect grids  

---

## 4. Structural Axes Rule (Critical)

Some axes are structural and must never be removed once established.

An axis is structural if:

- It exists in production (API or tokens), OR  
- It represents a core design model of the component, OR  
- It is clearly part of the component’s long-term semantic contract  

If an axis is structural:

→ It must remain in all future bridge versions,  
even if only one value is currently active.

Axes may be omitted ONLY if:

- They have never existed in API or tokens, AND  
- They are not intrinsic to the component type  

Examples:

- Button: purpose + option are structural  
- Chip: option is structural; purpose may be incidental  
- Tag: purpose is structural; option may not exist  

Stability > minimalism.

---

## 5. Disabled Strategy (Conditional)

Include:

    --component-{component}-disabled-opacity

ONLY if:

- A disabled state exists in Web or Lite tokens, OR  
- A disabled state exists in the component API  

Do NOT generate disabled color tokens.

Disabled styling is opacity-based only.

---

## 6. Border Radius Strategy (Conditional)

Include:

    --component-{component}-border-radius

ONLY if:

- Radius/shape exists in source tokens, OR  
- The component structure clearly depends on radius (e.g. pill, chip, tag)

No per-role or per-state radius tokens.

Adding a border-radius token may increase bridge token count (+1).  
This is acceptable if structurally justified.

---

## 7. Spacing & Dimension Exclusion

Out of scope:

- Padding  
- Gap  
- Size variants  
- Layout spacing  
- Icon padding  

These belong to layout/dimension systems, not semantic surface tokens.

---

## 8. Purpose Classification Rule

If a component has semantic categories such as:

- success  
- warning  
- error  
- info  
- neutral  

They must be treated as PURPOSE.

Do not invent new axis names.

---

## 9. STRICT FRAMEWORK EXECUTION MODE (Critical)

When applying this framework in a component thread:

Bridge = semantic contract only.

The bridge output must:

- Declare semantic token names only  
- Follow the mandatory header template exactly  
- Apply structural axes strictly  

The bridge output must NOT:

- Include value wiring  
- Include var() references  
- Include mapping logic  
- Include implementation resolution  
- Explain how tokens resolve to Web or Lite values  

If such output appears, treat it as a bug.

This framework defines the semantic API surface only — never the implementation layer.

---

## 10. Component-Level Versioning Model (per thread)

Each component maintains its own semantic bridge version.

If no previous bridge exists:
→ Start at v1.0

If updating:

MAJOR  
- Axes added or removed  
- Token naming structure changes  
- State model changes  

MINOR  
- Token additions within existing axes  
- Sparse state adjustments  
- Planned groups added  

PATCH  
- Formatting-only changes  
- Ordering changes  
- Comment/header refinements  

---

## 11. Mandatory Header Template (Property-First Pattern)

Every semantic bridge output must include this header verbatim:

    /* =========================================================
       SEMANTIC BRIDGE:
       ---
       ### {COMPONENT_UPPER} {VERSION} ###
       Counts → Web:{X} | Lite:{Y} | Bridge:{Z}

       Pattern:
       --component-{component}-{property}-{[purpose-]}{[option-]}{state}

       Rules:
       - No focus tokens, handled with separate helper element globally
       - One global disabled-opacity token (only if disabled state exists in source OR component API)
       - One global border-radius token (only if present in source OR required by component structure)
       - Only include state/property combos that exist in implementation (Web and/or Lite)
       - Explicit -default/-hover/-active suffixes always
       ========================================================= */

Do not shorten or reformat this header.

---

## 12. Token Surface Comparison Format

Every bridge output must include:

    Web:        {X}
    Lite:       {Y}

    ⤷  Bridge:  {Z}

    Δ Web   →  Bridge:  {Z-X}
    Δ Lite  →  Bridge:  {Z-Y}

Notes:

- Δ may be negative (reduction), zero (equal), or positive (increase).  
- Positive deltas are acceptable when structurally justified.  
- Surface growth must always be explained.  

---

# Governance Status

Framework status: LOCKED v1.2

This version introduces strict execution mode to prevent semantic/implementation layer mixing.

Framework updates must be systemic and rare.