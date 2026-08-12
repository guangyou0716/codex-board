import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// ponytail: one JSON row keeps private V1 writes simple; normalize task and
// activity tables when multi-user concurrency or server-side filtering matters.
export const boardState = sqliteTable("board_state", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
