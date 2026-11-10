# Editions and Business Model

LibreHR is **open core**: an AGPL-3.0-or-later Community edition plus a source-available Business edition in `ee/`. The decision and its reasons are in [ADR 0004](adr/0004-open-core-licensing.md).

Principle: **legal compliance is never a paid feature.** Everything a Spanish SMB needs to meet its legal obligations ships in Community.

## Offers

| Offer         | For                                       | What you get                                                                                      | Price |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- |
| **Community** | Self-hosters, small teams, public sector  | All core modules, self-hosted, AGPL                                                               | Free  |
| **Cloud**     | Most SMBs (no IT staff)                   | Hosted Community in the EU, backups, upgrades, email support. Business features as an add-on tier | TBD   |
| **Business**  | Growing SMBs, self-hosted or Cloud        | Community plus the Business features below, under a licence key                                   | TBD   |
| **Partners**  | Gestorías, integrators, hosting providers | Resale margin, permission to use the trademark for hosting, partner support                       | TBD   |

Prices are a maintainer decision and are left open.

## Feature split

| Area           | Community (AGPL)                                                                                         | Business (`ee/`)                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| People and org | Employees, departments, locations, org chart, custom fields, employment history, imports                 | Multi-entity groups (planned)                                                                         |
| Time off       | Leave types, statutory leave, policies, ledger, calendars, coverage rules, delegations                   | —                                                                                                     |
| Time tracking  | Registro de jornada, hash chain, corrections, kiosk, shifts, time bank, inspector role, exports          | —                                                                                                     |
| Documents      | Repository, payslips, acknowledgements, templates                                                        | E-signature integrations (planned)                                                                    |
| Security       | Email/password, sessions, **2FA (TOTP) and org-wide 2FA enforcement**, personal access tokens, audit log | **OIDC single sign-on (`AUTH-004`)**, SCIM provisioning (planned), audit log export to SIEM (planned) |
| Reports        | Headcount, absence, gestoría CSV export                                                                  | Advanced analytics and custom report builder (planned)                                                |
| Integrations   | Webhooks, REST API, iCalendar feed                                                                       | Payroll provider connectors (planned)                                                                 |
| Compliance     | GDPR data subject exports, retention, DPIA/ROPA templates                                                | —                                                                                                     |

Moving a feature between columns is a maintainer decision (`AGENTS.md` section 8). Features already published under AGPL stay available under AGPL in those published versions.

## Licence keys

A Business licence key is a signed token set in `LIBREHR_LICENSE_KEY`. It is verified offline. LibreHR never contacts a licence server. If the key is missing, invalid or expired, the instance runs as Community and all data remains accessible. The current edition is shown by `GET /v1/edition` (`LIC-001`).

## Partner programme (outline)

- **Gestorías and labour advisers**: resell Cloud to their clients and get a client management view.
- **Integrators**: implementation, migration and training for customers.
- **Hosting providers**: may host LibreHR under the trademark with a partner agreement (`TRADEMARKS.md`).

Terms are to be defined.

## Contributing

All contributions, in Community or `ee/`, require the [CLA](../CLA.md) plus the DCO sign-off. See `CONTRIBUTING.md`.
