-- AlterTable
ALTER TABLE "bill_items" ADD COLUMN "hsn_sac" TEXT;

-- AlterTable
ALTER TABLE "bills" ADD COLUMN "service_description" TEXT;
ALTER TABLE "bills" ADD COLUMN "service_from" DATETIME;
ALTER TABLE "bills" ADD COLUMN "service_to" DATETIME;

-- AlterTable
ALTER TABLE "products" ADD COLUMN "hsn_sac" TEXT;
