# Token documentation

Documentation and planning for the Tegel design system tokens.

## Catalog structure

```
tokens/
├── audit/          # Generated audit reports + small tracked config/state JSON files
├── docs/           # This folder – written docs and planning
├── json/           # Token source files (primitive, semantic)
├── scss/           # Generated SCSS from tokens
└── scripts/        # Audit and tooling scripts
```

## Audit reports

Each run writes to a **timestamped catalog** so you can compare runs by date/time:

- **`tokens/audit/YYYYMMDD-HHmmss/`** – one folder per run (e.g. `20260213-202018`)
- **`tokens/audit/latest-run.json`** – `{ "runId", "generated" }` pointing at the latest run

Inside each run folder:

**Aggregate** (underscore prefix so they sort at the top of the run folder)
- **_variable-inventory.md** / **_variable-inventory.json** – full inventory (`auditFormatVersion` + `generated`)
- **_variable-mapping.md** / **_variable-mapping.json** – variable-to-token mapping (`auditFormatVersion` + `generated`)
- **_overlap-analysis.md** / **_overlap-analysis.json** – cross-reference of web vs Tegel Lite variables: overlap (what to keep) and what to consider. Overlap matching uses **tokens/audit/overlap-assumptions.json** for component slug aliases (e.g. `radiobutton` → `radio-button` to merge inventory components), variable-level component aliases (e.g. `btn` → `button`), and property equivalences (e.g. `-color` ↔ `-text`); edit that file to add or change mappings.

**Per component** (e.g. Button)
- **button.md** / **button.json** – audit for that component (timestamp only: `generated`). Each `.md` has a **Web component** section (variables from `*-vars.scss` when present; otherwise a note that variables may live in the component’s main `.scss`) and, when applicable, a **Tegel Lite** section.

Summary statistics in the aggregate files are kept intentionally extensible so we can add more data points later (e.g. optimisations, overlap metrics, deprecation candidates).

Per-component files include only **`generated`** (ISO date/time) so you can compare the same component across runs without format-version noise. `auditFormatVersion` is only in the aggregate JSON files.

## Running the audit

From the **project root**:

```bash
# Full audit: all components (writes to tokens/audit/YYYYMMDD-HHmmss/)
npm run audit:tokens

# Quick audit (Phase 2): 3 random components only – faster for trials
npm run audit:tokens:quick

# Cluster audit: curated set of components (from tokens/audit/audit-cluster.json or CLI args)
npm run audit:tokens:cluster -- button text-field chip
```

- **Full audit**: Creates a new timestamped folder and writes inventory, mapping, and overlap for every component.
- **Quick audit**: Picks **3 random components** that have **not** been quick-audited in a previous run, writes to `tokens/audit/quick-YYYYMMDD-HHmmss/`. Once every component has been covered at least once, the “covered” list resets so you can cycle again. No duplicate: you will not get e.g. Badge in round one and again in round two until all have been done.

**Quick-audit state**: `tokens/audit/quick-audit-covered.json` stores which component slugs have already been quick-audited. Delete this file to reset and allow all components to be picked again.

**Audit ignore list**: `tokens/audit/audit-ignore.json` lists component slugs to exclude from both quick audit and full audit (e.g. `beta`, or experimental/deprecated components). Edit `ignoredSlugs` to add or remove entries.

Each run creates a new catalog folder. To compare runs, open two catalog folders and diff the same component (e.g. `button.json`).

## Audit files in the repo

**Should audit output be committed?**

- **Option A – Gitignore** (recommended for most teams): Add `tokens/audit/*` to `.gitignore` (keep `!tokens/audit/.gitkeep` if you track an empty folder). Audit output is generated on demand; no noise in PRs and no large generated files. Use `tokens/audit/` only locally or in CI artifacts.
- **Option B – Commit some runs**: If you want a snapshot in the repo (e.g. for review or baseline), commit one run folder and/or `latest-run.json`. Be aware folders can be large and may change often.
- **Option C – Keep only the last 1–3 runs**: To avoid clutter, periodically prune old run folders and keep only the most recent. Run `npm run audit:tokens:prune` (keeps **last 3** by default), or `node tokens/scripts/prune-audit-runs.js [N]` for a custom N. To remove **all** run folders in one go, run `npm run audit:tokens:prune:all` or `node tokens/scripts/prune-audit-runs.js 0` (or `all`). Pruning only removes timestamped run directories; it does not touch `latest-run.json`, `quick-audit-covered.json`, `overlap-assumptions.json`, `audit-ignore.json`, or `.gitkeep`.

**Summary**: Prefer **gitignoring** `tokens/audit/*` (except `.gitkeep` and optionally `quick-audit-covered.json` if you want to share “where we are” in Phase 2). If you commit runs, keep only 1–3 recent runs and prune the rest.

To gitignore audit output but keep the folder and config/state files, add to `.gitignore`:

```
tokens/audit/*
!tokens/audit/.gitkeep
!tokens/audit/audit-cluster.json
!tokens/audit/audit-ignore.json
!tokens/audit/latest-run.json
!tokens/audit/overlap-assumptions.json
!tokens/audit/quick-audit-covered.json
```

## Docs in this folder

- **README.md** (this file) – Overview and how to run audit
- **PHASE1_DRYRUN_SUMMARY.md** – Phase 1 dry run summary
- **PHASE1_VISUAL_DIFF.md** – Visual diff of Phase 1 changes

## Next steps

1. Run `npm run audit:tokens` and review the new run folder under `tokens/audit/`.
2. Use the mapping to plan component token JSON files.
3. See the token management plan for Phases 2–4.
