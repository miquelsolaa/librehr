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
  integer,
  check,
  foreignKey,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
    // SHA-256 hex of the bearer token (hashBearerToken); never the raw token.
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

// AUTH-001: single-use password reset links (0040). Global, like users.
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 hex of the emailed token (hashBearerToken); never the raw token.
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("password_reset_tokens_user_idx").on(table.userId, table.createdAt),
    index("password_reset_tokens_created_idx").on(table.createdAt),
  ],
);

// Shared rate-limit and lockout counters (migration 0038, issue #35). A
// global system table like sessions: pre-auth and cross-tenant, so no
// organization_id and no RLS. `key` is an HMAC digest, never a raw value.
// The table's storage parameter (fillfactor = 70) is set in the migration
// only; drizzle does not model it.
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    count: integer("count").notNull(),
    lockedUntil: timestamp("locked_until", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    index("rate_limit_buckets_expires_at_idx").on(table.expiresAt),
    check(
      "rate_limit_buckets_key_digest",
      sql`${table.key} ~ '^[0-9a-f]{64}$'`,
    ),
    check("rate_limit_buckets_count_nonnegative", sql`${table.count} >= 0`),
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
    // TIM-008: access ends at this instant (auditors); NULL means no end (0029).
    accessExpiresAt: timestamp("access_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
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
    // SHA-256 hex of the bearer token (hashBearerToken); never the raw token.
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
    // TIM-008: auditor access end date, copied to the membership on accept.
    accessExpiresAt: timestamp("access_expires_at", {
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

// AUTH-004 (0044): single-use OIDC sign-in requests. Global table without
// RLS, like sessions; consumed only through librehr_auth_sso_consume.
export const ssoLoginRequests = pgTable(
  "sso_login_requests",
  {
    id: primaryId(),
    // SHA-256 hex of the `state` value (hashBearerToken); never the raw value.
    stateHash: text("state_hash").notNull().unique(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ssoConfigurationId: uuid("sso_configuration_id")
      .notNull()
      .references(() => ssoConfigurations.id, { onDelete: "cascade" }),
    issuerUrl: text("issuer_url").notNull(),
    clientId: text("client_id").notNull(),
    nonce: text("nonce").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    locale: text("locale").notNull().default("ca"),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("sso_login_requests_created_idx").on(table.createdAt),
    index("sso_login_requests_config_idx").on(table.ssoConfigurationId),
    check(
      "sso_login_requests_locale_check",
      sql`${table.locale} IN ('ca', 'es', 'en')`,
    ),
  ],
);

// AUTH-004 (0044): identity provider subject linked to a member. Tenant
// table; rows are created only by librehr_auth_sso_resolve_user.
export const ssoIdentities = pgTable(
  "sso_identities",
  {
    id: primaryId(),
    organizationId: organizationIdCol(),
    userId: uuid("user_id").notNull(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "sso_identities_membership_fk",
      columns: [table.organizationId, table.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }).onDelete("cascade"),
    unique("sso_identities_subject_unique").on(
      table.organizationId,
      table.issuer,
      table.subject,
    ),
    unique("sso_identities_user_unique").on(
      table.organizationId,
      table.issuer,
      table.userId,
    ),
  ],
);
