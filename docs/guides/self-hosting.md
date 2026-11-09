# Self-Hosting LibreHR

Two-factor sign-in challenges require a unique `SESSION_SECRET` of at least
32 characters. Set it in the environment used by Docker Compose before
starting the API. Use the same secret on every API instance; rotating it
invalidates outstanding two-factor challenges. If it is missing or too short,
the API refuses to issue challenges rather than using a known default.

## Recover an account with a legacy plaintext password

Older versions stored some passwords without hashing. Those credentials are
rejected by the current sign-in implementation. An authorized instance
operator can assign a new password from an interactive terminal after verifying
the account owner's identity. Back up the database first, protect and expire
the backup according to your retention policy, and rebuild/redeploy the API
image with the current code. Then run:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml exec api node apps/api/dist/src/cli/recover-account.js
```

The command uses the API container's configured `DATABASE_URL`. It requires a
TTY, asks for the exact account email and confirmation, and reads the new
password twice without echoing it. Do not put the password in a command, an
environment variable, a ticket, or a log. The password must have at least
eight characters. The update and revocation of **all sessions for that user**,
including sessions in other organizations, occur in one transaction. Personal
access tokens and two-factor settings are unchanged; separately review or
revoke tokens as needed. This operator action does not create an in-app audit
entry, so record its authorization in your operator procedures without storing
the password. Resetting a password does not remove plaintext credentials from
old backups; secure and expire those backups under your retention policy.

This tool requires a database role permitted to update users and delete
sessions. Recovery is an operator procedure, not an employee self-service
password reset flow.

LibreHR is designed to be easily self-hostable on any standard Linux server, VPS, or cloud instance running Docker.

## System Requirements

- **OS:** Linux (Ubuntu 22.04+, Debian 12+, RHEL 9+)
- **CPU:** 2 vCPUs minimum
- **RAM:** 4 GB minimum (8 GB recommended for production)
- **Disk:** 20 GB SSD
- **Docker:** Engine 24+ and Docker Compose 2+

---

## 1. Quickstart with Docker Compose

1. **Clone the repository:**

   ```bash
   git clone https://github.com/miquelsolaa/librehr.git
   cd librehr
   ```

2. **Configure environment:**

   Create a `.env` file (keep it out of version control, readable only by the
   operator). The production compose file has **no defaults for secrets**: it
   refuses to start if any required variable is missing, and the API refuses to
   start in `NODE_ENV=production` if a secret is shorter than 32 characters or
   is one of the public development values from `.env.example`.

   Generate each secret separately (never reuse one value for two variables):

   ```bash
   openssl rand -base64 32
   ```

   | Variable                 | Required | Purpose                                                                           |
   | ------------------------ | -------- | --------------------------------------------------------------------------------- |
   | `POSTGRES_PASSWORD`      | yes      | Bootstrap superuser of the Postgres container                                     |
   | `LIBREHR_OWNER_PASSWORD` | yes      | `librehr_owner` role: owns the schema, runs migrations (not a superuser)          |
   | `LIBREHR_APP_PASSWORD`   | yes      | `librehr_app` role: runtime role, always bound by Row-Level Security              |
   | `BETTER_AUTH_SECRET`     | yes      | Signs sessions                                                                    |
   | `SESSION_SECRET`         | yes      | Signs two-factor sign-in challenges                                               |
   | `ENVELOPE_MASTER_KEY`    | yes      | Encrypts sensitive fields at rest. **Back it up: losing it loses that data**      |
   | `TIME_CHAIN_KEY`         | yes      | Keys the tamper-evidence chain of time-tracking events                            |
   | `BETTER_AUTH_URL`        | yes      | Public URL of the API                                                             |
   | `APP_URL`                | yes      | Public URL of the web app                                                         |
   | `SMTP_HOST`              | yes      | Your SMTP relay (`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` are optional) |

   The API also accepts `<NAME>_FILE` (for example `ENVELOPE_MASTER_KEY_FILE`)
   for the four application secrets, to use Docker secrets instead of plain
   environment variables. The bundled compose file passes plain variables;
   adapt it if you switch to `_FILE`.

   The role passwords are applied by `infra/postgres/init/00-roles.sh` only
   when the Postgres data volume is created for the first time. To change them
   later, use `ALTER ROLE ... PASSWORD` in `psql` and update `.env`.

3. **Start the stack:**

   ```bash
   docker compose --env-file .env -f infra/compose/docker-compose.yml up -d
   ```

   Upgrading from a release that used `postgres:16-alpine`: the compose files
   now use PostgreSQL 17. An existing 16 data volume does not start on 17;
   dump and restore it (see `backup-restore.md`) before switching images.

4. **Verify installation:**
   Visit `http://localhost:3000` or check system health:
   ```bash
   curl http://localhost:3001/healthz
   ```

---

## 2. Production Security Checklist

- [ ] Enforce HTTPS using Caddy or your reverse proxy (`infra/compose/Caddyfile.example`).
- [ ] Ensure database port 5432 is not exposed to the public internet (bind to internal Docker network only).
- [ ] Run `pnpm doctor` or verify RLS is forced on all tenant tables.
- [ ] Setup daily automated backups using `infra/scripts/backup.sh`.
- [ ] Configure outbound SMTP settings to deliver transactional invites and password resets.
