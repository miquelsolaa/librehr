# Contributing to LibreHR

Thanks for helping! This project handles people's employment data, so we are strict about privacy, security, and independence from commercial products.

## Ground rules

- Be kind; follow `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- Read `AGENTS.md`, `CLEANROOM.md`, and `COMPLIANCE.md` before your first PR.
- License: LibreHR is open core (see `docs/adr/0004-open-core-licensing.md`). Code outside `ee/` is **AGPL-3.0-or-later**; code in `ee/` is under the source-available **LibreHR Enterprise License** (`ee/LICENSE`).
- **CLA required**: by ticking the CLA box in the pull request template you agree to [`CLA.md`](CLA.md). You keep your copyright; the project steward may also license your contribution under other terms. Contributions outside `ee/` always remain available under AGPL.
- **DCO sign-off still required**: sign off every commit with `git commit -s`.
- Name and logo use is covered by [`TRADEMARKS.md`](TRADEMARKS.md).

## Getting started

```bash
corepack enable
pnpm install
cp infra/env/.env.example .env
pnpm infra:up      # Postgres, Mailpit, MinIO
pnpm db:migrate && pnpm db:seed
pnpm dev           # web http://localhost:3000, api http://localhost:3001, mail http://localhost:8025
```

Seed users (dev only): `admin@librehr.local`, `manager@librehr.local`, `hr@librehr.local`, `employee@librehr.local` and more (see `packages/db/seeds/dev.ts`). Password: `Password123!`. Kiosk PIN: `1234` (override with `SEED_DEV_KIOSK_PIN`). These are public values; the seed refuses to run with `NODE_ENV=production`.

## Workflow

1. Pick an issue labelled `good first issue` or `help wanted`, or open one first for anything non-trivial.
2. Branch: `feat/<scope>-<short>`. Keep PRs small and focused.
3. Add tests, i18n keys (ca/es/en), and docs. Run `pnpm verify`.
4. Open a PR using the template. Complete the clean-room attestation.
5. A maintainer reviews against `REVIEW.md`. Address comments with new commits; we squash on merge.

## Using AI assistants

Allowed and encouraged, under these conditions: you are responsible for every line; the agent follows `AGENTS.md`; you disclose significant AI assistance in the PR; no competitor material is placed in the prompt/context.

## Translations

Source locale is `en`. Required locales: `ca`, `es`. Missing keys fail CI. Use inclusive, plain language; see `DESIGN.md` voice guidelines.

## Security issues

Do not open public issues for vulnerabilities. Email security@<project-domain> or use GitHub private vulnerability reporting. See `SECURITY.md`.
