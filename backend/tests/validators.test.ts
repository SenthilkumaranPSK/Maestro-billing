/**
 * Tests for the Zod request validators. Pure-function tests — no DB needed.
 *
 * These cover the length caps and basic shape validation added in the
 * polish pass. The point is to lock the API contract: a 1MB notes field
 * or a 16-digit GSTIN should be rejected with a clear error before it
 * hits Prisma.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerSchema,
  productSchema,
  createBillSchema,
  billItemSchema,
  parseDateParam,
} from '../src/utils/validators.ts';

test('customerSchema accepts a minimal valid customer', () => {
  const result = customerSchema.safeParse({
    name: 'Senthil',
    phone: '9843096461',
  });
  assert.equal(result.success, true);
});

test('customerSchema rejects a 201-char name', () => {
  const result = customerSchema.safeParse({
    name: 'A'.repeat(201),
    phone: '9843096461',
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const msg = JSON.stringify(result.error.format());
    assert.ok(msg.includes('Name too long'), `expected "Name too long" in ${msg}`);
  }
});

test('customerSchema accepts a 200-char name (boundary)', () => {
  const result = customerSchema.safeParse({
    name: 'A'.repeat(200),
    phone: '9843096461',
  });
  assert.equal(result.success, true);
});

test('customerSchema rejects a 16-char phone', () => {
  const result = customerSchema.safeParse({
    name: 'Senthil',
    phone: '1'.repeat(16),
  });
  assert.equal(result.success, false);
});

test('customerSchema rejects a phone with letters', () => {
  const result = customerSchema.safeParse({
    name: 'Senthil',
    phone: '98430abcde',
  });
  assert.equal(result.success, false);
});

test('customerSchema accepts formatted phone with spaces and dashes', () => {
  const result = customerSchema.safeParse({
    name: 'Senthil',
    phone: '+91 98430-96461',
  });
  assert.equal(result.success, true);
});

test('customerSchema rejects a 16-char GSTIN', () => {
  const result = customerSchema.safeParse({
    name: 'Senthil',
    phone: '9843096461',
    gstin: 'A'.repeat(16),
  });
  assert.equal(result.success, false);
});

test('customerSchema accepts a 15-char GSTIN', () => {
  const result = customerSchema.safeParse({
    name: 'Senthil',
    phone: '9843096461',
    gstin: '33ABWPY8748G1ZN', // standard 15-char Indian GSTIN
  });
  assert.equal(result.success, true);
});

test('customerSchema rejects a 501-char address', () => {
  const result = customerSchema.safeParse({
    name: 'Senthil',
    phone: '9843096461',
    address: 'A'.repeat(501),
  });
  assert.equal(result.success, false);
});

test('customerSchema rejects a 2001-char notes field', () => {
  const result = customerSchema.safeParse({
    name: 'Senthil',
    phone: '9843096461',
    notes: 'A'.repeat(2001),
  });
  assert.equal(result.success, false);
});

test('productSchema rejects a 201-char product name', () => {
  const result = productSchema.safeParse({
    name: 'A'.repeat(201),
    unit: 'piece',
    unitPrice: 10000,
    gstRate: 18,
  });
  assert.equal(result.success, false);
});

test('productSchema rejects a 21-char unit', () => {
  const result = productSchema.safeParse({
    name: 'Passport Photo',
    unit: 'A'.repeat(21),
    unitPrice: 10000,
    gstRate: 18,
  });
  assert.equal(result.success, false);
});

test('billItemSchema requires productName, qty > 0, unitPrice >= 0', () => {
  const result = billItemSchema.safeParse({
    productName: '',
    unit: 'piece',
    qty: 0,
    unitPrice: -1,
    gstRate: 18,
  });
  assert.equal(result.success, false);
  // 3 different errors: min(1) on name, positive() on qty, nonnegative() on unitPrice
  if (!result.success) assert.ok(result.error.issues.length >= 3);
});

test('billItemSchema accepts a zero-priced (complimentary) item', () => {
  const result = billItemSchema.safeParse({
    productName: 'Complimentary Print',
    unit: 'piece',
    qty: 1,
    unitPrice: 0,
    gstRate: 0,
  });
  assert.equal(result.success, true);
});

test('createBillSchema requires at least one item', () => {
  const result = createBillSchema.safeParse({
    billDate: '2026-07-11',
    items: [],
  });
  assert.equal(result.success, false);
});

test('createBillSchema accepts a minimal valid bill', () => {
  const result = createBillSchema.safeParse({
    billDate: '2026-07-11',
    items: [
      {
        productName: 'Passport Photo',
        unit: 'piece',
        qty: 1,
        unitPrice: 10000,
        gstRate: 18,
      },
    ],
  });
  assert.equal(result.success, true);
});

test('createBillSchema rejects an impossible calendar date (Feb 30) for billDate', () => {
  // JS Date silently rolls "2026-02-30" over into March instead of
  // rejecting it — the schema must catch this itself, not trust Date.parse.
  const result = createBillSchema.safeParse({
    billDate: '2026-02-30',
    items: [
      { productName: 'X', unit: 'piece', qty: 1, unitPrice: 100, gstRate: 0 },
    ],
  });
  assert.equal(result.success, false);
});

test('createBillSchema rejects an invalid dueDate', () => {
  const result = createBillSchema.safeParse({
    billDate: '2026-07-11',
    dueDate: 'not-a-date',
    items: [
      { productName: 'X', unit: 'piece', qty: 1, unitPrice: 100, gstRate: 0 },
    ],
  });
  assert.equal(result.success, false);
});

test('createBillSchema accepts a valid dueDate', () => {
  const result = createBillSchema.safeParse({
    billDate: '2026-07-11',
    dueDate: '2026-07-20',
    items: [
      { productName: 'X', unit: 'piece', qty: 1, unitPrice: 100, gstRate: 0 },
    ],
  });
  assert.equal(result.success, true);
});

test('parseDateParam rejects an impossible calendar date', () => {
  assert.equal(parseDateParam('2026-02-30', 'start'), null);
  assert.equal(parseDateParam('2026-13-01', 'start'), null);
});

test('parseDateParam accepts a valid calendar date', () => {
  const d = parseDateParam('2026-02-28', 'start');
  assert.ok(d instanceof Date);
  assert.equal(d?.getMonth(), 1); // February
  assert.equal(d?.getDate(), 28);
});

test('createBillSchema rejects a 2001-char notes field', () => {
  const result = createBillSchema.safeParse({
    billDate: '2026-07-11',
    items: [
      {
        productName: 'Passport Photo',
        unit: 'piece',
        qty: 1,
        unitPrice: 10000,
        gstRate: 18,
      },
    ],
    notes: 'A'.repeat(2001),
  });
  assert.equal(result.success, false);
});

