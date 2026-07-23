-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bills" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bill_number" TEXT NOT NULL,
    "customer_id" INTEGER,
    "bill_date" DATETIME NOT NULL,
    "due_date" DATETIME,
    "sub_total" INTEGER NOT NULL,
    "gst_amount" INTEGER NOT NULL DEFAULT 0,
    "discount_amount" INTEGER NOT NULL DEFAULT 0,
    "grand_total" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "payment_mode" TEXT,
    "notes" TEXT,
    "service_description" TEXT,
    "service_from" DATETIME,
    "service_to" DATETIME,
    "gst_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "bills_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "bills_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_bills" ("bill_date", "bill_number", "created_at", "created_by", "customer_id", "deleted_at", "discount_amount", "due_date", "grand_total", "gst_amount", "id", "notes", "payment_mode", "service_description", "service_from", "service_to", "status", "sub_total", "updated_at") SELECT "bill_date", "bill_number", "created_at", "created_by", "customer_id", "deleted_at", "discount_amount", "due_date", "grand_total", "gst_amount", "id", "notes", "payment_mode", "service_description", "service_from", "service_to", "status", "sub_total", "updated_at" FROM "bills";
DROP TABLE "bills";
ALTER TABLE "new_bills" RENAME TO "bills";
CREATE UNIQUE INDEX "bills_bill_number_key" ON "bills"("bill_number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
