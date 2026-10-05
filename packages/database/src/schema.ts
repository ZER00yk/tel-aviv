import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  jsonb,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import type { Json } from "@tell-aviv/shared";
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  googleSub: text("google_sub").unique(),
  email: text("email"),
  username: varchar("username", { length: 24 }).notNull().unique(),
  displayName: varchar("display_name", { length: 80 }).notNull(),
  avatar: text("avatar"),
  banner: text("banner"),
  bio: text("bio").notNull().default(""),
  status: text("status").notNull().default(""),
  xp: integer("xp").notNull().default(0),
  role: text("role").notNull().default("user"),
  settings: jsonb("settings")
    .$type<Record<string, Json>>()
    .notNull()
    .default({}),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
