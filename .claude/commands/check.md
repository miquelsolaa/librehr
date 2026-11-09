---
description: Run pnpm verify and summarize failures with suggested fixes
---

# /check

Run all CI verification checks and summarize status and fixes.

## Steps

1. Execute `pnpm verify`.
2. Parse output for failures across:
   - Typecheck (`pnpm typecheck`)
   - Lint (`pnpm lint`)
   - Unit tests (`pnpm test`)
   - Integration tests (`pnpm test:int`)
   - i18n key consistency (`pnpm i18n:check`)
   - Build (`turbo run build`)
3. Summarize any errors with line references and provide concrete fixes.
