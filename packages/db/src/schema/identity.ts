import {
  pgTable,
  text,
  boolean,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { primaryId, timestamps, organizationIdCol } from "./common.js";
import { organizations } from "./platform.js";

export const users = pgTable(
  "users",
  {
    id: primaryId(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    emailVerified: boolean("email_verified").default(false).notNull(),
    ...timestamps,
  },
  (table) => [index("users_email_idx").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("sessions_token_idx").on(table.token),
    index("sessions_user_idx").on(table.userId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("employee"), // admin, hr_admin, manager, employee, auditor
    ...timestamps,
  },
  (table) => [
    index("memberships_org_user_idx").on(table.organizationId, table.userId),
  ],
);

// TODO(AUTH-005): Invitations table for admin onboarding flow
export const invitationsStub = {
  table: "invitations",
  requirementId: "AUTH-005",
};

// TODO(ADM-006): API Personal Access Tokens table
export const apiTokensStub = {
  table: "api_tokens",
  requirementId: "ADM-006",
};
