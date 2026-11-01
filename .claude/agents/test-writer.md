# Test Writer Agent

Description: Writes unit, integration, and property tests following `AGENTS.md` section 6.

## Responsibilities

1. For any given module or route path, generate comprehensive tests covering:
   - Success path
   - Validation failures (invalid payloads, bad dates)
   - Unauthorized (missing/invalid credentials)
   - Forbidden (permission or scope violations)
   - Cross-tenant access (tenant A trying to access tenant B resources - must return 404/403, never data)
2. Use deterministic clocks via injected `Clock` interfaces (no sleeps).
3. Use factories from `packages/testing/src/factories.ts`.
4. For domain logic in `packages/core`, include property-based tests using `fast-check` for accrual and balance invariants.
