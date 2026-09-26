/**
 * Database lifecycle, cross-platform (no psql required).
 *
 *   npm run db:migrate          apply every migration not yet applied, in order
 *   npm run db:reset            drop everything, migrate, seed  (dev only — refuses in prod)
 *   npm run db:seed             load db/seed/*.sql
 *
 * Migrations are plain SQL files in db/migrations, applied once each and recorded in
 * schema_migrations. 003_postgis.sql is skipped unless ALENTOUR_POSTGIS=1, because Stage 1
 * deliberately does not require PostGIS (see docs/alentour/09-architecture.md).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { syncTags } from "../src/taxonomy/sync.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const MIGRATIONS = path.join(ROOT, "db/migrations");
const SEEDS = path.join(ROOT, "db/seed");

export async function migrate(pool: pg.Pool, log = console.log): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
  );
  const applied: string[] = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    if (file.includes("postgis") && process.env.ALENTOUR_POSTGIS !== "1") continue;
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
      log(`  ✓ ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  // The taxonomy YAML is the source of truth for tags; keep the table in step with it.
  const n = await syncTags(pool);
  if (applied.length) log(`  ✓ ${n} taxonomy tags synced`);
  return applied;
}

export async function seed(pool: pg.Pool, log = console.log): Promise<void> {
  for (const file of readdirSync(SEEDS).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(SEEDS, file), "utf8"));
    log(`  ✓ seed ${file}`);
  }
}

export async function reset(pool: pg.Pool, log = console.log): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV === "production" || /prod/i.test(url)) {
    throw new Error("Refusing to reset what looks like a production database.");
  }
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool, log);
  await seed(pool, log);
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "migrate";
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (cmd === "migrate") await migrate(pool);
    else if (cmd === "seed") await seed(pool);
    else if (cmd === "reset") await reset(pool);
    else throw new Error(`Unknown command: ${cmd} (migrate | seed | reset)`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
