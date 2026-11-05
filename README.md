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
  <a href="https://github.com/miquelsolaa/librehr">
    <img src="docs/images/banner.png" alt="LibreHR â€” Open-Source HRIS for European SMBs" width="100%">
  </a>

  <p align="center">
    Open-source (AGPL-3.0), self-hostable, multi-tenant Human Resources Information System (HRIS) designed for European SMBs, starting with Spain and Catalonia.
    <br />
    <a href="docs/index.md"><strong>Explore the docs Â»</strong></a>
    &middot;
    <a href="docs/brand.md">Brand Assets</a>
    <br />
    <br />
    <a href="http://localhost:3000">View Demo</a>
    &middot;
    <a href="https://github.com/miquelsolaa/librehr/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/miquelsolaa/librehr/issues/new?labels=enhancement">Request Feature</a>
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

> [!IMPORTANT]
> **Clean-Room Guarantee:** LibreHR is designed and built strictly from first principles, public statutory law, and generic domain expertise. It is not affiliated with, nor copied from, any commercial HR vendor. See [`CLEANROOM.md`](CLEANROOM.md).

LibreHR is a self-hostable HR information system for small and medium-sized organizations, starting with Spain and Catalonia. The project is under active development; available screens and their limitations are listed in the [functionality inventory](docs/functionality.md).

- **People and organization:** employee directory, profiles, departments, locations, and an organization chart.
- **Time off and working time:** leave requests and balances, team calendars, clock events, timesheets, and configurable schedules and coverage rules.
- **Documents and onboarding:** employee documents and checklist views, with API capabilities documented in the inventory.
- **Privacy and localization:** tenant-aware access controls and interfaces in Catalan, Spanish, and English.

Reporting and gestoria exports are currently unavailable while their calculations are corrected. Time records still have local-date and overnight-shift limitations. Do not treat the current implementation as a guarantee of legal compliance; see [COMPLIANCE.md](COMPLIANCE.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Screenshots

These screenshots show the current application with **fictional mock data** supplied locally for the captures. They are illustrations of the interface, not evidence that all workflows or integrations are complete. Reports show their current unavailable state. See the [functionality inventory](docs/functionality.md) for limitations and planned screens.

Some captured time and reports screens contain existing compliance and official-export wording that has not been verified; it should not be read as a compliance claim.

To regenerate the gallery, run the web app locally on port 3109, then run `node scripts/capture-readme.cjs` from the repository root. Set `SCREENSHOT_BASE_URL` to use another local URL. The capture script intercepts API requests with fictional responses; it does not require production data.

<details>
<summary>Getting started</summary>

**Sign in**

[![Sign in screen](docs/images/screens/sign-in.png)](docs/images/screens/sign-in.png)

**Setup**

[![Setup screen](docs/images/screens/setup.png)](docs/images/screens/setup.png)

**Invitation**

[![Invitation screen](docs/images/screens/invitation.png)](docs/images/screens/invitation.png)

</details>

<details>
<summary>People and organization</summary>

**Home**

[![Home screen](docs/images/screens/home.png)](docs/images/screens/home.png)

**People directory**

[![People directory screen](docs/images/screens/people.png)](docs/images/screens/people.png)

**Employee profile**

[![Employee profile screen](docs/images/screens/profile.png)](docs/images/screens/profile.png)

**Organization chart**

[![Organization chart screen](docs/images/screens/org-chart.png)](docs/images/screens/org-chart.png)

</details>

<details>
<summary>Time off and working time</summary>

**Time off**

[![Time off screen](docs/images/screens/time-off.png)](docs/images/screens/time-off.png)

**Request time off**

[![Request time off screen](docs/images/screens/leave-request.png)](docs/images/screens/leave-request.png)

**Team absence calendar**

[![Team absence calendar screen](docs/images/screens/calendar.png)](docs/images/screens/calendar.png)

**Time tracking**

[![Time tracking screen](docs/images/screens/time.png)](docs/images/screens/time.png)

**Time corrections**

[![Time corrections screen](docs/images/screens/time-corrections.png)](docs/images/screens/time-corrections.png)

**Time export**

[![Time export screen](docs/images/screens/time-export.png)](docs/images/screens/time-export.png)

**Shift roster**

[![Shift roster screen](docs/images/screens/shifts.png)](docs/images/screens/shifts.png)

**Kiosk**

[![Kiosk screen](docs/images/screens/kiosk.png)](docs/images/screens/kiosk.png)

</details>

<details>
<summary>Documents, onboarding and reports</summary>

**Documents**

[![Documents screen](docs/images/screens/documents.png)](docs/images/screens/documents.png)

**Onboarding**

[![Onboarding screen](docs/images/screens/onboarding.png)](docs/images/screens/onboarding.png)

**Reports (currently unavailable)**

[![Reports (currently unavailable) screen](docs/images/screens/reports.png)](docs/images/screens/reports.png)

</details>

<details>
<summary>Administration</summary>

**Settings**

[![Settings screen](docs/images/screens/settings.png)](docs/images/screens/settings.png)

**Departments and coverage**

[![Departments and coverage screen](docs/images/screens/settings-departments.png)](docs/images/screens/settings-departments.png)

**Legal entities and locations**

[![Legal entities and locations screen](docs/images/screens/settings-locations.png)](docs/images/screens/settings-locations.png)

**Schedules**

[![Schedules screen](docs/images/screens/settings-time.png)](docs/images/screens/settings-time.png)

**Custom fields**

[![Custom fields screen](docs/images/screens/settings-custom-fields.png)](docs/images/screens/settings-custom-fields.png)

**Security**

[![Security screen](docs/images/screens/settings-security.png)](docs/images/screens/settings-security.png)

**Single sign-on**

[![Single sign-on screen](docs/images/screens/settings-sso.png)](docs/images/screens/settings-sso.png)

**API tokens**

[![API tokens screen](docs/images/screens/settings-tokens.png)](docs/images/screens/settings-tokens.png)

**Webhooks**

[![Webhooks screen](docs/images/screens/settings-webhooks.png)](docs/images/screens/settings-webhooks.png)

</details>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Architecture Overview

LibreHR separates presentation, orchestration, background workers, and domain calculations across a strict dependency boundary:

```text
Browser
   |
Reverse proxy
   |-- UI routes --> Next.js web app -- typed API client --+
   |-- /v1/* ----------------------------------------------+--> Hono API
                                                               |-- PostgreSQL (tenant data and job queue)
                                                               |-- Object storage
PostgreSQL job queue --> Background worker --> SMTP gateway
```

The diagram is plain text so it remains readable in Markdown viewers that do not render Mermaid. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

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
   git clone https://github.com/miquelsolaa/librehr.git
   cd librehr
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

- **Admin:** `admin@librehr.local`
- **Manager:** `manager@librehr.local`
- **Employee:** `employee@librehr.local`

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->

## Usage

### Quality Verification

Before committing code or opening a pull request, run the comprehensive verification suite:

```sh
pnpm verify
```

This pipeline runs the following checks:

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

LibreHR contains work across people, leave, time tracking, documents, onboarding, reporting, and administration. Implementation and review are ongoing; a feature's presence in the code does not imply that every related workflow is complete.

See the [functionality inventory](docs/functionality.md) for current coverage and known gaps, and [ROADMAP.md](ROADMAP.md) and [PRD.md](PRD.md) for planned requirements.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Because LibreHR manages sensitive employment data and adheres to European legal standards, all contributions must respect our architectural boundaries and clean-room policy:

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

[contributors-shield]: https://img.shields.io/github/contributors/miquelsolaa/librehr.svg?style=for-the-badge
[contributors-url]: https://github.com/miquelsolaa/librehr/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/miquelsolaa/librehr.svg?style=for-the-badge
[forks-url]: https://github.com/miquelsolaa/librehr/network/members
[stars-shield]: https://img.shields.io/github/stars/miquelsolaa/librehr.svg?style=for-the-badge
[stars-url]: https://github.com/miquelsolaa/librehr/stargazers
[issues-shield]: https://img.shields.io/github/issues/miquelsolaa/librehr.svg?style=for-the-badge
[issues-url]: https://github.com/miquelsolaa/librehr/issues
[license-shield]: https://img.shields.io/badge/License-AGPL_v3-blue.svg?style=for-the-badge
[license-url]: https://www.gnu.org/licenses/agpl-3.0
[ci-shield]: https://img.shields.io/github/actions/workflow/status/miquelsolaa/librehr/ci.yml?branch=main&style=for-the-badge&label=CI
[ci-url]: https://github.com/miquelsolaa/librehr/actions
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
