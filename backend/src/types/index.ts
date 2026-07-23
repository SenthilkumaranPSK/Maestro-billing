export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface BillItemInput {
  productId?: number;
  productName: string;
  hsnSac?: string | null;
  unit: string;
  qty: number;
  unitPrice: number; // in paise
  gstRate: number;
}

export interface CreateBillInput {
  customerId?: number;
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
  // See Bill.gstInclusive in schema.prisma
  gstInclusive?: boolean;
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
