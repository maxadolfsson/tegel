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

---

## Stepper

Found 2026-08-21 during cluster #17 Stepper, reading both code-of-record surfaces before drafting
the spec. All seven are code-side; none is fixed here. Cluster scope is Figma variables only.

### 1. `--tds-stepper-label-text-opacity-upcoming` is used but never defined — both brands

`packages/core/src/components/stepper/step/step.scss:265` and
`packages/core/src/tegel-lite/components/tl-stepper/tl-step.scss:230` both read it:

```scss
&.upcoming {
  color: var(--tds-stepper-label-text-upcoming);
  opacity: var(--tds-stepper-label-text-opacity-upcoming);   // never defined anywhere
}
```

A grep of the repo finds no definition. `opacity` therefore receives an invalid value and the
declaration is dropped, so **the intended dimming of the pending step's label never happens**.

This matters beyond the bug: it explains why the Tegel UI canvas draws the pending label at full
strength. Canvas and shipped behaviour agree — both are undimmed — so what looks like a
canvas/code divergence is actually canvas matching a broken implementation. Whether the pending
label *should* dim in Scania is a design question, not a code one.

Note also that `tl-step.scss` reaches for a `--tds-`-prefixed variable from inside tegel-lite,
where every other custom property in that component is `--stepper-*`. So even if the variable were
defined on the Scania side, tegel-lite would not pick it up.

**Proposed change**: decide whether the pending label dims. If yes, define the variable in both
`stepper-vars.scss` and `_tl-stepper-vars.scss` under each brand's own prefix. If no, delete both
`opacity` declarations.

---

### 2. `--tds-stepper-icon-step-background-success` is defined but never used

`packages/core/src/components/stepper/stepper-vars.scss:13` (light) and `:37` (dark) define it,
but `step.scss:233` paints the completed circle from the *border* variable instead:

```scss
&.success {
  background-color: var(--tds-stepper-icon-step-border-color-success);   // not …-background-success
  border-color: var(--tds-stepper-icon-step-border-color-success);
}
```

Both currently resolve to the same value, so there is **no visual symptom today** — but the
intended split between fill and ring is not wired, and changing the fill token would silently do
nothing. tegel-lite has the same collapse at `tl-step.scss:169-170`, though it at least uses one
variable consistently.

**Proposed change**: either bind `background-color` to `…-background-success` as named, or remove
the unused variable so the two are not mistaken for an available split.

---

### 3. `--tds-stepper-background` is defined but never used

`stepper-vars.scss:4` (light) and `:28` (dark). No consumer in `stepper.scss`, `step.scss`, or
anywhere else in the component. Dead.

**Proposed change**: remove, or wire it if a stepper-level surface was intended.

---

### 4. Hardcoded `--tds-white` on the completed step's tick

`step.scss:235`:

```scss
&.success {
  color: var(--tds-white);   // bypasses the stepper's own variable layer
}
```

Every other colour in the component routes through a `--tds-stepper-*` variable. tegel-lite does
this correctly via `--stepper-icon-step-checkmark`
(`_tl-stepper-vars.scss:12` → `--color-foreground-icon-inverse-strong`).

**Proposed change**: introduce the Scania-side equivalent rather than hardcoding the primitive.

---

### 5. Two property cross-typings on the TRATON side — in code, not just canvas

`packages/core/src/tegel-lite/components/tl-stepper/_tl-stepper-vars.scss`:

```scss
--stepper-current-number-with-border: var(--color-foreground-border-strong);   // :5  — a BORDER
                                                                              //   semantic
                                                                              //   colouring TEXT
--stepper-divider-line: var(--color-foreground-icon-disabled);                // :19 — an ICON
                                                                              //   semantic
                                                                              //   colouring a LINE
```

Both are consumed as those types: `:5` sets `color` on the ordinal (`tl-step.scss:175`), `:19` sets
`background-color` on the connector (`tl-step.scss:8`). The TRATON Figma canvas carries the same two
cross-typings, so **this is not canvas drift** — both sources agree, which is exactly why it would
be easy to "fix" one side and create a real divergence. The connector one is tracked spec-side as
`component/stepper/border/divider-default` at Needs Decision.

**Proposed change**: none unilaterally. Route through the designer's connector-line decision so
code and canvas move together.

---

### 6. Accessibility — pending steps announce as disabled, and labels never reach a screen reader

`packages/core/src/components/stepper/step/step.tsx`:

```tsx
aria-disabled={this.state === 'upcoming' ? 'true' : 'false'}   // :72
aria-label={`Step ${this.index}: ${this.state}`}               // :75
…
<div aria-hidden="true" class={`label ${this.size} ${this.state}`}>   // :96
```

Two separate problems. `aria-disabled="true"` on pending steps announces them as unavailable when
they are simply not yet reached — a different meaning, and the component has no disabled state at
all. And the visible label is `aria-hidden` while the accessible name is built from index and state
only, so **the label text is never announced**: a screen reader hears "Step 3: upcoming" and never
the words the sighted user reads.

**Proposed change**: drop `aria-disabled` for pending steps, and include the slotted label in the
accessible name rather than hiding it.

---

### 7. TRATON's Stepper has no test coverage

`tl-stepper` has no directory under `packages/tegel-lite/tests/`. Comparing that directory against
`packages/core/src/tegel-lite/components/`, **8 of 32 `tl-*` components lack tests**: stepper,
dropdown, header, side-menu, slider, spinner, table, tabs. Scania's core Stepper does have e2e
tests with light and dark snapshots.

Worth noting the queue overlap — Table and Dropdown are both on that list, so TRATON-side visual
claims on those clusters have no test backstop either.

**Proposed change**: add `tl-stepper` coverage mirroring the core Stepper's e2e suite.

---

## Table

Found during cluster #9 token analysis, 2026-08-25. Read-only investigation — no code was changed.
Items 1–4 are accessibility defects in the markup. Items 5–6 are design-architecture questions rather
than outright bugs, and 5 in particular **may be intentional from an earlier design** — worth checking
against Tegel UI coverage before treating it as a defect.

### 1. `<caption>` is nested inside a box that is already `display: table-caption`

`table-toolbar/table-toolbar.scss:6` sets the host to `display: table-caption`, and
`table-toolbar/table-toolbar.tsx:136` then renders a `<caption>` inside a
`<div class="tds-table__upper-bar-flex">` inside that host. A `<caption>` must be a direct child of
`<table>`, and a table may have only one.

**Proposed change**: pick one mechanism. Either the host *is* the caption (drop the inner `<caption>`
element and keep `display: table-caption`), or the inner element is the caption and the host is a plain
box. TRATON already takes the first route — see item 4.

---

### 2. `aria-labelledby` points at an element that usually does not exist

`table-toolbar.tsx` sets `aria-labelledby="table-toolbar-title"` on the Host unconditionally, but the
element carrying that id renders only when the `tableTitle` prop is non-empty — and it defaults to
`''`. So in the default configuration the toolbar's accessible name references a missing element.

**Proposed change**: render `aria-labelledby` only when `tableTitle` is set.

---

### 3. No row groups anywhere in the table markup

Across the 11 table components the markup emits `<table>`, `<tr>`, `<th>`, `<td>` and a single
`role="row"`, but **no `<thead>`, `<tbody>` or `<tfoot>`**. Assistive technology gets rows and cells
with no grouping, so "this is a header row" is conveyed only by `<th>` and, on the sortable column,
`aria-sort`.

**Proposed change**: introduce the three row groups, or the equivalent `role="rowgroup"` on the
existing wrappers.

---

### 4. The two brands disagree about what the caption is

- core (Scania): a `<caption>` holding just the title, nested inside the toolbar host
- tegel-lite (TRATON): the whole toolbar **is** the caption — `<caption class="tl-table__toolbar">`

**Proposed change**: converge on one structure. The TRATON form is the one that is valid HTML.

---

### 5. The pagination nav buttons have no visible hover, in either mode — PARKED, may be intentional

```
light:  --tds-table-footer-background: grey-150   --tds-table-footer-btn-hover: grey-150
dark:   --tds-table-footer-background: grey-700   --tds-table-footer-btn-hover: grey-700
```

In both modes the hover value equals the background the button sits on, so hovering a page-nav button
produces no visible change. `table-footer/table-footer.scss:89` applies it.

**Deliberately parked, not asserted as a bug** — this may be intentional from an earlier design, e.g.
if the affordance was meant to come from the icon rather than a background. **To verify:** check the
pagination hover treatment in the Tegel UI Library against these values.

> **MOOT 2026-08-26.** Max ruled that the nav buttons become icon-only `tds-button` instances (see
> item 6). Button ships `component/button/background/standard/tertiary-hover`, a real hover, so
> `--tds-table-footer-btn-hover` retires rather than being fixed. Note this **moots** the question
> rather than answering it — the Tegel UI check above was never run, so whether the invisible hover was
> once intentional is still unknown. It stops mattering because the variable goes away.

---

### 6. The pagination nav buttons bypass the Button component entirely

`table-footer.tsx:346–376` renders four raw `<button type="button" class="tds-table__footer-btn">`
elements wrapping `<tds-icon>`, with the native `disabled` attribute. `tds-button` appears nowhere
inside the table components — only in stories, as consumer-slotted content. Figma matches: the
`Table Pagination` set's page controls are plain FRAMEs (`Page controls` → `_Page control Light` →
`First last`), with no Button instance.

So a set of icon buttons carries its own hover, icon and disabled treatment instead of inheriting
Button's. Two consequences:

- **`--tds-table-footer-page-selector-icon-disabled: grey-500` expresses disabled as a colour.** The
  system rule is one `opacity/disabled` per component, not a per-property disabled colour.
- This is the **second** instance of the same question. Cluster #15 Tabs parked "Scroll→Button" for its
  scroll-affordance buttons. Pagination's nav buttons are the same pattern, so it is a system question
  rather than a Table-local one.

**Proposed change**: nothing in this cluster. Flagged so the Button-adoption question is decided once,
across Tabs' scroll controls and Pagination's nav controls together.

> **DECIDED for Table, 2026-08-26 (Max): adopt Button.** The nav controls become icon-only `tds-button`
> instances on both sides. Verified during cluster #9 that **neither** source uses a Button today —
> Figma's `Table/Footer/Selector` `Type=Page` holds four bare icon instances (`skip_backward`,
> `chevron_left`, `chevron_right`, `skip_forward`), each just a VECTOR, and code hand-rolls
> `<button class="tds-table__footer-btn">`. So there is no icon-only Button variant being inherited from
> anywhere; the icons are naked.
>
> Adopting Button supplies all three treatments Table would otherwise have to own —
> `icon/standard/tertiary-{default,hover,active}` for the icon, `opacity/disabled` for disabled, and a
> working hover that retires the broken variable in item 5. **This is why Pagination contributes only
> one Table-owned token** (`component/table/text/footer-default`).
>
> **Tabs' scroll controls are NOT covered by this ruling** — that remains open, and the "decide it once"
> framing above still holds for it.
>
> **Naming caveat carried into the spec:** code says `variant="ghost"` (`button.tsx:24`) while Button's
> tokens say `standard/tertiary`. Mapped by elimination — three non-danger variants, three standard
> tiers — not from anything documented.

---

### 7. `--tds-table-zebra-mode-backround` is both misspelled and redundant

Two problems, and the second changes what should be done about the first.

**Misspelled.** Missing the `g` in "background". Consistent between light and dark and between
`table-vars.scss` and its consumers, so nothing renders wrong — but it is part of the public CSS
custom property surface, so renaming it is a breaking change.

**Redundant.** Zebra is a swap between the two mode variants' row backgrounds, not a third colour:

| Scania light | primary | secondary |
|---|---|---|
| `--tds-table-body-row-background` | grey-50 | white |
| `--tds-table-zebra-mode-backround` | white | grey-50 |

The same two values, swapped. Dark behaves the same way (grey-850 / grey-900 against grey-900 /
grey-850). So the zebra variable never holds a value that the *other* variant's row background does not
already hold. Figma's `Table/Column` set expresses this directly — its `Zebra mode=True` variants bind
`component/table/secondary/cell` under Mode Variant=Primary and `component/table/cell` under
Secondary, i.e. it points at the other variant's token rather than at a zebra token. There is no
zebra token in the design system, by design.

**Proposed change**: do **not** fix the spelling in place — that would preserve a variable that should
not exist. Deprecate `--tds-table-zebra-mode-backround` and have zebra rows consume the opposite mode
variant's row background directly. If an interim alias is needed for consumers, alias the misspelling
to the opposite variant's value rather than minting a corrected third variable.

---

### 8. `tds-expendable-row-icon` — misspelled, and missing the block prefix

`table-body-row-expandable/table-body-row-expandable.tsx:275` renders:

```jsx
<span class="tds-expendable-row-icon">
```

Two defects in one class name:

- **"expendable" instead of "expandable."** Expendable means disposable.
- **Missing the `tds-table__` prefix.** Every other class in this file follows the block convention —
  `tds-table__row`, `tds-table__cell-expand`, `tds-table__expand-control-container`,
  `tds-table__expand-input`. This one is `tds-` plus a bare name.

Low risk to change: unlike `--tds-table-zebra-mode-backround` this is an internal class inside a
`shadow: true` component, not a published custom property, so no consumer can be targeting it.

**Proposed change**: rename to `tds-table__expand-icon`, matching tegel-lite's `tl-table__expand-icon`,
which already uses the correct spelling and the block prefix.

---

### 9. No example or test combines a toolbar with multiselect

Across both harnesses, no case renders a table that has *both* a toolbar and row selection:

| | has a toolbar | has multiselect |
|---|---|---|
| Storybook | `batch-actions` · `filtering` · `horizontal-scroll` · `sorting` | `multiselect` · `multiselect-expandable` |
| e2e | `batch` · `filtering` · `sorting` | `pagination-multiselect` · `pagination-multiselect-expandable` |

**Zero overlap in either.** A table with a title *and* row selection is an ordinary combination and it
is neither demonstrated nor tested.

**Proposed change**: add a story and an e2e case combining a toolbar with multiselect.

> **Revised 2026-08-25.** This entry originally also predicted a title/column misalignment in that
> combination — the toolbar's leading padding is a fixed `var(--tds-spacing-element-16)` and
> `table-toolbar` never receives `multiselect`, so the column headers shift when selection is enabled
> and the caption title cannot follow. **That is no longer filed as a defect.** Max's ruling: the
> toolbar is a `<caption>` and is not part of the column grid, `start` and `end` are the supported
> content slots, and a select-all checkbox belongs in the column that holds all the other checkboxes —
> not in the toolbar. So the caption title staying at the table's padding regardless of selection is
> intended behaviour, not drift.
>
> The design side is being corrected to match: Figma's `Table/Toolbar` carries a stray
> `Table/Row/Prefix` instance at x=0, 48px wide, set to `Action=Multi select`. It draws a checkbox code
> does not render there and reserves a column the caption does not belong to. It is being removed rather
> than switched to `Action=Empty` — the column should not be reserved at all.
>
> The coverage gap above stands on its own merits and is worth closing regardless.

---

### 10. The header cell's bottom border is painted with a hover colour

`table-header-cell.scss:15` draws the rule under every column header with the *hover* variable rather
than the divider one:

```scss
border-bottom: 1px solid var(--tds-table-header-background-hover);   /* grey-200 / grey-650 */
```

Every other divider in the table uses `--tds-table-divider` (grey-150 / grey-600), including the
header's own bottom edge one level up at `table-header.scss:15`. So two adjacent rules use two
different variables.

**Why this is a bug and not a heavier-rule design choice.** Tegel UI, the Scania source of truth, shows
header cell and body cell sharing **one** divider colour — `grey/200` `#d1d7e0` Light, `grey/600`
`#4e5e75` Dark, across all 84 header-cell and 108 body-cell variants. There is no heavier thead rule in
the design source. And the borrowed value lands accidentally right in Light (grey-200 matches) and one
rung off in Dark (grey-650 against `grey/600`) — an intentional treatment would be consistent in both.

**Proposed change**: point `table-header-cell.scss:15` at the divider variable. Also couples the header
rule to hover, so any future hover change silently moves it.

---

### 11. `table-body-row`'s `disabled` prop styles nothing on the row

`table-body-row.tsx:33–34` declares it, documented as *"Marks the row as disabled, used for multiselect
table"*, and `:156` passes it to the checkbox. **There is no `disabled` rule in
`table-body-row.scss` at all.**

So a disabled row renders identically to an enabled one — only its checkbox greys out. The row keeps
its hover treatment, its pointer cursor when `clickable`, and full text contrast.

**Accessibility angle:** the prop reflects to the host, so assistive tech may surface a disabled state
that is visually undetectable. Sighted users get no signal at all.

**Proposed change**: either apply `opacity/disabled` to the row (the system rule — see item 13), or
narrow the prop's documentation to say it disables the checkbox only. The current name and JSDoc
promise more than the implementation delivers.

---

### 12. `--tds-table-footer-page-selector-input-color-disabled` is used but never defined

`table-footer.scss:58` sets `color: var(--tds-table-footer-page-selector-input-color-disabled)` on the
disabled page-number input. **Zero definitions anywhere in the repo** — not in `table-vars.scss`, not
in `_tl-table-vars.scss`, not in the bridge.

Note the near-miss that hides it: `table-vars.scss:108` defines
`--tds-table-footer-page-selector-input-background-disabled`. Same prefix, different property —
`background` versus `color`. So the name looks defined at a glance.

With no fallback the declaration is invalid and the property is dropped, so the disabled input keeps
its enabled text colour.

**Proposed change**: define it, or delete the declaration. Same shape as Stepper's item 1
(`--tds-stepper-label-text-opacity-upcoming`) — the second undefined-variable instance in this file, so
worth a lint rule rather than case-by-case discovery.

---

### 13. Disabled is expressed as a background colour, in both brands

| Brand | Source | Declarations |
|---|---|---|
| Scania | `table-vars.scss:32, 99` | `--tds-table-input-background-disabled` |
| TRATON | `_tl-table-vars.scss:20` | `--table-input-disabled: var(--color-background-layer-01)` |

**The system rule is opacity, and among shipped specs it is unanimous.** Eleven components own
`opacity/disabled` — `-input`, accordion, button, checkbox, chip, dropdown, link, popover,
radio-button, tabs, toggle — and **no shipped spec has a background-disabled token at all.** (One
exists in `_menu-item-DRAFT.json`; draft specs are not precedent.)

Two brands making the same choice independently is still a departure from the system rule rather than
evidence for it. Item 6's `--tds-table-footer-page-selector-icon-disabled` is the same pattern
expressed as an icon colour.

**Proposed change**: route disabled to `component/-input/opacity/disabled` once the table's inline
fields become `Text Field` instances (item 15). **No Table-owned disabled token** — and note the canvas
could not bind one anyway: neither `Table/Column/Cell` nor `Table/Row` carries a disabled axis, so the
state is unmodelled in Figma entirely.

---

### 14. Two Scania values in code diverge from Tegel UI

Max's ruling is that **Tegel UI decides Scania design intent**, with the web component authoritative
for state and a11y behaviour. Probed 2026-08-26 across every table surface; two disagree:

| Surface | Tegel UI | `table-vars.scss` |
|---|---|---|
| Body row, secondary — **Dark** | `grey/800` `#242c37` | grey-**900** |
| Row selected — **Light** | `grey/150` `#e0e5eb` | grey-**100** |

Everywhere else the two agree exactly — primary row, row hover, header row and toolbar all match in
both modes — so this is two specific values, not a systematic offset.

**Not filed for the divider**, although it looks like a third case. Tegel UI's stroke is an opaque
colour style; the canvas semantic (`color/border/discrete`) is translucent — `#303c61` at 17% in Scania
Light, which composites over a `grey/50` row to roughly `#d4d7df` against Tegel UI's `#d1d7e0`. Not
comparable, and they agree in rendered result.

**Proposed change**: align the two values above. Low risk — both are single-rung.

---

### 15. Every input inside the table is hand-rolled instead of using `tds-text-field`

Four sites, none of them a Text Field:

| Site | Code |
|---|---|
| Toolbar search | built-in `<input class="tds-table__searchbar-input">`, `table-toolbar.tsx:143–155` |
| Page-number field | raw `<input class="tds-table__page-selector-input">`, `table-footer.tsx:335` |
| Filter cell | `tds-table-header-input-wrapper` around a slotted `<input>` |
| Cell edit | `table-body-input-wrapper` around a slotted `<input>` |

**This is why the six `--tds-table-input-*` and `--tds-table-input-header-*` variables exist.** A
`tds-text-field` would inherit `component/-input/*` for text, placeholder, icons and disabled opacity,
and the table would need none of them.

Figma is inconsistent in the same area but leans the other way: the page-number field **is** a real
`Text Field` instance, while the filter cell and cell-edit are hand-built frames.

Note the cross-component borrowing already happening: `table-body-input-wrapper.scss` uses
`var(--tds-text-field-bar)` for the focus bar — Text Field's own variable, reached into from Table.

**Proposed change**: migrate the four sites to `tds-text-field`. Sizeable, and not this cluster's work
— but it is the root cause behind items 12, 13 and the six orphan variables.

---

### 16. The pagination token renames orphan four tegel-lite call sites

`component/table/pagination/base` → `component/table/background/footer-default` and
`component/table/pagination/dropdown` → `component/table/background/popover-default`, renamed on the
Figma branch 2026-08-26 to put the property before the scope per `convention-naming-shape`.

`_tl-table-vars.scss` consumes the old CSS names at `:29`, `:30`, `:44`, `:45`:

```scss
--table-footer:                  var(--component-table-pagination-base);
--table-footer-page-selector-input: var(--component-table-pagination-dropdown);
--table-toolbar-searchbar:       var(--component-table-pagination-dropdown);
--table-toolbar-searchbar-hover: var(--component-table-pagination-base);
```

**Max's ruling: the rename stands.** Orphaned CSS variables are a dev-side concern, not a constraint on
token naming — if the old names must stay in the token contract, devs alias them.

**Proposed change**: repoint the four call sites, or add aliases from the old names to the new.

⚠ **ESCALATED 2026-08-28 — two of these four now have no target at all, not merely an old name.**
`component/table/background/popover-default` (which `pagination/dropdown` had been renamed to) was
**deleted from the branch** on 2026-08-28, after a branch-wide sweep confirmed zero bindings across
145,342 nodes and no code consumer. Its purpose was superseded: the pagination dropdown's interior now
resolves to Dropdown's own tokens.

Consequence once the bridge is regenerated: `--component-table-pagination-dropdown` will not be emitted,
so these two call sites resolve to nothing —

```scss
--table-footer-page-selector-input: var(--component-table-pagination-dropdown);  /* :30 */
--table-toolbar-searchbar:          var(--component-table-pagination-dropdown);  /* :44 */
```

meaning the page-selector input and the toolbar search field lose their background in TRATON. The other
two (`:29`, `:45`) still have a live target — `background/footer-default` survives and is in the Table
spec.

**Proposed change, revised**: repoint `:30` and `:44` to Dropdown's own background tokens rather than
aliasing a name that no longer exists. Aliasing is not available for these two.

---

### 17. `row-extend--active` and `row-expendable` — two typos that cancel into an always-true condition

`table-header/table-header.tsx:105-121`, `bodyExpandClicked()`:

```ts
const numberOfExtendRowsActive = parentBody.getElementsByClassName(
  'tds-table__row-extend--active',    // nothing sets this class -> always 0
).length;
const numberOfExtendRows = parentBody.getElementsByTagName(
  'tds-table-body-row-expendable',    // real tag is ...-expandable -> always 0
).length;

if (numberOfExtendRows === numberOfExtendRowsActive) {
  this.mainExpendSelected = true;
}
```

**Two independent misspellings, and they mask each other.**

- **`row-extend--active` does not exist.** The component sets `tds-table__row-expand--active`
  (`table-body-row-expandable.tsx:237`, from `this.isExpanded`). `extend` versus `expand`.
- **`tds-table-body-row-expendable` is not the tag.** It is `tds-table-body-row-expandable`
  (`table-body-row-expandable.tsx:35`). Same `expendable` defect already logged as item 8, different
  location.

Both counts are therefore always `0`, `0 === 0` is always true, and **`mainExpendSelected` is set true
unconditionally** — the header's all-expanded state is permanently on regardless of row state. A single
typo would have made the condition always *false*, which is why this survived: it takes both to make it
silently always true.

**Third instance, same spelling:** `table-body-row-expandable.scss:10` and `:27` style
`.tds-table__row-extend`, a class nothing applies (the expand row uses `tds-table__row-expand`,
`table-body-row-expandable.tsx:292`). The `:hover` background at `:27` is a dead selector.

Confirmed by exhaustive search: `row-extend` occurs in exactly three places repo-wide, none of them an
assignment.

**Not a token gap** — no token is wrong and nothing in the Table spec depends on it. Logged here because
it surfaced while mapping the Figma `Active` variant axis against code, and because the header's
expand-all state is a real user-facing behaviour.

**Proposed change**: fix both spellings at `table-header.tsx:109` and `:112`, and the two SCSS selectors.
Verify the all-expanded behaviour afterwards — it has never actually run.

---

### 18. A 2-mode token silently emits the other brand's primitive into the Scania theme

Found on the four `component/table/icon/accent/*` variables before they were deleted 2026-08-28. **The
Table instance is resolved; the mechanism is system-wide and unguarded.**

Those four had no Scania mode values. The generated bridge emitted:

```scss
:root, .tds-mode-light, .scania .tds-mode-light, .scania.tds-mode-light, … {
  --component-table-icon-accent-default: var(--traton-color-blue-700);
```

A `traton/*` primitive under `.scania` selectors, in both light and dark — the cross-brand inheritance
`convention-brand-primitive-aliases` forbids. **Style Dictionary does not error on a missing mode; it
falls back to the other brand's value.**

**The leak condition is precise: a 2-mode token leaks only when its fallback value is a brand-namespaced
primitive.** `component/table/cell` and `secondary/cell` are also 2-mode but alias
`color/background/layer-01` and `layer-02` — brand-aware semantics, which resolve correctly per theme and
do not leak. So mode count alone is not the predictor; mode count *plus* the fallback's namespace is.

This is the concrete mechanism behind 4-mode universal being locked, and it is worth a pipeline guard
rather than per-cluster vigilance: nothing in the chain currently fails a build, or even warns, when a
brand's theme block resolves a foreign brand's primitive.

**Proposed change**: a build-time check that no `.scania` selector block emits a `--traton-*` value and
no `.traton` block emits a `--scania-*` value. Cheap, mechanical, and it would have caught this without
anyone reading the file.

---

### 19. The editable cell's focus bar references a variable that is out of scope, and has never rendered

`table-body-input-wrapper.scss` styles the focused editable cell with two declarations in one rule:

```scss
::slotted(input:focus) {
  background-color: var(--tds-table-input-background-focus);  // applies
  border-bottom: 2px solid var(--tds-text-field-bar);          // never applies
}
```

`--tds-text-field-bar` is declared **only inside the `tds-text-field` selector** (`text-field-vars.scss:25`).
Table's wrapper is `tds-table-body-input-wrapper` and is never a descendant of `tds-text-field`, so the
variable is undefined at that point. A declaration containing an undefined `var()` is invalid at
computed-value time, so all three `border-bottom` longhands reset to their initial values —
`border-bottom-style: none`. No border is drawn.

**Confirmed visually, not just by reading.** In Storybook (Scania light, `@scania/tegel` 1.62.0) the
focused cell shows its white focus background, so the rule *is* matching and `:focus` *is* active. The bar
is simply absent. `table-header-input-wrapper.scss` references the same variable and has the same defect.

The canvas disagrees: Tegel UI `[New] Table/Table Cell` (`35259:125409`) draws this bar on all 24
`Cell Edit=True` variants — `#2a6ecf` light, `#4a89f3` dark — alongside the white focus background and the
edit icon. So the design source has always shown a focus affordance the code has never produced.

**Combined with item 20, focus is currently indistinguishable from hover in light mode**: the bar does not
render, and `--tds-table-input-background-focus` and `--tds-table-input-background-hover` are both
`var(--tds-white)` in the light block (`table-vars.scss:30–31`). Hovering and focusing an editable cell
produce identical pixels. That is a focus-visibility concern, not only a token one.

**Proposed change**: delete the declaration rather than repair the variable. The design-lead direction
(2026-08-28) is that the focus indicator comes from the global focus helper, so Table should not own a
focus border at all. If that direction changes, the repair is to route it to a Table-owned token — not to
reach into `tds-text-field`'s private scope, which would break again the moment that component is
refactored.

---

### 20. Dark-mode input hover points at a non-existent step of a deprecated scale

`table-vars.scss:98`, in the `.tds-mode-dark` block:

```scss
--tds-table-input-background-hover: var(--tds-white-50);
```

There is no `--tds-white-50`. The white scale documented in
`packages/core/src/stories/foundations/color/colors.mdx` is `100 / 87 / 48 / 38 / 05`, and the heading
above it reads **"White Scale (deprecated)"**. So the reference is wrong twice over: `50` is not a member
of the ramp, and the ramp itself is retired.

Repo-wide, `--tds-white-50` appears in exactly **one** source line — this one — plus two archived audit
inventories that recorded that same line.

**Scope limit on this evidence**: no colour primitive is defined anywhere in this working tree
(`--tds-white` itself has 178 references and zero definitions), and `node_modules` carries no built
palette, so the variable could not be resolved locally. That it is undefined is inferred from the
documented ramp, not read from a value.

**Corroborated in Storybook.** Light mode: the hovered cell lifts to white, visibly distinct from its
row. Dark mode: the hovered *row* lifts, but the cell inside it does not change at all. That asymmetry is
what an unresolvable `background-color` looks like.

It is also the only white-alpha hover in the component — every other dark hover here uses an opaque grey,
e.g. `--tds-table-body-row-background-hover: var(--tds-grey-800)` (`table-vars.scss:75`).

**Proposed change**: do not simply correct the digit — any `--tds-white-*` target lands on the deprecated
scale. Route dark input hover to a live token consistent with the rest of the file. Note that the light
and dark values here are different mechanisms (opaque `--tds-white` vs a translucent overlay), which is
worth resolving deliberately rather than by matching one to the other.

---

## Tracking

- Latest union scan: [tokens/audit/20260423-210513-figma-scan/_scan-summary.md](../audit/20260423-210513-figma-scan/_scan-summary.md)
- Spec source: [tokens/specs/](../specs/)
- Figma libraries registry: [tokens/audit/figma-libraries.json](../audit/figma-libraries.json)
