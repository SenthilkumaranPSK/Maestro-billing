import { rupeeToPaisa } from '@/types';

export interface LineTotalsInput {
  qty: number;
  unitPrice: number; // rupees (UI layer)
  gstRate: number;
}

export interface ItemLineTotal {
  subTotalP: number; // the taxable base ("Actual Amount"), in paise
  gstAmountP: number; // in paise
  totalP: number; // subTotalP + gstAmountP, in paise
}

/**
 * Per-item GST split — mirrors BillService.computeItemTotals's per-item
 * branch on the backend exactly (same rounding, same inclusive/exclusive
 * logic): exclusive treats the entered amount as the pre-tax base and adds
 * GST on top; inclusive treats it as the final all-in price and backs the
 * base out of it instead, so the entered amount is always what the row's
 * own "Total" shows in inclusive mode. Shared by computeLineTotals (the
 * bill-level aggregate) and any per-row display so neither can drift from
 * the other, to the paisa.
 */
export function computeItemLineTotal(item: LineTotalsInput, gstInclusive: boolean): ItemLineTotal {
  const enteredTotalP = Math.round(item.qty * rupeeToPaisa(item.unitPrice));
  let subTotalP: number;
  let gstAmountP: number;

  if (gstInclusive && item.gstRate > 0) {
    subTotalP = Math.round((enteredTotalP * 100) / (100 + item.gstRate));
    gstAmountP = enteredTotalP - subTotalP;
  } else {
    subTotalP = enteredTotalP;
    gstAmountP = Math.round((subTotalP * item.gstRate) / 100);
  }

  return { subTotalP, gstAmountP, totalP: subTotalP + gstAmountP };
}

/**
 * Bill-level aggregate — sums computeItemLineTotal across every item.
 */
export function computeLineTotals(
  items: LineTotalsInput[],
  gstInclusive: boolean,
): { subTotalP: number; gstTotalP: number } {
  let subTotalP = 0;
  let gstTotalP = 0;

  for (const item of items) {
    const r = computeItemLineTotal(item, gstInclusive);
    subTotalP += r.subTotalP;
    gstTotalP += r.gstAmountP;
  }

  return { subTotalP, gstTotalP };
}

/**
 * Splits a bill/item's single blended gstAmountP into CGST+SGST
 * (intra-state) or IGST (inter-state) — mirrors the backend's
 * utils/taxSplit.ts splitTax exactly. The total tax amount never changes
 * between the two; only how it's split/labeled does, since gstAmountP is
 * already computed above from the full GST rate regardless of isInterState.
 */
export function splitTaxP(
  gstAmountP: number,
  isInterState: boolean,
): { cgstP: number; sgstP: number; igstP: number } {
  if (isInterState) {
    return { cgstP: 0, sgstP: 0, igstP: gstAmountP };
  }
  const half = Math.floor(gstAmountP / 2);
  return { cgstP: half, sgstP: gstAmountP - half, igstP: 0 };
}
