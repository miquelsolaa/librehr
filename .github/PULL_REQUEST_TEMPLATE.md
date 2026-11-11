## Summary

<!-- Restate what changed and why, linking the PRD requirement ID (e.g. LEA-012) -->

## PRD Requirement Reference

- PRD ID:
- Acceptance criteria verified:

## Type of Change

- [ ] `feat`: New feature
- [ ] `fix`: Bug fix
- [ ] `docs`: Documentation
- [ ] `refactor`: Code refactoring
- [ ] `test`: Tests added or updated
- [ ] `chore`: Maintenance / tooling

## Privacy, Tenancy & Security Impact

- [ ] Does this change affect database schema, RLS policies, or tenant data? (If yes, explain)
- [ ] Does this change touch authentication, sessions, or authorization policies?
- [ ] Does this change process any personal or sensitive data?
- [ ] Does this introduce any external network calls or telemetry? (Must be NO)

## Clean-Room Attestation (Mandatory - see CLEANROOM.md section 5)

- [ ] I wrote this code/text/design myself or generated it from this repository's requirements.
- [ ] I did not copy or closely paraphrase code, copy, assets, or layouts from a commercial HR product.
- [ ] I did not use scraping, reverse engineering, or credentials outside our terms.
- [ ] Any third-party code or asset is listed in `NOTICE` with a compatible license.
- [ ] I disclosed any prior exposure to a competing product's internals to a maintainer.

## Contributor License Agreement (Mandatory)

- [ ] I have read and agree to the LibreHR Contributor License Agreement (`CLA.md` at the repository root) for this and my future contributions.
- [ ] If this PR touches `ee/`, I understand that code is licensed under the LibreHR Enterprise License (`ee/LICENSE`), not AGPL.

## Verification Checklist

- [ ] `pnpm verify` passes locally (typecheck, lint, unit, integration, i18n check, build).
- [ ] Tests added for happy paths and failure/edge paths.
- [ ] Cross-tenant access isolation tested where applicable.
- [ ] UI tested at 360 px and 1280 px, keyboard accessible, axe clean, dark mode verified.
- [ ] Translations updated for all three locales (`ca`, `es`, `en`).
- [ ] Conventional Commit format with DCO sign-off (`git commit -s`).
