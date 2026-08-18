/**
 * Tests for lib/billMath.ts — the frontend's mirror of the backend's ONLY
 * source of GST-split truth (BillService.computeItemTotals). The two must
 * never drift by a paisa, or the on-screen bill preview shows a different
 * number than what actually saves and gets charged — this has happened for
 * real before (Phase 8's GST-inclusive per-row display bug in
 * PROJECT_HISTORY.md), and there was no automated test guarding against it
 * happening again.
 *
 * Two kinds of coverage here:
 *   1. Worked-example assertions against concrete expected numbers (documents
 *      the actual behavior, same style as the backend's BillService tests).
 *   2. A direct cross-check against the REAL backend BillService class
 *      (imported straight out of ../../backend/src, not re-implemented) —
 *      the strongest guarantee available that the two can't silently drift,
 *      since it exercises the actual production code on both sides rather
 *      than two independently hand-derived expectations that could encode
 *      the same mistake twice.
 *
 * Run with: npm test --workspace=frontend
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeItemLineTotal, computeLineTotals, type LineTotalsInput } from '../src/lib/billMath.ts';
import { BillService } from '../../backend/src/services/BillService.ts';
import { rupeeToPaisa } from '../src/types/index.ts';

// computeItemTotals doesn't touch `this.prisma` at all — safe to construct
// without a real PrismaClient for this pure-math cross-check.
const backendService = new BillService({} as never);

/**
 * Runs the SAME item through the real backend computeItemTotals (paise
 * unitPrice) and the frontend computeItemLineTotal (rupee unitPrice) and
 * asserts they agree to the paisa. `unitPriceRupees` is converted to paise
 * via rupeeToPaisa — the exact function the frontend itself uses before
 * ever sending a price to the API — so both sides start from the identical
 * integer-paise number, the same way a real bill save does.
 */
function crossCheck(
  item: { qty: number; unitPriceRupees: number; gstRate: number },
  gstInclusive: boolean,
) {
  const unitPricePaise = rupeeToPaisa(item.unitPriceRupees);

  const backend = backendService.computeItemTotals(
    [{ productName: 'X', unit: 'piece', qty: item.qty, unitPrice: unitPricePaise, gstRate: item.gstRate }],
    gstInclusive,
  );
  const frontend = computeItemLineTotal({ qty: item.qty, unitPrice: item.unitPriceRupees, gstRate: item.gstRate }, gstInclusive);

  const backendItem = backend.items[0]!;
  assert.equal(frontend.totalP, backendItem.totalAmount, `total mismatch (${JSON.stringify(item)}, inclusive=${gstInclusive})`);
  assert.equal(frontend.gstAmountP, backendItem.gstAmount, `gst mismatch (${JSON.stringify(item)}, inclusive=${gstInclusive})`);
  assert.equal(
    frontend.subTotalP,
    backendItem.totalAmount - backendItem.gstAmount,
    `subtotal mismatch (${JSON.stringify(item)}, inclusive=${gstInclusive})`,
  );
  assert.equal(frontend.subTotalP, backend.subTotal);
  assert.equal(frontend.gstAmountP, backend.totalGst);
}

test('computeItemLineTotal (exclusive): ₹1500 @ 18% adds GST on top → ₹1770', () => {
  const r = computeItemLineTotal({ qty: 1, unitPrice: 1500, gstRate: 18 }, false);
  assert.equal(r.subTotalP, 150000); // ₹1500 in paise
  assert.equal(r.gstAmountP, 27000); // ₹270
  assert.equal(r.totalP, 177000); // ₹1770
});

test('computeItemLineTotal (inclusive): ₹1500 @ 18% extracts GST from within it → still ₹1500', () => {
  const r = computeItemLineTotal({ qty: 1, unitPrice: 1500, gstRate: 18 }, true);
  assert.equal(r.totalP, 150000); // customer still pays exactly ₹1500
  assert.equal(r.subTotalP, 127119); // ₹1271.19 base
  assert.equal(r.gstAmountP, 22881); // ₹228.81 GST
  assert.equal(r.subTotalP + r.gstAmountP, r.totalP);
});

test('computeItemLineTotal: inclusive mode with gstRate=0 is a no-op split (whole amount is the base)', () => {
  const r = computeItemLineTotal({ qty: 1, unitPrice: 500, gstRate: 0 }, true);
  assert.equal(r.subTotalP, 50000);
  assert.equal(r.gstAmountP, 0);
  assert.equal(r.totalP, 50000);
});

test('computeItemLineTotal: fractional qty and a price with paise-level rounding', () => {
  // 0.5 * ₹3.33 = ₹1.665 → 166.5 paise → rounds to 167 (matches Math.round semantics)
  const r = computeItemLineTotal({ qty: 0.5, unitPrice: 3.33, gstRate: 0 }, false);
  assert.equal(r.subTotalP, 167);
});

test('computeLineTotals: aggregates multiple items with mixed GST rates', () => {
  const items: LineTotalsInput[] = [
    { qty: 1, unitPrice: 100, gstRate: 18 },
    { qty: 1, unitPrice: 500, gstRate: 12 },
  ];
  const r = computeLineTotals(items, false);
  // item 1: 10000 sub + 1800 gst; item 2: 50000 sub + 6000 gst
  assert.equal(r.subTotalP, 60000);
  assert.equal(r.gstTotalP, 7800);
});

test('cross-check against the real backend BillService.computeItemTotals: exclusive mode, several worked cases', () => {
  crossCheck({ qty: 1, unitPriceRupees: 1500, gstRate: 18 }, false);
  crossCheck({ qty: 2, unitPriceRupees: 100, gstRate: 12 }, false);
  crossCheck({ qty: 0.5, unitPriceRupees: 10, gstRate: 0 }, false);
  crossCheck({ qty: 3, unitPriceRupees: 333, gstRate: 18 }, false); // odd rounding case
  crossCheck({ qty: 1, unitPriceRupees: 0, gstRate: 18 }, false); // complimentary item
});

test('cross-check against the real backend BillService.computeItemTotals: inclusive mode, several worked cases', () => {
  crossCheck({ qty: 1, unitPriceRupees: 1500, gstRate: 18 }, true);
  crossCheck({ qty: 2, unitPriceRupees: 100, gstRate: 12 }, true);
  crossCheck({ qty: 1, unitPriceRupees: 999.99, gstRate: 5 }, true); // odd paisa remainder
  crossCheck({ qty: 4, unitPriceRupees: 333.33, gstRate: 18 }, true);
  crossCheck({ qty: 1, unitPriceRupees: 500, gstRate: 0 }, true); // inclusive but zero-rated
});

test('cross-check: a full multi-item bill aggregates identically on both sides', () => {
  const itemsRupees = [
    { qty: 2, unitPriceRupees: 1500, gstRate: 18 },
    { qty: 1, unitPriceRupees: 250000, gstRate: 18 }, // album-sized amount
    { qty: 0.5, unitPriceRupees: 10, gstRate: 0 }, // film roll, fractional qty
  ];
  for (const gstInclusive of [false, true]) {
    const backendItems = itemsRupees.map((i) => ({
      productName: 'X',
      unit: 'piece',
      qty: i.qty,
      unitPrice: rupeeToPaisa(i.unitPriceRupees),
      gstRate: i.gstRate,
    }));
    const backend = backendService.computeItemTotals(backendItems, gstInclusive);

    const frontendItems: LineTotalsInput[] = itemsRupees.map((i) => ({
      qty: i.qty,
      unitPrice: i.unitPriceRupees,
      gstRate: i.gstRate,
    }));
    const frontend = computeLineTotals(frontendItems, gstInclusive);

    assert.equal(frontend.subTotalP, backend.subTotal, `subTotal mismatch, inclusive=${gstInclusive}`);
    assert.equal(frontend.gstTotalP, backend.totalGst, `gstTotal mismatch, inclusive=${gstInclusive}`);
  }
});
