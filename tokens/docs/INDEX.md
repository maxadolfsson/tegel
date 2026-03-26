# Token Documentation Index

Single entry point for all token-related documentation.

## Frameworks & Specifications

| Document | Purpose | Status |
|----------|---------|--------|
| [Semantic Bridge Framework v1.3](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__v1.3.md) | Token naming rules and conventions | LOCKED |
| [Semantic Bridge Framework v1.0–1.2](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__v1.0.md) | Earlier framework versions | Archived |
| [Bridge Generation Prompt](BRIDGE_GENERATION_PROMPT.md) | Template for Claude-assisted bridge token generation | Active (v2.0) |
| [Bridge Prompt (original)](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__PROMPT.md) | Original bridge prompt specification | Archived |
| [Review Batch 1+2](TEGEL_TOKENS__SEMANTIC_BRIDGE_FRAMEWORK__REVIEW-BATCH-1+2.md) | Component bridge review notes | Reference |

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
| `npm run audit:tokens:prune` | Clean old audit runs (keep last 3) |

## Configuration

| File | Purpose |
|------|---------|
| `tokens/audit/figma-libraries.json` | Registry of tracked Figma library files |
| `tokens/audit/audit-cluster.json` | Priority component slugs for cluster audits |
| `tokens/audit/audit-ignore.json` | Components excluded from audits |
| `tokens/audit/overlap-assumptions.json` | Cross-library slug aliases and property equivalences |
