/**
 * Notifications: an in-app inbox (the source of truth) plus a best-effort push copy through
 * Expo's push service, which needs no key and fronts both APNs and FCM.
 */
import type pg from "pg";

export interface PushMessage { to: string; title: string; body: string; data?: Record<string, unknown> }
export interface Pusher { send(messages: PushMessage[]): Promise<void> }

export class MemoryPusher implements Pusher {
  sent: PushMessage[] = [];
  async send(m: PushMessage[]) { this.sent.push(...m); }
}

export class ExpoPusher implements Pusher {
  fetchImpl: typeof fetch;
  constructor(fetchImpl: typeof fetch = fetch) { this.fetchImpl = fetchImpl; }
  async send(messages: PushMessage[]) {
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100).map((m) => ({ ...m, sound: "default" }));
      await this.fetchImpl("https://exp.host/--/api/v2/push/send", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(chunk),
      }).catch(() => {});                 // push is a copy of the inbox; never fail the caller
    }
  }
}

export type Text = { fr: string; en: string };

/** Notify users, each in their own language. */
export async function notify(
  pool: pg.Pool | pg.PoolClient, pusher: Pusher | undefined, userIds: string[],
  n: { kind: string; outingId?: string | null; title: Text; body: Text },
): Promise<void> {
  if (!userIds.length) return;
  const { rows } = await pool.query(
    `SELECT u.id, u.locale, array_remove(array_agg(t.token), NULL) AS tokens
       FROM users u LEFT JOIN push_tokens t ON t.user_id = u.id
      WHERE u.id = ANY($1::uuid[]) AND u.status = 'active' GROUP BY u.id`, [userIds]);
  const push: PushMessage[] = [];
  for (const u of rows) {
    const l = String(u.locale).startsWith("en") ? "en" : "fr";
    await pool.query(
      `INSERT INTO notifications (user_id, kind, outing_id, title, body) VALUES ($1, $2, $3, $4, $5)`,
      [u.id, n.kind, n.outingId ?? null, n.title[l], n.body[l]]);
    for (const to of u.tokens as string[]) push.push({ to, title: n.title[l], body: n.body[l], data: { outingId: n.outingId ?? null, kind: n.kind } });
  }
  if (pusher && push.length) await pusher.send(push);
}
