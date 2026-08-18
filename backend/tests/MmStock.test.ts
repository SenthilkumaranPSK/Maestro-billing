/**
 * Tests for the MM billing module's stock/inventory ledger — BillService's
 * adjustMmStock() and its integration into createBill/updateBill, plus the
 * bill-cancel reversal (BillService.adjustMmStock called with sign=1, the
 * same pattern backend/src/routes/bills.ts's DELETE handler uses).
 *
 * PROJECT_HISTORY.md describes this as verified end-to-end by hand
 * (correction → restock → sale → bill-qty edit → bill cancel, confirming the
 * ledger's balance returns exactly to its pre-sale value) but that
 * verification was never automated — this file locks it in.
 *
 * Core invariants under test:
 *   - A SALE deducts stock and writes a signed, dated MmStockMovement row
 *     with a snapshotted balanceAfter (never recomputed from history).
 *   - Editing a bill restores what it sold before, THEN deducts the new set
 *     — both inside one transaction, so the net effect is atomic.
 *   - Cancelling a bill fully reverses whatever it deducted.
 *   - A manually-typed MM item (no mmProductId) never touches stock/ledger.
 *   - A MAIN-series item (productId, not mmProductId) never touches the MM
 *     ledger at all, even though createBill/updateBill run the same code
 *     path for every bill regardless of series.
 *   - Stock is allowed to go negative (an oversell is a signal to restock,
 *     never a blocked action).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma, reset } from './setup.ts';
import { BillService } from '../src/services/BillService.ts';

const service = new BillService(prisma);

test.beforeEach(async () => {
  await reset();
});

async function makeMmProduct(stockQty = 100) {
  return prisma.mmProduct.create({
    data: { name: 'Thenkuzhal Murukku', unit: 'Kgs', unitPrice: 12000, gstRate: 5, hsnSac: '210690', stockQty },
  });
}

test('createBill: a SALE deducts stock and writes a dated movement with the correct balanceAfter', async () => {
  const product = await makeMmProduct(100);
  const bill = await service.createBill({
    billDate: '2026-07-29T10:00:00.000Z',
    series: 'MM',
    items: [
      { mmProductId: product.id, productName: product.name, unit: 'Kgs', qty: 4, unitPrice: 12000, gstRate: 5 },
    ],
  });

  const updated = await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(updated.stockQty, 96);

  const movements = await prisma.mmStockMovement.findMany({ where: { mmProductId: product.id } });
  assert.equal(movements.length, 1);
  assert.equal(movements[0]!.type, 'SALE');
  assert.equal(movements[0]!.qtyChange, -4);
  assert.equal(movements[0]!.balanceAfter, 96);
  assert.equal(movements[0]!.billId, bill.id);
});

test('createBill: a manually-typed MM item (no mmProductId) never touches stock or the ledger', async () => {
  const product = await makeMmProduct(50);
  await service.createBill({
    billDate: '2026-07-29T10:00:00.000Z',
    series: 'MM',
    items: [
      { productName: 'Hand-typed extra item, no catalog link', unit: 'Kgs', qty: 2, unitPrice: 10000, gstRate: 5 },
    ],
  });

  const unchanged = await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(unchanged.stockQty, 50, 'an untouched product must keep its original stock');
  const movements = await prisma.mmStockMovement.count();
  assert.equal(movements, 0, 'no ledger row should be written for an item with no mmProductId');
});

test('createBill: a MAIN-series item (productId) never touches the MM ledger, even sharing the same createBill code path', async () => {
  const mmProduct = await makeMmProduct(50);
  const mainProduct = await prisma.product.create({
    data: { name: 'Passport Photo', unit: 'piece', unitPrice: 10000, gstRate: 18 },
  });

  await service.createBill({
    billDate: '2026-07-29T10:00:00.000Z',
    // series omitted → defaults to 'MAIN'
    items: [
      { productId: mainProduct.id, productName: mainProduct.name, unit: 'piece', qty: 3, unitPrice: 10000, gstRate: 18 },
    ],
  });

  const stillFull = await prisma.mmProduct.findUniqueOrThrow({ where: { id: mmProduct.id } });
  assert.equal(stillFull.stockQty, 50);
  assert.equal(await prisma.mmStockMovement.count(), 0);
});

test('createBill: stock is allowed to go negative (oversell is a signal to restock, not a blocked action)', async () => {
  const product = await makeMmProduct(5);
  await service.createBill({
    billDate: '2026-07-29T10:00:00.000Z',
    series: 'MM',
    items: [
      { mmProductId: product.id, productName: product.name, unit: 'Kgs', qty: 8, unitPrice: 12000, gstRate: 5 },
    ],
  });

  const oversold = await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(oversold.stockQty, -3);
  const movement = await prisma.mmStockMovement.findFirstOrThrow({ where: { mmProductId: product.id } });
  assert.equal(movement.balanceAfter, -3);
});

test('updateBill: restores the old items THEN deducts the new set, net effect only', async () => {
  const product = await makeMmProduct(100);
  const bill = await service.createBill({
    billDate: '2026-07-29T10:00:00.000Z',
    series: 'MM',
    items: [
      { mmProductId: product.id, productName: product.name, unit: 'Kgs', qty: 10, unitPrice: 12000, gstRate: 5 },
    ],
  });
  assert.equal((await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } })).stockQty, 90);

  // Edit down to a smaller quantity — net effect should be +10 (restore) -4 (new sale) = +6 from the sold state.
  await service.updateBill(bill.id, {
    billDate: '2026-07-29T10:00:00.000Z',
    series: 'MM',
    items: [
      { mmProductId: product.id, productName: product.name, unit: 'Kgs', qty: 4, unitPrice: 12000, gstRate: 5 },
    ],
  });

  const afterEdit = await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(afterEdit.stockQty, 96); // 100 - 10 (original sale) + 10 (restore) - 4 (new sale)

  const movements = await prisma.mmStockMovement.findMany({
    where: { mmProductId: product.id },
    orderBy: { id: 'asc' },
  });
  assert.equal(movements.length, 3, 'SALE (create) + RESTORE (edit) + SALE (edit) = 3 rows');
  assert.deepEqual(movements.map((m) => m.type), ['SALE', 'RESTORE', 'SALE']);
  assert.deepEqual(movements.map((m) => m.qtyChange), [-10, 10, -4]);
  assert.deepEqual(movements.map((m) => m.balanceAfter), [90, 100, 96]);
});

test('updateBill: switching an item to a DIFFERENT MmProduct restores the old one and deducts the new one', async () => {
  const productA = await makeMmProduct(100);
  const productB = await prisma.mmProduct.create({
    data: { name: 'Butter Muruku', unit: 'Kgs', unitPrice: 15000, gstRate: 5, stockQty: 50 },
  });

  const bill = await service.createBill({
    billDate: '2026-07-29T10:00:00.000Z',
    series: 'MM',
    items: [{ mmProductId: productA.id, productName: productA.name, unit: 'Kgs', qty: 5, unitPrice: 12000, gstRate: 5 }],
  });

  await service.updateBill(bill.id, {
    billDate: '2026-07-29T10:00:00.000Z',
    series: 'MM',
    items: [{ mmProductId: productB.id, productName: productB.name, unit: 'Kgs', qty: 3, unitPrice: 15000, gstRate: 5 }],
  });

  assert.equal((await prisma.mmProduct.findUniqueOrThrow({ where: { id: productA.id } })).stockQty, 100, 'product A fully restored');
  assert.equal((await prisma.mmProduct.findUniqueOrThrow({ where: { id: productB.id } })).stockQty, 47, 'product B newly deducted');
});

test('cancelling a bill (adjustMmStock sign=+1, mirroring bills.ts DELETE) fully reverses the sale', async () => {
  const product = await makeMmProduct(100);
  const bill = await service.createBill({
    billDate: '2026-07-29T10:00:00.000Z',
    series: 'MM',
    items: [{ mmProductId: product.id, productName: product.name, unit: 'Kgs', qty: 12, unitPrice: 12000, gstRate: 5 }],
  });
  assert.equal((await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } })).stockQty, 88);

  // Same shape as backend/src/routes/bills.ts's DELETE /:id handler: read the
  // bill's items, restore stock, mark CANCELLED — all in one transaction.
  await prisma.$transaction(async (tx) => {
    const items = await tx.billItem.findMany({ where: { billId: bill.id } });
    await service.adjustMmStock(tx, items, 1, bill.id);
    await tx.bill.update({ where: { id: bill.id }, data: { status: 'CANCELLED' } });
  });

  const afterCancel = await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(afterCancel.stockQty, 100, 'cancelling must restore stock exactly to its pre-sale level');

  const movements = await prisma.mmStockMovement.findMany({
    where: { mmProductId: product.id },
    orderBy: { id: 'asc' },
  });
  assert.deepEqual(movements.map((m) => m.type), ['SALE', 'RESTORE']);
  assert.equal(movements[1]!.balanceAfter, 100);
});

test('full lifecycle: correction → restock → sale → bill-qty edit → cancel returns the ledger to its pre-sale balance', async () => {
  const product = await makeMmProduct(0);

  // Correction — a manual stockQty fix (mirrors PUT /mm-products/:id writing
  // a CORRECTION row when the edited stockQty differs from what's stored).
  const afterCorrection = await prisma.$transaction(async (tx) => {
    const before = await tx.mmProduct.findUniqueOrThrow({ where: { id: product.id } });
    const updated = await tx.mmProduct.update({ where: { id: product.id }, data: { stockQty: 20 } });
    await tx.mmStockMovement.create({
      data: { mmProductId: product.id, type: 'CORRECTION', qtyChange: 20 - before.stockQty, balanceAfter: updated.stockQty },
    });
    return updated;
  });
  assert.equal(afterCorrection.stockQty, 20);

  // Restock — a Goods Received entry (mirrors POST /mm-products/:id/restock).
  await prisma.$transaction(async (tx) => {
    const updated = await tx.mmProduct.update({ where: { id: product.id }, data: { stockQty: { increment: 30 } } });
    await tx.mmStockMovement.create({
      data: { mmProductId: product.id, type: 'PURCHASE', qtyChange: 30, balanceAfter: updated.stockQty, supplierName: 'Local Supplier' },
    });
  });
  const preSaleStock = (await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } })).stockQty;
  assert.equal(preSaleStock, 50);

  // Sale.
  const bill = await service.createBill({
    billDate: '2026-07-29T10:00:00.000Z',
    series: 'MM',
    items: [{ mmProductId: product.id, productName: product.name, unit: 'Kgs', qty: 15, unitPrice: 12000, gstRate: 5 }],
  });
  assert.equal((await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } })).stockQty, 35);

  // Bill-qty edit — sell 20 instead of 15.
  await service.updateBill(bill.id, {
    billDate: '2026-07-29T10:00:00.000Z',
    series: 'MM',
    items: [{ mmProductId: product.id, productName: product.name, unit: 'Kgs', qty: 20, unitPrice: 12000, gstRate: 5 }],
  });
  assert.equal((await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } })).stockQty, 30);

  // Cancel.
  await prisma.$transaction(async (tx) => {
    const items = await tx.billItem.findMany({ where: { billId: bill.id } });
    await service.adjustMmStock(tx, items, 1, bill.id);
    await tx.bill.update({ where: { id: bill.id }, data: { status: 'CANCELLED' } });
  });

  const final = await prisma.mmProduct.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(final.stockQty, preSaleStock, "the ledger's running balance must return exactly to its pre-sale value once the bill is cancelled");

  // Every movement's own balanceAfter must match stockQty as it stood right
  // after that movement — the ledger is never recomputed from history, so a
  // wrong balanceAfter anywhere would otherwise go undetected.
  const allMovements = await prisma.mmStockMovement.findMany({
    where: { mmProductId: product.id },
    orderBy: { id: 'asc' },
  });
  let running = 0;
  for (const m of allMovements) {
    running += m.qtyChange;
    assert.equal(m.balanceAfter, running, `movement ${m.type} (id ${m.id}) balanceAfter must equal the running total`);
  }
  assert.equal(running, preSaleStock);
});
