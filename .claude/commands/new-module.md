---
description: Scaffold a feature module (contracts, db repository, api routes, web feature, i18n keys, tests) per ARCHITECTURE.md
argument-hint: <name> <prd-id>
---

# /new-module <name> <prd-id>

Scaffold a feature module across packages according to `ARCHITECTURE.md` and `PRD.md`.

## Arguments

- `$1`: module name (e.g. `expenses`)
- `$2`: PRD prefix (e.g. `EXP`)

## Steps

1. Find the `$2` requirements in `PRD.md` and quote their acceptance criteria before writing code.
2. Create contracts in `packages/contracts/src/<name>.ts` with Zod schemas and request/response shapes.
3. Add exports to `packages/contracts/src/index.ts`.
4. **Stop and ask for confirmation before any database schema change** (`AGENTS.md` section 8,
   "Ask first"). Propose the tables, columns, `organization_id` + RLS policy, and indexes for
   `packages/db/src/schema/<name>.ts`, then wait for an explicit "yes" from the human. Do not
   create or edit any schema or migration file until then. If the answer is no, skip steps 5-6.
5. After approval, write the schema in `packages/db/src/schema/<name>.ts`. Do not leave `TODO`
   comments: if something is deliberately left unfinished, write
   `// TODO(<issue-url>): ...` with the literal placeholder `<issue-url>` and tell the human to
   replace it with a real issue link before merging (`AGENTS.md` section 9.6).
6. Create the repository in `packages/db/src/repositories/<name>.repository.ts`.
7. Create service in `apps/api/src/services/<name>.ts`.
8. Create API route in `apps/api/src/routes/<name>.ts` using contracts.
9. Create web feature directory in `apps/web/src/features/<name>/index.ts`.
10. Add translation keys to `packages/i18n/messages/{en,es,ca}.json`.
11. Add unit and integration tests.
12. Run `pnpm verify`, and list any remaining `<issue-url>` placeholders in your report.
