import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import type { Bill, Settings } from '@/types';
import { paisaToRupee } from '@/types';
import { amountInWordsINR } from '@/lib/amountInWords';
import { bytesToBase64 } from '@/lib/pdf';
import { embedBrandFonts } from '@/lib/brandFont';
import { splitTaxP } from '@/lib/billMath';

// Same caching/fallback pattern as lib/pdf.ts's thermal-receipt logo — fetch
// and decode once per session, prefer the small pre-downscaled copy so the
// invoice PDF doesn't balloon to ~1MB per generation. Logo-receipt-green.png
// is a pre-tinted (BRAND green) copy generated from Logo.png via sharp's
// alpha-masked composite ("dest-in" onto a solid-green canvas) — a plain
// sharp.tint() leaves solid-black artwork black, since tint colorizes by
// lightness and black has none. Falls back to the original black/transparent
// logo if the green copy is ever missing.
let logoBytesCache: ArrayBuffer | null | undefined;
async function fetchLogoBytes(): Promise<ArrayBuffer | null> {
  if (logoBytesCache !== undefined) return logoBytesCache;
  logoBytesCache = null;
  for (const path of ['/Logo-receipt-green.png', '/Logo-receipt.png', '/Logo.png']) {
    try {
      const response = await fetch(path);
      if (response.ok) {
        logoBytesCache = await response.arrayBuffer();
        break;
      }
    } catch {
      // try the next candidate
    }
  }
  return logoBytesCache;
}

/**
 * "Service Bill" A4 invoice — a second, full-page layout alongside the
 * thermal-roll receipt (lib/thermal.ts + lib/pdf.ts), for studios printing
 * on a normal A4 printer instead of (or in addition to) the receipt printer.
 * Modeled on a reference tax-invoice template supplied by the studio.
 */

const PAGE_W = 595.28; // A4, pt
const PAGE_H = 841.89;
const MARGIN = 32;

export function hexRgb(hex: string): ReturnType<typeof rgb> {
  const n = parseInt(hex, 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

const BLACK = rgb(0.08, 0.08, 0.08);
const BRAND = hexRgb('b2df00'); // "MAESTRO YUVARAJ V"
const ACCENT = hexRgb('b400ff'); // GSTIN/Invoice/Date + signature block (the "pink")
const BODY = hexRgb('397601'); // customer/service/item/bank text (the other "green")

// No Settings field for this yet (see conversation) — filled in from the
// reference invoice. Revisit if the studio needs to edit these from the UI.
// Exported: reused as-is by mmA4invoice.ts (MM/A4 Tax Invoice layout) — same
// studio, same bank account, regardless of which print layout is used.
export const BANK_DETAILS = {
  accountName: 'MAESTRO YUVARAJ V',
  accountNumber: '510909010267230',
  accountType: 'Current Account',
  bankName: 'City Union Bank',
  branch: 'Fairlands, Salem',
  ifsc: 'CIUB0000188',
};

export function wrapText(font: PDFFont, str: string, size: number, maxWidth: number): string[] {
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

export function formatDDMMYYYY(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** "Jan 21 / 2026" — matches the reference invoice's Service Date style. */
function formatShortDate(d: Date): string {
  const month = d.toLocaleDateString('en-IN', { month: 'short' });
  return `${month} ${d.getDate()} / ${d.getFullYear()}`;
}

export function formatRupees(paise: number): string {
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
  const { regular, bold } = await embedBrandFonts(doc);

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;
  const outerTop = PAGE_H - MARGIN;
  // The lowest the invoice may reach. NOT where it necessarily ends on a
  // continuation page — see borderBottom below.
  const pageBottomLimit = MARGIN;

  // Thinner throughout, per the studio's request for a more elegant look —
  // was 0.75/1.2/1 originally, then 0.4/0.7/0.6 (grid lines / header divider
  // / outer border); asked to go thinner still.
  const THIN = 0.25;

  // All drawing helpers are bound to whichever page is "current" — reassigned
  // at the top of each page's render pass in the pagination loop below (same
  // pattern lib/mmA4invoice.ts uses for its own multi-page Tax Invoice).
  let page: PDFPage;
  const hline = (yPos: number, x1 = left, x2 = right, thickness = THIN) =>
    page.drawLine({ start: { x: x1, y: yPos }, end: { x: x2, y: yPos }, thickness, color: BLACK });
  const vline = (xPos: number, y1: number, y2: number) =>
    page.drawLine({ start: { x: xPos, y: y1 }, end: { x: xPos, y: y2 }, thickness: THIN, color: BLACK });

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

  // ── Header content (identical on every page) ────────────────────────────
  const studioOwner = (studio?.studio_owner || studio?.studio_name || 'Studio').toUpperCase();
  const studioName = studio?.studio_name || "The Studio's";
  const studioAddress = studio?.studio_address || '';
  const studioPhone = studio?.studio_phone || '';
  const studioGstin = studio?.studio_gstin || '';

  // Fixed-height header box: logo top-left (large); the studio name/address/
  // mobile block is bottom-aligned inside the same box, tightly packed with
  // no extra line-gap, sitting right above the divider; GSTIN/Invoice/Date is
  // vertically centered on the right. Three independent vertical anchors
  // (top/bottom/center) sharing one box, rather than everything chained off
  // a single cursor top-down — that's what let the name/address/mobile block
  // drift away from the logo with awkward gaps before.
  const HEADER_H = 118;
  const rightColX = right - 205;
  // Logo + name/address/mobile are inset from the page margin, not flush
  // against it, matching the indent every other left-aligned block in this
  // invoice (e.g. "Service Bill To :") already uses.
  const headerLeft = left + 10;

  // The logo used to sit here, top-left of the header. Moved down to sit just
  // above the signature line instead (see the bank/signature block below) —
  // fetched once here and reused there (and on every page — pdf-lib lets one
  // embedded image be drawn on any number of pages of the same document).
  const logoBytes = await fetchLogoBytes();
  const logoImage = logoBytes ? await doc.embedPng(logoBytes) : null;

  // Name/address/mobile is centered within a fixed-width block — this used to
  // be sized to the header logo's own width (logoW || 220), but with the logo
  // gone from the header there's nothing left to size against, so it's just
  // the same 220pt fallback the "no logo" case already used.
  const ownerBlockW = 220;

  // Right column: block is anchored to the right side of the page, but the
  // lines are center-aligned to each other within that block (not each one
  // hugging the right edge, which reads as ragged since "Date" is shorter
  // than "GSTIN"), and vertically centered in the header box.
  const rightLines: string[] = [];
  if (studioGstin) rightLines.push(`GSTIN : ${studioGstin}`);
  rightLines.push(`Invoice : ${bill.billNumber}`);
  rightLines.push(`Date : ${formatDDMMYYYY(new Date(bill.billDate))}`);
  const RIGHT_LINE_GAP = 16;
  const rightBlockH = (rightLines.length - 1) * RIGHT_LINE_GAP;

  // Name/address/mobile — tightly packed and vertically CENTERED in the
  // header box (previously bottom-anchored to the divider; centered instead
  // now that there's no header logo to sit flush beneath), while staying
  // positioned on the left side of the page (headerLeft, unchanged) with
  // each line still centered relative to the others within that block. This
  // mirrors how the right-hand GSTIN/Invoice/Date column is already
  // vertically centered in the same box.
  const addressLines = studioAddress
    ? wrapText(regular, studioAddress.replace(/\n/g, ', '), 9.5, ownerBlockW)
    : [];
  const ownerLines: Array<{ text: string; size: number; font: PDFFont; color: ReturnType<typeof rgb> }> = [
    { text: studioOwner, size: 22, font: bold, color: BRAND },
    ...addressLines.map((line) => ({ text: line, size: 9.5, font: regular, color: ACCENT })),
    ...(studioPhone ? [{ text: `Mobile : ${studioPhone}`, size: 9.5, font: regular, color: ACCENT }] : []),
  ];
  const OWNER_LINE_GAP = 2;
  const ownerBlockH = ownerLines.reduce((sum, ln) => sum + ln.size + OWNER_LINE_GAP, 0) - OWNER_LINE_GAP;

  // Draws the header + "Service Bill From" divider row on the CURRENT page,
  // returns the y just below it (same content every page — repeated per
  // page, same pattern lib/mmA4invoice.ts's own drawHeader() uses).
  function drawHeader(topY: number): number {
    const headerTop = topY - 4;
    const headerBottom = headerTop - HEADER_H;

    let ry = (headerTop + headerBottom) / 2 + rightBlockH / 2;
    for (const line of rightLines) {
      text(line, rightColX, ry, { size: 10, font: bold, color: ACCENT, align: 'center', maxWidth: right - rightColX });
      ry -= RIGHT_LINE_GAP;
    }

    // Baseline-from-block-top approximation (0.8 * first line's size), same
    // convention used elsewhere in this codebase for centering text blocks
    // without a full font-metrics ascent lookup.
    let ly = (headerTop + headerBottom) / 2 + ownerBlockH / 2 - ownerLines[0]!.size * 0.8;
    for (const ln of ownerLines) {
      text(ln.text, headerLeft, ly, { size: ln.size, font: ln.font, color: ln.color, align: 'center', maxWidth: ownerBlockW });
      ly -= ln.size + OWNER_LINE_GAP;
    }

    let hy = headerBottom;
    hline(hy, left, right, 0.45);
    hy -= 18;

    text(`Service Bill From : ${studioName}`, left + 8, hy, { size: 9.5, font: bold, color: BODY });
    text('Tax Invoice', right - 8, hy, { size: 10, font: bold, align: 'right', color: BODY });
    hy -= 10;
    hline(hy);
    return hy;
  }

  // ── 3-column info box content: Service Bill To / Service Details / Service
  //    Date (identical on every page) ─────────────────────────────────────
  const colA_W = contentW * 0.42;
  const colB_W = contentW * 0.32;
  const colA_X = left;
  const colB_X = left + colA_W;
  const colC_X = colB_X + colB_W;

  // Wrapped line arrays are computed once, up front, and reused for both the
  // height calculation below AND the actual drawing — an unusually long
  // customer name/address or Service Description used to just draw past a
  // fixed 108pt box height and overlap the item table header underneath it.
  // '0000000000' is the seeded Walk-in Customer's placeholder phone — when
  // that record is the one picked for the bill, print "Customer" rather than
  // its admin-facing "Walk-in Customer" label, same as when no customer is
  // attached at all.
  const isPlaceholderCustomer = bill.customer?.phone === '0000000000';
  const displayCustName = isPlaceholderCustomer ? 'Customer' : bill.customer?.name ?? '';
  const custNameLines = bill.customer ? wrapText(bold, displayCustName, 9.5, colA_W - 16) : [];
  const custAddressLines = bill.customer?.address ? wrapText(regular, bill.customer.address, 9, colA_W - 16) : [];
  const serviceDescLines = bill.serviceDescription ? wrapText(regular, bill.serviceDescription, 9, colB_W - 16) : [];
  // Prefer the new arbitrary serviceDates list; fall back to the old from/to
  // range for a bill saved before that field existed.
  const serviceDateList: string[] = bill.serviceDates?.length
    ? bill.serviceDates
    : [bill.serviceFrom, bill.serviceTo].filter((d): d is string => !!d);

  const showCustPhone = !!bill.customer?.phone && !isPlaceholderCustomer;

  const colA_ContentH = bill.customer
    ? 14 + custNameLines.length * 12.5 + custAddressLines.length * 12 + (showCustPhone ? 12 : 0) + (bill.customer.gstin ? 12 : 0)
    : 14 + 13;
  const colB_ContentH = 14 + serviceDescLines.length * 12;
  const colC_ContentH = 14 + (serviceDateList.length || 1) * 12;

  // Sized to whatever content actually needs (40pt floor just keeps the box
  // from looking clipped when every column is at its shortest) — previously
  // forced to a 108pt minimum, which left a large dead gap under a short
  // customer/service block on most real bills.
  const infoBoxH = Math.max(40, colA_ContentH, colB_ContentH, colC_ContentH) + 6; // 6pt bottom padding

  // Draws the 3-column info box on the CURRENT page, returns its bottom y.
  function drawInfoBox(topY: number): number {
    const infoTop = topY;
    const infoBottom = infoTop - infoBoxH;

    hline(infoBottom);
    vline(colB_X, infoBottom, infoTop);
    vline(colC_X, infoBottom, infoTop);

    let cy = infoTop - 14;
    text('Service Bill To :', colA_X + 8, cy, { size: 9.5, font: bold, color: BODY });
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
      text('Customer', colA_X + 8, cy, { size: 9.5, color: BODY });
    }

    cy = infoTop - 14;
    text('Service Details :', colB_X + 8, cy, { size: 9.5, font: bold, color: BODY });
    cy -= 14;
    for (const line of serviceDescLines) {
      text(line, colB_X + 8, cy, { size: 9, color: BODY });
      cy -= 12;
    }

    cy = infoTop - 14;
    text('Service Date :', colC_X + 8, cy, { size: 9.5, font: bold, color: BODY });
    cy -= 14;
    if (serviceDateList.length) {
      for (const d of serviceDateList) {
        text(formatShortDate(new Date(d)), colC_X + 8, cy, { size: 9, color: BODY });
        cy -= 12;
      }
    } else {
      text(formatShortDate(new Date(bill.billDate)), colC_X + 8, cy, { size: 9, color: BODY });
    }

    return infoBottom;
  }

  // ── Item table columns ───────────────────────────────────────────────────
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
  const amountCol = cols[cols.length - 1]!;

  const tableHeaderH = 22;
  function drawTableHeader(topY: number): number {
    // SN's header is centered over the full column width, matching its row
    // values below (String(i + 1), also centered) — a left+8-inset header
    // over centered data left the numbers visibly right of "SN" (confirmed by
    // rendering an actual invoice, not just reading the alignment options).
    text(cols[0]!.label, cols[0]!.x, topY - 15, { size: 9.5, font: bold, align: 'center', maxWidth: cols[0]!.w, color: BODY });
    text(cols[1]!.label, cols[1]!.x + 8, topY - 15, { size: 9.5, font: bold, color: BODY });
    for (const c of cols.slice(2, -1)) {
      text(c.label, c.x, topY - 15, { size: 9, font: bold, align: 'center', maxWidth: c.w, color: BODY });
    }
    // AMOUNT is the one column whose row data is right-aligned (money reads
    // right-to-left for digit-place comparison), not centered like Qty/Price/
    // HSN — its header must use the same align+maxWidth as the row values
    // below (see the item loop), or the header centers over the column while
    // the actual figures hug the right edge, landing ~10pt apart.
    text(amountCol.label, amountCol.x, topY - 15, { size: 9, font: bold, align: 'right', maxWidth: amountCol.w - 8, color: BODY });
    const headerBottom = topY - tableHeaderH;
    hline(headerBottom);
    return headerBottom;
  }

  // ── Item row heights ─────────────────────────────────────────────────────
  // Natural height, one row per item, no compression — a long/many-item bill
  // now spills onto additional pages (below) instead of being squeezed into
  // rows shorter than the text itself, which used to overlap into an
  // unreadable mess (confirmed against a real 40-item bill: rows compressed
  // to ~9pt while the text stayed at a fixed 9pt font size, so consecutive
  // rows drew directly on top of each other).
  const LINE_H = 11;
  const ROW_PAD = 8;
  const BASE_ROW_H = 20;
  const itemLines = bill.items.map((item) => wrapText(regular, item.productName, 9, cols[1]!.w - 16));
  const rowHeights = itemLines.map((lines) => Math.max(BASE_ROW_H, lines.length * LINE_H + ROW_PAD));

  // ── Amount-in-words + totals / bank + signature content (last page only,
  //    but sized up front so pagination is consistent across all pages) ────
  const wordsW = contentW * 0.6;
  const totalsX = left + wordsW;
  const wordsLines = wrapText(regular, amountInWordsINR(bill.grandTotal), 9.5, wordsW - 16);

  // Same Sub Total / CGST / SGST / Round Off / Grand Total layout regardless
  // of GST inclusive/exclusive — only how subTotal/gstAmount were derived
  // differs (see billMath.ts), never how the invoice is printed.
  const gstRates = [...new Set(bill.items.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
  const halfRate = gstRates.length === 1 ? gstRates[0]! / 2 : undefined;
  const fullRate = gstRates.length === 1 ? gstRates[0]! : undefined;
  const totalRows: Array<[string, number]> = [];
  totalRows.push(['Sub Total', bill.subTotal]);
  if (bill.gstAmount > 0) {
    if (bill.isInterState) {
      totalRows.push([fullRate !== undefined ? `IGST @ ${fullRate}%` : 'IGST', bill.gstAmount]);
    } else {
      const { cgstP, sgstP } = splitTaxP(bill.gstAmount, false);
      totalRows.push([halfRate !== undefined ? `CGST @ ${halfRate}%` : 'CGST', cgstP]);
      totalRows.push([halfRate !== undefined ? `SGST @ ${halfRate}%` : 'SGST', sgstP]);
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

  // Fixed height regardless of how many rows actually apply — the render
  // loop divides it by the real row count, so extra rows just make each one
  // proportionally shorter instead of overflowing.
  const totalsBoxH = 22 * 4;
  // Sized to what the bank-details block actually needs (16pt down to its
  // header, 15pt gap, then 6 lines at 12.5pt = 106pt) plus a modest 6pt of
  // bottom padding.
  const bankBoxH = 112;
  const summaryBlockH = totalsBoxH + bankBoxH;

  // ── Paginate items ───────────────────────────────────────────────────────
  const bottomLimit = pageBottomLimit;
  // Every page's item table stops at the same fixed line, reserving room for
  // the summary block whether or not this particular page turns out to be
  // the last one — the table border still stretches down to it either way
  // (blank ruled space on a continuation page, same "fills the page" look
  // this layout already used for a short single-page bill), and the summary
  // content itself only actually gets drawn when isLast.
  const reservedBottomY = bottomLimit + summaryBlockH;
  // Header + info box consume the same height on every page (same content
  // repeated each time), so the item table always starts at the same y.
  const headerAndInfoH = 4 + HEADER_H + 18 + 10 + infoBoxH;
  const availableItemsH = outerTop - headerAndInfoH - tableHeaderH - reservedBottomY;

  const pageItemIdx: number[][] = [];
  let current: number[] = [];
  let currentH = 0;
  bill.items.forEach((_, i) => {
    const h = rowHeights[i]!;
    if (current.length > 0 && currentH + h > availableItemsH) {
      pageItemIdx.push(current);
      current = [];
      currentH = 0;
    }
    current.push(i);
    currentH += h;
  });
  pageItemIdx.push(current); // always at least one page, even with 0 items (shouldn't happen — bills require >=1 item)

  // ── Render pages ─────────────────────────────────────────────────────────
  pageItemIdx.forEach((idxGroup, pageIdx) => {
    const isLast = pageIdx === pageItemIdx.length - 1;
    page = doc.addPage([PAGE_W, PAGE_H]);

    const afterHeader = drawHeader(outerTop);
    const tableTop = drawInfoBox(afterHeader);
    let ty = drawTableHeader(tableTop);

    for (const i of idxGroup) {
      const item = bill.items[i]!;
      const rowH = rowHeights[i]!;
      const lines = itemLines[i]!;
      const rowMid = ty - rowH / 2 - 3;
      text(String(i + 1), cols[0]!.x, rowMid, { size: 9, color: BODY, align: 'center', maxWidth: cols[0]!.w });
      let ly = ty - ROW_PAD / 2 - 8;
      for (const line of lines) {
        text(line, cols[1]!.x + 8, ly, { size: 9, color: BODY });
        ly -= LINE_H;
      }
      // PRICE/AMOUNT show the tax-excluded base, not item.unitPrice as
      // entered — for an exclusive bill those are the same number, but for
      // an inclusive bill unitPrice is the all-in sticker price, and
      // printing that here would make the item rows sum to more than the
      // Sub Total row below. (totalAmount - gstAmount) is the tax-excluded
      // base in both modes, matching lib/thermal.ts.
      const baseAmt = item.totalAmount - item.gstAmount;
      const baseUnitPrice = item.qty ? Math.round(baseAmt / item.qty) : item.unitPrice;
      text(`${item.qty} ${item.unit}`, cols[2]!.x, rowMid, { size: 9, color: BODY, align: 'center', maxWidth: cols[2]!.w });
      // toLocaleString, not toFixed — a 4-digit-plus unit price needs the
      // same thousands separator the Amount column gets via formatRupees, or
      // the two columns visibly disagree on formatting for the exact same
      // bill (e.g. "Rs 1200.00" next to "Rs 1,200").
      text(
        `Rs ${paisaToRupee(baseUnitPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        cols[3]!.x,
        rowMid,
        { size: 9, color: BODY, align: 'center', maxWidth: cols[3]!.w },
      );
      text(item.hsnSac ?? '-', cols[4]!.x, rowMid, { size: 9, color: BODY, align: 'center', maxWidth: cols[4]!.w });
      text(`Rs ${formatRupees(baseAmt)}`, cols[5]!.x, rowMid, { size: 9, color: BODY, align: 'right', maxWidth: cols[5]!.w - 8 });
      ty -= rowH;
    }

    // On the last page the table stretches down to the reserved summary
    // line regardless of how far the actual rows reached (blank ruled space
    // below them, matching this layout's existing "fills the page" look for
    // a short bill). A continuation page instead stops right after its own
    // last row (plus a small gap for "Continue...").
    const tableBottom = isLast ? reservedBottomY : Math.min(ty - 22, reservedBottomY);
    vline(left, tableBottom, tableTop);
    vline(right, tableBottom, tableTop);
    for (const c of cols.slice(1)) vline(c.x, tableBottom, tableTop);
    hline(tableBottom);

    if (!isLast) {
      text('Continue...', left, ty - 14, { size: 9.5, font: bold, align: 'center', maxWidth: contentW });
    } else {
      // ── Amount in words + totals box ────────────────────────────────────
      let y = tableBottom;
      text('Amount in Words :', left + 8, y - 16, { size: 9.5, font: bold, color: BODY });
      let wordsY = y - 32;
      for (const line of wordsLines) {
        text(line, left + 8, wordsY, { size: 9.5, color: BODY });
        wordsY -= 13;
      }

      const totalsRowH = totalsBoxH / totalRows.length;
      vline(totalsX, y - totalsBoxH, y);
      let tty = y;
      totalRows.forEach(([label, amount], i) => {
        const isLastRow = i === totalRows.length - 1;
        if (i > 0) hline(tty, totalsX, right);
        // Every label (Sub Total, CGST/SGST/IGST, Discount, Round Off) is
        // bold now, not just Grand Total — Grand Total keeps the larger size
        // as its own extra emphasis on top of that shared boldness.
        const size = isLastRow ? 10 : 9.5;
        text(label, totalsX + 8, tty - totalsRowH / 2 - 3, { size, font: bold, color: BODY });
        const amtStr = `${amount < 0 ? '-' : ''}Rs ${formatRupees(Math.abs(amount))}`;
        text(amtStr, right - 8, tty - totalsRowH / 2 - 3, { size, font: isLastRow ? bold : regular, color: BODY, align: 'right' });
        tty -= totalsRowH;
      });
      hline(y - totalsBoxH);

      y -= totalsBoxH;
      hline(y);

      // ── Bank details + signature ────────────────────────────────────────
      const bankColW = contentW * 0.55;
      vline(left + bankColW, y - bankBoxH, y);

      // Bold labels in the accent BODY green (studio confirmed green, not
      // black, just bolder than the plain-weight text this used to be).
      let by = y - 16;
      text('Bank Account Details :', left + 8, by, { size: 9.5, font: bold, color: BODY });
      by -= 15;
      // A bill saved before this field existed has no billedByName — shown
      // as "—" rather than dropping the row, so this list is always the
      // same shape instead of silently missing a line. bankBoxH (112, set
      // above) already has ~21pt of slack below the 6 original lines, more
      // than this one extra 12.5pt row needs.
      const bankLines: Array<[string, string]> = [
        ['Account Name', BANK_DETAILS.accountName],
        ['Account Number', BANK_DETAILS.accountNumber],
        ['Account Type', BANK_DETAILS.accountType],
        ['Bank Name', BANK_DETAILS.bankName],
        ['Branch', BANK_DETAILS.branch],
        ['IFSC Code', BANK_DETAILS.ifsc],
        ['Billed By', bill.billedByName || '—'],
      ];
      for (const [label, value] of bankLines) {
        text(label, left + 8, by, { size: 8.5, font: bold, color: BODY });
        text(`-  ${value}`, left + 105, by, { size: 8.5, color: BODY });
        by -= 12.5;
      }

      // Signature block: the studio logo sits at the TOP of this half of the
      // box (like a letterhead stamp) with "Authorised Signature" anchored
      // at the bottom, same as before — the gap between them is deliberately
      // large, room for an actual pen signature. (Previously the logo sat
      // right above the signature line instead, leaving all the blank space
      // above the logo instead of between logo and signature — moved down
      // here per studio feedback.)
      const sigColLeft = left + bankColW + 8;
      const sigColRight = right - 8;
      const SIG_RIGHT_NUDGE = 24;
      const sigCenterLeft = sigColLeft + SIG_RIGHT_NUDGE;
      const sigColW = sigColRight - sigCenterLeft;
      const sigColCenter = (sigCenterLeft + sigColRight) / 2;
      const sigTextY = y - bankBoxH + 16;
      const LOGO_TOP_PAD = 10;
      if (logoImage) {
        const forTextWidth = bold.widthOfTextAtSize(`For ${studioName.toUpperCase()}`, 9.5);
        const sigLogoW = Math.min(forTextWidth, sigColW);
        const sigLogoH = sigLogoW * (logoImage.height / logoImage.width);
        page.drawImage(logoImage, {
          x: sigColCenter - sigLogoW / 2,
          y: y - LOGO_TOP_PAD - sigLogoH,
          width: sigLogoW,
          height: sigLogoH,
        });
      }
      text('Authorised Signature', sigCenterLeft, sigTextY, { size: 9, color: ACCENT, align: 'center', maxWidth: sigColW });
    }

    // ── Outer border for this page ───────────────────────────────────────
    // Full-length on the last page (frames the totals/bank/signature block
    // too). A continuation page has nothing below the item table, so its
    // border ends right there instead of framing a large dead rectangle.
    const borderBottom = isLast ? pageBottomLimit : tableBottom;
    page.drawRectangle({
      x: left,
      y: borderBottom,
      width: contentW,
      height: outerTop - borderBottom,
      borderColor: BLACK,
      borderWidth: 0.4,
    });
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
