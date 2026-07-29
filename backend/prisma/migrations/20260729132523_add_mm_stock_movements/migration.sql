-- CreateTable
CREATE TABLE "mm_stock_movements" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mm_product_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "qty_change" REAL NOT NULL,
    "balance_after" REAL NOT NULL,
    "bill_id" INTEGER,
    "supplier_name" TEXT,
    "purchase_cost" INTEGER,
    "invoice_ref" TEXT,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mm_stock_movements_mm_product_id_fkey" FOREIGN KEY ("mm_product_id") REFERENCES "mm_products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "mm_stock_movements_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_mm_products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Kgs',
    "unit_price" INTEGER NOT NULL,
    "gst_rate" REAL NOT NULL DEFAULT 5,
    "hsn_sac" TEXT DEFAULT '210690',
    "stock_qty" REAL NOT NULL DEFAULT 0,
    "reorder_level" REAL NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_mm_products" ("created_at", "gst_rate", "hsn_sac", "id", "is_active", "name", "stock_qty", "unit", "unit_price", "updated_at") SELECT "created_at", "gst_rate", "hsn_sac", "id", "is_active", "name", "stock_qty", "unit", "unit_price", "updated_at" FROM "mm_products";
DROP TABLE "mm_products";
ALTER TABLE "new_mm_products" RENAME TO "mm_products";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "mm_stock_movements_mm_product_id_idx" ON "mm_stock_movements"("mm_product_id");
