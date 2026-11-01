<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![License: AGPL-3.0][license-shield]][license-url]
[![CI Status][ci-shield]][ci-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/miquelsolaa/openhr">
    <img src="apps/web/public/icons/icon-192.svg" alt="OpenHR Logo" width="80" height="80">
  </a>

  <h3 align="center">OpenHR</h3>

  <p align="center">
    Open-source (AGPL-3.0), self-hostable, multi-tenant Human Resources Information System (HRIS) designed for European SMBs, starting with Spain and Catalonia.
    <br />
    <a href="docs/index.md"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="http://localhost:3000">View Demo</a>
    &middot;
    <a href="https://github.com/miquelsolaa/openhr/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/miquelsolaa/openhr/issues/new?labels=enhancement">Request Feature</a>
    &middot;
    <a href="docs/guides/self-hosting.md">Self-Hosting Guide</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#core-capabilities--compliance">Core Capabilities & Compliance</a></li>
        <li><a href="#architecture-overview">Architecture Overview</a></li>
        <li><a href="#monorepo-structure">Monorepo Structure</a></li>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation--setup">Installation & Setup</a></li>
        <li><a href="#default-ports--seed-accounts">Default Ports & Seed Accounts</a></li>
      </ul>
    </li>
    <li>
      <a href="#usage">Usage</a>
      <ul>
        <li><a href="#quality-verification">Quality Verification</a></li>
        <li><a href="#environment-doctor">Environment Doctor</a></li>
        <li><a href="#common-commands">Common Commands</a></li>
      </ul>
    </li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#security--compliance">Security & Compliance</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->

## About The Project

[![OpenHR Dashboard Preview][dashboard-light-screenshot]](https://github.com/miquelsolaa/openhr)

> [!IMPORTANT]
> **Clean-Room Guarantee:** OpenHR is designed and built strictly from first principles, public statutory law, and generic domain expertise. It is not affiliated with, nor copied from, any commercial HR vendor. See [`CLEANROOM.md`](CLEANROOM.md).

OpenHR is an open-source HRIS purpose-built to free European SMBs from proprietary vendor lock-in, recurring per-seat fees, and compliance anxiety. While most existing HR platforms are either US-centric SaaS solutions or legacy enterprise software, OpenHR provides modern, pleasant software built directly around European privacy and labor mandates:

- **Statutory Working Time Compliance:** Native support for mandatory daily time tracking (_registro de jornada_, Real Decreto-ley 8/2019) with immutable append-only records and SHA-256 tamper-evident hash chaining.
- **First-Class European Leave Management:** Ledger-based leave tracking (no mutable balance columns), half-days, location-based public holiday calendars (national, regional, and municipal), and strict statutory carry-over policies.
- **Privacy & GDPR by Design:** Fine-grained PostgreSQL Row-Level Security (RLS) ensuring strict multi-tenant isolation, AES-256-GCM envelope encryption for sensitive fields, structured ROPA templates, and zero third-party telemetry.
- **Trilingual Native Experience:** Fully symmetric language support across Catalan (`ca`), Spanish (`es`), and English (`en`).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Screenshots

<div align="center">

#### Modern Dashboard & Dark Mode

|                                    Light Theme                                    |                                   Dark Theme                                   |
| :-------------------------------------------------------------------------------: | :----------------------------------------------------------------------------: |
| [![Dashboard Light][dashboard-light-screenshot]](docs/images/dashboard-light.png) | [![Dashboard Dark][dashboard-dark-screenshot]](docs/images/dashboard-dark.png) |

#### Employee Management & Time Off

|                        Employee Directory                        |                      Statutory Leave & Balances                      |
| :--------------------------------------------------------------: | :------------------------------------------------------------------: |
| [![People Directory][people-screenshot]](docs/images/people.png) | [![Time Off & Leave][time-off-screenshot]](docs/images/time-off.png) |

#### First-Run Experience

|                    Setup & Legal Entity Wizard                    |                   Clean Authentication                    |
| :---------------------------------------------------------------: | :-------------------------------------------------------: |
| [![Setup Wizard][setup-screenshot]](docs/images/setup-wizard.png) | [![Sign In][sign-in-screenshot]](docs/images/sign-in.png) |

</div>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Architecture Overview

OpenHR separates presentation, orchestration, background workers, and domain calculations across a strict dependency boundary:

```mermaid
graph TD
    User["Web Browser / Mobile PWA"]
    Proxy["Reverse Proxy (Caddy / Nginx)"]
    Web["Next.js App Router (apps/web)"]
    API["Hono REST API (apps/api)"]
    Worker["pg-boss Worker (apps/worker)"]
    DB[("PostgreSQL 16 (Row-Level Security)")]
    Mail["SMTP Gateway (Mailpit / External)"]
    Storage["Object Storage (MinIO / Local)"]

    User --> Proxy
    Proxy -->|UI Routes| Web
    Proxy -->|/v1/* & /healthz| API
    Web -.->|Typed Client| API
    API -->|withTenant RLS Tx| DB
    API -->|Queue Jobs| DB
    Worker -->|Process Jobs| DB
    Worker -->|Send Emails| Mail
    API --> Storage
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Monorepo Structure

```
apps/
  web/          Next.js App Router frontend with i18n and dark mode
  api/          Hono REST API with OpenAPI contracts and Better Auth
  worker/       pg-boss background jobs processor with idempotency
packages/
  core/         Pure TypeScript domain logic (working-days, balances, hash chain)
  db/           Drizzle schema, PostgreSQL RLS policies, migrations, seeds
  contracts/    Shared Zod schemas, OpenAPI specs, typed API client
  ui/           Design system (shadcn/Radix-based), CSS tokens, Storybook
  i18n/         Catalogs (ca, es, en) and CI validation tools
  emails/       React Email templates (Invite, Password Reset)
  config/       Shared ESLint flat configs, Prettier, Tailwind preset
  testing/      Testcontainers helpers and test fixtures
infra/
  docker/       Multi-stage Dockerfiles for production containers
  compose/      Docker Compose files for production and development
  scripts/      Backup, restore, and environment doctor CLI
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

- [![Next.js][Next.js]][Next-url]
- [![TypeScript][TypeScript]][TypeScript-url]
- [![Hono][Hono]][Hono-url]
- [![PostgreSQL][PostgreSQL]][PostgreSQL-url]
- [![Drizzle ORM][Drizzle]][Drizzle-url]
- [![TailwindCSS][TailwindCSS]][Tailwind-url]
- [![Docker][Docker]][Docker-url]
- [![Turborepo][Turborepo]][Turborepo-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->

## Getting Started

Follow these steps to set up a local development environment.

### Prerequisites

- **Node.js** `>= 22.0.0`
- **pnpm** `>= 10.0.0` (enable via `corepack enable`)
- **Docker & Docker Compose** (for PostgreSQL, Mailpit, and MinIO)

### Installation & Setup

1. **Clone the repository:**

   ```sh
   git clone https://github.com/openhr-project/openhr.git
   cd openhr
   ```

2. **Install dependencies:**

   ```sh
   pnpm install
   ```

3. **Configure environment variables:**

   ```sh
   cp infra/env/.env.example .env
   ```

4. **Start local infrastructure (Postgres 16, Mailpit, MinIO):**

   ```sh
   pnpm infra:up
   ```

5. **Run database migrations and seed sample data:**

   ```sh
   pnpm db:migrate
   pnpm db:seed
   ```

6. **Start all development services:**
   ```sh
   pnpm dev
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Default Ports & Seed Accounts

Once started, the following services and endpoints are accessible:

| Service / App             | URL                                                                            | Description                              |
| :------------------------ | :----------------------------------------------------------------------------- | :--------------------------------------- |
| **Web Frontend**          | [http://localhost:3000](http://localhost:3000)                                 | Next.js App Router user interface        |
| **REST API**              | [http://localhost:3001](http://localhost:3001)                                 | Hono REST API                            |
| **API Health**            | [http://localhost:3001/healthz](http://localhost:3001/healthz)                 | Health check endpoint                    |
| **OpenAPI Specification** | [http://localhost:3001/v1/openapi.json](http://localhost:3001/v1/openapi.json) | Interactive OpenAPI / Swagger schema     |
| **Mailpit Web UI**        | [http://localhost:8025](http://localhost:8025)                                 | Local SMTP inspector for outbound emails |

#### Development Seed Accounts

The development database seeds sample organizations and test accounts with the default development password: `Password123!`

- **Admin:** `admin@openhr.local`
- **Manager:** `manager@openhr.local`
- **Employee:** `employee@openhr.local`

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->

## Usage

### Quality Verification

Before committing code or opening a pull request, run the comprehensive verification suite:

```sh
pnpm verify
```

This pipeline guarantees high code quality and strict boundaries:

1. `pnpm typecheck` &mdash; Strict TypeScript typecheck across all 11 packages and apps.
2. `pnpm lint` &mdash; ESLint checks enforcing import directions and coding standards.
3. `pnpm test` &mdash; Unit and property-based test suites with coverage.
4. `pnpm test:int` &mdash; Integration tests validating multi-tenant RLS isolation.
5. `pnpm i18n:check` &mdash; Validates full key symmetry across Catalan, Spanish, and English catalogs.
6. `turbo run build` &mdash; Production builds of all apps and packages.

### Environment Doctor

Run the built-in diagnostic tool to check your environment, dependencies, and database connection:

```sh
pnpm run doctor
```

### Common Commands

| Command                   | Purpose                                                |
| :------------------------ | :----------------------------------------------------- |
| `pnpm dev`                | Start web, api, and worker processes concurrently      |
| `pnpm infra:up`           | Spin up Postgres, Mailpit, and MinIO in Docker         |
| `pnpm db:migrate`         | Apply forward-only schema migrations                   |
| `pnpm db:generate`        | Generate Drizzle migration from schema changes         |
| `pnpm db:reset`           | Reset database and re-run migrations                   |
| `pnpm db:seed`            | Seed development tenants, users, and holiday calendars |
| `pnpm contracts:generate` | Regenerate OpenAPI specifications and typed API client |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->

## Roadmap

- [x] **M0 - Foundations:** Monorepo architecture, Docker infra stack, PostgreSQL RLS tenancy harness, auth skeleton, design tokens, trilingual i18n pipeline, and seed data.
- [ ] **M1 - People:** Setup wizard, employee directory & profiles, invitations, role-based authorization, and immutable audit logging.
- [ ] **M2 - Time Off:** Leave requests, approval chains, cancellation flows, append-only balance ledgers, and official holiday calendars.
- [ ] **M3 - Time Tracking:** Compliant daily time records (_jornada_), SHA-256 tamper-evident hash chaining, schedule assignment, and missing clock-out background jobs.
- [ ] **M4 - Documents & Lifecycle:** Employee document vault, bulk payslip distribution, onboarding checklists, and GDPR data subject request (DSR) export tools.
- [ ] **M5 - Insights, Hardening & v1.0:** Workforce reporting, performance audits, penetration testing, signed production container images, and v1.0 release candidate.

See the full [ROADMAP.md](ROADMAP.md) and [PRD.md](PRD.md) for detailed requirements and milestones.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Because OpenHR manages sensitive employment data and adheres to European legal standards, all contributions must respect our architectural boundaries and clean-room policy:

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feat/amazing-feature`)
3. Commit your Changes with DCO Sign-off (`git commit -s -m 'feat(leave): add amazing feature'`)
4. Verify all tests and checks pass (`pnpm verify`)
5. Push to the Branch (`git push origin feat/amazing-feature`)
6. Open a Pull Request completing the **clean-room attestation**

Please review [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CLEANROOM.md`](CLEANROOM.md), and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) before submitting your first contribution.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->

## License

Distributed under the **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE) for details.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- SECURITY & COMPLIANCE -->

## Security & Compliance

- **Security:** For security inquiries or vulnerability reports, please review [`SECURITY.md`](SECURITY.md) or use GitHub Private Vulnerability Reporting.
- **Compliance Documentation:** Detailed compliance records, breach response runbooks, DPIA templates, and ROPA templates are documented in [`COMPLIANCE.md`](COMPLIANCE.md) and the [`docs/compliance/`](docs/compliance/) directory.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->

## Acknowledgments

- [othneildrew/Best-README-Template](https://github.com/othneildrew/Best-README-Template) &mdash; for the README template and inspiration
- [Choose an Open Source License](https://choosealicense.com/)
- [PostgreSQL Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Hono](https://hono.dev/)
- [pg-boss](https://github.com/timgit/pg-boss)
- [Radix UI](https://www.radix-ui.com/)
- [Shields.io](https://shields.io/)
- [Testcontainers](https://testcontainers.com/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[contributors-shield]: https://img.shields.io/github/contributors/miquelsolaa/openhr.svg?style=for-the-badge
[contributors-url]: https://github.com/miquelsolaa/openhr/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/miquelsolaa/openhr.svg?style=for-the-badge
[forks-url]: https://github.com/miquelsolaa/openhr/network/members
[stars-shield]: https://img.shields.io/github/stars/miquelsolaa/openhr.svg?style=for-the-badge
[stars-url]: https://github.com/miquelsolaa/openhr/stargazers
[issues-shield]: https://img.shields.io/github/issues/miquelsolaa/openhr.svg?style=for-the-badge
[issues-url]: https://github.com/miquelsolaa/openhr/issues
[license-shield]: https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=for-the-badge
[license-url]: https://www.gnu.org/licenses/agpl-3.0
[ci-shield]: https://img.shields.io/github/actions/workflow/status/miquelsolaa/openhr/ci.yml?branch=main&style=for-the-badge&label=CI
[ci-url]: https://github.com/miquelsolaa/openhr/actions
[dashboard-light-screenshot]: docs/images/dashboard-light.png
[dashboard-dark-screenshot]: docs/images/dashboard-dark.png
[setup-screenshot]: docs/images/setup-wizard.png
[time-off-screenshot]: docs/images/time-off.png
[people-screenshot]: docs/images/people.png
[sign-in-screenshot]: docs/images/sign-in.png
[Next.js]: https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[Next-url]: https://nextjs.org/
[TypeScript]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Hono]: https://img.shields.io/badge/Hono-E36002?style=for-the-badge&logo=hono&logoColor=white
[Hono-url]: https://hono.dev/
[PostgreSQL]: https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white
[PostgreSQL-url]: https://www.postgresql.org/
[Drizzle]: https://img.shields.io/badge/Drizzle_ORM-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black
[Drizzle-url]: https://orm.drizzle.team/
[TailwindCSS]: https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white
[Tailwind-url]: https://tailwindcss.com/
[Docker]: https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white
[Docker-url]: https://www.docker.com/
[Turborepo]: https://img.shields.io/badge/Turborepo-EF4444?style=for-the-badge&logo=turborepo&logoColor=white
[Turborepo-url]: https://turbo.build/
