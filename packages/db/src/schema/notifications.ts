import { pgTable, text, uuid, boolean, index } from "drizzle-orm/pg-core";
import { primaryId, organizationIdCol, timestamps } from "./common.js";
import { organizations } from "./platform.js";
import { users } from "./identity.js";

export const notifications = pgTable(
  "notifications",
  {
    id: primaryId(),
    organizationId: organizationIdCol().references(() => organizations.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").notNull(), // leave_request, leave_decision, time_record, system
    link: text("link"),
    read: boolean("read").default(false).notNull(),
    ...timestamps,
  },
  (table) => [
    index("notifications_org_user_idx").on(table.organizationId, table.userId),
    index("notifications_read_idx").on(table.userId, table.read),
  ],
);
