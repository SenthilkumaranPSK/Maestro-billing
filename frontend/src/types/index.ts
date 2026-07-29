export interface User {
  id: number;
  username: string;
  role: 'admin' | 'staff';
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  gstin?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** MM billing module's own customer database — separate from Customer above. */
export interface MmCustomer {
  id: number;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  gstin?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: number;
  name: string;
  description?: string;
  unit: string;
  unitPrice: number; // paise
  gstRate: number;
  hsnSac?: string;
  isActive: boolean;
}

/** MM billing module's own product catalog — separate from Product above. */
export interface MmProduct {
  id: number;
  name: string;
  unit: string;
  unitPrice: number; // paise
  gstRate: number;
  hsnSac?: string;
  isActive: boolean;
}

/** Reusable catalog entry feeding the Service Description autocomplete on A4 invoices. */
export interface Service {
  id: number;
  name: string;
  isActive: boolean;
}

export interface BillItem {
  id: number;
  billId: number;
  productId?: number;
  productName: string;
  hsnSac?: string;
  unit: string;
  qty: number;
  unitPrice: number; // paise
  gstRate: number;
  gstAmount: number; // paise
  totalAmount: number; // paise
}

export interface Payment {
  id: number;
  billId: number;
  amount: number; // paise
  paymentMode: PaymentMode;
  transactionRef?: string;
  paidAt: string;
  notes?: string;
}

export type BillStatus = 'DRAFT' | 'PAID' | 'PARTIAL' | 'CANCELLED';

/** Badge color per status — single source so every screen shows the same colors. */
export const billStatusVariant: Record<BillStatus, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  PAID: 'success',
  DRAFT: 'secondary',
  PARTIAL: 'warning',
  CANCELLED: 'destructive',
};
export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'CHEQUE';

export interface Bill {
  id: number;
  billNumber: string;
  customerId?: number;
  customer?: Customer;
  // MM billing module only — see Bill.mmCustomerId in schema.prisma.
  mmCustomerId?: number;
  mmCustomer?: MmCustomer;
  billDate: string;
  dueDate?: string;
  subTotal: number; // paise
  gstAmount: number; // paise
  discountAmount: number; // paise
  grandTotal: number; // paise
  status: BillStatus;
  paymentMode?: PaymentMode;
  notes?: string;
  // A4 "Service Bill" layout only — see backend schema.prisma Bill model.
  serviceDescription?: string;
  serviceFrom?: string;
  serviceTo?: string;
  // Arbitrary list of service dates, replacing the old from/to range — see
  // backend schema.prisma Bill.serviceDates.
  serviceDates?: string[];
  // Whether item prices were entered GST-inclusive (tax extracted from the
  // sticker price) or GST-exclusive (tax added on top, the default).
  gstInclusive: boolean;
  // MM/A4 "Tax Invoice" layout only — see backend schema.prisma Bill model.
  vehicleNo?: string;
  despatchedThrough?: string;
  destination?: string;
  otherReference?: string;
  ewayBillNo?: string;
  irnNo?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  consigneeGstin?: string;
  // 'MAIN' (Thermal/A4, the studio's normal billing) or 'MM' (the separate
  // MM billing module) — see backend schema.prisma Bill.series.
  series?: 'MAIN' | 'MM';
  items: BillItem[];
  payments: Payment[];
  createdAt: string;
}

export interface BillItemForm {
  _id: string;           // stable React key (UI-only, not sent to API)
  productId?: number;
  productName: string;
  hsnSac?: string;
  unit: string;
  qty: number;
  unitPrice: number; // rupees (UI layer)
  gstRate: number;
}

export interface Settings {
  studio: {
    studio_name: string;
    studio_owner: string;
    studio_address: string;
    studio_phone: string;
    studio_email: string;
    studio_gstin: string;
  };
  invoice: {
    invoice_prefix: string;
    invoice_footer: string;
  };
  tax: {
    gst_enabled: string;
    default_gst_rate: string;
  };
  printer: {
    thermal_printer_name: string;
    thermal_paper_width: string;
  };
  general: {
    currency_symbol: string;
    currency_code: string;
    // 'false' hides the WhatsApp checkbox/buttons on the New Bill screen.
    // Missing (older installs that predate this setting) or any other value
    // means "show" — this must default to today's behaviour, not opt-in.
    show_whatsapp_on_billing: string;
  };
  // MM billing module's own settings group — separate from tax above (MM's
  // default GST rate is independent of the studio's regular one).
  mm: {
    mm_default_gst_rate: string;
  };
}

// Single source of truth for the show_whatsapp_on_billing convention — only
// the literal string 'false' hides it; missing (older installs) or any
// other value means "show". Used by both BillingPage (New Bill) and
// Settings (the toggle itself) so they can't silently disagree.
export function shouldShowWhatsappOnBilling(general: Pick<Settings['general'], 'show_whatsapp_on_billing'> | undefined): boolean {
  return general?.show_whatsapp_on_billing !== 'false';
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    // Only set by /bills — true when total exceeds what this response
    // actually returned (e.g. a report requesting "everything" via a large
    // limit hit the server's hard cap). Existing pages already compute this
    // themselves (total > data.length); this is the same signal, exposed by
    // the API directly.
    capped?: boolean;
  };
}

// Monetary utilities
const PLACEHOLDER = '—';

export const paisaToRupee = (paise: number | null | undefined): number => {
  // Return 0 (not NaN) for non-finite input so callers can safely do math
  // without NaN propagation. formatCurrency handles the display case
  // separately by returning the em-dash placeholder.
  if (paise == null || !Number.isFinite(paise)) return 0;
  return paise / 100;
};

export const rupeeToPaisa = (rupee: number): number => Math.round(rupee * 100);
export const formatCurrency = (paise: number | null | undefined, symbol = '₹'): string => {
  if (paise == null || !Number.isFinite(paise)) return PLACEHOLDER;
  return `${symbol}${paisaToRupee(paise).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
