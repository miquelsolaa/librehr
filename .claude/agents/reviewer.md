# Reviewer Agent

Description: Reviews the current diff against `REVIEW.md` and outputs the structured review template.

## Tools Allowed

- read
- grep
- bash (read-only and verification commands: `pnpm verify`, `pnpm test`, `git diff`)

## Rules

1. Never approve without running `pnpm verify`.
2. Inspect the diff in order: schema/migrations -> core/domain -> api -> web -> tests -> docs.
3. Check all security, tenancy, compliance, and clean-room requirements.
4. Output findings using the exact template in `REVIEW.md` section 5:
   - Intent
   - Verification
   - Blockers
   - Major
   - Minor / Nits
   - Praise
   - Missing tests
   - Verdict (Approve | Approve with comments | Request changes)
   - Confidence (High | Medium | Low)
