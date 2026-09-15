# Token Documentation Index

Single entry point for all token-related documentation.

## Foundation (read first)

| Document | Purpose | Status |
|----------|---------|--------|
| [Cluster Foundation](CLUSTER_FOUNDATION.md) | Architecture, vocabulary, tooling, workflow — the durable foundation for cluster work | Active |

## Frameworks & Specifications

| Document | Purpose | Status |
|----------|---------|--------|
| [Semantic Bridge Framework v1.3](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__v1.3.md) | Token naming rules and conventions | LOCKED |
| [Semantic Bridge Framework v1.0–1.2](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__v1.0.md) | Earlier framework versions | Archived |
| [Bridge Generation Prompt](BRIDGE_GENERATION_PROMPT.md) | Template for Claude-assisted bridge token generation | Active (v2.0) |
| [Bridge Prompt (original)](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__PROMPT.md) | Original bridge prompt specification | Archived |
| [Review Batch 1+2](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__REVIEW-BATCH-1+2.md) | Component bridge review notes | Reference |

## Figma Handoff

| Document | Purpose | Status |
|----------|---------|--------|
| [Figma Quick Start](FIGMA_QUICKSTART.md) | Cheat sheet for Figma MCP tools + REST API script | Active |
| [Figma Component Variables — Designer Guide](FIGMA_COMPONENT_VARIABLES_GUIDE.md) | Naming convention & workflow for creating component-level variables in Figma | Active |

## Inventories

| Document | Purpose | Status |
|----------|---------|--------|
| [Figma Color Inventory (canvas)](FIGMA_COLOR_INVENTORY.md) | Manual canvas-based color extraction via MCP | Superseded — use REST API (`npm run audit:figma:colors`) |

## Audit Pipeline

Run commands from project root:

| Command | Description |
|---------|-------------|
| `npm run audit:tokens` | Full baseline audit (all components, all phases) |
| `npm run audit:tokens:quick` | Quick trial (3 random components) |
| `npm run audit:tokens:cluster` | Priority cluster (from `audit-cluster.json`) |
| `npm run audit:tokens:hardcoded` | Standalone hardcoded value scan |
| `npm run audit:tokens:report` | Standalone report generation |
| `npm run audit:tokens:palette` | Brand palette comparison (default: scania) |
| `npm run audit:tokens:palette:all` | Palette comparison for all brands |
| `npm run audit:figma:colors` | Fetch Figma color styles + variables |
| `npm run audit:figma:colors:all` | Fetch from all registered Figma libraries |
| `npm run audit:figma:branches` | Snapshot branch keys per library to `tokens/audit/figma-branches.json` (branch *creation* is a Figma UI action — no REST endpoint) |
| `npm run audit:figma:push -- --spec tokens/specs/footer.json` | Preview spec push (dry run, default) |
| `npm run audit:figma:push -- --spec tokens/specs/footer.json --push` | Push spec variables to Figma |
| `node tokens/scripts/scan-figma-vs-specs.js --branch <branchKey>` | Scan specs vs Figma main + branch; write reports to `tokens/audit/{ts}-figma-scan/` (REST path — needs `FIGMA_API_KEY`) |
| `node tokens/scripts/scan-figma-vs-specs.js --main-snapshot ... --branch-snapshot ...` | Same scan, but reads pre-captured MCP Plugin API snapshots from `.figma-scan-cache/` (no REST token) |
| `node tokens/scripts/merge-mcp-slices.js --side main --cache tokens/audit/.figma-scan-cache --file-key <key>` | Merge MCP-captured slice JSONs into a single snapshot for `scan-figma-vs-specs.js` |
| `npm run audit:tokens:prune` | Clean old audit runs (keep last 3) |

## Workflow

| Document | Purpose | Status |
|----------|---------|--------|
| [Cluster Workflow](CLUSTER_WORKFLOW.md) | Step-by-step process for tackling component clusters | Active |
| [Cluster Kickoff Template](CLUSTER_KICKOFF_TEMPLATE.md) | Copy-paste prompt template for starting a new cluster session — pre-loads conventions, enforces branch gate, and pins the close-out recipe | Active |
| [Handover Templates](../templates/README.md) | One template per close-out artifact (Decision log, Notion handover, talking points) — drives the documentation pass in the Cluster Workflow | Active |

## Configuration

| File | Purpose |
|------|---------|
| `tokens/audit/figma-libraries.json` | Registry of tracked Figma library files |
| `tokens/audit/figma-pages.json` | Component → Figma page ID + URL mapping (both libraries) |
| `tokens/audit/audit-cluster.json` | Priority component slugs for cluster audits |
| `tokens/audit/audit-ignore.json` | Components excluded from audits |
| `tokens/audit/overlap-assumptions.json` | Cross-library slug aliases and property equivalences |
