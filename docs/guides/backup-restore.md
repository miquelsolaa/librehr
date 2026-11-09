# Backup and Restore Procedures

Regular database backups and quarterly recovery drills are mandatory to maintain data integrity and regulatory compliance.

## 1. Automated Backups

LibreHR provides an automated backup script at `infra/scripts/backup.sh`.

### Manual Backup

```bash
export DATABASE_URL="postgres://librehr:password@localhost:5432/librehr"
./infra/scripts/backup.sh /var/backups/librehr
```

### Scheduling with Cron

Add the following line to `/etc/cron.d/librehr-backup` to run daily at 02:00 UTC:

```cron
0 2 * * * root DATABASE_URL="postgres://librehr:password@localhost:5432/librehr" /opt/librehr/infra/scripts/backup.sh /var/backups/librehr >> /var/log/librehr-backup.log 2>&1
```

---

## 2. Restore Procedure

> [!CAUTION]
> Restoring a database will overwrite existing tables in the target database. Always take a pre-restore snapshot before proceeding.

1. **Stop web, api, and worker containers:**

   ```bash
   docker compose --env-file .env -f infra/compose/docker-compose.yml stop web api worker
   ```

2. **Execute restore script:**

   ```bash
   export DATABASE_URL="postgres://librehr:password@localhost:5432/librehr"
   ./infra/scripts/restore.sh /var/backups/librehr/librehr_backup_YYYYMMDD_HHMMSS.sql.gz
   ```

3. **Verify restored data and RLS integrity:**

   ```bash
   pnpm doctor
   ```

4. **Restart application services:**
   ```bash
   docker compose --env-file .env -f infra/compose/docker-compose.yml start api worker web
   ```
