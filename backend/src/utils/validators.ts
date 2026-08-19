import { z } from 'zod';

// JS Date arithmetic silently rolls an out-of-range day into the next
// month/year instead of rejecting it (new Date(2026, 1, 31) just becomes
// March 3) — Date.parse() does the same for ISO-shaped strings. So neither
// isNaN(Date.parse(s)) nor a plain regex catches "2026-02-31". Every date
// string accepted from the outside world is validated with this helper
// against the YYYY-MM-DD portion so an impossible calendar date is rejected
// with a clean 400 instead of silently shifting to a different real date.
function isValidDateString(s: string): boolean {
  if (isNaN(Date.parse(s))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!match) return true;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

// Shared phone rule — used for customers and WhatsApp sends alike so the two
// paths can never drift apart on what counts as a valid number.
export const phoneSchema = z
  .string()
  .min(10, 'Valid phone required')
  .max(20, 'Phone too long')
  .regex(/^[\d\s+\-()]+$/, 'Phone contains invalid characters')
  // The length checks above cap the *string* (digits + formatting), so a
  // no-formatting run of 16+ digits still slid through as "valid" — cap the
  // actual digit count too, at the E.164 international max of 15.
  .refine((v) => {
    const digits = v.replace(/\D/g, '').length;
    return digits >= 10 && digits <= 15;
  }, 'Phone must have 10-15 digits');

export const customerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name too long'),
  phone: phoneSchema,
  email: z
    .string()
    .email()
    .max(1000, 'Email too long')
    .nullable()
    .optional()
    .or(z.literal('')),
  address: z.string().max(500, 'Address too long').nullable().optional(),
  gstin: z.string().max(15, 'GSTIN must be 15 characters or fewer').nullable().optional(),
  notes: z.string().max(2000, 'Notes too long').nullable().optional(),
});

// MM billing module's own customer database — separate from customerSchema
// above (see schema.prisma MmCustomer).
export const mmCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name too long'),
  phone: phoneSchema,
  email: z
    .string()
    .email()
    .max(1000, 'Email too long')
    .nullable()
    .optional()
    .or(z.literal('')),
  address: z.string().max(500, 'Address too long').nullable().optional(),
  gstin: z.string().max(15, 'GSTIN must be 15 characters or fewer').nullable().optional(),
  notes: z.string().max(2000, 'Notes too long').nullable().optional(),
});

export const productSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(200, 'Product name too long'),
  description: z.string().max(2000, 'Description too long').nullable().optional(),
  unit: z.string().min(1).max(20),
  unitPrice: z.number().int().nonnegative('Price cannot be negative'),
  gstRate: z.number().min(0).max(100),
  hsnSac: z.string().max(20, 'HSN/SAC too long').nullable().optional(),
  isActive: z.boolean().optional(),
});

// MM billing module's own product catalog — separate from productSchema
// above (see schema.prisma MmProduct).
export const mmProductSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(200, 'Product name too long'),
  unit: z.string().min(1).max(20),
  unitPrice: z.number().int().nonnegative('Price cannot be negative'),
  gstRate: z.number().min(0).max(100),
  hsnSac: z.string().max(20, 'HSN/SAC too long').nullable().optional(),
  // Allowed negative (an oversold product) — never validated as nonnegative.
  stockQty: z.number().optional(),
  // 0 means "no reorder alert configured" for this product.
  reorderLevel: z.number().optional(),
  isActive: z.boolean().optional(),
});

// MM restock — a manual purchase entry, separate from the product's own
// stockQty/reorderLevel fields above.
export const mmRestockSchema = z.object({
  qty: z.number().refine((n) => n !== 0, 'Quantity cannot be zero'),
  supplierName: z.string().max(200, 'Supplier name too long').nullable().optional(),
  purchaseCost: z.number().int().nonnegative('Cost cannot be negative').nullable().optional(),
  invoiceRef: z.string().max(100, 'Invoice/reference too long').nullable().optional(),
  notes: z.string().max(1000, 'Notes too long').nullable().optional(),
});

export const serviceSchema = z.object({
  name: z.string().min(1, 'Service name is required').max(200, 'Service name too long'),
  isActive: z.boolean().optional(),
});

export const billItemSchema = z.object({
  productId: z.number().int().positive().optional(),
  // MM billing module only — links a sold item back to its MmProduct so
  // stock can be auto-deducted (see BillService). Never set for MAIN items.
  mmProductId: z.number().int().positive().optional(),
  productName: z.string().min(1).max(200, 'Product name too long'),
  // .nullable() too, not just .optional() — products denormalize hsnSac from
  // the Product row, which is a nullable column, so an unset code arrives as
  // `null`, not `undefined`, and .optional() alone rejects null.
  hsnSac: z.string().max(20, 'HSN/SAC too long').nullable().optional(),
  unit: z.string().min(1).max(20),
  qty: z.number().positive(),
  // nonnegative, not positive — a 0-price line item is how a complimentary/
  // free item (or a 100%-discounted one) gets billed.
  unitPrice: z.number().int().nonnegative(),
  gstRate: z.number().min(0).max(100),
});

export const createBillSchema = z.object({
  customerId: z.number().int().positive().optional(),
  mmCustomerId: z.number().int().positive().optional(),
  billDate: z
    .string()
    .min(1)
    .refine(isValidDateString, 'Invalid bill date'),
  dueDate: z.string().refine(isValidDateString, 'Invalid due date').optional(),
  items: z.array(billItemSchema).min(1, 'At least one item required'),
  notes: z.string().max(2000, 'Notes too long').optional(),
  discountAmount: z.number().int().min(0).optional(),
  paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'CHEQUE']).optional(),
  // Rounding to the nearest rupee can never require more than 99 paise of
  // adjustment either way — bounding it catches a garbage/malicious value
  // (e.g. -999999) that would otherwise silently produce a wildly wrong
  // grandTotal, since the server just adds it in without recomputing it.
  roundOffAmount: z.number().int().min(-99).max(99).optional(),
  serviceDescription: z.string().max(500, 'Service description too long').optional(),
  serviceFrom: z.string().refine(isValidDateString, 'Invalid service-from date').optional(),
  serviceTo: z.string().refine(isValidDateString, 'Invalid service-to date').optional(),
  // Arbitrary list of service dates, replacing the old from/to range.
  serviceDates: z.array(z.string().refine(isValidDateString, 'Invalid service date')).max(20, 'Too many service dates').optional(),
  gstInclusive: z.boolean().optional(),
  isInterState: z.boolean().optional(),
  // MM/A4 "Tax Invoice" layout only — see the matching schema.prisma comment.
  vehicleNo: z.string().max(50, 'Vehicle No too long').optional(),
  despatchedThrough: z.string().max(100, 'Despatched Through too long').optional(),
  destination: z.string().max(100, 'Destination too long').optional(),
  otherReference: z.string().max(200, 'Other Reference too long').optional(),
  ewayBillNo: z.string().max(50, 'E-Way Bill No too long').optional(),
  irnNo: z.string().max(100, 'IRN No too long').optional(),
  consigneeName: z.string().max(200, 'Consignee name too long').optional(),
  consigneeAddress: z.string().max(500, 'Consignee address too long').optional(),
  consigneeGstin: z.string().max(15, 'Consignee GSTIN must be 15 characters or fewer').optional(),
  series: z.enum(['MAIN', 'MM']).optional(),
});

export const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(5000),
  group: z.string().max(50).optional(),
});

export const bulkSettingsSchema = z.array(settingSchema).min(1).max(200);

// ── Request-param helpers ─────────────────────────────────────────────────────
// Route/query params arrive as raw strings; a bare parseInt() lets NaN or
// negative values reach Prisma, which then throws an opaque 500. These helpers
// make every route fail with a clean 400 (or a sane default) instead.

/** Parse a positive-integer route param (e.g. /:id). Returns null when invalid. */
export function parseId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * NaN-safe positive integer with a default and an optional cap (page/limit).
 * `0` and negative values fall back to `def` rather than being rejected —
 * there's no way to distinguish "caller explicitly wants 0 results" from
 * "caller omitted/mistyped the param", so this treats both as "use the
 * default" instead of erroring.
 */
export function parseIntParam(raw: string | undefined, def: number, max?: number): number {
  const n = parseInt(raw ?? '', 10);
  if (isNaN(n) || n < 1) return def;
  return max !== undefined ? Math.min(max, n) : n;
}

/** Strict YYYY-MM-DD query param → Date at start/end of that day, else null. */
export function parseDateParam(raw: string, edge: 'start' | 'end'): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !isValidDateString(raw)) return null;
  // .999 so a bill stamped in the day's final second isn't excluded from lte.
  const d = new Date(raw + (edge === 'start' ? 'T00:00:00' : 'T23:59:59.999'));
  return isNaN(d.getTime()) ? null : d;
}
