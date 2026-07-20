import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

const bindings = env as unknown as { DB?: D1Database };

export function getDb() {
  if (!bindings.DB) throw new Error("Cloudflare D1 binding DB is unavailable");
  return drizzle(bindings.DB, { schema });
}

export async function ensureSchema() {
  const d1 = bindings.DB;
  if (!d1) throw new Error("Cloudflare D1 binding DB is unavailable");
  await d1.batch([
    d1.prepare("CREATE TABLE IF NOT EXISTS profiles (user_email TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY NOT NULL, user_email TEXT NOT NULL, share_token TEXT NOT NULL UNIQUE, title TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS trips_user_email_idx ON trips (user_email)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS trips_share_token_idx ON trips (share_token)"),
  ]);
}
