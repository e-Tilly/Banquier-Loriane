/**
 * Library sync. The client sends everything it has; the server merges it with what it holds
 * (last-writer-wins per entry, tombstones included) and returns the result. Because the merge
 * is commutative and idempotent, clients can retry freely and sync in any order.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../context.ts";
import { parseBody, UUID_RE } from "../http.ts";
import { requireUser } from "../middleware.ts";
import { compact, emptyLibrary, mergeLibraries, parseLibrary, isSaved, type Library } from "../../user/library.ts";

const Put = z.object({ library: z.unknown() });

export function libraryRoutes(d: Deps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  app.get("/", async (c) => {
    const { rows } = await d.pool.query(`SELECT data FROM libraries WHERE user_id = $1`, [c.get("user")!.id]);
    return c.json({ library: rows[0] ? parseLibrary(rows[0].data) : emptyLibrary() });
  });

  app.put("/", async (c) => {
    const body = await parseBody(c, Put);
    if (!body.ok) return body.response;
    const incoming = parseLibrary(body.data.library);
    const userId = c.get("user")!.id;
    const now = d.now ? d.now() : new Date();

    const client = await d.pool.connect();
    let merged: Library;
    try {
      await client.query("BEGIN");
      // Row lock: two devices syncing at the same moment must not overwrite each other.
      await client.query(
        `INSERT INTO libraries (user_id, data) VALUES ($1, '{"saves":{},"lists":{}}') ON CONFLICT DO NOTHING`, [userId]);
      const { rows } = await client.query(`SELECT data FROM libraries WHERE user_id = $1 FOR UPDATE`, [userId]);
      merged = compact(mergeLibraries(parseLibrary(rows[0]?.data), incoming), now);
      await client.query(`UPDATE libraries SET data = $2, updated_at = $3 WHERE user_id = $1`,
        [userId, JSON.stringify(merged), now]);
      await syncSavesTable(client, userId, merged);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (/library_size/.test(String(err))) return c.json({ error: "library_too_large" }, 413);
      throw err;
    } finally {
      client.release();
    }
    return c.json({ library: merged });
  });

  return app;
}

/**
 * Keep the relational `saves` table in step with the library. The outreach agent counts saves
 * per venue over the last 30 days, so each row keeps the time the user actually saved — not the
 * time of the sync, which would fake a surge every time a phone reconnects.
 */
async function syncSavesTable(client: { query: (q: string, p?: unknown[]) => Promise<unknown> }, userId: string, lib: Library): Promise<void> {
  const saved = Object.entries(lib.saves)
    .filter(([id]) => UUID_RE.test(id) && isSaved(lib, id))
    .map(([id, e]) => ({ id, at: e.at }));
  const ids = saved.map((s) => s.id);
  await client.query(`DELETE FROM saves WHERE user_id = $1 AND NOT (activity_id = ANY($2::uuid[]))`, [userId, ids]);
  if (!saved.length) return;
  // Only activities that still exist: a save of something since removed must not fail the sync.
  await client.query(
    `INSERT INTO saves (user_id, activity_id, created_at)
     SELECT $1, s.id::uuid, s.at::timestamptz
       FROM jsonb_to_recordset($2::jsonb) AS s(id text, at text)
       JOIN activities a ON a.id = s.id::uuid
     ON CONFLICT (user_id, activity_id) DO NOTHING`,
    [userId, JSON.stringify(saved)]);
}
