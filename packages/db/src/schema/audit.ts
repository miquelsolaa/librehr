import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { primaryId, organizationIdCol } from "./common.js";
import { organizations } from "./platform.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    actorId: uuid("actor_id"),
    action: text("action").notNull(), // e.g. auth.login, employee.read_sensitive, time.correct
    entityType: text("entity_type"), // e.g. user, employee, leave_request
    entityId: uuid("entity_id"),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    details: jsonb("details"),
    metadata: jsonb("metadata"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    prevHash: text("prev_hash"), // SHA-256 tamper-evident chain
    hash: text("hash"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_log_org_idx").on(table.organizationId),
    index("audit_log_created_idx").on(table.createdAt),
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
  ],
);
