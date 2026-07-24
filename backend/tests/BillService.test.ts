/**
 * Tests for BillService. Uses a real SQLite test DB (see setup.ts).
 *
 * Covers:
 *   - computeItemTotals math (paise arithmetic, GST rounding, multiple items)
 *   - createBill happy path (always PAID, no payment rows)
 *   - createBill / updateBill allow a zero total (complimentary bill), reject negative
 *   - updateBill allowed on PAID, blocked on CANCELLED
 *   - discount + round-off math flows through to grandTotal
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma, reset } from './setup.ts';
import { BillService } from '../src/services/BillService.ts';

const service = new BillService(prisma);

test.beforeEach(async () => {
  await reset();
});

test('computeItemTotals: 1 item, 18% GST, no rounding needed', () => {
  const r = service.computeItemTotals([
    { productName: 'Passport', unit: 'piece', qty: 2, unitPrice: 10000, gstRate: 18 },
  ]);
  // 2 * 10000 = 20000 sub, 20000 * 0.18 = 3600 gst, total 23600
  assert.equal(r.subTotal, 20000);
  assert.equal(r.totalGst, 3600);
  assert.equal(r.grandTotal, 23600);
  assert.equal(r.items[0].totalAmount, 23600);
});

test('computeItemTotals: 2 items, mixed GST rates', () => {
  const r = service.computeItemTotals([
    { productName: 'Passport', unit: 'piece', qty: 1, unitPrice: 10000, gstRate: 18 },
    { productName: 'Album',    unit: 'piece', qty: 1, unitPrice: 50000, gstRate: 12 },
  ]);
  assert.equal(r.subTotal, 60000);
  assert.equal(r.totalGst, 1800 + 6000);
  assert.equal(r.grandTotal, 67800);
});

test('computeItemTotals: fractional qty rounds subTotal to integer paise', () => {
  const r = service.computeItemTotals([
    { productName: 'Film', unit: 'roll', qty: 0.5, unitPrice: 1000, gstRate: 0 },
  ]);
  // 0.5 * 1000 = 500 (already integer); 500 * 0% = 0
  assert.equal(r.subTotal, 500);
  assert.equal(r.totalGst, 0);
  assert.equal(r.grandTotal, 500);
});

test('computeItemTotals: GST rounds to nearest paise', () => {
  // 333 * 18% = 59.94 → rounds to 60
  const r = service.computeItemTotals([
    { productName: 'X', unit: 'piece', qty: 1, unitPrice: 333, gstRate: 18 },
  ]);
  assert.equal(r.subTotal, 333);
  assert.equal(r.totalGst, 60);
  assert.equal(r.grandTotal, 393);
});

test('createBill: bill is always PAID, no payment rows', async () => {
  const bill = await service.createBill({
    billDate: '2026-07-11T10:00:00.000Z',
    items: [
      { productName: 'Passport', unit: 'piece', qty: 1, unitPrice: 10000, gstRate: 18 },
    ],
  });
  assert.equal(bill.status, 'PAID');
  assert.equal(bill.subTotal, 10000);
  assert.equal(bill.gstAmount, 1800);
  assert.equal(bill.grandTotal, 11800);
  assert.equal(bill.payments.length, 0);
  assert.equal(bill.items.length, 1);
});

test('createBill: allows a zero-total (complimentary) bill', async () => {
  const bill = await service.createBill({
    billDate: '2026-07-11T10:00:00.000Z',
    items: [
      { productName: 'Freebie', unit: 'piece', qty: 1, unitPrice: 0, gstRate: 0 },
    ],
  });
  assert.equal(bill.grandTotal, 0);
  assert.equal(bill.status, 'PAID');
});

test('createBill: discount + round-off flow to grandTotal', async () => {
  const bill = await service.createBill({
    billDate: '2026-07-11T10:00:00.000Z',
    items: [
      { productName: 'X', unit: 'piece', qty: 1, unitPrice: 100, gstRate: 0 },
    ],
    discountAmount: 5,
    roundOffAmount: 1, // round UP by 1 paise
  });
  // subTotal=100, gst=0, grand=100, -5 discount = 95, +1 round = 96
  assert.equal(bill.grandTotal, 96);
});

test('createBill: REJECTS negative-total bill (discount > subtotal)', async () => {
  await assert.rejects(
    () =>
      service.createBill({
        billDate: '2026-07-11T10:00:00.000Z',
        items: [
          { productName: 'X', unit: 'piece', qty: 1, unitPrice: 100, gstRate: 0 },
        ],
        discountAmount: 500, // exceeds subtotal
      }),
    /negative total/,
  );
});

test('updateBill: editing a PAID bill succeeds and recalculates totals', async () => {
  const bill = await service.createBill({
    billDate: '2026-07-11T10:00:00.000Z',
    items: [
      { productName: 'X', unit: 'piece', qty: 1, unitPrice: 1000, gstRate: 0 },
    ],
  });
  const updated = await service.updateBill(bill.id, {
    billDate: '2026-07-11T10:00:00.000Z',
    items: [
      { productName: 'Y', unit: 'piece', qty: 2, unitPrice: 2500, gstRate: 0 },
    ],
  });
  assert.equal(updated.status, 'PAID');
  assert.equal(updated.grandTotal, 5000);
  assert.equal(updated.items.length, 1);
  assert.equal(updated.items[0].productName, 'Y');
});

test('updateBill: allows editing a bill down to a zero (complimentary) total', async () => {
  const bill = await service.createBill({
    billDate: '2026-07-11T10:00:00.000Z',
    items: [
      { productName: 'X', unit: 'piece', qty: 1, unitPrice: 1000, gstRate: 0 },
    ],
  });
  const updated = await service.updateBill(bill.id, {
    billDate: '2026-07-11T10:00:00.000Z',
    items: [
      { productName: 'Y', unit: 'piece', qty: 1, unitPrice: 0, gstRate: 0 },
    ],
  });
  assert.equal(updated.grandTotal, 0);
});

test('updateBill: REJECTS editing a CANCELLED bill', async () => {
  const bill = await service.createBill({
    billDate: '2026-07-11T10:00:00.000Z',
    items: [
      { productName: 'X', unit: 'piece', qty: 1, unitPrice: 1000, gstRate: 0 },
    ],
  });
  await prisma.bill.update({ where: { id: bill.id }, data: { status: 'CANCELLED' } });
  await assert.rejects(
    () =>
      service.updateBill(bill.id, {
        billDate: '2026-07-11T10:00:00.000Z',
        items: [
          { productName: 'X', unit: 'piece', qty: 1, unitPrice: 2000, gstRate: 0 },
        ],
      }),
    /Cancelled bills cannot be edited/,
  );
});

test('updateBill: REJECTS editing a bill that has recorded payments', async () => {
  const bill = await service.createBill({
    billDate: '2026-07-11T10:00:00.000Z',
    items: [
      { productName: 'X', unit: 'piece', qty: 1, unitPrice: 1000, gstRate: 0 },
    ],
  });
  // The app itself never creates Payment rows today (always-PAID, no
  // partial-payment UI) — insert one directly to simulate the day that
  // changes, and confirm editing can no longer silently wipe it.
  await prisma.payment.create({
    data: { billId: bill.id, amount: 1000, paymentMode: 'CASH' },
  });
  await assert.rejects(
    () =>
      service.updateBill(bill.id, {
        billDate: '2026-07-11T10:00:00.000Z',
        items: [
          { productName: 'X', unit: 'piece', qty: 1, unitPrice: 2000, gstRate: 0 },
        ],
      }),
    /recorded payments/,
  );
  const paymentsAfter = await prisma.payment.count({ where: { billId: bill.id } });
  assert.equal(paymentsAfter, 1, 'the payment row must survive the rejected edit');
});

test('getNextBillNumber: increments from the highest existing in the current year (NNN/YYYY format)', async () => {
  await service.createBill({
    billDate: '2026-07-11T10:00:00.000Z',
    items: [
      { productName: 'A', unit: 'piece', qty: 1, unitPrice: 100, gstRate: 0 },
    ],
  });
  const next = await service.getNextBillNumber();
  assert.match(next, /^\d{3}\/2026$/);
  const seq = parseInt(next.split('/')[0], 10);
  assert.ok(seq >= 2, `expected seq >= 2, got ${seq}`);
});

test('getNextBillNumber: continues the sequence gap-free across the old PREFIX-YYYY-NNNN format', async () => {
  // Simulates bills already created before the numbering format changed —
  // GST filing expects a consistent, sequential invoice series within a
  // year, so switching formats must not restart the count at 1.
  await prisma.bill.create({
    data: {
      billNumber: 'MS-2026-0044',
      billDate: new Date('2026-07-11T10:00:00.000Z'),
      subTotal: 100,
      grandTotal: 100,
      status: 'PAID',
    },
  });
  const next = await service.getNextBillNumber();
  assert.equal(next, '045/2026');
});

test('getNextBillNumber: continues the sequence gap-free across the brief NNN/YY (2-digit year) format', async () => {
  // Real bills already exist in this format from before the year was
  // widened to 4 digits — must not restart the count at 1 either.
  await prisma.bill.create({
    data: {
      billNumber: '048/26',
      billDate: new Date('2026-07-11T10:00:00.000Z'),
      subTotal: 100,
      grandTotal: 100,
      status: 'PAID',
    },
  });
  const next = await service.getNextBillNumber();
  assert.equal(next, '049/2026');
});
