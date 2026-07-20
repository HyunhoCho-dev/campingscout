import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  userEmail: text("user_email").primaryKey(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const trips = sqliteTable("trips", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  shareToken: text("share_token").notNull().unique(),
  title: text("title").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("trips_user_email_idx").on(table.userEmail), index("trips_share_token_idx").on(table.shareToken)]);
