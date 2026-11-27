# Editions and Business Model

LibreHR is **open core**: an AGPL-3.0-or-later Community edition plus a source-available Business edition in `ee/`. The decision and its reasons are in [ADR 0004](adr/0004-open-core-licensing.md).

Principle: **legal compliance is never a paid feature.** Everything a Spanish SMB needs to meet its legal obligations ships in Community.

## Offers

| Offer                    | For                                         | What you get                                                                   | Price (EUR, excl. VAT)                      |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------- |
| **Community**            | Self-hosters, small teams, public sector    | All core modules, self-hosted, AGPL                                            | Free                                        |
| **Cloud**                | SMBs without IT staff                       | Hosted Community in the EU, daily backups, upgrades, best-effort email support | 2 per active employee/month, minimum 20     |
| **Cloud Business**       | Growing SMBs that want hosting              | Cloud plus the Business features below                                         | 4 per active employee/month, minimum 60     |
| **Business (self-host)** | Growing SMBs on their own servers           | Community plus the Business features below, under a licence key                | Agreed per customer (contact first)         |
| **Installation service** | Teams that want to self-host but not set up | We install LibreHR on the customer's server or cloud account                   | From 300 one-off; maintenance from 40/month |
| **Partners**             | Gestorías, integrators, hosting providers   | Resale margin, permission to use the trademark for hosting, partner support    | TBD                                         |

Prices and the reasons for them are in [ADR 0007](adr/0007-cloud-early-access-and-pricing.md). In short:

- **Billing unit:** active employees, meaning people who have not been terminated. Auditors and inspectors are not billed. With Cloud Business every active employee is billed at the Business rate.
- **Yearly billing** gets two months free. There is **no free trial**: Community is free to install.
- **Cloud is early access:** EU hosting, daily backups kept 7 days, a full data copy on request and a DPA with every customer, but no uptime guarantee, best-effort support and features that may change.

## Feature split

| Area           | Community (AGPL)                                                                                         | Business (`ee/`)                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| People and org | Employees, departments and memberships, locations, org chart, custom fields, employment history, imports | Multi-entity groups (planned)                                                                         |
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

The key is read once, when the API starts. A key that expires while the API is running keeps working until the next restart; restart the API after changing or renewing a key.

What a Business feature stored is never hidden when its licence lapses (`LIC-003`). For single sign-on, administrators can still read the stored configuration (`GET /v1/sso/config`) and switch it off (`POST /v1/sso/config/disable`) in Community; creating or changing it needs the licence.

"Require SSO" is enforced only while the licence grants `sso` (there is no environment switch); otherwise members sign in with their password and the setting is kept. See [Require single sign-on](guides/sso-enforcement.md).

## Builds and images

A checkout with `ee/` deleted builds and runs as the Community edition; CI proves it on every pull request. The default API image (`infra/docker/api.Dockerfile`) is the AGPL Community image and does not contain `ee/`. Build the Business image with `--build-arg EDITION=business`.

## Partner programme (outline)

- **Gestorías and labour advisers**: resell Cloud to their clients and get a client management view.
- **Integrators**: implementation, migration and training for customers.
- **Hosting providers**: may host LibreHR under the trademark with a partner agreement (`TRADEMARKS.md`).

Terms are to be defined.

## Contributing

All contributions, in Community or `ee/`, require the [CLA](../CLA.md) plus the DCO sign-off. See `CONTRIBUTING.md`.
