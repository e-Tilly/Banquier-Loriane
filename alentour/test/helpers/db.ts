/**
 * Test databases. Each API test file gets its own database (alentour_test_<name>) on the server
 * named by DATABASE_URL, because node's test runner runs files in parallel.
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import { migrate, seed } from "../../scripts/db.ts";
import { MemoryMailer } from "../../src/api/mailer.ts";
import type { Deps } from "../../src/api/context.ts";
import type { ApiConfig } from "../../src/api/config.ts";

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

export async function freshDatabase(name: string): Promise<pg.Pool> {
  // Parsed with pg's own parser: socket-style URLs (postgres://u@/db?host=/tmp) are valid
  // connection strings that `new URL()` rejects.
  const base = parse(process.env.DATABASE_URL!) as pg.PoolConfig;
  const dbName = `alentour_test_${name.replace(/[^a-z0-9_]/g, "")}`;
  const admin = new pg.Pool({ ...base, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const pool = new pg.Pool({ ...base, database: dbName, max: 10 });
  await migrate(pool, () => {});
  await seed(pool, () => {});
  return pool;
}

export const TEST_CONFIG: ApiConfig = {
  secret: "test-secret-test-secret-test-secret-test",
  sessionDays: 30,
  codeTtlMinutes: 10,
  corsOrigins: ["*"],
  appleAudience: ["app.alentour.mobile"],
  googleAudience: ["google-client-id"],
  production: false,
};

/** A controllable clock. */
export class Clock {
  t: Date;
  constructor(t = new Date("2026-09-01T12:00:00Z")) { this.t = t; }
  now = () => new Date(this.t);
  advance(ms: number) { this.t = new Date(this.t.getTime() + ms); }
}

export function makeDeps(pool: pg.Pool, over: Partial<Deps> = {}): Deps & { mailer: MemoryMailer; clock: Clock } {
  const clock = new Clock();
  return { pool, mailer: new MemoryMailer(), config: TEST_CONFIG, now: clock.now, clock, ...over } as
    Deps & { mailer: MemoryMailer; clock: Clock };
}
