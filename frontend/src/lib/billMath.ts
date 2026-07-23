import { rupeeToPaisa } from '@/types';

export interface LineTotalsInput {
  qty: number;
  unitPrice: number; // rupees (UI layer)
  gstRate: number;
}

/**
 * Mirrors BillService.computeItemTotals on the backend exactly (same
 * per-item rounding, same inclusive/exclusive branch) so the on-screen
 * preview always matches what actually gets saved, to the paisa.
 */
export function computeLineTotals(
  items: LineTotalsInput[],
  gstInclusive: boolean,
): { subTotalP: number; gstTotalP: number } {
  let subTotalP = 0;
  let gstTotalP = 0;

  for (const item of items) {
    const enteredTotalP = Math.round(item.qty * rupeeToPaisa(item.unitPrice));
    let itemSubTotalP: number;
    let gstAmountP: number;

    if (gstInclusive && item.gstRate > 0) {
      itemSubTotalP = Math.round((enteredTotalP * 100) / (100 + item.gstRate));
      gstAmountP = enteredTotalP - itemSubTotalP;
    } else {
      itemSubTotalP = enteredTotalP;
      gstAmountP = Math.round((itemSubTotalP * item.gstRate) / 100);
    }

    subTotalP += itemSubTotalP;
    gstTotalP += gstAmountP;
  }

  return { subTotalP, gstTotalP };
}
