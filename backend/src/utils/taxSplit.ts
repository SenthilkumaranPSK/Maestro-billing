/**
 * Splits a bill/item's single blended GST amount into CGST+SGST (intra-state)
 * or IGST (inter-state) — mirrored on the frontend by billMath.ts's
 * splitTaxP. The total tax amount never changes between the two; only how
 * it's split/labeled does, so gstAmount itself is computed once upstream by
 * BillService.computeItemTotals regardless of isInterState.
 */
export function splitTax(
  gstAmount: number,
  isInterState: boolean,
): { cgst: number; sgst: number; igst: number } {
  if (isInterState) {
    return { cgst: 0, sgst: 0, igst: gstAmount };
  }
  // Floor + remainder, not gstAmount/2 on both sides — an odd gstAmount
  // split evenly would either lose a paisa or double-count one.
  const half = Math.floor(gstAmount / 2);
  return { cgst: half, sgst: gstAmount - half, igst: 0 };
}
