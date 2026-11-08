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
docker compose -f infra/compose/docker-compose.yml exec api node apps/api/dist/src/cli/recover-account.js
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

   ```bash
   cp infra/env/.env.example .env
   ```

   Generate a secure random secret for authentication and encryption:

   ```bash
   openssl rand -base64 32
   ```

   Set `AUTH_SECRET=<generated_secret>` and secure passwords in `.env`.

3. **Start the stack:**

   ```bash
   docker compose -f infra/compose/docker-compose.yml up -d
   ```

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
