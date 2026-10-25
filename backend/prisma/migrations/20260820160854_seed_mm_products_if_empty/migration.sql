-- MM billing was introduced well after this app's first release, via a
-- schema-only migration (add_mm_products_and_bill_series) — the 16 sample
-- products that ship with it have only ever come from seed.ts, a manual
-- dev-only script (`npm run db:seed`) that never runs automatically. A
-- genuinely fresh install picks them up from desktop/template/studio.db
-- (which IS built by running seed.ts once at packaging time), but an
-- UPGRADE of an existing client install never touches that template at
-- all (see desktop/main.js prepareDataDir()) — it just runs pending
-- migrations against the studio's own real database, and no migration
-- before this one ever inserted these rows. Result: an already-installed
-- studio upgrading straight from before MM billing existed gets a
-- correctly-structured but completely empty mm_products table.
--
-- Guarded on the table being empty so this only ever helps that exact
-- case — a studio that has already added their own real MM products
-- (even just one) is left completely untouched.
INSERT INTO "mm_products" ("name", "unit", "unit_price", "gst_rate", "hsn_sac", "sort_order", "updated_at")
SELECT * FROM (VALUES
  ('Thenkuzhal Murukku', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Butter Muruku', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Spring Muruku', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Garlic Mixture', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Pepper Sev', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Sirai Pakkoda', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Kara Boondhi', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Madras Mixture', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Kara Sev', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Mini Kara Sev', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Mullu Murukku', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Bombay Mixture', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Double Ring Murukku', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Onion Murukku', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Baby Nippet Chilly', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP),
  ('Avul Mixture', 'Kgs', 12000, 5.0, '210690', 0, CURRENT_TIMESTAMP)
)
WHERE NOT EXISTS (SELECT 1 FROM "mm_products");
