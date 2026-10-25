-- AlterTable
ALTER TABLE "bills" ADD COLUMN "consignee_address" TEXT;
ALTER TABLE "bills" ADD COLUMN "consignee_gstin" TEXT;
ALTER TABLE "bills" ADD COLUMN "consignee_name" TEXT;
ALTER TABLE "bills" ADD COLUMN "despatched_through" TEXT;
ALTER TABLE "bills" ADD COLUMN "destination" TEXT;
ALTER TABLE "bills" ADD COLUMN "eway_bill_no" TEXT;
ALTER TABLE "bills" ADD COLUMN "irn_no" TEXT;
ALTER TABLE "bills" ADD COLUMN "other_reference" TEXT;
ALTER TABLE "bills" ADD COLUMN "vehicle_no" TEXT;
