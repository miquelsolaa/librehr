import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { primaryId, organizationIdCol } from "./common.js";
import { organizations } from "./platform.js";
import { employees } from "./people.js";

// DOC-001: Documents metadata table
export const documents = pgTable(
  "documents",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    employeeId: uuid("employee_id").references(() => employees.id, {
      onDelete: "cascade",
    }), // null for company-wide documents (DOC-002)
    title: text("title").notNull(),
    category: text("category").notNull(), // contracts, payslips, certificates, company_policies, other
    description: text("description"),
    audienceType: text("audience_type").notNull().default("individual"), // individual, company, department, location
    targetDepartmentId: uuid("target_department_id"),
    targetLocationId: uuid("target_location_id"),
    createdById: uuid("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    // DOC-001 soft delete: set on DELETE; rows and files stay until the
    // retention job (ADM-005) purges them. The actor is in the audit log.
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("documents_org_idx").on(table.organizationId),
    index("documents_employee_idx").on(table.employeeId),
    index("documents_category_idx").on(table.category),
    index("documents_live_org_idx")
      .on(table.organizationId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

// DOC-001, DOC-004: Document versions and encrypted storage references
export const documentVersions = pgTable(
  "document_versions",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull().default(1),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256Hash: text("sha256_hash").notNull(),
    uploadedById: uuid("uploaded_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("document_versions_document_idx").on(table.documentId),
    index("document_versions_org_idx").on(table.organizationId),
  ],
);

// DOC-006: Employee read receipt / acknowledgement log
export const documentAcknowledgements = pgTable(
  "document_acknowledgements",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    acknowledgedAt: timestamp("acknowledged_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("document_acks_document_idx").on(table.documentId),
    index("document_acks_employee_idx").on(table.employeeId),
  ],
);

// DOC-007: Document templates with merge fields (contracts, certificates, letters)
export const documentTemplates = pgTable(
  "document_templates",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    category: text("category").notNull(), // contracts, certificates, letters, policies, other
    description: text("description"),
    content: text("content").notNull(), // Template text / markdown with {{tags}}
    createdById: uuid("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("doc_templates_org_idx").on(table.organizationId),
    index("doc_templates_category_idx").on(table.category),
  ],
);
