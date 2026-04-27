# Shipyard — AI Agent Instructions

## REQUIRED: Load project skill before any work

Before reading any file, writing any code, or answering any question about this project:

```
Use the Skill tool to load: shipyard-dev
```

This skill contains the architecture rules, file map, known issues, and coding standards.
Skipping it will cause architectural violations.

## Quick Reference

- All types: `src/graph.ts`
- Entry point: `src/index.ts` → `src/shipyard.ts`
- Current version: v0.3 (CLI working end-to-end)
- Next priority: Phase 1.1 checkpoint persistence

## Non-Negotiable Rules

1. Engine (`src/`) has zero UI dependencies
2. Nodes are atomic — complete or rollback, never partial
3. Evidence is append-only
4. No node marked `done` without passing verification
