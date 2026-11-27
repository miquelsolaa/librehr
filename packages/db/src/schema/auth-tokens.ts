import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { primaryId } from "./common.js";
import { users } from "./identity.js";

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

// AUTH-001: single-use email verification links (0043). Global, like users.
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The address the link was sent to; it verifies only while users.email matches.
    email: text("email").notNull(),
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
    index("email_verification_tokens_user_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("email_verification_tokens_created_idx").on(table.createdAt),
  ],
);
