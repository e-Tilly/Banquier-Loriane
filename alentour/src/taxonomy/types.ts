/** Types for the closed vocabulary in taxonomy/taxonomy.yaml. */

export interface TagDef {
  slug: string;
  fr: string;
  en: string;
  /** Excluded from home-screen shelves (kept in the catalog, e.g. category.family for an 18-30 audience). */
  shelf?: boolean;
  max_cents?: number | null;
}

export interface ScaleDef {
  key: string;
  range: [number, number];
  anchors_per_category?: boolean;
  drives_behaviour?: boolean;
  meanings?: Record<string, string>;
  notes?: string;
}

export interface FacetDef {
  key: string;
  filterable: boolean;
  tristate?: boolean;
  /** false => the enrichment pipeline may suggest but never assert these tags as true. */
  ai_may_assert?: boolean;
  derived?: boolean;
  cardinality?: string;
  max_per_activity?: number;
  tags?: TagDef[];
  scales?: ScaleDef[];
  reserved?: string[];
  notes?: string;
}

export interface ShelfDef {
  key: string;
  fr: string;
  en: string;
  filters: Record<string, unknown>;
  when?: Record<string, unknown>;
}

export interface Taxonomy {
  version: number;
  locales: string[];
  facets: FacetDef[];
  shelves: ShelfDef[];
}
