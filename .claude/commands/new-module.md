# /new-module <name> <prd-id>

Scaffold a feature module across packages according to `ARCHITECTURE.md` and `PRD.md`.

## Arguments

- `$1`: module name (e.g. `expenses`)
- `$2`: PRD prefix (e.g. `EXP`)

## Steps

1. Create contracts in `packages/contracts/src/<name>.ts` with Zod schemas and request/response shapes.
2. Add exports to `packages/contracts/src/index.ts`.
3. Add schema stubs in `packages/db/src/schema/<name>.ts` with `// TODO(<prd-id>): ...`.
4. Create empty repository in `packages/db/src/repositories/<name>.repository.ts`.
5. Create service in `apps/api/src/services/<name>.ts`.
6. Create API route in `apps/api/src/routes/<name>.ts` using contracts.
7. Create web feature directory in `apps/web/src/features/<name>/index.ts`.
8. Add translation keys to `packages/i18n/messages/{en,es,ca}.json`.
9. Add unit and integration tests.
10. Run `pnpm verify`.
