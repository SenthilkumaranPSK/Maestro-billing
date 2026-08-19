-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bills" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bill_number" TEXT NOT NULL,
    "customer_id" INTEGER,
    "mm_customer_id" INTEGER,
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
    "service_dates" TEXT,
    "gst_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "is_inter_state" BOOLEAN NOT NULL DEFAULT false,
    "vehicle_no" TEXT,
    "despatched_through" TEXT,
    "destination" TEXT,
    "other_reference" TEXT,
    "eway_bill_no" TEXT,
    "irn_no" TEXT,
    "consignee_name" TEXT,
    "consignee_address" TEXT,
    "consignee_gstin" TEXT,
    "series" TEXT NOT NULL DEFAULT 'MAIN',
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "bills_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "bills_mm_customer_id_fkey" FOREIGN KEY ("mm_customer_id") REFERENCES "mm_customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "bills_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_bills" ("bill_date", "bill_number", "consignee_address", "consignee_gstin", "consignee_name", "created_at", "created_by", "customer_id", "deleted_at", "despatched_through", "destination", "discount_amount", "due_date", "eway_bill_no", "grand_total", "gst_amount", "gst_inclusive", "id", "irn_no", "mm_customer_id", "notes", "other_reference", "payment_mode", "series", "service_dates", "service_description", "service_from", "service_to", "status", "sub_total", "updated_at", "vehicle_no") SELECT "bill_date", "bill_number", "consignee_address", "consignee_gstin", "consignee_name", "created_at", "created_by", "customer_id", "deleted_at", "despatched_through", "destination", "discount_amount", "due_date", "eway_bill_no", "grand_total", "gst_amount", "gst_inclusive", "id", "irn_no", "mm_customer_id", "notes", "other_reference", "payment_mode", "series", "service_dates", "service_description", "service_from", "service_to", "status", "sub_total", "updated_at", "vehicle_no" FROM "bills";
DROP TABLE "bills";
ALTER TABLE "new_bills" RENAME TO "bills";
CREATE UNIQUE INDEX "bills_bill_number_key" ON "bills"("bill_number");
CREATE INDEX "bills_bill_date_idx" ON "bills"("bill_date");
CREATE INDEX "bills_customer_id_idx" ON "bills"("customer_id");
CREATE INDEX "bills_mm_customer_id_idx" ON "bills"("mm_customer_id");
CREATE INDEX "bills_series_idx" ON "bills"("series");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
