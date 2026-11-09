import {
  pgTable,
  text,
  varchar,
  jsonb,
  boolean,
  timestamp,
  uuid,
  index,
  bigint,
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
    twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
    twoFactorSecret: text("two_factor_secret"),
    twoFactorRecoveryCodes: jsonb("two_factor_recovery_codes").$type<
      string[]
    >(),
    // AUTH-003: setup state until the first code is verified (0025b).
    twoFactorPendingSecret: text("two_factor_pending_secret"),
    twoFactorPendingRecoveryCodes: jsonb(
      "two_factor_pending_recovery_codes",
    ).$type<string[]>(),
    twoFactorPendingExpiresAt: timestamp("two_factor_pending_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    // AUTH-003: newest accepted TOTP time step; older or equal steps are replays (0025c).
    twoFactorLastStep: bigint("two_factor_last_step", { mode: "number" }),
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

export const invitations = pgTable(
  "invitations",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    email: text("email").notNull(),
    role: text("role").notNull().default("employee"),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    invitedById: uuid("invited_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...timestamps,
  },
  (table) => [
    index("invitations_token_idx").on(table.token),
    index("invitations_org_idx").on(table.organizationId),
  ],
);

export const personalAccessTokens = pgTable(
  "personal_access_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(), // sha256 hex
    prefix: varchar("prefix", { length: 16 }).notNull(), // e.g. lhr_live_...
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (table) => [
    index("pat_org_idx").on(table.organizationId),
    index("pat_user_idx").on(table.userId),
    index("pat_token_hash_idx").on(table.tokenHash),
  ],
);

export const ssoConfigurations = pgTable(
  "sso_configurations",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(), // google, microsoft, generic_oidc
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),
    issuerUrl: text("issuer_url").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    enforceSso: boolean("enforce_sso").default(false).notNull(),
    allowedDomains: jsonb("allowed_domains").$type<string[]>().notNull(),
    ...timestamps,
  },
  (table) => [
    index("sso_org_idx").on(table.organizationId),
    index("sso_provider_idx").on(table.provider),
  ],
);
