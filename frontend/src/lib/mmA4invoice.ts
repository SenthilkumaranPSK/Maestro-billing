import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import type { Bill, Settings } from '@/types';
import { paisaToRupee } from '@/types';
import { amountInWordsINR } from '@/lib/amountInWords';
import { bytesToBase64 } from '@/lib/pdf';
import { embedBrandFonts } from '@/lib/brandFont';
import { hexRgb, wrapText, formatDDMMYYYY, formatRupees, BANK_DETAILS } from '@/lib/a4invoice';

/**
 * MM/A4 "Tax Invoice" — a third print layout alongside the thermal receipt
 * and the retail-style A4 "Service Bill" invoice, for the occasional formal
 * GST tax invoice (goods dispatch, Buyer + separate Consignee, e-way details,
 * HSN-wise CGST/SGST breakdown). Modeled on a wholesale tax-invoice template
 * supplied by the studio (maestro1.pdf) — same studio/bank details as the A4
 * layout, reused via a4invoice.ts's exports rather than duplicated.
 *
 * No QR code: the reference template's QR encodes a government e-invoice
 * IRN. This app never registers invoices with that portal, so there is
 * nothing genuine to encode — a decorative QR on a tax document would be
 * actively misleading. irnNo (if the studio has one from elsewhere) still
 * prints as plain text.
 */

const PAGE_W = 595.28; // A4, pt
const PAGE_H = 841.89;
const MARGIN = 28;

const BLACK = rgb(0.08, 0.08, 0.08);
const BODY = hexRgb('397601');
const ACCENT = hexRgb('b400ff');

// Static — no Settings field for GST boilerplate text exists, and
// invoice_footer already means something else (the thermal receipt's
// "Thank You" line). Standard wording used on most Indian tax invoices.
const TERMS_TEXT =
  'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.';

function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

interface HsnGroup {
  hsnSac: string;
  taxableValue: number; // paise
  cgstRate: number;
  cgstAmount: number; // paise
  sgstRate: number;
  sgstAmount: number; // paise
}

function computeHsnSummary(bill: Bill): HsnGroup[] {
  const groups = new Map<string, HsnGroup>();
  for (const item of bill.items) {
    const key = `${item.hsnSac ?? '-'}|${item.gstRate}`;
    const baseAmt = item.totalAmount - item.gstAmount;
    const half = Math.floor(item.gstAmount / 2);
    const existing = groups.get(key);
    if (existing) {
      existing.taxableValue += baseAmt;
      existing.cgstAmount += half;
      existing.sgstAmount += item.gstAmount - half;
    } else {
      groups.set(key, {
        hsnSac: item.hsnSac ?? '-',
        taxableValue: baseAmt,
        cgstRate: item.gstRate / 2,
        cgstAmount: half,
        sgstRate: item.gstRate / 2,
        sgstAmount: item.gstAmount - half,
      });
    }
  }
  return [...groups.values()];
}

interface RowLayout {
  lines: string[];
  height: number;
}

export async function generateMmA4InvoicePDF(bill: Bill, settings: Partial<Settings>): Promise<Uint8Array> {
  const studio = settings.studio;
  const doc = await PDFDocument.create();
  const { regular, bold } = await embedBrandFonts(doc);

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;

  const THIN = 0.4;

  interface TextOpts {
    size?: number;
    font?: PDFFont;
    color?: ReturnType<typeof rgb>;
    align?: 'left' | 'right' | 'center';
    maxWidth?: number;
  }

  // All drawing helpers are bound to whichever page is "current" — reassigned
  // at the top of each page's render pass in the pagination loop below.
  let page: PDFPage;
  const hline = (yPos: number, x1 = left, x2 = right, thickness = THIN) =>
    page.drawLine({ start: { x: x1, y: yPos }, end: { x: x2, y: yPos }, thickness, color: BLACK });
  const vline = (xPos: number, y1: number, y2: number, thickness = THIN) =>
    page.drawLine({ start: { x: xPos, y: y1 }, end: { x: xPos, y: y2 }, thickness, color: BLACK });
  const shadeRect = (x: number, y: number, w: number, h: number, gray = 0.85) =>
    page.drawRectangle({ x, y, width: w, height: h, color: rgb(gray, gray, gray) });
  const text = (str: string, x: number, yPos: number, opts: TextOpts = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 9;
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

  // ── Header block content (identical on every page) ─────────────────────
  const studioName = studio?.studio_name || "The Studio's";
  const studioAddress = studio?.studio_address || '';
  const studioPhone = studio?.studio_phone || '';
  const studioGstin = studio?.studio_gstin || '';
  const studioEmail = studio?.studio_email || '';

  const addressLines = studioAddress ? wrapText(regular, studioAddress.replace(/\n/g, ', '), 9, contentW - 40) : [];
  const gstinContactLine = [studioGstin ? `GSTIN : ${studioGstin}` : '', studioPhone ? `Contact : ${studioPhone}` : '']
    .filter(Boolean)
    .join('   ');
  const emailLine = studioEmail ? `E-Mail : ${studioEmail}` : '';

  // Draws the header + divider on the CURRENT page, returns the y just below it.
  function drawHeader(): number {
    let hy = PAGE_H - MARGIN;
    text(studioName, left, hy - 18, { size: 18, font: bold, align: 'center', maxWidth: contentW });
    hy -= 32;
    for (const line of addressLines) {
      text(line, left, hy, { size: 9, align: 'center', maxWidth: contentW });
      hy -= 12;
    }
    if (gstinContactLine) {
      text(gstinContactLine, left, hy, { size: 9, align: 'center', maxWidth: contentW });
      hy -= 12;
    }
    if (emailLine) {
      text(emailLine, left, hy, { size: 9, align: 'center', maxWidth: contentW });
      hy -= 12;
    }
    if (bill.irnNo) {
      hy -= 4;
      hline(hy);
      hy -= 12;
      text(`IRN No : ${bill.irnNo}`, left + 4, hy, { size: 8 });
      hy -= 8;
    }
    hy -= 4;
    hline(hy, left, right, 0.6);
    return hy - 2;
  }

  // ── Buyer / Consignee / Invoice-info box content (identical every page) ──
  // MM bills carry their customer via mmCustomer (mmCustomerId), never the
  // main-series customer FK — reading bill.customer here always came up
  // blank for a real MM bill.
  const isPlaceholderCustomer = bill.mmCustomer?.phone === '0000000000';
  const buyerName = isPlaceholderCustomer ? 'Customer' : bill.mmCustomer?.name ?? 'Customer';
  const consigneeName = bill.consigneeName || buyerName;
  const consigneeAddress = bill.consigneeName ? bill.consigneeAddress : bill.mmCustomer?.address;
  const consigneeGstin = bill.consigneeName ? bill.consigneeGstin : bill.mmCustomer?.gstin;

  // Invoice-info column needs enough room for "label : value" on one line
  // (e.g. "Other Reference : PO-2026-118") — 38/38 left it too narrow and
  // the label/value collided.
  const colA_W = contentW * 0.33;
  const colB_W = contentW * 0.33;
  const colA_X = left;
  const colB_X = left + colA_W;
  const colC_X = colB_X + colB_W;
  const colC_W = right - colC_X;

  function buildPartyLines(name: string, address: string | undefined, gstin: string | undefined, phone: string | undefined) {
    const lines: Array<{ text: string; font: PDFFont; size: number }> = [
      { text: name, font: bold, size: 9.5 },
    ];
    if (address) {
      for (const l of wrapText(regular, address, 9, colA_W - 16)) lines.push({ text: l, font: regular, size: 9 });
    }
    if (gstin) lines.push({ text: `GSTIN : ${gstin}`, font: regular, size: 9 });
    if (phone) lines.push({ text: `Ph : ${phone}`, font: regular, size: 9 });
    return lines;
  }
  const buyerLines = buildPartyLines(buyerName, bill.mmCustomer?.address, bill.mmCustomer?.gstin, bill.mmCustomer?.phone);
  const consigneeLines = buildPartyLines(consigneeName, consigneeAddress, consigneeGstin, undefined);

  const invoiceInfoRows: Array<[string, string]> = [
    ['Invoice No', bill.billNumber],
    ['Dated', formatDDMMYYYY(new Date(bill.billDate))],
    ...(bill.vehicleNo ? [['Vehicle No', bill.vehicleNo] as [string, string]] : []),
    ...(bill.despatchedThrough ? [['Despatched Through', bill.despatchedThrough] as [string, string]] : []),
    ...(bill.destination ? [['Destination', bill.destination] as [string, string]] : []),
    ...(bill.otherReference ? [['Other Reference', bill.otherReference] as [string, string]] : []),
  ];

  const LINE_GAP = 13;
  const partyBoxH = (labelH: number) => 16 + labelH * LINE_GAP + 6;
  // "TAX INVOICE" sits in its own mini-box (closed by one extra hline) above
  // a single-line label:value grid — one row per field, not the old
  // stacked label-then-bold-value pair.
  const TAXINV_BOX_H = 20;
  const INFO_ROW_H = 14;
  const invoiceBoxH = TAXINV_BOX_H + 12 + invoiceInfoRows.length * INFO_ROW_H + 8;
  // E-Way Bill No is bottom-anchored in the Consignee column instead of just
  // another invoice-info row — reserve extra room there when it's present.
  const consigneeExtra = bill.ewayBillNo ? 18 : 0;
  const infoBoxH = Math.max(
    partyBoxH(buyerLines.length + 1),
    partyBoxH(consigneeLines.length + 1) + consigneeExtra,
    invoiceBoxH,
  );

  function drawPartyBox(topY: number): number {
    const boxTop = topY;
    const boxBottom = boxTop - infoBoxH;
    hline(boxBottom);
    vline(colB_X, boxBottom, boxTop);
    vline(colC_X, boxBottom, boxTop);

    let by = boxTop - 14;
    text('Buyer :-', colA_X + 8, by, { size: 9, font: bold });
    let cy = boxTop - 14;
    text('Consignee :-', colB_X + 8, cy, { size: 9, font: bold });
    by -= LINE_GAP;
    cy -= LINE_GAP;
    for (const ln of buyerLines) {
      text(ln.text, colA_X + 8, by, { size: ln.size, font: ln.font, color: BODY, maxWidth: colA_W - 16 });
      by -= LINE_GAP;
    }
    for (const ln of consigneeLines) {
      text(ln.text, colB_X + 8, cy, { size: ln.size, font: ln.font, color: BODY, maxWidth: colB_W - 16 });
      cy -= LINE_GAP;
    }
    if (bill.ewayBillNo) {
      text(`E-Way Bill No : ${bill.ewayBillNo}`, colB_X + 8, boxBottom + 8, { size: 8 });
    }

    text('TAX INVOICE', colC_X + 8, boxTop - 14, { size: 10.5, font: bold, align: 'center', maxWidth: colC_W - 16 });
    hline(boxTop - TAXINV_BOX_H, colC_X, right);
    let iy = boxTop - TAXINV_BOX_H - 12;
    for (const [label, value] of invoiceInfoRows) {
      text(label, colC_X + 8, iy, { size: 8, color: BODY });
      text(`: ${value}`, right - 8, iy, { size: 8.5, font: bold, align: 'right' });
      iy -= INFO_ROW_H;
    }
    return boxBottom;
  }

  // ── Item table columns ───────────────────────────────────────────────────
  const cols = [
    { key: 'sno', label: 'S.No', x: 0, w: contentW * 0.05 },
    { key: 'particulars', label: 'Particulars', x: 0, w: contentW * 0.37 },
    { key: 'hsn', label: 'HSN', x: 0, w: contentW * 0.1 },
    { key: 'qty', label: 'Quantity', x: 0, w: contentW * 0.14 },
    { key: 'rate', label: 'Rate', x: 0, w: contentW * 0.12 },
    { key: 'per', label: 'Per', x: 0, w: contentW * 0.08 },
    { key: 'amount', label: 'Amount', x: 0, w: contentW * 0.14 },
  ];
  {
    let cx = left;
    for (const c of cols) {
      c.x = cx;
      cx += c.w;
    }
  }
  const sameUnit = bill.items.length > 0 && bill.items.every((i) => i.unit === bill.items[0]!.unit);
  const totalQty = bill.items.reduce((s, i) => s + i.qty, 0);

  const TABLE_HEADER_H = 24;
  function drawTableHeader(topY: number): number {
    const headerBottom = topY - TABLE_HEADER_H;
    shadeRect(left, headerBottom, contentW, TABLE_HEADER_H);
    const baseline = topY - TABLE_HEADER_H / 2 - 3;
    text(cols[0]!.label, cols[0]!.x, baseline, { size: 8.5, font: bold, align: 'center', maxWidth: cols[0]!.w });
    text(cols[1]!.label, cols[1]!.x + 6, baseline, { size: 8.5, font: bold });
    for (const c of cols.slice(2)) {
      text(c.label, c.x, baseline, { size: 8.5, font: bold, align: 'center', maxWidth: c.w });
    }
    hline(headerBottom);
    return headerBottom;
  }

  const ROW_LINE_H = 10.5;
  const ROW_PAD = 16;
  const rowLayouts: RowLayout[] = bill.items.map((item) => {
    const lines = wrapText(regular, item.productName, 8.5, cols[1]!.w - 12);
    return { lines, height: Math.max(30, lines.length * ROW_LINE_H + ROW_PAD) };
  });

  // ── Summary block (totals / words / bank / HSN summary / terms /
  //    signature) — rendered only on the last page, but its height is
  //    computed once up front so pagination is consistent across pages. ──
  const hsnGroups = computeHsnSummary(bill);
  const gstRates = [...new Set(bill.items.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
  const halfRate = gstRates.length === 1 ? gstRates[0]! / 2 : undefined;

  const TOTAL_ROW_H = 20;
  // "Amount in words" wraps to a variable number of lines depending on the
  // actual grand total (a multi-lakh/crore figure needs more lines than a
  // small one) — computed once here from the real bill, not a fixed guess,
  // so a large amount can't overflow into the GST-summary column beside it.
  const wordsW = contentW * 0.6 - 16;
  const wordsLines = wrapText(regular, amountInWordsINR(bill.grandTotal), 9, wordsW);
  const leftContentH = 26 + wordsLines.length * 12 + 4 + 12 + 4 * 11 + 6; // words + bank-detail block
  const rightContentH = 14 + 13 + 15 + 13 + 10; // CGST + SGST + divider gap + Total Value row + padding
  const WORDS_BANK_H = Math.max(leftContentH, rightContentH);
  const HSN_ROW_H = 13;
  // Matches exactly what the HSN-summary render loop below consumes: a 12pt
  // offset before the header row, then one HSN_ROW_H per header + group +
  // total row. Always reserved now — the table always renders.
  const hsnTableH = 12 + (hsnGroups.length + 2) * HSN_ROW_H;
  const TERMS_H = 30;
  const SIGNATURE_H = 50;
  const summaryBlockH = TOTAL_ROW_H + WORDS_BANK_H + hsnTableH + TERMS_H + SIGNATURE_H;

  // ── Paginate items ───────────────────────────────────────────────────────
  const bottomLimit = MARGIN;
  // Every page's item table stops at the same fixed line, reserving room for
  // the summary block whether or not this particular page turns out to be
  // the last one — the table border still stretches down to it either way
  // (blank ruled space on a continuation page, same "stretch to fill" look
  // the A4 layout already uses), and the summary content itself only
  // actually gets drawn when isLast.
  const reservedBottomY = bottomLimit + summaryBlockH;
  const pages: RowLayout[][] = [];
  let current: RowLayout[] = [];
  let currentH = 0;

  function drawHeaderHeight(): number {
    // Mirrors drawHeader()'s vertical consumption without touching `page`.
    let h = 32 + addressLines.length * 12 + (gstinContactLine ? 12 : 0) + (emailLine ? 12 : 0);
    if (bill.irnNo) h += 24;
    h += 6;
    return h;
  }
  // Computed against the header/party-box's (identical on every page) actual
  // height, so every page reserves the same item-table space regardless of
  // whether it turns out to be first, middle, or last.
  const availableItemsH = PAGE_H - MARGIN - drawHeaderHeight() - infoBoxH - TABLE_HEADER_H - reservedBottomY;

  for (const rl of rowLayouts) {
    if (current.length > 0 && currentH + rl.height > availableItemsH) {
      pages.push(current);
      current = [];
      currentH = 0;
    }
    current.push(rl);
    currentH += rl.height;
  }
  pages.push(current); // always at least one page, even with 0 items (shouldn't happen — bills require >=1 item)

  // ── Render pages ─────────────────────────────────────────────────────────
  let itemIndex = 0;
  pages.forEach((pageRows, pageIdx) => {
    const isLast = pageIdx === pages.length - 1;
    page = doc.addPage([PAGE_W, PAGE_H]);

    let y = drawHeader();
    y = drawPartyBox(y);
    let ty = drawTableHeader(y);

    for (const rl of pageRows) {
      const item = bill.items[itemIndex]!;
      const rowTop = ty;
      const rowMid = rowTop - rl.height / 2 - 3;
      text(String(itemIndex + 1), cols[0]!.x, rowMid, { size: 8.5, color: BODY, align: 'center', maxWidth: cols[0]!.w });
      let ly = rowTop - ROW_PAD / 2 - 8;
      for (const line of rl.lines) {
        text(line, cols[1]!.x + 6, ly, { size: 8.5, color: BODY });
        ly -= ROW_LINE_H;
      }
      text(item.hsnSac ?? '-', cols[2]!.x, rowMid, { size: 8.5, color: BODY, align: 'center', maxWidth: cols[2]!.w });
      const baseAmt = item.totalAmount - item.gstAmount;
      const baseUnitPrice = item.qty ? baseAmt / item.qty : item.unitPrice;
      text(`${formatQty(item.qty)} ${item.unit}`, cols[3]!.x, rowMid, { size: 8.5, color: BODY, align: 'center', maxWidth: cols[3]!.w });
      text(paisaToRupee(baseUnitPrice).toFixed(2), cols[4]!.x, rowMid, { size: 8.5, color: BODY, align: 'center', maxWidth: cols[4]!.w });
      text(item.unit, cols[5]!.x, rowMid, { size: 8.5, color: BODY, align: 'center', maxWidth: cols[5]!.w });
      text(formatRupees(baseAmt), cols[6]!.x, rowMid, { size: 8.5, color: BODY, align: 'right', maxWidth: cols[6]!.w - 6 });
      ty -= rl.height;
      itemIndex++;
    }

    // On the last page the table stretches down to the reserved summary
    // line regardless of how far the actual rows reached (blank ruled space
    // below them, same "stretch to fill" look the A4 layout already uses).
    // A continuation page instead stops right after its own last row (plus a
    // small gap for "Continue...") — reservedBottomY can sit very close to
    // where a nearly-full page's last row ends, and stretching to it there
    // used to print "Continue..." right on top of that row's own text.
    const tableBottom = isLast ? reservedBottomY : Math.min(ty - 22, reservedBottomY);
    // On the last page, the S.No/Particulars/HSN column boundaries stop at
    // the top of the Total row instead of running through it, so "Total"
    // reads as one merged cell (the Quantity column boundary stays
    // full-height — that's the merged cell's real right edge).
    const totalRowTop = tableBottom + TOTAL_ROW_H;
    vline(left, tableBottom, y);
    vline(right, tableBottom, y);
    for (const c of cols.slice(1)) {
      const mergeIntoTotal = isLast && (c.key === 'particulars' || c.key === 'hsn');
      vline(c.x, mergeIntoTotal ? totalRowTop : tableBottom, y);
    }
    hline(tableBottom);

    if (!isLast) {
      text('Continue...', left, ty - 14, { size: 9, font: bold, align: 'center', maxWidth: contentW });
    } else {
      // ── Total row ──────────────────────────────────────────────────────
      let sy = tableBottom;
      const totalBaseline = sy - TOTAL_ROW_H / 2 - 3;
      text('Total', cols[1]!.x + 6, totalBaseline, { size: 9, font: bold });
      if (sameUnit) {
        text(`${formatQty(totalQty)} ${bill.items[0]!.unit}`, cols[3]!.x, totalBaseline, { size: 9, font: bold, align: 'center', maxWidth: cols[3]!.w });
      }
      text(formatRupees(bill.items.reduce((s, i) => s + (i.totalAmount - i.gstAmount), 0)), cols[6]!.x, totalBaseline, {
        size: 9,
        font: bold,
        align: 'right',
        maxWidth: cols[6]!.w - 6,
      });
      sy -= TOTAL_ROW_H;
      hline(sy);

      // ── Amount in words + Bank details (left) / GST summary (right) ────
      const leftW = contentW * 0.6;
      const rightX = left + leftW;
      vline(rightX, sy - WORDS_BANK_H, sy);

      let wy = sy - 14;
      text('Amount In Words', left + 8, wy, { size: 8.5, font: bold });
      wy -= 12;
      for (const line of wordsLines) {
        text(line, left + 8, wy, { size: 9, color: BODY });
        wy -= 12;
      }
      wy -= 4;
      text('Bank Detail', left + 8, wy, { size: 8.5, font: bold });
      wy -= 12;
      const bankLines: Array<[string, string]> = [
        ['A/C Name', BANK_DETAILS.accountName],
        ['A/C Number', BANK_DETAILS.accountNumber],
        ['Bank Name', BANK_DETAILS.bankName],
        ['Branch & IFSC', `${BANK_DETAILS.branch}, ${BANK_DETAILS.ifsc}`],
      ];
      for (const [label, value] of bankLines) {
        text(`${label} : ${value}`, left + 8, wy, { size: 8, color: BODY });
        wy -= 11;
      }

      let ry = sy - 14;
      const gstAmountTotal = bill.gstAmount;
      const halfGst = Math.floor(gstAmountTotal / 2);
      text(halfRate !== undefined ? `Output CGST @ ${halfRate}%` : 'Output CGST', rightX + 8, ry, { size: 8.5 });
      text(formatRupees(halfGst), right - 8, ry, { size: 8.5, align: 'right' });
      ry -= 13;
      text(halfRate !== undefined ? `Output SGST @ ${halfRate}%` : 'Output SGST', rightX + 8, ry, { size: 8.5 });
      text(formatRupees(gstAmountTotal - halfGst), right - 8, ry, { size: 8.5, align: 'right' });
      ry -= 15;
      hline(ry, rightX, right);
      ry -= 13;
      shadeRect(rightX, ry - 5, right - rightX, 18);
      text('Total Value', rightX + 8, ry, { size: 9.5, font: bold });
      text(formatRupees(bill.grandTotal), right - 8, ry, { size: 9.5, font: bold, align: 'right' });

      sy -= WORDS_BANK_H;
      hline(sy);

      // ── HSN/SAC-wise tax summary ──────────────────────────────────────────
      {
        // Shortened labels — the reference's full "SGST/UTGST Rate/Amount"
        // wording doesn't fit a 10-14%-wide column at readable size.
        const hsnCols = [
          { label: 'HSN/SAC', x: left, w: contentW * 0.16 },
          { label: 'Taxable Value', x: 0, w: contentW * 0.18 },
          { label: 'CGST Rate', x: 0, w: contentW * 0.1 },
          { label: 'CGST Amt', x: 0, w: contentW * 0.14 },
          { label: 'SGST Rate', x: 0, w: contentW * 0.1 },
          { label: 'SGST Amt', x: 0, w: contentW * 0.14 },
          { label: 'Total Tax Amt', x: 0, w: contentW * 0.18 },
        ];
        {
          let cx = left;
          for (const c of hsnCols) {
            c.x = cx;
            cx += c.w;
          }
        }
        const hsnTop = sy;
        let hy = sy - 12;
        for (const c of hsnCols) text(c.label, c.x, hy, { size: 7.5, font: bold, align: 'center', maxWidth: c.w });
        hy -= HSN_ROW_H;
        hline(hy, left, right);
        for (const g of hsnGroups) {
          text(g.hsnSac, hsnCols[0]!.x, hy - 10, { size: 8, align: 'center', maxWidth: hsnCols[0]!.w });
          text(formatRupees(g.taxableValue), hsnCols[1]!.x, hy - 10, { size: 8, align: 'center', maxWidth: hsnCols[1]!.w });
          text(`${g.cgstRate}%`, hsnCols[2]!.x, hy - 10, { size: 8, align: 'center', maxWidth: hsnCols[2]!.w });
          text(formatRupees(g.cgstAmount), hsnCols[3]!.x, hy - 10, { size: 8, align: 'center', maxWidth: hsnCols[3]!.w });
          text(`${g.sgstRate}%`, hsnCols[4]!.x, hy - 10, { size: 8, align: 'center', maxWidth: hsnCols[4]!.w });
          text(formatRupees(g.sgstAmount), hsnCols[5]!.x, hy - 10, { size: 8, align: 'center', maxWidth: hsnCols[5]!.w });
          text(formatRupees(g.cgstAmount + g.sgstAmount), hsnCols[6]!.x, hy - 10, { size: 8, align: 'center', maxWidth: hsnCols[6]!.w });
          hy -= HSN_ROW_H;
        }
        hline(hy, left, right);
        const totalTaxable = hsnGroups.reduce((s, g) => s + g.taxableValue, 0);
        const totalCgst = hsnGroups.reduce((s, g) => s + g.cgstAmount, 0);
        const totalSgst = hsnGroups.reduce((s, g) => s + g.sgstAmount, 0);
        text('Total', hsnCols[0]!.x, hy - 10, { size: 8, font: bold, align: 'center', maxWidth: hsnCols[0]!.w });
        text(formatRupees(totalTaxable), hsnCols[1]!.x, hy - 10, { size: 8, font: bold, align: 'center', maxWidth: hsnCols[1]!.w });
        text(formatRupees(totalCgst), hsnCols[3]!.x, hy - 10, { size: 8, font: bold, align: 'center', maxWidth: hsnCols[3]!.w });
        text(formatRupees(totalSgst), hsnCols[5]!.x, hy - 10, { size: 8, font: bold, align: 'center', maxWidth: hsnCols[5]!.w });
        text(formatRupees(totalCgst + totalSgst), hsnCols[6]!.x, hy - 10, { size: 8, font: bold, align: 'center', maxWidth: hsnCols[6]!.w });
        hy -= HSN_ROW_H;
        sy = hy;
        hline(sy, left, right);
        vline(left, sy, hsnTop);
        vline(right, sy, hsnTop);
        for (const c of hsnCols.slice(1)) vline(c.x, sy, hsnTop);
      }

      // ── Terms & signature ────────────────────────────────────────────────
      let termsY = sy - 12;
      text('Terms & Conditions', left + 8, termsY, { size: 8, font: bold });
      termsY -= 11;
      for (const line of wrapText(regular, TERMS_TEXT, 7.5, contentW - 16)) {
        text(line, left + 8, termsY, { size: 7.5, color: BODY });
        termsY -= 10;
      }

      const sigY = sy - TERMS_H;
      text(`For ${studioName}`, right - 8, sigY, { size: 9, font: bold, align: 'right' });
      text('Verified By', left + 8, MARGIN + 12, { size: 9 });
      text('Authorised Signatory', right - 8, MARGIN + 12, { size: 9, font: bold, color: ACCENT, align: 'right' });
    }

    // ── Outer border for this page ───────────────────────────────────────
    // Full-length on the last page (frames the reserved summary block too,
    // even though it was blank space during pagination). A continuation
    // page has nothing below the item table at all, so its border ends
    // right there instead of framing a large dead rectangle down to
    // reservedBottomY.
    const borderBottom = isLast ? bottomLimit : tableBottom;
    page.drawRectangle({
      x: left,
      y: borderBottom,
      width: contentW,
      height: PAGE_H - MARGIN - borderBottom,
      borderColor: BLACK,
      borderWidth: 0.4,
    });
  });

  return doc.save();
}

export async function generateMmA4InvoicePDFBase64(bill: Bill, settings: Partial<Settings>): Promise<string> {
  const bytes = await generateMmA4InvoicePDF(bill, settings);
  return bytesToBase64(bytes);
}

export async function downloadMmA4InvoicePDF(bill: Bill, settings: Partial<Settings>) {
  const bytes = await generateMmA4InvoicePDF(bill, settings);
  const blob = new Blob([bytes.buffer.slice(0) as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${bill.billNumber}-tax-invoice.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function printMmA4InvoicePDF(bill: Bill, settings: Partial<Settings>) {
  const bytes = await generateMmA4InvoicePDF(bill, settings);
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
    iframe.contentWindow?.addEventListener('afterprint', cleanup);
    iframe.contentWindow?.print();
    setTimeout(cleanup, 60_000);
  };
}
