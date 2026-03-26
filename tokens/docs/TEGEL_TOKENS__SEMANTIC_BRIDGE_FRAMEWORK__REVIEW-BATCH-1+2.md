/* =========================================================
   SEMANTIC BRIDGE:
   ---
   ### CHIP v1.0 ###
   Counts → Web:16 | Lite:24 | Bridge:17

   Pattern:
   --component-{component}-{property}-{[purpose-]}{[option-]}{state}

   Rules:
   - No focus tokens, handled with separate helper element globally
   - One global disabled-opacity token (only if disabled state exists in source OR component API)
   - One global border-radius token (only if present in source OR required by component structure)
   - Only include state/property combos that exist in implementation (Web and/or Lite)
   - Explicit -default/-hover/-active suffixes always
   ========================================================= */

--component-chip-background-default
--component-chip-background-hover
--component-chip-background-active
--component-chip-background-selected-default
--component-chip-background-selected-hover
--component-chip-background-selected-active
--component-chip-border-default
--component-chip-border-hover
--component-chip-border-selected-default
--component-chip-border-selected-hover
--component-chip-text-default
--component-chip-text-active
--component-chip-text-selected-default
--component-chip-icon-default
--component-chip-icon-selected-default
--component-chip-disabled-opacity
--component-chip-border-radius

Web:        16
Lite:       24

⤷  Bridge:  17

Δ Web   →  Bridge:  +1
Δ Lite  →  Bridge:  -7

Reasoning:
- Bridge excludes focus tokens (2 in Web, 3 in Lite) per global focus rule, reducing raw counts.
- Lite contains internal alias tokens (--component-chip-color-* series) that are implementation detail, not bridge surface tokens; these are excluded.
- `selected` is treated as an `option` axis (not a state) because both Web and Lite distinguish selected/active background and text as structurally separate token sets; once present, the axis must be maintained.
- `--component-chip-disabled-opacity` added (bridge +1 vs Web) because disabled state exists in both Web and Lite source tokens.
- `--component-chip-border-radius` included because chip is structurally radius-dependent and radius is explicitly present in Lite source tokens.

/* =========================================================
   SEMANTIC BRIDGE:
   ---
   ### TAG v1.0 ###
   Counts → Web:12 | Lite:0 | Bridge:13

   Pattern:
   --component-{component}-{property}-{[purpose-]}{[option-]}{state}

   Rules:
   - No focus tokens, handled with separate helper element globally
   - One global disabled-opacity token (only if disabled state exists in source OR component API)
   - One global border-radius token (only if present in source OR required by component structure)
   - Only include state/property combos that exist in implementation (Web and/or Lite)
   - Explicit -default/-hover/-active suffixes always
   ========================================================= */

--component-tag-border-radius

--component-tag-background-success-default
--component-tag-text-success-default

--component-tag-background-warning-default
--component-tag-text-warning-default

--component-tag-background-error-default
--component-tag-text-error-default

--component-tag-background-information-default
--component-tag-text-information-default

--component-tag-background-new-default
--component-tag-text-new-default

--component-tag-background-neutral-default
--component-tag-text-neutral-default

Web:        12
Lite:       0

⤷  Bridge:  13

Δ Web   →  Bridge:  +1
Δ Lite  →  Bridge:  +13

Reasoning:
- Bridge adds 1 token over Web: --component-tag-border-radius, required by component structure (tag is a pill/badge shape).
- No interactive states (hover/active) exist in Web source; tag is a static display component — only -default is emitted per property/purpose pair.
- purpose axis (success / warning / error / information / new / neutral) is carried forward verbatim from Web source tokens.
- No option axis exists in source or component API; none is introduced.
- Lite count is 0 (no Lite source provided); Bridge is fully grounded in Web implementation.

/* =========================================================
   SEMANTIC BRIDGE:
   ---
   ### BUTTON v1.0 ###
   Counts → Web:84 | Lite:56 | Bridge:44

   Pattern:
   --component-button-{property}-{purpose}-{option}-{state}

   Rules:
   - No focus tokens, handled with separate helper element globally
   - One global disabled-opacity token (only if disabled state exists in source OR component API)
   - One global border-radius token (only if present in source OR required by component structure)
   - Only include state/property combos that exist in implementation (Web and/or Lite)
   - Explicit -default/-hover/-active suffixes always
   ========================================================= */

--component-button-border-radius
--component-button-disabled-opacity

--component-button-background-standard-primary-default
--component-button-background-standard-primary-hover
--component-button-background-standard-primary-active
--component-button-border-standard-primary-default
--component-button-border-standard-primary-hover
--component-button-border-standard-primary-active
--component-button-text-standard-primary-default
--component-button-text-standard-primary-hover
--component-button-text-standard-primary-active
--component-button-icon-standard-primary-default

--component-button-background-standard-secondary-default
--component-button-background-standard-secondary-hover
--component-button-background-standard-secondary-active
--component-button-border-standard-secondary-default
--component-button-border-standard-secondary-hover
--component-button-border-standard-secondary-active
--component-button-text-standard-secondary-default
--component-button-text-standard-secondary-hover
--component-button-text-standard-secondary-active
--component-button-icon-standard-secondary-default
--component-button-icon-standard-secondary-hover
--component-button-icon-standard-secondary-active

--component-button-background-standard-tertiary-default
--component-button-background-standard-tertiary-hover
--component-button-background-standard-tertiary-active
--component-button-border-standard-tertiary-default
--component-button-border-standard-tertiary-hover
--component-button-border-standard-tertiary-active
--component-button-text-standard-tertiary-default
--component-button-text-standard-tertiary-hover
--component-button-text-standard-tertiary-active
--component-button-icon-standard-tertiary-default

--component-button-background-danger-primary-default
--component-button-background-danger-primary-hover
--component-button-background-danger-primary-active
--component-button-border-danger-primary-default
--component-button-border-danger-primary-hover
--component-button-border-danger-primary-active
--component-button-text-danger-primary-default
--component-button-text-danger-primary-hover
--component-button-text-danger-primary-active
--component-button-icon-danger-primary-default

Web:        84
Lite:       56

⤷  Bridge:  44

Δ Web   →  Bridge:  -40
Δ Lite  →  Bridge:  -12

Reasoning:
- Web delta (-40): Web carries focus/outline tokens, split disabled-primary/secondary tokens, and separate icon-fill/icon-color tokens per variant — all excluded by bridge rules.
- Lite delta (-12): Lite excludes focus tokens already but retains spacing/padding variables (radius, outline-width, padding) and per-variant utility tokens (transparent, white, black) not applicable to the bridge.
- Purpose axis (standard, danger) and option axis (primary, secondary, tertiary) both written out explicitly on all tokens for future-proofing; danger currently covers primary only.
- Icon hover/active included only for secondary option, where Web source has explicit coverage; all other options carry icon-default only.
- `standard` replaces the visually-named "default" for purpose; `tertiary` replaces "ghost" for option — both per naming rules.

/* =========================================================
   SEMANTIC BRIDGE:
   ---
   ### TOOLTIP v1.0 ###
   Counts → Web:2 | Lite:2 | Bridge:2

   Pattern:
   --component-{component}-{property}-{[purpose-]}{[option-]}{state}

   Rules:
   - No focus tokens, handled with separate helper element globally
   - One global disabled-opacity token (only if disabled state exists in source OR component API)
   - One global border-radius token (only if present in source OR required by component structure)
   - Only include state/property combos that exist in implementation (Web and/or Lite)
   - Explicit -default/-hover/-active suffixes always
   ========================================================= */

--component-tooltip-background-default
--component-tooltip-text-default

Web:        2
Lite:       2

⤷  Bridge:  3

Δ Web   →  Bridge:  +1
Δ Lite  →  Bridge:  +1

Reasoning:
- Web and Lite both expose 2 surface color tokens (background, text), mapping to 2 bridge tokens.
- `--component-tooltip-border-radius` added at explicit request; not present in source tokens but included as a structural override.
- No hover or active states exist in either Web or Lite source tokens; only `-default` is emitted.
- No disabled state in source tokens or component API; no disabled-opacity token generated.


/* =========================================================
   SEMANTIC BRIDGE:
   ---
   ### BADGE v1.0 ###
   Counts → Web:0 | Lite:2 | Bridge:2

   Pattern:
   --component-badge-{property}-{state}

   Rules:
   - No focus tokens, handled with separate helper element globally
   - One global disabled-opacity token (only if disabled state exists in source OR component API)
   - One global border-radius token (only if present in source OR required by component structure)
   - Only include state/property combos that exist in implementation (Web and/or Lite)
   - Explicit -default/-hover/-active suffixes always
   ========================================================= */

--component-badge-background-default
--component-badge-text-default

Web:        0
Lite:       2

⤷  Bridge:  2

Δ Web   →  Bridge:  +2
Δ Lite  →  Bridge:  0

Reasoning:
- Bridge matches Lite exactly; no Web source tokens exist to add or reconcile.
- No interactive states (hover, active) found in either source, so only -default suffixes are generated.
- No disabled state found in source or component API; disabled-opacity token excluded.
- Badge is not structurally radius-dependent in the way chip/tag/pill are, and no radius token found in source; border-radius token excluded.
- No purpose or option axis present in source tokens or component API; flat naming structure is correct.


/* =========================================================
   SEMANTIC BRIDGE:
   ---
   ### SPINNER v1.0 ###
   Counts → Web:0 | Lite:2 | Bridge:1

   Pattern:
   --component-{component}-{property}-{[purpose-]}{[option-]}{state}

   Rules:
   - No focus tokens, handled with separate helper element globally
   - One global disabled-opacity token (only if disabled state exists in source OR component API)
   - One global border-radius token (only if present in source OR required by component structure)
   - Only include state/property combos that exist in implementation (Web and/or Lite)
   - Explicit -default/-hover/-active suffixes always
   ========================================================= */

--component-spinner-color-default
--component-spinner-color-inverted-default

Web:        0
Lite:       2

⤷  Bridge:  2

Δ Web   →  Bridge:  +2
Δ Lite  →  Bridge:  0

Reasoning:
- Web has no vars file; bridge is sourced entirely from Lite tokens.
- Lite exposes two surface color tokens: default and inverted — both are included as semantic bridge tokens.
- All other Lite variables (speed, radius, stroke-width, PI, animation) are excluded per rules (non-surface, layout/size tokens).
- No states beyond default exist in source (no hover/active/disabled), so no state variants or disabled-opacity token are generated.
- No purpose or option axes are present in source; none added. No border-radius token added (spinner uses SVG stroke geometry, not CSS border-radius).

