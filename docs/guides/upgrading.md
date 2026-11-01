# Upgrading OpenHR

All OpenHR database migrations are designed to be forward-only and safe to run on populated production databases without downtime.

## Standard Upgrade Workflow

1. **Create a fresh pre-upgrade backup:**

   ```bash
   ./infra/scripts/backup.sh /var/backups/openhr
   ```

2. **Pull latest release / code:**

   ```bash
   git pull origin main
   # or pull latest release container tags
   docker compose -f infra/compose/docker-compose.yml pull
   ```

3. **Run database migrations:**

   ```bash
   pnpm db:migrate
   ```

   _Note: OpenHR migrations use PostgreSQL advisory locks to guarantee that multiple concurrent instances will not execute duplicate migrations simultaneously._

4. **Restart services:**

   ```bash
   docker compose -f infra/compose/docker-compose.yml up -d
   ```

5. **Verify health:**
   ```bash
   curl -f http://localhost:3001/readyz
   ```
