-- Stage 2+: add PostGIS once queries move server-side.
--
-- Purely additive — the lat/lon columns from 001 remain the source of truth and the geography
-- columns are generated from them, so nothing that reads lat/lon needs to change.
-- Do not run this in Stage 1; it is here so the path is obvious, not because it is needed yet.

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE venues
  ADD COLUMN geom geography(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED;

ALTER TABLE activity_locations
  ADD COLUMN geom geography(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) STORED;

CREATE INDEX venues_geom_gix             ON venues USING GIST (geom);
CREATE INDEX activity_locations_geom_gix ON activity_locations USING GIST (geom);

-- H3 cells for the shared candidate cache described in docs/alentour/05-discovery-and-ranking.md.
-- Populate from the application; there is no need for the h3 extension.
ALTER TABLE activity_locations ADD COLUMN h3_r7 bigint;
CREATE INDEX activity_locations_h3_ix ON activity_locations (h3_r7);
