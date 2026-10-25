import type { Bill } from '@/types';
import { splitTaxP } from '@/lib/billMath';

export interface HsnGroup {
  hsnSac: string;
  taxableValue: number; // paise
  cgstRate: number;
  cgstAmount: number; // paise
  sgstRate: number;
  sgstAmount: number; // paise
  igstRate: number;
  igstAmount: number; // paise
}

/**
 * Groups a bill's items by (HSN/SAC, GST rate) and splits each group's tax
 * into CGST+SGST or IGST per the bill's isInterState flag. Shared by the
 * MM/A4 Tax Invoice's HSN summary table (lib/mmA4invoice.ts) and the GST
 * Report's detailed bill-wise CSV export (pages/GstReport.tsx) so the two
 * can never disagree on how a bill's tax breaks down by HSN code. Kept out
 * of mmA4invoice.ts (which eagerly imports pdf-lib) so importing this stays
 * light for pages like GstReport.tsx that never need the PDF generator.
 */
export function computeHsnSummary(bill: Bill): HsnGroup[] {
  const groups = new Map<string, HsnGroup>();
  for (const item of bill.items) {
    const key = `${item.hsnSac ?? '-'}|${item.gstRate}`;
    const baseAmt = item.totalAmount - item.gstAmount;
    const { cgstP, sgstP, igstP } = splitTaxP(item.gstAmount, bill.isInterState);
    const existing = groups.get(key);
    if (existing) {
      existing.taxableValue += baseAmt;
      existing.cgstAmount += cgstP;
      existing.sgstAmount += sgstP;
      existing.igstAmount += igstP;
    } else {
      groups.set(key, {
        hsnSac: item.hsnSac ?? '-',
        taxableValue: baseAmt,
        cgstRate: bill.isInterState ? 0 : item.gstRate / 2,
        cgstAmount: cgstP,
        sgstRate: bill.isInterState ? 0 : item.gstRate / 2,
        sgstAmount: sgstP,
        igstRate: bill.isInterState ? item.gstRate : 0,
        igstAmount: igstP,
      });
    }
  }
  return [...groups.values()];
}
