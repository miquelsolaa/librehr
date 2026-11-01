# Backup and Restore Procedures

Regular database backups and quarterly recovery drills are mandatory to maintain data integrity and regulatory compliance.

## 1. Automated Backups

OpenHR provides an automated backup script at `infra/scripts/backup.sh`.

### Manual Backup

```bash
export DATABASE_URL="postgres://openhr:password@localhost:5432/openhr"
./infra/scripts/backup.sh /var/backups/openhr
```

### Scheduling with Cron

Add the following line to `/etc/cron.d/openhr-backup` to run daily at 02:00 UTC:

```cron
0 2 * * * root DATABASE_URL="postgres://openhr:password@localhost:5432/openhr" /opt/openhr/infra/scripts/backup.sh /var/backups/openhr >> /var/log/openhr-backup.log 2>&1
```

---

## 2. Restore Procedure

> [!CAUTION]
> Restoring a database will overwrite existing tables in the target database. Always take a pre-restore snapshot before proceeding.

1. **Stop web, api, and worker containers:**

   ```bash
   docker compose -f infra/compose/docker-compose.yml stop web api worker
   ```

2. **Execute restore script:**

   ```bash
   export DATABASE_URL="postgres://openhr:password@localhost:5432/openhr"
   ./infra/scripts/restore.sh /var/backups/openhr/openhr_backup_YYYYMMDD_HHMMSS.sql.gz
   ```

3. **Verify restored data and RLS integrity:**

   ```bash
   pnpm doctor
   ```

4. **Restart application services:**
   ```bash
   docker compose -f infra/compose/docker-compose.yml start api worker web
   ```
