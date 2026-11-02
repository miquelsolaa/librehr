import { pgTable, text, uuid, index, boolean } from "drizzle-orm/pg-core";
import { primaryId, timestamps, organizationIdCol } from "./common.js";

export const organizations = pgTable(
  "organizations",
  {
    id: primaryId(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    defaultLocale: text("default_locale").notNull().default("ca"),
    timezone: text("timezone").notNull().default("Europe/Madrid"),
    requireTwoFactor: boolean("require_two_factor").default(false).notNull(),
    ...timestamps,
  },
  (table) => [index("organizations_slug_idx").on(table.slug)],
);

export const legalEntities = pgTable(
  "legal_entities",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    taxId: text("tax_id").notNull(), // CIF / NIF
    country: text("country").notNull().default("ES"),
    ...timestamps,
  },
  (table) => [index("legal_entities_org_idx").on(table.organizationId)],
);

export const locations = pgTable(
  "locations",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    country: text("country").notNull().default("ES"),
    region: text("region").notNull().default("CT"), // Autonomous Community (e.g. CT = Catalunya)
    city: text("city").notNull(),
    timezone: text("timezone").notNull().default("Europe/Madrid"),
    ...timestamps,
  },
  (table) => [index("locations_org_idx").on(table.organizationId)],
);
