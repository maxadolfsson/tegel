# TEGEL TOKENS — SEMANTIC BRIDGE PROMPT

**Prompt version: 2.0**

## Instructions

You are generating a semantic bridge token list for a Tegel component.

Read the token analysis in the INPUT block below. Apply the rules defined in the RULES block. Output exactly the structure defined in the OUTPUT FORMAT block. Do not output anything else.

## RULES

### Token naming pattern

    --component-{component}-{property}-{[purpose-]}{[option-]}{state}

Properties: background · border · text · icon
States (always explicit): -default · -hover · -active

### What to include

- Only surface color tokens: background, border, text, icon
- Only state/property combinations that exist in Web and/or Lite source tokens
- One `--component-{component}-disabled-opacity` token — ONLY if a disabled state exists in source tokens or component API
- One `--component-{component}-border-radius` token — ONLY if radius exists in source tokens or the component is structurally radius-dependent (e.g. chip, tag, pill)

### What to exclude

- Focus tokens (handled globally)
- Per-role or per-state radius tokens
- Spacing, padding, gap, size, layout tokens
- `var()` references, value wiring, implementation logic

### Axes (structural stability)

- **purpose** axis: include if the component has semantic categories (success / warning / error / info / neutral), or if it exists in source tokens
- **option** axis: include if it exists in source tokens or the component API
- Once an axis is present, it must remain — even if only one value is currently active

### Token naming

- Names must describe purpose, option, property, state — never visual appearance
- Do not encode: filled, outlined, ghost, gradient, expressive, decorative

### Versioning

- No prior bridge exists → start at v1.0
- Axes added/removed, naming structure changes, state model changes → MAJOR
- Token additions within existing axes → MINOR
- Formatting/ordering only → PATCH

## OUTPUT FORMAT

Output only the following three blocks, in this order. No other text.

### Block 1 — Header + token list (verbatim structure, fill in placeholders)

```
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

--component-{component}-{property}-{[purpose-]}{[option-]}{state}
--component-{component}-{property}-{[purpose-]}{[option-]}{state}
...
```

### Block 2 — Surface comparison (verbatim structure, fill in numbers)

```
Web:        {X}
Lite:       {Y}

⤷  Bridge:  {Z}

Δ Web   →  Bridge:  {Z-X}
Δ Lite  →  Bridge:  {Z-Y}

Reasoning:
- {Max 5 lines. Cover only: why Bridge count differs from Web/Lite, whether delta is structural or cosmetic, confirmation of structural axes compliance.}
```

## INPUT

Token analysis:

```
[PASTE TOKEN ANALYSIS HERE]
```
