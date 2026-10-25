-- AlterTable
ALTER TABLE "products" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "mm_products" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "services" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Backfill sort_order to match each table's current alphabetical order
-- (name, then id as a tiebreaker) — every row defaults to 0 above, so
-- without this every existing catalog would collapse to one arbitrary
-- (id) order the first time it's opened after upgrading, instead of
-- staying exactly as it looked until the operator actually uses Rearrange.
UPDATE "products" SET "sort_order" = (
  SELECT COUNT(*) FROM "products" p2
  WHERE p2."name" < "products"."name" OR (p2."name" = "products"."name" AND p2."id" < "products"."id")
);

UPDATE "mm_products" SET "sort_order" = (
  SELECT COUNT(*) FROM "mm_products" p2
  WHERE p2."name" < "mm_products"."name" OR (p2."name" = "mm_products"."name" AND p2."id" < "mm_products"."id")
);

UPDATE "services" SET "sort_order" = (
  SELECT COUNT(*) FROM "services" p2
  WHERE p2."name" < "services"."name" OR (p2."name" = "services"."name" AND p2."id" < "services"."id")
);
