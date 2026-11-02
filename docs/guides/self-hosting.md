# Self-Hosting LibreHR

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
