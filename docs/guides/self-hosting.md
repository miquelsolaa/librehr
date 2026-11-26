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
sessions. Recovery is an operator procedure for accounts that cannot use the
self-service reset. Everyone else resets their own password from the sign-in
page ("Forgot your password?"): the emailed link expires in 1 hour, works
once, signs the account out everywhere and revokes its personal access
tokens, and the reset is recorded in the audit log of each organization the
account belongs to. Reset links older than 30 days are deleted whenever a new
one is requested. Self-service reset
needs `SMTP_HOST` and `APP_URL`; without them, requests are accepted but no
email is sent.

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
   | `SCHEDULER_*`            | no       | Worker job scheduler: on by default; see [the job scheduler guide](job-scheduler.md)                                              |

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
- [ ] If you run several API replicas, give them all the same `SESSION_SECRET`. Rate limits and lockouts (sign-in, two-factor, kiosk PINs, setup, exports) are kept in Postgres (`rate_limit_buckets`) and shared by every replica, timed by the database clock. Their keys are HMACs under a key derived from `SESSION_SECRET`, so replicas with different secrets count separately: rotating the secret resets every counter and lockout, and during a rolling rotation (old and new secret both serving) each client briefly gets up to twice its budget. The API refuses to start in production without `SESSION_SECRET`. IPv6 clients are counted per /64 network, IPv4 clients per address. A large site whose users all reach the API from one IPv6 /64 therefore shares one per-IP budget, as users behind one IPv4 NAT address already do; the per-account limits are unaffected. If Postgres is unreachable, rate-limited routes such as sign-in fail closed with a 500 rather than skip the limit. Kiosk PIN attempts are reserved per identifier and per client IP before the PIN is checked, so a burst across replicas never checks more PINs than those limits allow; a correct PIN, or an attempt refused because its identifier is locked, gives the IP's attempt back, so a shared kiosk's normal clock-ins never use up the site's failure budget. The correct PIN that reaches the IP limit locks the IP for as long as it takes to check it; attempts from that IP refused in that moment get a `Retry-After` of at most 3 seconds, and any refusal while a lock is under 3 seconds old does too (a lock that stays reports its full remaining time on the next try).
- [ ] Set `TRUST_PROXY` to the exact number of reverse proxies in front of the API (`1` with the bundled Caddy).
- [ ] Ensure database port 5432 is not exposed to the public internet (bind to internal Docker network only).
- [ ] Run `pnpm doctor` or verify RLS is forced on all tenant tables.
- [ ] Setup daily automated backups using `infra/scripts/backup.sh`.
- [ ] Configure outbound SMTP settings to deliver transactional invites and password resets.
- [ ] If the API host may only reach the internet through a forward proxy, allow direct outbound HTTPS for webhook deliveries (see [Outbound webhooks](#outbound-webhooks-and-proxies)).

### Outbound webhooks and proxies

Webhook deliveries only go to public `https://` addresses. The API resolves the webhook host once, checks every address it resolves to (no loopback, private, link-local or cloud metadata ranges, including their IPv6 and IPv4-mapped forms), and then connects straight to one of those checked addresses. The `Host` header, TLS SNI and certificate check still use the hostname, certificate verification cannot be turned off (`NODE_TLS_REJECT_UNAUTHORIZED` is ignored for webhooks), and redirects are never followed.

By design, webhook delivery **does not use `HTTP_PROXY` / `HTTPS_PROXY`**: a proxy would resolve the hostname again and could reach an address that was never checked. If your network only allows egress through a proxy, open direct outbound HTTPS (port 443) from the API container to your webhook receivers, or webhook deliveries will fail.

`WEBHOOKS_ALLOW_PRIVATE=true` (development only, refused in production) also allows `http://` and private addresses; the connection is still pinned to the address resolved before sending.

## 2a. Editions and licence key

LibreHR runs as the **Community** edition (AGPL) by default, and every core and legal-compliance feature works without a key. To unlock **Business** features (see [`docs/editions.md`](../editions.md)), set the licence key you received:

```bash
LIBREHR_LICENSE_KEY=eyJ2IjoxLC...signature
```

- The key is verified **offline** against a public key built into LibreHR. The instance never contacts a licence server.
- `GET /v1/edition` shows the active edition. Admins also see the licensee and expiry date.
- If the key is missing, invalid or expired, the API logs a warning (without the key) and runs as Community. Data stored by Business features is kept and comes back when a valid key is set again.
- `LIBREHR_LICENSE_PUBLIC_KEY` exists only for development and testing and is refused when `NODE_ENV=production`.

For development, create a throwaway keypair and key with `pnpm --filter @librehr/ee issue-license -- --generate-keypair <dir>` and then `-- --private-key <dir>/license-private.pem --licensee "Dev" --features sso --expires 2030-01-01T00:00:00Z`. Keep that directory outside the repository.

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

## 4. Upgrading from Postgres 16 to Postgres 18

> [!WARNING]
> Releases before this one ran Postgres 16. This release runs Postgres 18 and
> stores its data in a **new volume** (`postgres18_data`). Postgres does not
> read the data of an older major version, so your data does not move by
> itself. If you only pull and run `up -d`, LibreHR starts on an **empty
> database** and the API creates a new, empty schema in it. Your old data
> stays in the old volume (`postgres_data`), untouched, but it is not used.
> Follow the steps below instead.

The upgrade is a dump and restore. It needs downtime: plan a few minutes per
gigabyte of data. The commands below run from the repository root and use the
production compose file:

```bash
COMPOSE="docker compose --env-file .env -f infra/compose/docker-compose.yml"
```

1. **Dump everything from the Postgres 16 container.** Do this **before** you
   pull the new release, while the old stack still runs. Stop the
   application first, so nothing writes during the dump:

   ```bash
   $COMPOSE stop web api worker
   umask 077
   $COMPOSE exec -T postgres sh -c 'pg_dumpall -U "$POSTGRES_USER"' > librehr-pg16.sql
   ```

   `pg_dumpall` saves every database and the roles with their password
   hashes. The file holds personal data: keep it readable only by the
   operator, and delete it once the upgrade is done.

   Write down a few row counts to compare later:

   ```bash
   $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (SELECT count(*) FROM organizations) AS orgs, (SELECT count(*) FROM employees) AS employees, (SELECT count(*) FROM time_events) AS time_events, (SELECT count(*) FROM leave_ledger) AS leave_ledger;"'
   ```

2. **Stop the old stack.** Do **not** pass `-v`: that deletes the volumes.

   ```bash
   $COMPOSE down
   ```

3. **Switch to the new release.** Pull the code (or release tag) that runs
   Postgres 18. It changes the image to `postgres:18-alpine` and mounts the
   new volume at `/var/lib/postgresql`.

   ```bash
   git pull origin main
   ```

4. **Start only Postgres.** On the empty volume, the init script creates the
   LibreHR roles and the database again, from the same `.env` passwords.

   ```bash
   $COMPOSE up -d postgres
   $COMPOSE ps postgres   # wait until it reports "healthy"
   ```

5. **Restore the dump.**

   ```bash
   $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres' < librehr-pg16.sql
   ```

   A few `already exists` errors are expected: for the bootstrap role,
   `librehr_owner`, `librehr_app` and the `librehr` database, which the init
   script created in step 4. Any other error means the restore is not
   complete. Stop and investigate before you start the application.

6. **Verify.** Run the row counts from step 1 again and compare them. Check
   the server version:

   ```bash
   $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tc "SELECT version();"'
   ```

   Then start the stack and check health:

   ```bash
   $COMPOSE up -d
   curl -f https://hr.example.com/readyz
   pnpm doctor
   ```

   Sign in and open a few employees, time records and leave balances.

7. **Clean up.** Keep the old volume until you are sure. To roll back, check
   out the previous release and start it: it still uses the old volume. When
   you no longer need it, find it with `docker volume ls` (the name ends in
   `postgres_data`) and remove it with `docker volume rm`. Delete
   `librehr-pg16.sql` as well.

**Backups after the upgrade.** `infra/scripts/backup.sh` runs `pg_dump` on
the host. `pg_dump` must be at least as new as the server, so install the
Postgres 18 client tools on the host, or run the dump inside the container
as in step 1.

**Alternative: `pg_upgrade`.** For large databases, `pg_upgrade` is faster
than a dump and restore. It needs the binaries of both versions in one
place, which the official images do not ship, and it is easier to get
wrong. Postgres 18 also turns on data checksums by default for new
clusters, and `pg_upgrade` needs both clusters to match: initialise the new
cluster with `--no-data-checksums`, or turn checksums on in the old cluster
first with `pg_checksums`. Follow the Postgres documentation for
`pg_upgrade` and take a dump first either way.
