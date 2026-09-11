# Cluster kickoff prompt template

Copy-paste this when starting a new cluster session. Fill in the angle-bracket placeholders. Everything else stays as-is — the standing rules at the bottom are what keeps each cluster aligned with the LOCKED conventions and the standard close-out recipe.

---

```
[#XX/a] Token pipeline: <component>

==

Kick off for new component cluster. Read this first:

1. /Users/madodv/.claude/projects/-Users-madodv--dev-maxadolfsson-tegel/memory/project-status.md
2. /Users/madodv/.claude/projects/-Users-madodv--dev-maxadolfsson-tegel/memory/cluster-roadmap.md
3. tokens/specs/<component>-DRAFT.json — if a scope draft exists
4. LOCKED conventions matching this cluster's expected work:
   - convention-handover-decision-log (close-out handover)
   - convention-opacity-disabled-wrapper (if disabled state expected)
   - convention-variant-axis-preservation (if Primary/Secondary axis)
   - convention-component-topology (Source / Wrapper / Group)
   - convention-cross-brand-audit (always)
   - any others the cluster scope draft cites

Figma branch URL (REQUIRED — never write to main):
https://www.figma.com/design/<fileKey>/branch/<branchKey>/...

If no branch yet, ask before any Plugin API call.

Then follow the spec's _kickoffDecisionQueue (or default sequence):
- Phase 0: tokens-architecture-verifier (branch-scoped)
- Cross-brand audit: 4 parallel probes (TRATON Figma + Tegel UI Figma +
  tegel-lite SCSS + core Stencil SCSS)
- Audit COMPONENT_SET on canvas (enableBase64Response: true) on pageId <id>
- Resolve open decisions in order surfaced by the scope draft
- Enumerate any migration consumers if scope mentions them

Honor:
- spec-only scope (never edit JSON sources, bridge SCSS, Style Dictionary)
- source-only writes (never modify INSTANCEs)
- ask-before-deep-checking (1 line from user usually explains it)
- MUST ask if uncertain — don't proceed on assumptions
- never declare "done" with standard close-out steps still pending
- read each LOCKED convention BEFORE doing work that matches its shape

Report shape: 4-part kickoff per convention-kickoff-report-shape —
tools run → plain-English findings → proposed token table → numbered
decisions.

Close-out recipe (all must complete + verify before QA designer ping):
- tokens-spec-validator (re-run after any spec edit)
- tokens-architecture-verifier (branch-scoped)
- tokens-figma-variable-audit (scoped to component/<slug>/* + INTERNAL/*)
- tokens-figjam-sync (apply + read-back-verify against Accordion canonical recipe)
- tokens-designer-handoff (zero outstanding designer tasks)
- Decision_log handover populated in correct instance + screenshot-verified
- Code-vs-spec cross-brand palette check (if vars.scss or bridge exists)
- Update durable state: project-status.md (new top entry) + cluster-roadmap.md (move out of Planned, into Cluster complete)
```

---

## Placeholders to fill

| Placeholder | Example |
|---|---|
| `<XX>` | `16` |
| `<component>` | `popover` |
| `<fileKey>` | `6osYTOfd4MgDq7LO6BCoUO` |
| `<branchKey>` | `BRANCH:popover-16` |
| `<id>` (pageId) | `26693:59843` |

## Optional cluster-specific additions

If the scope draft surfaces unusual decisions or design lessons from prior clusters that apply, append them after the "Honor:" block. Cluster #16 example added:

```
Honor: consolidation-not-a-goal (no content tokens here), cross-brand
audit before locking, indicator-namespace lesson (border/ for decorative
4px stripes regardless of canvas property).
```

Keep these to one short paragraph — they're cluster-specific reminders, not standing rules.

## When to update this template

- New LOCKED convention lands → add to the convention list line
- Standard close-out recipe changes → update the close-out block (also update CLAUDE.md)
- Phase 0 step added → reflect in the kickoff sequence
- Standing rule added → add to the Honor list

Keep the template in sync with CLAUDE.md's Phase 0 / Cluster close-out sections — they should always say the same things.
