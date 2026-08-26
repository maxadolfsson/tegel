# Dev Token Gaps

Running list of places where the design tokens (spec + Figma) and the code-side implementation (SCSS + CSS custom properties) have diverged. Each entry is a bug-report candidate for the component team.

Evidence cited against `origin/develop` unless otherwise noted.

---

## Scrollbar

**Status**: Figma-side aligned on branch `7XfNHOAtmNdQyxi8Ybiiho` (2026-04-24). Spec updated in [scrollbar.json](../specs/scrollbar.json). Code-side gaps below.

### 1. Thumb colour — code bypasses the semantic alias layer

- `packages/core/src/global/scrollbar-vars.scss` sets:
  ```scss
  --tds-scrollbar-thumb-color:        var(--tds-grey-400);   // light
  --tds-scrollbar-hover-thumb-color:  var(--tds-grey-500);
  /* dark flips to 500/400 */
  ```
- Spec + Figma want the chain `component/scrollbar/background/thumb-default` → `color/border/subtle` (and `thumb-hover` → `color/border/soft`).
- Consuming raw greys means brand-mode remaps at the semantic layer never reach scrollbar. The end pixel colour may coincide today but drifts apart the moment `color/border/subtle|soft` is rebalanced for either brand.

**Proposed change**: replace the grey primitives with the semantic aliases (or the published `--tds-color-border-subtle|soft` props, whichever naming the build emits).

### 2. Width + radius — code hardcodes literals, ignores published tokens

- `packages/core/src/mixins/_scrollbar.scss`:
  ```scss
  --tds-scrollbar-width:                   10px;
  --tds-scrollbar-height:                  10px;
  --tds-scrollbar-thumb-border-width:      3px;  // thumb visible thickness 10 - 2×3 = 4
  --tds-scrollbar-thumb-border-hover-width: 2px; // thumb visible thickness 10 - 2×2 = 6
  border-radius: 40px;                            // hardcoded, not read from any variable
  ```
- Design tokens now published:
  - `component/scrollbar/width/radius-default` → `traton/unit/4` (4px, thumb at rest)
  - `component/scrollbar/width/radius-hover` → 6 (thumb on hover)
  - `component/scrollbar/size/width-default` → 6 (visible width)
  - `component/scrollbar/border/radius-default` → `traton/unit/8` (8px)
- The 10px-track / 3px-border trick is a rendering workaround (webkit doesn't let scrollbar-width grow independently of the track). If kept, annotate _why_; ideally expose the 4/6 values as consumable tokens and derive the border-widths from them.

**Proposed change**: consume the published tokens directly; if the workaround must stay, document it with a link back to this entry.

### 3. Naming redundancy (design-side cleanup, mentioned here for completeness)

- `component/scrollbar/size/width-default = 6` and `component/scrollbar/width/radius-hover = 6` both describe the hover-state thumb width. One should probably go away in a future design-side pass. Not a dev concern today.

---

## Chip

**Status**: _Needs user confirmation on the specific rename(s) flagged._ Preliminary code-side observations below — to be refined.

### Observed gaps on `origin/develop`

- **Plural vs singular naming**: `packages/core/src/components/chip/chip-vars.scss` publishes `--tds-chips-*` (e.g. `--tds-chips-color`, `--tds-chips-background`, `--tds-chips-border`). Design system calls the component `chip` (singular) and Figma publishes `component/chip/*`. Consumer-facing CSS prop names are out of sync with the rest of the system.
- **Flat code vs structured Figma**: code has a single `--tds-chips-background`; Figma splits into `background/{standard|selected}/{default|hover}` (4 distinct tokens). Code currently ignores the standard/selected distinction at the token layer and handles it in component logic.
- **Raw primitives instead of semantic aliases**: same pattern as scrollbar — `var(--tds-grey-150)`, `var(--tds-blue-400)` etc., bypassing the semantic layer.
- **Open rename question**: the current `token-analysis` branch work restructures `border/selected-{active,default,hover}` → `border/selected/{active,default,hover}` (adds a slash). Not currently consumed by code, so no immediate break, but consumers will need updating if they start reading these tokens.

_User (Max) to confirm which of the above should be filed as active dev bugs vs left as observations._

---

## Textarea

**Status**: Confirmed bug, found 2026-07-05 during spec verification. Task chip spawned for a fix session.

### 1. `vrer()` typo breaks read-only background

- `packages/core/src/components/textarea/textarea-vars.scss:52` reads:
  ```scss
  --tds-textarea-read-only-background: vrer(--tds-white);
  ```
  `vrer(` is a typo for `var(` — an invalid CSS value, so this custom property silently falls back in its theme block.
- Related token: `component/textarea/icon/readonly-default` in [textarea.json](../specs/textarea.json) (Scania values verified against this same file; the typo sits two variables away from the verified icon colours).

**Proposed change**: one-character fix to `var(--tds-white)`; sweep `packages/core` for any further `vrer(`/malformed `var(` occurrences while in there.

---

### 2. Dropdown option rows do not respond to the dropdown's size (tegel-lite)

**Found** 2026-08-08 during cluster #11a Dropdown, while checking whether Figma's option row
was missing a Medium size.

`packages/core/src/tegel-lite/components/tl-dropdown/tl-dropdown.scss:656` pins the option row:

```scss
.tl-dropdown__option {
  height: 48px;   // fixed — no per-size override found
}
```

No `.tl-dropdown--lg/--md/--sm` override for the option row was found in that file. Scania core
does implement a size ladder for the same element — `dropdown-option.scss` sets per-size padding
which, with the 16px `--tds-detail-02` line-height, renders **55 / 47 / 39px** for lg / md / sm
(single-select). So the two brands disagree: Scania core scales option rows with the dropdown's
size, tegel-lite does not.

**Design intent, confirmed by Max 2026-08-08: the sizes SHOULD differ in height.** That makes the
fixed 48px a bug rather than a deliberate simplification.

Note the option's size is not settable by a consumer in either brand — in Scania core it is
`@State`, assigned from `parentDropdown.size` at load — so this is about the row responding to the
dropdown it sits in, not about exposing a new control.

**Caveat on the evidence:** the "no per-size override" claim rests on a grep of that one file and
was not exhaustively verified; confirm before fixing.

**Proposed change**: give `.tl-dropdown__option` per-size heights under the existing
`.tl-dropdown--lg/--md/--sm` modifiers, matching whichever ladder the brands agree on. Note Scania
core's ladder (55/47/39) matches neither tegel-lite's 48 nor the TRATON Figma file's rows, so the
target values are a design decision, not a straight port.

**Out of scope for #11a** — that cluster is colour tokens, and its spec scopes sizing out to the
CDEP-2019 typography track.
