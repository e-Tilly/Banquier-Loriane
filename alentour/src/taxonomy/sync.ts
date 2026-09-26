/**
 * Mirror taxonomy.yaml into the `tags` table.
 *
 * activity_tags references tags(slug), so every slug the taxonomy defines must exist as a row
 * before an owner, the enrichment pipeline or a seed file can use it. The YAML is the source of
 * truth; this upsert is idempotent and runs after every migration. Slugs removed from the YAML
 * are marked deprecated rather than deleted, so existing listings keep their history.
 */
import type pg from "pg";
import { loadTaxonomy } from "./load.ts";

export async function syncTags(pool: pg.Pool | pg.PoolClient): Promise<number> {
  const tax = loadTaxonomy();
  const rows = tax.facets.flatMap((f, fi) =>
    (f.tags ?? []).map((tag, ti) => ({
      slug: tag.slug,
      facet: f.key,
      labels: { "fr-CA": tag.fr, "en-CA": tag.en },
      filterable: f.filterable !== false,
      tristate: f.tristate === true,
      aiMayAssert: f.ai_may_assert !== false,
      sort: fi * 100 + ti,
    })));
  await pool.query(
    `INSERT INTO tags (slug, facet, label_i18n, is_filterable, is_tristate, ai_may_assert, sort_order, deprecated_at)
     SELECT r.slug, r.facet, r.labels, r.filterable, r.tristate, r.ai_may_assert, r.sort, NULL
       FROM jsonb_to_recordset($1::jsonb) AS r(slug text, facet text, labels jsonb, filterable boolean,
                                               tristate boolean, ai_may_assert boolean, sort integer)
     ON CONFLICT (slug) DO UPDATE SET
       facet = EXCLUDED.facet, label_i18n = EXCLUDED.label_i18n, is_filterable = EXCLUDED.is_filterable,
       is_tristate = EXCLUDED.is_tristate, ai_may_assert = EXCLUDED.ai_may_assert,
       sort_order = EXCLUDED.sort_order, deprecated_at = NULL`,
    [JSON.stringify(rows.map((r) => ({ ...r, ai_may_assert: r.aiMayAssert })))]);
  await pool.query(
    `UPDATE tags SET deprecated_at = COALESCE(deprecated_at, now()) WHERE NOT (slug = ANY($1::text[]))`,
    [rows.map((r) => r.slug)]);
  return rows.length;
}
