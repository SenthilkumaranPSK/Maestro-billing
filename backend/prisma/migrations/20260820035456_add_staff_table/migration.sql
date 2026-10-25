-- CreateTable
CREATE TABLE "staff" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- Seed the two staff members that were previously hardcoded in
-- frontend/src/lib/staff.ts, with the SAME ids they had there — any bill
-- already saved with billedById 1 or 2 under the old hardcoded list must
-- keep resolving to the same person after this migration.
INSERT INTO "staff" ("id", "name", "sort_order", "is_active", "updated_at") VALUES
  (1, 'YUVARAJ V', 0, true, CURRENT_TIMESTAMP),
  (2, 'PANDIYAN I', 1, true, CURRENT_TIMESTAMP);
