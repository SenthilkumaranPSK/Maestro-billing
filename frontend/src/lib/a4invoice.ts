import { PDFDocument, PDFFont, rgb, StandardFonts } from 'pdf-lib';
import type { Bill, Settings } from '@/types';
import { paisaToRupee } from '@/types';
import { amountInWordsINR } from '@/lib/amountInWords';
import { bytesToBase64 } from '@/lib/pdf';

/**
 * "Service Bill" A4 invoice — a second, full-page layout alongside the
 * thermal-roll receipt (lib/thermal.ts + lib/pdf.ts), for studios printing
 * on a normal A4 printer instead of (or in addition to) the receipt printer.
 * Modeled on a reference tax-invoice template supplied by the studio.
 */

const PAGE_W = 595.28; // A4, pt
const PAGE_H = 841.89;
const MARGIN = 32;

const BLACK = rgb(0.08, 0.08, 0.08);
const BRAND = rgb(0.53, 0.74, 0.19); // big studio-owner name
const ACCENT = rgb(0.78, 0.1, 0.55); // GSTIN/Invoice/Date + signature block
const BODY = rgb(0.1, 0.42, 0.28); // customer/service/item/bank text

// No Settings field for this yet (see conversation) — filled in from the
// reference invoice. Revisit if the studio needs to edit these from the UI.
const BANK_DETAILS = {
  accountName: 'MAESTRO YUVARAJ V',
  accountNumber: '510909010267230',
  accountType: 'Current Account',
  bankName: 'City Union Bank',
  branch: 'Fairlands, Salem',
  ifsc: 'CIUB0000188',
};

function wrapText(font: PDFFont, str: string, size: number, maxWidth: number): string[] {
  const words = str.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function formatDDMMYYYY(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** "Jan 21 / 2026" — matches the reference invoice's Service Date style. */
function formatShortDate(d: Date): string {
  const month = d.toLocaleDateString('en-IN', { month: 'short' });
  return `${month} ${d.getDate()} / ${d.getFullYear()}`;
}

function formatRupees(paise: number): string {
  // Whole-rupee amounts print without decimals (e.g. "18,000", matching the
  // reference invoice); anything with a paisa remainder always gets exactly
  // 2 decimals, never 1 (minimumFractionDigits:0 alone would print "11,800.5").
  const hasFraction = Math.round(paise) % 100 !== 0;
  return paisaToRupee(paise).toLocaleString('en-IN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export async function generateA4InvoicePDF(bill: Bill, settings: Partial<Settings>): Promise<Uint8Array> {
  const studio = settings.studio;
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;
  const outerTop = PAGE_H - MARGIN;
  const outerBottom = MARGIN;

  const hline = (yPos: number, x1 = left, x2 = right) =>
    page.drawLine({ start: { x: x1, y: yPos }, end: { x: x2, y: yPos }, thickness: 0.75, color: BLACK });
  const vline = (xPos: number, y1: number, y2: number) =>
    page.drawLine({ start: { x: xPos, y: y1 }, end: { x: xPos, y: y2 }, thickness: 0.75, color: BLACK });

  interface TextOpts {
    size?: number;
    font?: PDFFont;
    color?: ReturnType<typeof rgb>;
    align?: 'left' | 'right' | 'center';
    maxWidth?: number;
  }
  const text = (str: string, x: number, yPos: number, opts: TextOpts = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 9.5;
    const color = opts.color ?? BLACK;
    const w = font.widthOfTextAtSize(str, size);
    let drawX = x;
    if (opts.align === 'right') {
      drawX = opts.maxWidth !== undefined ? x + opts.maxWidth - w : x - w;
    } else if (opts.align === 'center') {
      drawX = opts.maxWidth !== undefined ? x + (opts.maxWidth - w) / 2 : x - w / 2;
    }
    page.drawText(str, { x: drawX, y: yPos, size, font, color });
  };

  let y = outerTop;

  // ── Header ───────────────────────────────────────────────────────────────
  const studioOwner = (studio?.studio_owner || studio?.studio_name || 'Studio').toUpperCase();
  const studioName = studio?.studio_name || "The Studio's";
  const studioAddress = studio?.studio_address || '';
  const studioPhone = studio?.studio_phone || '';
  const studioGstin = studio?.studio_gstin || '';

  y -= 26;
  text(studioOwner, left + 14, y, { size: 22, font: bold, color: BRAND });

  const rightColX = right - 200;
  let ry = y + 2;
  if (studioGstin) {
    text(`GSTIN : ${studioGstin}`, rightColX, ry, { size: 9.5, font: bold, color: ACCENT });
    ry -= 15;
  }
  text(`Invoice : ${bill.billNumber}`, rightColX, ry, { size: 9.5, font: bold, color: ACCENT });
  ry -= 15;
  text(`Date : ${formatDDMMYYYY(new Date(bill.billDate))}`, rightColX, ry, { size: 9.5, font: bold, color: ACCENT });

  y -= 18;
  if (studioAddress) {
    text(studioAddress.replace(/\n/g, ', '), left, y, { size: 9, color: ACCENT, align: 'center', maxWidth: contentW - 210 });
    y -= 13;
  }
  if (studioPhone) {
    text(`Mobile : ${studioPhone}`, left, y, { size: 9, color: ACCENT, align: 'center', maxWidth: contentW - 210 });
    y -= 13;
  }

  y -= 8;
  hline(y);
  y -= 18;

  // ── "Service Bill From" / "Tax Invoice" row ─────────────────────────────
  text(`Service Bill From : ${studioName}`, left + 8, y, { size: 9.5 });
  text('Tax Invoice', right - 8, y, { size: 10, font: bold, align: 'right' });
  y -= 10;
  hline(y);

  // ── 3-column info box: Service Bill To / Service Details / Service Date ──
  const colA_W = contentW * 0.42;
  const colB_W = contentW * 0.32;
  const colA_X = left;
  const colB_X = left + colA_W;
  const colC_X = colB_X + colB_W;

  // Wrapped line arrays are computed once, up front, and reused for both the
  // height calculation below AND the actual drawing — an unusually long
  // customer name/address or Service Description used to just draw past a
  // fixed 108pt box height and overlap the item table header underneath it.
  const custNameLines = bill.customer ? wrapText(bold, bill.customer.name, 9.5, colA_W - 16) : [];
  const custAddressLines = bill.customer?.address ? wrapText(regular, bill.customer.address, 9, colA_W - 16) : [];
  const serviceDescLines = bill.serviceDescription ? wrapText(regular, bill.serviceDescription, 9, colB_W - 16) : [];

  // '0000000000' is the seeded Walk-in Customer's placeholder phone, not a
  // real number — showing it on a printed invoice would look like a mistake.
  const showCustPhone = !!bill.customer?.phone && bill.customer.phone !== '0000000000';

  const colA_ContentH = bill.customer
    ? 14 + custNameLines.length * 12.5 + custAddressLines.length * 12 + (showCustPhone ? 12 : 0) + (bill.customer.gstin ? 12 : 0)
    : 14 + 13;
  const colB_ContentH = 14 + serviceDescLines.length * 12;
  const colC_ContentH = 14 + (bill.serviceFrom || bill.serviceTo ? [bill.serviceFrom, bill.serviceTo].filter(Boolean).length : 1) * 12;

  const infoTop = y;
  const infoBoxH = Math.max(108, colA_ContentH, colB_ContentH, colC_ContentH) + 6; // 6pt bottom padding
  const infoBottom = infoTop - infoBoxH;

  hline(infoBottom);
  vline(colB_X, infoBottom, infoTop);
  vline(colC_X, infoBottom, infoTop);

  let cy = infoTop - 14;
  text('Service Bill To :', colA_X + 8, cy, { size: 9.5, font: bold });
  cy -= 14;
  if (bill.customer) {
    for (const line of custNameLines) {
      text(line, colA_X + 8, cy, { size: 9.5, font: bold, color: BODY });
      cy -= 12.5;
    }
    for (const line of custAddressLines) {
      text(line, colA_X + 8, cy, { size: 9, color: BODY });
      cy -= 12;
    }
    if (showCustPhone) {
      text(`Mobile : ${bill.customer.phone}`, colA_X + 8, cy, { size: 9, color: BODY });
      cy -= 12;
    }
    if (bill.customer.gstin) {
      text(`GST IN : ${bill.customer.gstin}`, colA_X + 8, cy, { size: 9, color: BODY });
    }
  } else {
    text('Walk-in Customer', colA_X + 8, cy, { size: 9.5, color: BODY });
  }

  cy = infoTop - 14;
  text('Service Details :', colB_X + 8, cy, { size: 9.5, font: bold });
  cy -= 14;
  for (const line of serviceDescLines) {
    text(line, colB_X + 8, cy, { size: 9, color: BODY });
    cy -= 12;
  }

  cy = infoTop - 14;
  text('Service Date :', colC_X + 8, cy, { size: 9.5, font: bold });
  cy -= 14;
  if (bill.serviceFrom || bill.serviceTo) {
    if (bill.serviceFrom) {
      text(formatShortDate(new Date(bill.serviceFrom)), colC_X + 8, cy, { size: 9, color: BODY });
      cy -= 12;
    }
    if (bill.serviceTo) {
      text(formatShortDate(new Date(bill.serviceTo)), colC_X + 8, cy, { size: 9, color: BODY });
    }
  } else {
    text(formatShortDate(new Date(bill.billDate)), colC_X + 8, cy, { size: 9, color: BODY });
  }

  y = infoBottom;

  // ── Item table ───────────────────────────────────────────────────────────
  // SN is its own column (not "1. Product Name" folded into the description)
  // to match the reference tax-bill layout, same as the thermal receipt's
  // "SN  Product" header.
  const cols = [
    { label: 'SN', x: 0, w: contentW * 0.05 },
    { label: 'PRODUCT', x: 0, w: contentW * 0.37 },
    { label: 'QUANTITY', x: 0, w: contentW * 0.14 },
    { label: 'PRICE', x: 0, w: contentW * 0.13 },
    { label: 'HSN / SAC', x: 0, w: contentW * 0.13 },
    { label: 'AMOUNT', x: 0, w: contentW * 0.18 },
  ];
  {
    let cx = left;
    for (const c of cols) {
      c.x = cx;
      cx += c.w;
    }
  }

  const tableTop = y;
  const tableHeaderH = 22;
  const tableHeaderBottom = tableTop - tableHeaderH;

  text(cols[0]!.label, cols[0]!.x + 8, tableTop - 15, { size: 9.5, font: bold });
  text(cols[1]!.label, cols[1]!.x + 8, tableTop - 15, { size: 9.5, font: bold });
  for (const c of cols.slice(2, -1)) {
    text(c.label, c.x, tableTop - 15, { size: 9, font: bold, align: 'center', maxWidth: c.w });
  }
  // AMOUNT is the one column whose row data is right-aligned (money reads
  // right-to-left for digit-place comparison), not centered like Qty/Price/
  // HSN — its header must use the same align+maxWidth as the row values
  // below (see the item loop), or the header centers over the column while
  // the actual figures hug the right edge, landing ~10pt apart.
  const amountCol = cols[cols.length - 1]!;
  text(amountCol.label, amountCol.x, tableTop - 15, { size: 9, font: bold, align: 'right', maxWidth: amountCol.w - 8 });
  hline(tableHeaderBottom);

  // Totals and bank/signature blocks are anchored to fixed positions from the
  // bottom of the page — not "directly under however many item rows there
  // are" — so a short bill doesn't leave a big blank rectangle between the
  // content and the page's outer border. The item table box itself extends
  // down to fill whatever space that leaves (real rows on top, blank space
  // within the same border below, same as a paper invoice with unused lines).
  // Fixed height regardless of how many rows actually apply (Sub Total /
  // CGST / SGST / Discount / Round Off / Grand Total) — the render loop
  // divides it by the real row count, so extra rows just make each one
  // proportionally shorter instead of overflowing.
  const totalsBoxH = 22 * 4;
  const bankBoxH = 130;
  const bankBoxBottom = outerBottom;
  const bankBoxTop = bankBoxBottom + bankBoxH;
  const totalsBoxBottom = bankBoxTop;
  const totalsBoxTop = totalsBoxBottom + totalsBoxH;
  const tableBottom = totalsBoxTop;
  const availableTableH = tableHeaderBottom - tableBottom;

  const LINE_H = 11;
  const ROW_PAD = 8;
  const BASE_ROW_H = 20;
  const itemLines = bill.items.map((item) =>
    wrapText(regular, item.productName, 9, cols[1]!.w - 16),
  );
  const naturalRowHeights = itemLines.map((lines) => Math.max(BASE_ROW_H, lines.length * LINE_H + ROW_PAD));
  const naturalTotalH = naturalRowHeights.reduce((s, h) => s + h, 0);
  // A very long bill (many items / long names) won't fit one A4 page at
  // natural size — compress proportionally as a last resort rather than
  // overlapping the totals/bank blocks. True pagination is a future
  // improvement if that turns out to be a common case.
  const scale = naturalTotalH > availableTableH && naturalTotalH > 0 ? availableTableH / naturalTotalH : 1;

  let ty = tableHeaderBottom;
  bill.items.forEach((item, i) => {
    const rowH = naturalRowHeights[i]! * scale;
    const lines = itemLines[i]!;
    const lineH = Math.min(LINE_H, (rowH - ROW_PAD) / lines.length);
    const rowMid = ty - rowH / 2 - 3;
    text(String(i + 1), cols[0]!.x, rowMid, { size: 9, color: BODY, align: 'center', maxWidth: cols[0]!.w });
    let ly = ty - ROW_PAD / 2 - 8;
    for (const line of lines) {
      text(line, cols[1]!.x + 8, ly, { size: 9, color: BODY });
      ly -= lineH;
    }
    text(`${item.qty} ${item.unit}`, cols[2]!.x, rowMid, { size: 9, color: BODY, align: 'center', maxWidth: cols[2]!.w });
    text(`Rs ${paisaToRupee(item.unitPrice).toFixed(2)}`, cols[3]!.x, rowMid, { size: 9, color: BODY, align: 'center', maxWidth: cols[3]!.w });
    text(item.hsnSac ?? '-', cols[4]!.x, rowMid, { size: 9, color: BODY, align: 'center', maxWidth: cols[4]!.w });
    const lineAmount = Math.round(item.qty * item.unitPrice);
    text(`Rs ${formatRupees(lineAmount)}`, cols[5]!.x, rowMid, { size: 9, color: BODY, align: 'right', maxWidth: cols[5]!.w - 8 });
    ty -= rowH;
  });

  vline(left, tableBottom, tableTop);
  vline(right, tableBottom, tableTop);
  for (const c of cols.slice(1)) vline(c.x, tableBottom, tableTop);
  hline(tableBottom);

  y = tableBottom;

  // ── Amount in words + totals box ────────────────────────────────────────
  const wordsW = contentW * 0.6;
  const totalsX = left + wordsW;

  text('Amount in Words :', left + 8, y - 16, { size: 9.5, font: bold });
  let wordsY = y - 32;
  for (const line of wrapText(regular, amountInWordsINR(bill.grandTotal), 9.5, wordsW - 16)) {
    text(line, left + 8, wordsY, { size: 9.5, color: BODY });
    wordsY -= 13;
  }
  if (bill.gstInclusive && bill.gstAmount > 0) {
    text('(Price is inclusive of applicable GST)', left + 8, wordsY - 4, { size: 8, color: BODY });
  }

  // GST-inclusive bills print as a single all-in figure — no separate
  // CGST/SGST breakdown — since the whole point of that pricing mode is
  // "one sticker price", not a line-itemized tax split.
  const gstRates = [...new Set(bill.items.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
  const halfRate = gstRates.length === 1 ? gstRates[0]! / 2 : undefined;
  // [label, amount, mid?] — mid is the total-quantity note shown next to Sub
  // Total, matching the thermal receipt's equivalent 3-column row.
  const totalRows: Array<[string, number, string?]> = [];
  if (!bill.gstInclusive) {
    const totalQty = bill.items.reduce((s, i) => s + i.qty, 0);
    totalRows.push(['Sub Total', bill.subTotal, `${totalQty} No`]);
    if (bill.gstAmount > 0) {
      const half = Math.floor(bill.gstAmount / 2);
      totalRows.push([halfRate !== undefined ? `CGST @ ${halfRate}%` : 'CGST', half]);
      totalRows.push([halfRate !== undefined ? `SGST @ ${halfRate}%` : 'SGST', bill.gstAmount - half]);
    }
  }
  if (bill.discountAmount > 0) totalRows.push(['Discount', -bill.discountAmount]);
  // Derived, not a stored field — same computation as the thermal receipt
  // (lib/thermal.ts): items-incl-GST minus discount vs. the actual grand
  // total. Without this line the printed items wouldn't add up to the
  // printed Grand Total whenever rounding to the nearest rupee applied.
  const itemsTotal = bill.items.reduce((s, i) => s + i.totalAmount, 0);
  const roundOff = bill.grandTotal - (itemsTotal - bill.discountAmount);
  if (roundOff !== 0) totalRows.push(['Round Off', roundOff]);
  totalRows.push(['Grand Total', bill.grandTotal]);

  const totalsRowH = totalsBoxH / totalRows.length;
  vline(totalsX, y - totalsBoxH, y);
  let tty = y;
  totalRows.forEach(([label, amount, mid], i) => {
    const isLast = i === totalRows.length - 1;
    if (i > 0) hline(tty, totalsX, right);
    const f = isLast ? bold : regular;
    const size = isLast ? 10 : 9.5;
    text(label, totalsX + 8, tty - totalsRowH / 2 - 3, { size, font: f, color: isLast ? BLACK : BLACK });
    if (mid) {
      text(mid, totalsX + (right - totalsX) * 0.45, tty - totalsRowH / 2 - 3, { size, font: f, color: BODY });
    }
    const amtStr = `${amount < 0 ? '-' : ''}Rs ${formatRupees(Math.abs(amount))}`;
    text(amtStr, right - 8, tty - totalsRowH / 2 - 3, { size, font: f, color: BODY, align: 'right' });
    tty -= totalsRowH;
  });
  hline(y - totalsBoxH);

  y -= totalsBoxH;
  hline(y);

  // ── Bank details + signature ────────────────────────────────────────────
  const bankColW = contentW * 0.55;
  vline(left + bankColW, y - bankBoxH, y);

  let by = y - 16;
  text('Bank Account Details :', left + 8, by, { size: 9.5, font: bold, color: BODY });
  by -= 15;
  const bankLines: Array<[string, string]> = [
    ['Account Name', BANK_DETAILS.accountName],
    ['Account Number', BANK_DETAILS.accountNumber],
    ['Account Type', BANK_DETAILS.accountType],
    ['Bank Name', BANK_DETAILS.bankName],
    ['Branch', BANK_DETAILS.branch],
    ['IFSC Code', BANK_DETAILS.ifsc],
  ];
  for (const [label, value] of bankLines) {
    text(label, left + 8, by, { size: 8.5, color: BODY });
    text(`-  ${value}`, left + 105, by, { size: 8.5, color: BODY });
    by -= 12.5;
  }

  const sigX = left + bankColW;
  const sigW = contentW - bankColW;
  text(`For ${studioName.toUpperCase()}`, sigX, y - 22, { size: 9.5, font: bold, color: ACCENT, align: 'center', maxWidth: sigW });
  text('Authorised Signature', sigX, y - bankBoxH + 16, { size: 9, color: ACCENT, align: 'center', maxWidth: sigW });

  y -= bankBoxH;

  // ── Outer border ─────────────────────────────────────────────────────────
  page.drawRectangle({
    x: left,
    y: outerBottom,
    width: contentW,
    height: outerTop - outerBottom,
    borderColor: BLACK,
    borderWidth: 1,
  });

  return doc.save();
}

export async function generateA4InvoicePDFBase64(bill: Bill, settings: Partial<Settings>): Promise<string> {
  const bytes = await generateA4InvoicePDF(bill, settings);
  return bytesToBase64(bytes);
}

export async function downloadA4InvoicePDF(bill: Bill, settings: Partial<Settings>) {
  const bytes = await generateA4InvoicePDF(bill, settings);
  const blob = new Blob([bytes.buffer.slice(0) as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${bill.billNumber}-invoice.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function printA4InvoicePDF(bill: Bill, settings: Partial<Settings>) {
  const bytes = await generateA4InvoicePDF(bill, settings);
  const blob = new Blob([bytes.buffer.slice(0) as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (iframe.parentNode) document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    };
    // afterprint fires once the print dialog is actually dismissed (printed
    // or cancelled). A fixed short timer here used to destroy this iframe
    // (and revoke its blob: URL) out from under a print dialog the operator
    // was still interacting with — e.g. switching the destination printer,
    // which takes a few seconds while the preview re-renders — which could
    // take the whole print flow (and in some cases the window) down mid
    // interaction. The timeout below is only a fallback in case afterprint
    // never fires (not guaranteed on every platform/embedder).
    iframe.contentWindow?.addEventListener('afterprint', cleanup);
    iframe.contentWindow?.print();
    setTimeout(cleanup, 60_000);
  };
}
