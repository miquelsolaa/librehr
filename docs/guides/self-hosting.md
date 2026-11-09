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

   Generate each secret separately (never reuse one value for two variables).
   Database role passwords (`POSTGRES_PASSWORD`, `LIBREHR_OWNER_PASSWORD`,
   `LIBREHR_APP_PASSWORD`) are placed inside `postgres://user:password@host`
   URLs, so generate them as hex, which is URL-safe:

   ```bash
   openssl rand -hex 32      # database role passwords
   openssl rand -base64 32   # all other secrets
   ```

   Base64 output can contain `/` and `+`, which break URL parsing. If you choose
   a database password yourself, URL-encode it wherever it appears in a URL
   (`/` as `%2F`, `+` as `%2B`, `@` as `%40`, ...). The API and worker refuse to
   start with an unparseable database URL (the error names the variable, never
   its value).

   | Variable                 | Required | Purpose                                                                                                                           |
   | ------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
   | `POSTGRES_PASSWORD`      | yes      | Bootstrap superuser of the Postgres container (hex)                                                                               |
   | `LIBREHR_OWNER_PASSWORD` | yes      | `librehr_owner` role: owns the schema, runs migrations and the worker (hex)                                                       |
   | `LIBREHR_APP_PASSWORD`   | yes      | `librehr_app` role: runtime role, always bound by Row-Level Security (hex)                                                        |
   | `BETTER_AUTH_SECRET`     | yes      | Validated at startup (unique, 32+ characters) but not used by the current release                                                 |
   | `SESSION_SECRET`         | yes      | Signs two-factor sign-in challenges                                                                                               |
   | `ENVELOPE_MASTER_KEY`    | yes      | Encrypts sensitive fields at rest. **Back it up: losing it loses that data**                                                      |
   | `TIME_CHAIN_KEY`         | yes      | Keys the tamper-evidence chain of time records (api and worker). **Keep it: changing it makes existing records unverifiable**     |
   | `BETTER_AUTH_URL`        | yes      | Public origin of the API. With the bundled Caddyfile, the same value as `APP_URL` (production refuses a `localhost` value)        |
   | `APP_URL`                | yes      | Public URL of the web app, e.g. `https://hr.example.com` (production refuses a `localhost` value)                                 |
   | `DOMAIN`                 | yes      | Host name Caddy serves and requests a certificate for: the host of `APP_URL`, e.g. `hr.example.com`                               |
   | `PUBLIC_API_URL`         | no       | Browser-facing API URL baked into the web image. Leave empty (same origin); see [Public URLs](#public-urls-and-the-reverse-proxy) |
   | `SMTP_HOST`              | yes      | Your SMTP relay (`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` are optional)                                                 |

   In production the API also refuses a `DATABASE_URL` that connects as
   `librehr_owner`, as the migration role, or as the bootstrap superuser
   (`postgres` or `POSTGRES_USER`): requests must run as `librehr_app`.

   The API also accepts `<NAME>_FILE` (for example `ENVELOPE_MASTER_KEY_FILE`)
   for the four application secrets, to use Docker secrets instead of plain
   environment variables. The bundled compose file passes plain variables;
   adapt it if you switch to `_FILE`.

   Compose derives the database URLs from these passwords: the API serves
   requests as `librehr_app` (`DATABASE_URL`) and runs migrations as
   `librehr_owner` (`DATABASE_MIGRATION_URL`); the worker also uses
   `librehr_owner` because it owns the `pgboss` schema. Neither role is a
   superuser or has `BYPASSRLS`; the bootstrap superuser is only used by the
   init script. Upgrading an older install: see [upgrading.md](upgrading.md).

   `TRUST_PROXY` (optional, default `0`) is the number of reverse proxies in
   front of the API that append to `X-Forwarded-For`. The bundled compose file
   sets it to `1` for Caddy. The API rate-limits sign-in and two-factor
   attempts by client IP, taking the right-most address it did not get from a
   trusted proxy; with `0` it ignores the header and uses the socket address.
   Never set it higher than your real number of proxies, or clients can spoof
   their IP and escape the limit.

   The role passwords are applied by `infra/postgres/init/00-roles.sh` only
   when the Postgres data volume is created for the first time. To change them
   later, use `ALTER ROLE ... PASSWORD` in `psql` and update `.env`.

3. **Start the stack:**

   ```bash
   docker compose --env-file .env -f infra/compose/docker-compose.yml up -d
   ```

4. **Verify installation:**
   Only Caddy publishes ports; the web app and API are reached through it.
   Visit `APP_URL` or check system health:
   ```bash
   curl https://hr.example.com/healthz
   ```

### Public URLs and the reverse proxy

The bundled `Caddyfile.example` serves everything from **one origin**
(`https://$DOMAIN`): `/v1/*`, `/healthz` and `/readyz` go to the API, and
everything else to the web app. The browser therefore calls the API on the
web app's own origin, which the session cookie requires (it is `httpOnly`,
`Secure` and `SameSite`, so it is only sent reliably to the same site).

- Set `APP_URL` and `BETTER_AUTH_URL` to the same value, for example
  `https://hr.example.com`, and `DOMAIN` to `hr.example.com`.
- Leave `PUBLIC_API_URL` empty. The web image is then built so the browser
  sends API requests to relative `/v1/...` paths. The internal address
  `http://api:3001` only works between containers; a browser cannot reach it.
- `NEXT_PUBLIC_API_URL` (fed from `PUBLIC_API_URL`) is **inlined into the
  browser bundle when the web image is built**. Setting it on the running
  container has no effect. If you change it, rebuild the image:
  `docker compose --env-file .env -f infra/compose/docker-compose.yml build web`.
  Only set it if you serve the API from a different origin; that also needs
  the API's CORS configuration and cookie settings to allow it, which the
  bundled setup does not cover.
- The web app makes no server-side API calls, so it needs no internal API URL.

**SSO callback.** Register this redirect URI with your identity provider:

```
https://hr.example.com/v1/sso/callback
```

That is `APP_URL` (equal to `BETTER_AUTH_URL`) followed by `/v1/sso/callback`.
There is no `/api` prefix: the proxy forwards `/v1/*` to the API unchanged.

---

## 2. Production Security Checklist

- [ ] Enforce HTTPS using Caddy or your reverse proxy (`infra/compose/Caddyfile.example`). Session cookies are `Secure` when `NODE_ENV=production`, so the web app and API must be served over HTTPS from the same site (the bundled Caddyfile serves both from one origin).
- [ ] Run a single API instance. Rate limits for sign-in and two-factor are kept in memory per process; several replicas would each keep their own counters and multiply the limit.
- [ ] Set `TRUST_PROXY` to the exact number of reverse proxies in front of the API (`1` with the bundled Caddy).
- [ ] Ensure database port 5432 is not exposed to the public internet (bind to internal Docker network only).
- [ ] Run `pnpm doctor` or verify RLS is forced on all tenant tables.
- [ ] Setup daily automated backups using `infra/scripts/backup.sh`.
- [ ] Configure outbound SMTP settings to deliver transactional invites and password resets.

## 3. Background job data retention

The worker queues jobs in the `pgboss` schema. Job payloads are stored in those
tables until pg-boss deletes them, and email jobs carry personal data: the
recipient address and invitation or password-reset URLs. The worker sets every
queue to:

- **`retentionSeconds` = 7 days**: a job still waiting to run (created or
  retrying) is deleted after 7 days.
- **`deleteAfterSeconds` = 3 days**: a finished job (completed, cancelled or
  failed) is deleted 3 days after it finished. Inspect and re-drive failed
  jobs within that window.

The worker applies these values at startup, including to queues created by
earlier versions (`QUEUE_RETENTION` in `apps/worker/src/lib/queue-setup.ts`).
Database backups contain whatever job rows existed when they were taken, so
expire backups under your retention policy as well.
