import { formatCurrency } from '@/types';
import { formatDate } from '@/lib/utils';
import type { Bill, Settings } from '@/types';

/**
 * The bill as a WhatsApp message.
 *
 * This replaces sending the PDF. The PDF path had to drive WhatsApp's own UI —
 * open the attach menu, pick "Document", capture the <input type=file>, inject
 * the file, then confirm the preview — and every one of those steps is at
 * WhatsApp's mercy. It broke: the "Document" menu item is `pointer-events:none`
 * and its bounding box is offset from the row it renders, so the click that
 * opened it landed on the menu container instead and the attach silently never
 * happened. A text message needs none of that machinery: WhatsApp fills the
 * composer itself from the `?text=` deep link, so there is nothing to click but
 * Send.
 *
 * Unlike every PDF generator in this app, ₹ is safe here. The pdf-lib
 * `StandardFonts` are WinAnsi-encoded and throw on U+20B9, which is why those
 * files all write "Rs." — a WhatsApp message is plain Unicode text with no such
 * limit, so `formatCurrency`'s default symbol is used as-is.
 */

/** Rupees with no trailing ".00" — "₹1,950" reads better in chat than "₹1,950.00". */
function money(paise: number): string {
  const text = formatCurrency(paise);
  return text.replace(/\.00$/, '');
}

export interface WhatsAppBillTextOptions {
  /** MM bills label themselves so a wholesale buyer isn't sent a studio receipt. */
  heading?: string;
}

/**
 * Compact layout: one line per item, a single GST line, bold grand total.
 *
 * Deliberately NOT a tax invoice — the printed thermal/A4 output remains the
 * real document. This is the "your bill is ready" notification, so it shows a
 * single GST figure rather than the CGST/SGST split; anyone querying the split
 * has the printed invoice.
 */
export function buildWhatsAppBillText(
  bill: Bill,
  settings: Partial<Settings>,
  options: WhatsAppBillTextOptions = {},
): string {
  const studio = options.heading ?? settings.studio?.studio_name ?? "The Maestro Studio's";
  const name = (bill.customer?.name ?? bill.mmCustomer?.name ?? '').trim();

  const lines: string[] = [];
  // *bold* is WhatsApp's own markup, not markdown — single asterisks.
  lines.push(`*${studio.toUpperCase()}*`);
  lines.push(`Bill ${bill.billNumber} · ${formatDate(bill.billDate)}`);
  lines.push('');
  lines.push(name ? `Hi ${name},` : 'Hi,');
  lines.push('');

  for (const item of bill.items ?? []) {
    // qty is not always whole (0.5 hr of studio time), so only drop the
    // decimals when there genuinely aren't any.
    const qty = Number.isInteger(item.qty) ? String(item.qty) : String(item.qty);
    lines.push(`${item.productName}  ${qty} × ${money(item.unitPrice)} = ${money(item.totalAmount)}`);
  }

  lines.push('');
  lines.push(`Subtotal  ${money(bill.subTotal)}`);
  if (bill.discountAmount > 0) lines.push(`Discount  −${money(bill.discountAmount)}`);
  if (bill.gstAmount > 0) lines.push(`GST  ${money(bill.gstAmount)}`);
  lines.push(`*TOTAL  ${money(bill.grandTotal)}*`);

  // MAIN bills only — MmBilling has no Billed By field (see CLAUDE.md).
  if (bill.billedByName) {
    lines.push('');
    lines.push(`Billed by ${bill.billedByName}`);
  }

  lines.push('');
  lines.push('Thank you!');

  return lines.join('\n');
}
