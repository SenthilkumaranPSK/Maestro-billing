import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import type { Bill, Settings } from '@/types';
import { paisaToRupee } from '@/types';
import { amountInWordsINR } from '@/lib/amountInWords';
import { bytesToBase64 } from '@/lib/pdf';
import { embedBrandFonts } from '@/lib/brandFont';

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

function hexRgb(hex: string): ReturnType<typeof rgb> {
  const n = parseInt(hex, 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

const BLACK = rgb(0.08, 0.08, 0.08);
const BRAND = hexRgb('b2df00'); // "MAESTRO YUVARAJ V"
const ACCENT = hexRgb('b400ff'); // GSTIN/Invoice/Date + signature block (the "pink")
const BODY = hexRgb('397601'); // customer/service/item/bank text (the other "green")

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
  const { regular, bold } = await embedBrandFonts(doc);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const contentW = right - left;
  const outerTop = PAGE_H - MARGIN;
  // The lowest the invoice may reach. NOT where it necessarily ends — the
  // outer border's real bottom (`outerBottom`) is computed further down from
  // how tall the item table actually needs to be, so a short bill produces a
  // shorter invoice rather than a stretched one.
  const pageBottomLimit = MARGIN;

  // Thinner throughout, per the studio's request for a more elegant look —
  // was 0.75/1.2/1 originally, then 0.4/0.7/0.6 (grid lines / header divider
  // / outer border); asked to go thinner still.
  const THIN = 0.25;
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

  let y = outerTop;

  // ── Header ───────────────────────────────────────────────────────────────
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
  const headerTop = y - 4;
  const headerBottom = headerTop - HEADER_H;
  const rightColX = right - 205;
  // Logo + name/address/mobile are inset from the page margin, not flush
  // against it, matching the indent every other left-aligned block in this
  // invoice (e.g. "Service Bill To :") already uses.
  const headerLeft = left + 10;

  // The logo used to sit here, top-left of the header. Moved down to sit just
  // above the signature line instead (see the bank/signature block below) —
  // fetched once here and reused there, so it's still only decoded once.
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
  let ry = (headerTop + headerBottom) / 2 + rightBlockH / 2;
  for (const line of rightLines) {
    text(line, rightColX, ry, { size: 10, font: bold, color: ACCENT, align: 'center', maxWidth: right - rightColX });
    ry -= RIGHT_LINE_GAP;
  }

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
  // Baseline-from-block-top approximation (0.8 * first line's size), same
  // convention used elsewhere in this codebase for centering text blocks
  // without a full font-metrics ascent lookup.
  let ly = (headerTop + headerBottom) / 2 + ownerBlockH / 2 - ownerLines[0]!.size * 0.8;
  for (const ln of ownerLines) {
    text(ln.text, headerLeft, ly, { size: ln.size, font: ln.font, color: ln.color, align: 'center', maxWidth: ownerBlockW });
    ly -= ln.size + OWNER_LINE_GAP;
  }

  y = headerBottom;
  hline(y, left, right, 0.45);
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
  const infoTop = y;
  const infoBoxH = Math.max(40, colA_ContentH, colB_ContentH, colC_ContentH) + 6; // 6pt bottom padding
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
    text('Customer', colA_X + 8, cy, { size: 9.5, color: BODY });
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
  if (serviceDateList.length) {
    for (const d of serviceDateList) {
      text(formatShortDate(new Date(d)), colC_X + 8, cy, { size: 9, color: BODY });
      cy -= 12;
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

  // SN's header is centered over the full column width, matching its row
  // values below (String(i + 1), also centered) — a left+8-inset header
  // over centered data left the numbers visibly right of "SN" (confirmed by
  // rendering an actual invoice, not just reading the alignment options).
  text(cols[0]!.label, cols[0]!.x, tableTop - 15, { size: 9.5, font: bold, align: 'center', maxWidth: cols[0]!.w });
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
  // ITEM TABLE HEIGHT (see the note above about what changed and why).
  //
  // These blocks used to be pinned to the bottom of the page, with the item
  // table stretched to fill whatever was left. On a one- or two-item bill
  // that left a large empty rectangle inside the table border — reported as
  // "the white box coming below the bill". The table is now sized to its
  // own content, and the totals / bank / signature blocks (and the outer
  // border itself) follow it up the page, so a short bill simply produces a
  // shorter invoice with plain unused paper beneath it.
  //
  // The page-bottom limit still caps it: a long bill fills the page and then
  // compresses proportionally, exactly as before.
  // Sized to what the bank-details block actually needs (16pt down to its
  // header, 15pt gap, then 6 lines at 12.5pt = 106pt) plus a modest 6pt of
  // bottom padding — was a flat 130, which left a visible gap of blank space
  // under the bank details on every invoice regardless of content.
  const bankBoxH = 112;

  const LINE_H = 11;
  const ROW_PAD = 8;
  const BASE_ROW_H = 20;
  const itemLines = bill.items.map((item) =>
    wrapText(regular, item.productName, 9, cols[1]!.w - 16),
  );
  const naturalRowHeights = itemLines.map((lines) => Math.max(BASE_ROW_H, lines.length * LINE_H + ROW_PAD));
  const naturalTotalH = naturalRowHeights.reduce((s, h) => s + h, 0);

  // Most the table could occupy before the blocks below it would run past
  // the page's bottom margin.
  const maxTableH = tableHeaderBottom - (pageBottomLimit + bankBoxH + totalsBoxH);
  // A floor so a single short item still reads as a table rather than one
  // cramped line squeezed against its own border.
  const MIN_TABLE_H = BASE_ROW_H * 2;
  const tableH = Math.min(Math.max(naturalTotalH, MIN_TABLE_H), maxTableH);

  const tableBottom = tableHeaderBottom - tableH;
  const totalsBoxTop = tableBottom;
  const totalsBoxBottom = totalsBoxTop - totalsBoxH;
  const bankBoxTop = totalsBoxBottom;
  const bankBoxBottom = bankBoxTop - bankBoxH;
  // The invoice's real bottom edge — follows the content up the page on a
  // short bill instead of always sitting at the page margin (this is what
  // fixed a large empty rectangle *inside* the item table's own border on a
  // short bill). Left alone, though, that same short bill puts the whole
  // invoice at the very top of the page with a large area of plain,
  // UNFRAMED paper below the border — reported as "too much space in the
  // A4 down below". A half-measure (reclaiming only part of that leftover,
  // capped) was tried and still left a visible chunk of bare page below the
  // frame — neither fully tight nor full-page reads as intentional, so it
  // still looked wrong.
  //
  // The border now always reaches the page's bottom margin, same as every
  // real invoice template does. This is safe to do unconditionally BECAUSE
  // the block above it (the table) is still sized to its own content, not
  // stretched — the leftover page space becomes a plain blank footer margin
  // *below* the bank/signature block (normal for a short one-page document),
  // never blank ruled cells *inside* the table border (the original bug).
  const outerBottom = pageBottomLimit;

  // A very long bill (many items / long names) won't fit one A4 page at
  // natural size — compress proportionally as a last resort rather than
  // overlapping the totals/bank blocks. True pagination is a future
  // improvement if that turns out to be a common case.
  const scale = naturalTotalH > tableH && naturalTotalH > 0 ? tableH / naturalTotalH : 1;

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
    // PRICE/AMOUNT show the tax-excluded base, not item.unitPrice as entered
    // — for an exclusive bill those are the same number, but for an
    // inclusive bill unitPrice is the all-in sticker price, and printing
    // that here would make the item rows sum to more than the Sub Total row
    // below. (totalAmount - gstAmount) is the tax-excluded base in both
    // modes, matching lib/thermal.ts.
    const baseAmt = item.totalAmount - item.gstAmount;
    const baseUnitPrice = item.qty ? Math.round(baseAmt / item.qty) : item.unitPrice;
    text(`${item.qty} ${item.unit}`, cols[2]!.x, rowMid, { size: 9, color: BODY, align: 'center', maxWidth: cols[2]!.w });
    text(`Rs ${paisaToRupee(baseUnitPrice).toFixed(2)}`, cols[3]!.x, rowMid, { size: 9, color: BODY, align: 'center', maxWidth: cols[3]!.w });
    text(item.hsnSac ?? '-', cols[4]!.x, rowMid, { size: 9, color: BODY, align: 'center', maxWidth: cols[4]!.w });
    text(`Rs ${formatRupees(baseAmt)}`, cols[5]!.x, rowMid, { size: 9, color: BODY, align: 'right', maxWidth: cols[5]!.w - 8 });
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
  // Same Sub Total / CGST / SGST / Round Off / Grand Total layout regardless
  // of GST inclusive/exclusive — only how subTotal/gstAmount were derived
  // differs (see billMath.ts), never how the invoice is printed.
  const gstRates = [...new Set(bill.items.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
  const halfRate = gstRates.length === 1 ? gstRates[0]! / 2 : undefined;
  const totalRows: Array<[string, number]> = [];
  totalRows.push(['Sub Total', bill.subTotal]);
  if (bill.gstAmount > 0) {
    const half = Math.floor(bill.gstAmount / 2);
    totalRows.push([halfRate !== undefined ? `CGST @ ${halfRate}%` : 'CGST', half]);
    totalRows.push([halfRate !== undefined ? `SGST @ ${halfRate}%` : 'SGST', bill.gstAmount - half]);
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
  totalRows.forEach(([label, amount], i) => {
    const isLast = i === totalRows.length - 1;
    if (i > 0) hline(tty, totalsX, right);
    const f = isLast ? bold : regular;
    const size = isLast ? 10 : 9.5;
    text(label, totalsX + 8, tty - totalsRowH / 2 - 3, { size, font: f, color: isLast ? BLACK : BLACK });
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

  // Signature block: the studio logo (small — sized to the footprint the
  // removed "For <studio name>" text used to occupy, not a full-size header
  // logo) sits directly above "Authorised Signature", nudged right of dead-
  // center within this half of the box — centering it exactly between the
  // bank box and the page edge read as too far left under the signature
  // line above it. The blank space above them is still the room for an
  // actual pen signature.
  const sigColLeft = left + bankColW + 8;
  const sigColRight = right - 8;
  const SIG_RIGHT_NUDGE = 24;
  const sigCenterLeft = sigColLeft + SIG_RIGHT_NUDGE;
  const sigColW = sigColRight - sigCenterLeft;
  const sigColCenter = (sigCenterLeft + sigColRight) / 2;
  const sigTextY = y - bankBoxH + 16;
  if (logoImage) {
    const forTextWidth = bold.widthOfTextAtSize(`For ${studioName.toUpperCase()}`, 9.5);
    const sigLogoW = Math.min(forTextWidth, sigColW);
    const sigLogoH = sigLogoW * (logoImage.height / logoImage.width);
    page.drawImage(logoImage, {
      x: sigColCenter - sigLogoW / 2,
      y: sigTextY + 11 + 4, // clear the signature text's own line + a small gap
      width: sigLogoW,
      height: sigLogoH,
    });
  }
  text('Authorised Signature', sigCenterLeft, sigTextY, { size: 9, color: ACCENT, align: 'center', maxWidth: sigColW });

  y -= bankBoxH;

  // ── Outer border ─────────────────────────────────────────────────────────
  page.drawRectangle({
    x: left,
    y: outerBottom,
    width: contentW,
    height: outerTop - outerBottom,
    borderColor: BLACK,
    borderWidth: 0.4,
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
