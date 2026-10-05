import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { User } from "@tell-aviv/shared";
const globalDb = globalThis as typeof globalThis & {
  tellAvivDb?: ReturnType<typeof postgres>;
  tellAvivOrmDb?: ReturnType<typeof postgres>;
};
const connection =
  process.env.DATABASE_URL ??
  "postgres://tellaviv:local-development-only@127.0.0.1:5432/tellaviv";
export const db =
  globalDb.tellAvivDb ??
  postgres(connection, { max: 10, idle_timeout: 20, connect_timeout: 10 });
// Drizzle changes postgres-js type serializers. Keep a separate pool so raw domain
// queries retain native JSON and timestamp handling rather than sharing mutation.
const ormDb =
  globalDb.tellAvivOrmDb ??
  postgres(connection, { max: 3, idle_timeout: 20, connect_timeout: 10 });
if (process.env.NODE_ENV !== "production") {
  globalDb.tellAvivDb = db;
  globalDb.tellAvivOrmDb = ormDb;
}
export const orm = drizzle(ormDb, { schema });
export async function closeDatabase() {
  await Promise.all([db.end(), ormDb.end()]);
}
export function mapUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    avatar: row.avatar as string | null,
    banner: row.banner as string | null,
    bio: String(row.bio),
    status: String(row.status),
    xp: Number(row.xp),
    role: row.role as User["role"],
    settings: (row.settings ?? {}) as User["settings"],
  };
}
export async function getUser(id: string): Promise<User | null> {
  const [row] = await db`SELECT * FROM users WHERE id=${id} AND disabled=false`;
  return row ? mapUser(row) : null;
}
