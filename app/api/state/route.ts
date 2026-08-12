import { ensureDatabase } from "../../../db";
import { createSeedState, type AppState } from "../../state";

const STATE_ID = "default";

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppState>;
  return Array.isArray(candidate.repositories) && Array.isArray(candidate.tasks) && Array.isArray(candidate.activity);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected storage error";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const db = await ensureDatabase();
    const row = await db
      .prepare("SELECT payload FROM board_state WHERE id = ?1")
      .bind(STATE_ID)
      .first<{ payload: string }>();

    if (row?.payload) {
      return Response.json({ state: JSON.parse(row.payload) as AppState, persisted: true });
    }

    const state = createSeedState();
    await db
      .prepare("INSERT INTO board_state (id, payload) VALUES (?1, ?2)")
      .bind(STATE_ID, JSON.stringify(state))
      .run();
    return Response.json({ state, persisted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { state?: unknown };
    if (!isAppState(body.state)) {
      return Response.json({ error: "A valid Codex Board state is required." }, { status: 400 });
    }

    const serialized = JSON.stringify(body.state);
    if (serialized.length > 1_000_000) {
      return Response.json({ error: "Codex Board state is too large." }, { status: 413 });
    }

    const db = await ensureDatabase();
    await db
      .prepare(
        `INSERT INTO board_state (id, payload, updated_at)
         VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`
      )
      .bind(STATE_ID, serialized)
      .run();

    return Response.json({ state: body.state, persisted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
