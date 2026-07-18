import { z } from 'zod';

// Shared phone rule — used for customers and WhatsApp sends alike so the two
// paths can never drift apart on what counts as a valid number.
export const phoneSchema = z
  .string()
  .min(10, 'Valid phone required')
  .max(20, 'Phone too long')
  .regex(/^[\d\s+\-()]+$/, 'Phone contains invalid characters');

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

export const productSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(200, 'Product name too long'),
  description: z.string().max(2000, 'Description too long').nullable().optional(),
  unit: z.string().min(1).max(20),
  unitPrice: z.number().int().positive('Price must be positive'),
  gstRate: z.number().min(0).max(100),
  isActive: z.boolean().optional(),
});

export const billItemSchema = z.object({
  productId: z.number().int().positive().optional(),
  productName: z.string().min(1).max(200, 'Product name too long'),
  unit: z.string().min(1).max(20),
  qty: z.number().positive(),
  unitPrice: z.number().int().positive(),
  gstRate: z.number().min(0).max(100),
});

export const createBillSchema = z.object({
  customerId: z.number().int().positive().optional(),
  billDate: z
    .string()
    .min(1)
    .refine((s) => !isNaN(Date.parse(s)), 'Invalid bill date'),
  dueDate: z.string().optional(),
  items: z.array(billItemSchema).min(1, 'At least one item required'),
  notes: z.string().max(2000, 'Notes too long').optional(),
  discountAmount: z.number().int().min(0).optional(),
  roundOffAmount: z.number().int().optional(),
});

export const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(5000),
  group: z.string().max(50).optional(),
});

export const bulkSettingsSchema = z.array(settingSchema).min(1).max(200);

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required').max(100),
  password: z.string().min(1, 'Password is required').max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(200),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(200),
});

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

/** NaN-safe positive integer with a default and an optional cap (page/limit). */
export function parseIntParam(raw: string | undefined, def: number, max?: number): number {
  const n = parseInt(raw ?? '', 10);
  if (isNaN(n) || n < 1) return def;
  return max !== undefined ? Math.min(max, n) : n;
}

/** Strict YYYY-MM-DD query param → Date at start/end of that day, else null. */
export function parseDateParam(raw: string, edge: 'start' | 'end'): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  // .999 so a bill stamped in the day's final second isn't excluded from lte.
  const d = new Date(raw + (edge === 'start' ? 'T00:00:00' : 'T23:59:59.999'));
  return isNaN(d.getTime()) ? null : d;
}
