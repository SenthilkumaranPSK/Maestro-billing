-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'staff',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "customers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "unit_price" INTEGER NOT NULL,
    "gst_rate" REAL NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "bills" (
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
    "created_by" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "bills_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "bills_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bill_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bill_id" INTEGER NOT NULL,
    "product_id" INTEGER,
    "product_name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "qty" REAL NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "gst_rate" REAL NOT NULL DEFAULT 0,
    "gst_amount" INTEGER NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bill_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bill_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "payment_mode" TEXT NOT NULL,
    "transaction_ref" TEXT,
    "paid_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'general',
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER,
    "old_value" TEXT,
    "new_value" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "bills_bill_number_key" ON "bills"("bill_number");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");
