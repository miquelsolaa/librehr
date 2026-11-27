import { pgTable, text, uuid, integer, unique } from "drizzle-orm/pg-core";
import { primaryId, organizationIdCol, timestamps } from "./common.js";
import { organizations } from "./platform.js";
import { users } from "./identity.js";

// ADM-005: per-organization retention period overrides (migration 0042).
// A missing row means the default of packages/core/src/retention. The
// category list and the legal floors are CHECK constraints in the migration.
export const retentionPolicies = pgTable(
  "retention_policies",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    category: text("category").notNull(),
    retentionDays: integer("retention_days").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    unique("retention_policies_org_category_unique").on(
      table.organizationId,
      table.category,
    ),
  ],
);
