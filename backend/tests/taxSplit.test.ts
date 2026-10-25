import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTax } from '../src/utils/taxSplit.ts';

test('splitTax: intra-state splits into CGST+SGST via floor+remainder, IGST zero', () => {
  assert.deepEqual(splitTax(3601, false), { cgst: 1800, sgst: 1801, igst: 0 });
});

test('splitTax: inter-state puts the whole amount in IGST, CGST/SGST zero', () => {
  assert.deepEqual(splitTax(3600, true), { cgst: 0, sgst: 0, igst: 3600 });
});

test('splitTax: cgst+sgst+igst always sums back to the original amount', () => {
  for (const amount of [0, 1, 2, 99, 3601, 999999]) {
    for (const isInterState of [false, true]) {
      const { cgst, sgst, igst } = splitTax(amount, isInterState);
      assert.equal(cgst + sgst + igst, amount);
    }
  }
});
