export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface BillItemInput {
  productId?: number;
  productName: string;
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
