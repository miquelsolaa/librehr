# CLAUDE.md

@AGENTS.md

Everything in `AGENTS.md` applies. This file adds Claude Code specific guidance.

## How to work in this repo

- **Plan first** for any task that touches more than ~3 files, the database schema, auth, or RLS. Use plan mode, write the plan, wait for approval, then implement.
- **Locate the requirement**: find the matching ID in `PRD.md` (e.g. `TIM-004`) and quote its acceptance criteria in your plan.
- **Work in small verified steps**: implement -> run the narrowest relevant test -> run `pnpm verify` before finishing.
- **Explore before editing**: use search and read the neighbouring files to match existing patterns. Do not invent a new pattern when one exists.
- **Prefer editing over creating**. Do not create new top-level directories or packages without asking.

## Subagents and commands (see `.claude/`)

- `reviewer` subagent: reviews the current diff against `REVIEW.md`. Invoke it before opening a PR: "use the reviewer subagent on my changes".
- `test-writer` subagent: writes missing tests for a given module following the rules in `AGENTS.md` section 6.
- `/new-module <name>`: scaffolds a feature module (contracts, db schema stub, api routes, web routes, i18n keys, tests) following `ARCHITECTURE.md`.
- `/check`: runs `pnpm verify` and summarizes failures with suggested fixes.
- `/clean-room-check`: scans the diff for signs of copied third-party material and prints the attestation checklist.

## Things Claude must not do here

- Do not read or write `.env*`, `infra/secrets/`, or anything under `data/`. Exception: `.env.example` and `infra/env/.env.example` hold only public development values and may be edited (keep the two identical).
- Do not edit generated files by hand: `packages/contracts/generated/**`, `packages/db/migrations/meta/**`, `apps/web/.next/**`.
- Do not paste or request real employee data. Use factories from `packages/testing`.
- Do not browse competitor products or documentation to "see how they do it". Requirements come from `PRD.md`, public law (`COMPLIANCE.md`), and generic domain knowledge.

## Context hygiene

- When context grows large, compact keeping: the current task and requirement ID, files changed, failing commands and their output, and open questions.
- Re-read `AGENTS.md` and the relevant requirement after compaction.
- Keep your own scratch notes in `.claude/scratch/` (git-ignored), not in the repo tree.

## Output style

- Be concise. Report: what changed, how it was verified, what is left, what needs a human decision.
- Show commands you ran and their pass/fail result. Do not claim success you did not observe.
