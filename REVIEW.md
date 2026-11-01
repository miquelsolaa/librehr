# REVIEW.md - Code review guide (humans and agents)

Use this for every PR. Agents: when asked to review, follow "How to run a review" and produce the output template in section 5. Do not approve what you did not verify.

## 1. How to run a review

1. Read the PR description, linked issue, and the PRD requirement ID. Restate the intended behavior in one sentence.
2. Read the diff top-down: schema/migrations -> core/domain -> api -> web -> tests -> docs.
3. Check out the branch and run `pnpm verify`. For UI changes, run the app and exercise the flow including failure paths and keyboard-only.
4. Walk the checklists in section 3 relevant to the change.
5. Classify findings by severity (section 2) and report using the template in section 5.

## 2. Severity levels

- **Blocker:** security/privacy/tenancy flaw, data loss or corruption risk, legal/compliance violation, clean-room violation, broken build/tests, wrong business logic. Must fix before merge.
- **Major:** likely bug, missing test for important behavior, accessibility barrier, performance regression, unsafe migration, unclear API contract. Should fix before merge.
- **Minor:** maintainability, naming, small inefficiency, missing docs. Fix or create an issue.
- **Nit:** style preference not enforced by tooling. Optional; prefix with "nit:".
- **Praise:** call out good decisions; it teaches the team.

## 3. Checklists

### 3.1 Correctness and domain

- [ ] Behavior matches PRD acceptance criteria; edge cases handled (year boundaries, DST change days, leap day, half days, part-time, mid-year joiners, terminated employees).
- [ ] Dates/times use the right type (`timestamptz` vs `date`), correct time zone source (organization/location), and Temporal/date-fns-tz only inside `core`.
- [ ] Leave balances derive from the ledger; no direct balance mutation; compensating entries for cancellations.
- [ ] Time events are append-only; corrections reference originals; hash chain preserved.
- [ ] Policies are configuration, not constants.
- [ ] Idempotency for retried requests/jobs (no double accrual, no double email).

### 3.2 Security

- [ ] AuthN required; AuthZ checks permission **and** scope in the API (not only UI).
- [ ] Inputs validated with Zod at the boundary; outputs shaped by explicit response schemas (no accidental field leakage).
- [ ] No SQL string concatenation; parameterized queries only; no unsafe `dangerouslySetInnerHTML`.
- [ ] CSRF protection and secure cookie flags on session endpoints; CORS is an allow-list.
- [ ] Rate limiting on auth, invitation, export, and file endpoints.
- [ ] File uploads: size/type limits, sniffed MIME, randomized storage keys, no path traversal, scan hook.
- [ ] Secrets only via env/secret files; none logged or committed.
- [ ] New dependency: license compatible with AGPL-3.0, maintained, minimal install scripts, pinned via lockfile.

### 3.3 Privacy and compliance

- [ ] Data minimization: only necessary fields collected and returned.
- [ ] Special-category data (health/absence reasons, union, disability) not stored beyond what the PRD allows; access restricted and audited.
- [ ] Sensitive fields masked by default; reveals audited; encrypted at rest where required.
- [ ] No PII in logs, analytics, error messages, URLs, or test fixtures.
- [ ] Retention/erasure behavior defined for new data categories; DSR export includes them.
- [ ] No third-party runtime requests (fonts, scripts, analytics, maps) introduced.
- [ ] Compliance-relevant defaults match `COMPLIANCE.md`.

### 3.4 Tenancy and database

- [ ] New tenant tables have `organization_id`, RLS enabled and forced, and policies tested.
- [ ] Cross-tenant tests exist (A cannot read/write B, including via joins, search, exports, and jobs).
- [ ] Migrations are forward-only, idempotent in CI, safe on populated tables (no long locks; add column nullable -> backfill -> constrain), have indexes for new query paths, and include a rollback note.
- [ ] Constraints enforce invariants (unique, check, foreign keys, exclusion constraints for overlapping periods).
- [ ] No N+1 queries; list endpoints paginated; heavy work in the worker.

### 3.5 API contract

- [ ] Zod contracts updated in `packages/contracts`; OpenAPI regenerated; breaking changes versioned/documented.
- [ ] Errors use problem+json with stable `code`; HTTP status codes correct; pagination cursor-based; idempotency keys for unsafe retries.
- [ ] Backwards compatibility considered for public API and webhooks.

### 3.6 Frontend and UX

- [ ] Uses `packages/ui` components and tokens (no raw colors, no ad-hoc spacing).
- [ ] All states: loading, empty, error, offline, permission-denied.
- [ ] Keyboard operable, focus managed, axe clean; works at 360 px; dark mode ok.
- [ ] Strings in ca/es/en via ICU messages; no concatenation; plural/gender handled.
- [ ] Forms preserve input on error; double-submit prevented; optimistic updates roll back on failure.
- [ ] No unnecessary client-side JS; server components used where appropriate; bundle budget respected.

### 3.7 Tests and CI

- [ ] Tests fail without the change and pass with it; they assert behavior, not implementation.
- [ ] Cross-tenant and authorization tests for new endpoints; property tests for accrual/balance logic.
- [ ] No flaky timing (sleeps); deterministic clocks injected via a `Clock` interface.
- [ ] Fixtures use factories; no real personal data.

### 3.8 Observability and operations

- [ ] Structured logs with request id and organization id (not PII); metrics for new jobs; health checks unaffected.
- [ ] Config documented in `infra/env/.env.example` and docs; sensible defaults; fails fast on invalid config.
- [ ] Jobs are retry-safe with backoff and dead-letter visibility.

### 3.9 Docs and housekeeping

- [ ] README/docs/ADR updated when behavior or decisions changed; CHANGELOG entry (Conventional Commits drive release notes).
- [ ] Commit messages and PR title follow Conventional Commits; DCO sign-off present.
- [ ] No dead code, stray TODOs without issue links, or commented-out blocks.

### 3.10 Clean-room and licensing

- [ ] PR attestation complete (`CLEANROOM.md` section 5).
- [ ] Nothing resembles copied third-party code/text/assets/layouts; assets have licenses recorded in `NOTICE`.
- [ ] Naming and copy do not use competitor brand names.

## 4. Review etiquette

- Be specific, kind, and actionable: say what, why, and a suggested fix. Ask questions when intent is unclear.
- Review the code, not the person. Separate must-fix from preference.
- Authors: respond to every comment; push fixes as new commits; request re-review explicitly.
- Reviewers: aim to respond within 2 working days; approve when blockers/majors are resolved.
- Two approvals required for: auth, RLS/migrations, encryption, audit log, compliance defaults, `CLEANROOM.md`.

## 5. Review output template (for agents and humans)

```
## Review of <PR/branch>
**Intent:** <one sentence>
**Verification:** <commands run and results; manual checks performed>

### Blockers
- [file:line] <issue> - <why it matters> - <suggested fix>

### Major
- ...

### Minor / Nits
- ...

### Praise
- ...

### Missing tests
- ...

**Verdict:** Approve | Approve with comments | Request changes
**Confidence:** High | Medium | Low (state what you could not verify)
```
