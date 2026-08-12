import { env } from "cloudflare:workers";

export function getD1() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  return env.DB;
}

export async function ensureDatabase() {
  const db = getD1();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS board_state (
        id TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    )
    .run();
  return db;
}
