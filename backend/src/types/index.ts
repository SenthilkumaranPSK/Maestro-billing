export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface BillItemInput {
  productId?: number;
  // MM billing module only — see schema.prisma BillItem.mmProductId.
  mmProductId?: number;
  productName: string;
  hsnSac?: string | null;
  unit: string;
  qty: number;
  unitPrice: number; // in paise
  gstRate: number;
}

export interface CreateBillInput {
  customerId?: number;
  // MM billing module only — see Bill.mmCustomerId in schema.prisma.
  mmCustomerId?: number;
  billDate: string;
  dueDate?: string;
  items: BillItemInput[];
  notes?: string;
  discountAmount?: number; // in paise
  roundOffAmount?: number; // in paise (positive = round up, negative = round down)
  // A4 "Service Bill" layout only — see Bill.serviceDescription in schema.prisma
  serviceDescription?: string;
  serviceFrom?: string;
  serviceTo?: string;
  // See Bill.serviceDates in schema.prisma
  serviceDates?: string[];
  // See Bill.gstInclusive in schema.prisma
  gstInclusive?: boolean;
  // MM/A4 "Tax Invoice" layout only — see the matching Bill fields in schema.prisma
  vehicleNo?: string;
  despatchedThrough?: string;
  destination?: string;
  otherReference?: string;
  ewayBillNo?: string;
  irnNo?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  consigneeGstin?: string;
  // Which billing area this bill belongs to — see Bill.series in schema.prisma.
  // Only meaningful on create; updateBill never changes it.
  series?: 'MAIN' | 'MM';
}

export interface SettingInput {
  key: string;
  value: string;
  group?: string;
}

// Monetary helpers — all DB values in paise
export function paisaToRupee(paise: number): number {
  return paise / 100;
}

export function rupeeToPaisa(rupee: number): number {
  return Math.round(rupee * 100);
}
