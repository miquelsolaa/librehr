# ADR 0004: Open-Core Licensing, Editions and Contributor Agreement

## Status

Accepted

## Date

2026-11-10

## Context

LibreHR needs a sustainable business model without losing what makes it attractive: an auditable, self-hostable, open-source HRIS for European SMBs. Until now everything was AGPL-3.0-or-later and contributions came in under the DCO with no CLA (`CONTRIBUTING.md`, `PRD.md` open question 2).

Facts that shape the decision:

- The project has a single copyright holder today, so relicensing is still possible. The first outside contribution under DCO-only would remove that option for the contributed code.
- The repository is public. Every version already published remains available under AGPL-3.0-or-later; this ADR only affects future work.
- The main competitors are closed SaaS products. Being open source, self-hostable and free of lock-in is LibreHR's differentiator, so the core must stay OSI open source.
- Most target customers (10–200 employees, no IT staff) will not self-host. They will pay for a hosted service.

Options considered: (A) permissive core plus proprietary modules, (B) AGPL core plus proprietary modules, (C) source-available licence for everything (BSL, ELv2, FSL). A lets third parties host without giving anything back; C gives up the "open source" label. B keeps both the label and copyleft protection.

## Decision

1. **Two editions from one repository.**
   - **Community**: everything outside `ee/`, licensed AGPL-3.0-or-later. It includes every feature needed to comply with the law (registro de jornada, leave, documents, GDPR tooling, 2FA). Compliance never becomes a paid feature.
   - **Business**: code under `ee/`, licensed under the source-available **LibreHR Enterprise License** (`ee/LICENSE`). Development and testing are free; production use needs a valid licence key or a LibreHR Cloud subscription.
2. **Commercial offers**, in order of priority: LibreHR Cloud (hosted, per employee per month), Business licences for self-hosters, partner programme (gestorías and integrators) and services. See `docs/editions.md`.
3. **Contributor License Agreement.** Contributions require agreeing to `CLA.md` (checkbox in the pull request template) in addition to the existing DCO sign-off. Contributors keep their copyright and grant the steward a licence that allows relicensing, including under the Enterprise License.
4. **Code boundary.**
   - `ee/` may import `core`, `db` and `contracts`. Nothing outside `ee/` imports it, except the single API extension loader (`apps/api/src/extensions/load.ts`) and API tests. Lint enforces this.
   - The API exposes an `ApiExtension` interface; `ee/` registers its routes through it.
   - A build with `ee/` deleted must still compile and run as Community.
5. **Licence keys** are Ed25519-signed tokens verified **offline** against a public key embedded in `ee/`. There is no phone-home, activation server or telemetry. A missing, invalid or expired key falls back to Community and never blocks core features or data access.
6. **Trademark.** "LibreHR" and the logo are protected by `TRADEMARKS.md`. Forks may use the code but must rebrand; commercial hosting under the name needs a partner agreement.
7. **First Business feature:** OIDC single sign-on (`AUTH-004`) moves to `ee/`. The SSO configuration table, repository and contracts stay in Community because the schema and migrations are one chain.

## Consequences

- `PRD.md` gains section 7.12 (`LIC-001`..`LIC-003`); `AUTH-004` is marked Business.
- Anyone may still host the Community edition commercially under AGPL terms, provided they publish their modifications and do not use the trademark. This is accepted.
- Moving existing features into `ee/` is a product decision that needs maintainer approval (`AGENTS.md` section 8).
- Business code is visible in the public repository. The licence and key, not secrecy, are what protect it.
- `CLA.md`, `ee/LICENSE` and `TRADEMARKS.md` are drafts. They must be reviewed by a lawyer before the first paid licence is sold.
- The production signing key is generated and stored offline by the steward. Until its public key replaces the placeholder in `ee/`, every instance runs as Community.
