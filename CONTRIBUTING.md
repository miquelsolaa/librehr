# Contributing to LibreHR

Thanks for helping! This project handles people's employment data, so we are strict about privacy, security, and independence from commercial products.

## Ground rules

- Be kind; follow `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- Read `AGENTS.md`, `CLEANROOM.md`, and `COMPLIANCE.md` before your first PR.
- License: contributions are accepted under **AGPL-3.0-or-later**. We use the **DCO**: sign off commits with `git commit -s`. No CLA.

## Getting started

```bash
corepack enable
pnpm install
cp infra/env/.env.example .env
pnpm infra:up      # Postgres, Mailpit, MinIO
pnpm db:migrate && pnpm db:seed
pnpm dev           # web http://localhost:3000, api http://localhost:4000, mail http://localhost:8025
```

Seed users (dev only): `admin@example.test`, `manager@example.test`, `employee@example.test` (password in `infra/env/.env.example`).

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
