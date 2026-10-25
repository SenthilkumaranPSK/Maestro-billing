-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bill_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bill_id" INTEGER NOT NULL,
    "product_id" INTEGER,
    "mm_product_id" INTEGER,
    "product_name" TEXT NOT NULL,
    "hsn_sac" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "qty" REAL NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "gst_rate" REAL NOT NULL DEFAULT 0,
    "gst_amount" INTEGER NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bill_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "bill_items_mm_product_id_fkey" FOREIGN KEY ("mm_product_id") REFERENCES "mm_products" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_bill_items" ("bill_id", "created_at", "gst_amount", "gst_rate", "hsn_sac", "id", "product_id", "product_name", "qty", "total_amount", "unit", "unit_price", "updated_at") SELECT "bill_id", "created_at", "gst_amount", "gst_rate", "hsn_sac", "id", "product_id", "product_name", "qty", "total_amount", "unit", "unit_price", "updated_at" FROM "bill_items";
DROP TABLE "bill_items";
ALTER TABLE "new_bill_items" RENAME TO "bill_items";
CREATE TABLE "new_mm_products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Kgs',
    "unit_price" INTEGER NOT NULL,
    "gst_rate" REAL NOT NULL DEFAULT 5,
    "hsn_sac" TEXT DEFAULT '210690',
    "stock_qty" REAL NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_mm_products" ("created_at", "gst_rate", "hsn_sac", "id", "is_active", "name", "unit", "unit_price", "updated_at") SELECT "created_at", "gst_rate", "hsn_sac", "id", "is_active", "name", "unit", "unit_price", "updated_at" FROM "mm_products";
DROP TABLE "mm_products";
ALTER TABLE "new_mm_products" RENAME TO "mm_products";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
