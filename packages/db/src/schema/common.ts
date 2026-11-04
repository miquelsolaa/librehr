import { timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const primaryId = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
};

export const organizationIdCol = () =>
  uuid("organization_id")
    .default(sql`NULLIF(current_setting('app.current_org', true), '')::uuid`)
    .notNull();
