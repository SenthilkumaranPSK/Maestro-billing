import type { Bill, Settings } from '@/types';
import { paisaToRupee } from '@/types';

export interface ThermalPreviewLine {
  text: string;
  bold?: boolean;
  center?: boolean;
  separator?: boolean;
}

/**
 * Normalize the `thermal_paper_width` setting into the canonical '58' | '80' string.
 * Accepts '58', '58mm', ' 80 ', etc. Defaults to '80' for anything unrecognized.
 */
export function normalizePaperWidth(s: string | undefined | null): '58' | '80' {
  const n = String(s ?? '').trim().replace(/mm$/i, '');
  return n === '58' ? '58' : '80';
}

export function getCharWidth(paperWidth: '58' | '80'): number {
  // RP 3160 is 80mm. Char widths are realistic for a 12×24 dot font:
  //   80mm paper → 42 chars per line
  //   58mm paper → 32 chars per line
  return paperWidth === '58' ? 32 : 42;
}

function splitText(text: string, maxLen: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const linesArr: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (word.length > maxLen) {
      // Word itself is longer than a line — push current buffer then hard-wrap the word.
      if (currentLine) {
        linesArr.push(currentLine);
        currentLine = '';
      }
      let remaining = word;
      while (remaining.length > maxLen) {
        linesArr.push(remaining.substring(0, maxLen));
        remaining = remaining.substring(maxLen);
      }
      currentLine = remaining;
      continue;
    }
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length <= maxLen) {
      currentLine = candidate;
    } else {
      linesArr.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) linesArr.push(currentLine);
  return linesArr.length ? linesArr : [''];
}

/**
 * Right-align `right` to `charWidth` with a left label `left`.
 * The gap between them is the exact remaining space (≥ 1 char), so the right
 * column always lands on the same character position regardless of right-side length.
 *
 * Never truncates the right side. Truncates the left side with `..` if it would
 * otherwise push the right side past the line width.
 */
function rpad(left: string, right: string, charWidth: number): string {
  if (right.length >= charWidth) {
    // Right side fills or overflows the line — emit the right side right-padded to width.
    return right.substring(0, charWidth).padEnd(charWidth, ' ');
  }
  const maxLeft = charWidth - right.length - 1; // at least 1 space of gap
  const trimmedLeft = left.length > maxLeft ? left.substring(0, Math.max(0, maxLeft - 2)) + '..' : left;
  const gap = charWidth - trimmedLeft.length - right.length;
  return trimmedLeft + ' '.repeat(gap) + right;
}

/**
 * Right-align an entire "label  amount" string as one block, e.g. for
 * CGST/SGST rows that sit clustered at the right edge instead of spanning
 * the full line width like rpad(). Never truncates — a block wider than
 * charWidth prints as-is (unpadded) rather than losing digits.
 */
function rightAlign(text: string, charWidth: number): string {
  return text.length >= charWidth ? text : ' '.repeat(charWidth - text.length) + text;
}

/**
 * Whole-rupee amounts print without decimals (e.g. "5,000"); anything with a
 * paisa remainder always gets exactly 2 decimals, never a stray 1 decimal.
 * Exported: shared with thermalLayout.ts, which needs identical formatting
 * whether it ends up on the PDF or the physical raster print.
 */
export function formatAmt(paise: number): string {
  const hasFraction = Math.round(paise) % 100 !== 0;
  return paisaToRupee(paise).toLocaleString('en-IN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

// Product.unit is a full word ("piece", "session", …) sized for the Products
// page and the A4 invoice, where there's room for it. The thermal receipt's
// narrow Qty column needs it abbreviated to keep every row the same width as
// the header, whatever unit the product is set to. Module-level (not inside
// buildReceiptPreview) and exported so thermalLayout.ts shares the exact same
// abbreviations rather than risking a second, drifting copy.
const UNIT_ABBR: Record<string, string> = {
  piece: 'Pc', photo: 'Ph', album: 'Al', set: 'Set',
  frame: 'Fr', session: 'Ses', roll: 'Rl', print: 'Pr', no: 'No',
};
function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
export function abbrUnit(u: string): string {
  return UNIT_ABBR[u.toLowerCase()] ?? capitalize(u).slice(0, 3);
}

/**
 * Emit a `prefix`-prefixed multi-line value. The first chunk carries the prefix
 * (e.g. "Customer: …"); continuation chunks are emitted without the prefix so
 * the wrapped text aligns with the first chunk. The last chunk is right-padded
 * with `right` (e.g. an amount) via `rpad`; if `right` is omitted, every chunk
 * is left-aligned.
 */
function emitWrapped(
  lines: ThermalPreviewLine[],
  prefix: string,
  value: string,
  charWidth: number,
  opts: { right?: string; bold?: boolean; center?: boolean; separator?: boolean } = {},
): void {
  const valueMaxLen = Math.max(1, charWidth - prefix.length - 1);
  const chunks = splitText(value, valueMaxLen);

  chunks.forEach((chunk, i) => {
    const isFirst = i === 0;
    const isLast = i === chunks.length - 1;
    const head = isFirst ? `${prefix}${chunk}` : chunk;
    const text = isLast && opts.right !== undefined
      ? rpad(head, opts.right, charWidth)
      : head;
    lines.push({
      text,
      bold: opts.bold,
      center: opts.center,
      separator: opts.separator,
    });
  });
}

/**
 * @param charWidthOverride  columns to lay the receipt out in, when the caller
 *   knows the real figure. The PDF renderer sizes its own page, so it uses the
 *   getCharWidth() default; raw ESC/POS printing computes the exact number of
 *   characters that fit inside the printer's configured print area and passes
 *   it here, so what gets padded matches what the printer actually prints.
 */
export function buildReceiptPreview(
  bill: Bill,
  settings: Partial<Settings>,
  charWidthOverride?: number,
): ThermalPreviewLine[] {
  const studio = settings.studio;
  const studioOwner = studio?.studio_owner ?? '';
  const studioPhone = studio?.studio_phone ?? '';
  const studioGstin = studio?.studio_gstin ?? '';
  const studioAddress = studio?.studio_address ?? '';
  // Fallback matches the seeded default so the footer never changes just
  // because the settings row is missing.
  const footer = settings.invoice?.invoice_footer ?? 'Thank You';
  const paperWidth = normalizePaperWidth(settings.printer?.thermal_paper_width);
  const charWidth = charWidthOverride ?? getCharWidth(paperWidth);

  // A solid rule, not a dashed one — "-" repeated read as a row of dashes
  // rather than a straight divider line.
  const dline = '_'.repeat(charWidth);

  const billDate = new Date(bill.billDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const lines: ThermalPreviewLine[] = [];

  // Studio header — logo (PDF output only; ESC/POS is text-only, see pdf.ts),
  // then owner name, address, mobile, GSTIN, all centered.
  if (studioOwner) {
    lines.push({ text: studioOwner, center: true, bold: true });
  }
  if (studioAddress) {
    // "\n" in the setting forces a line break at that exact point (e.g. street
    // vs city/pincode); each resulting segment is still word-wrapped so it
    // never overflows narrow (58mm) paper.
    studioAddress.split('\n').forEach((paragraph) => {
      splitText(paragraph.trim(), charWidth).forEach((addrLine) => {
        lines.push({ text: addrLine, center: true });
      });
    });
  }
  if (studioPhone) {
    lines.push({ text: `Mobile : ${studioPhone}`, center: true });
  }
  if (studioGstin) {
    lines.push({ text: `GSTIN : ${studioGstin}`, center: true });
  }

  lines.push(
    { text: dline, separator: true, center: true },
    { text: 'Tax Bill', center: true, bold: true },
    { text: dline, separator: true, center: true },
  );

  // When the customer has their own GSTIN (a B2B bill), the bill number gets
  // its own centered line right under "Tax Bill" so Name can pair with Gstin
  // instead. Otherwise it stays paired with Name on the right, as usual.
  const hasCustomerGstin = !!bill.customer?.gstin;
  if (hasCustomerGstin) {
    lines.push({ text: `Bill Num : ${bill.billNumber}`, center: true });
  }

  // Customer + bill info as a two-column layout: name/mobile on the left,
  // the customer's own GSTIN/the bill date right-aligned on the same
  // lines. A long name or GSTIN must never be truncated with ".." just to
  // fit next to them — fall back to stacking them on their own line instead
  // when they don't fit.
  const pairOrStack = (leftText: string, rightText: string) => {
    if (leftText.length + rightText.length + 1 <= charWidth) {
      lines.push({ text: rpad(leftText, rightText, charWidth) });
    } else {
      if (leftText) lines.push({ text: leftText });
      lines.push({ text: rpad('', rightText, charWidth) });
    }
  };

  // '0000000000' is the seeded Walk-in Customer's placeholder phone — when
  // that record is the one picked for the bill, print "Customer" rather than
  // its admin-facing "Walk-in Customer" label, same as when no customer is
  // attached at all.
  const isPlaceholderCustomer = bill.customer?.phone === '0000000000';
  const custName = !bill.customer || isPlaceholderCustomer ? 'Customer' : bill.customer.name;
  // The customer's own GSTIN (not the studio's) prints beside their name when
  // present; otherwise the bill number goes there instead, same as before
  // GSTIN support was added.
  pairOrStack(`Name : ${custName}`, hasCustomerGstin ? `Gstin : ${bill.customer!.gstin}` : `Bill Num : ${bill.billNumber}`);
  const showPhone = !!bill.customer?.phone && !isPlaceholderCustomer;
  pairOrStack(showPhone ? `Mobile : ${bill.customer!.phone}` : '', `Date : ${billDate}`);

  // Item table header. Qty/Price/Amt sit in fixed-width columns on the right
  // (colFit below), with Product taking whatever's left — the same layout
  // the header row and every item row share, so the columns line up.
  // Right-aligns into `width`. Never truncates on overflow (e.g. a price
  // wider than the column was sized for) — silently chopping digits off a
  // printed amount is far worse than a column running slightly wide. Adds a
  // leading space in that case so it never runs straight into its neighbour
  // with zero gap.
  const colFit = (text: string, width: number) =>
    text.length >= width ? ` ${text}` : text.padStart(width, ' ');

  // Qty/Price/Amt sit in right-hand columns sized to THIS bill's widest
  // actual value, with Product taking whatever's left.
  //
  // These used to be hardcoded 6/9/9. The 9s existed for GST-INCLUSIVE bills,
  // where tax is extracted from the entered price and almost always leaves a
  // paisa remainder ("1,271.19"). But an exclusive bill's amounts are short
  // ("1,500"), so 24 characters were reserved on every receipt to fit a
  // number most bills never print — leaving the product name just 14
  // characters on 80mm paper. "Passport Size Photo" (19) therefore wrapped
  // onto two lines while eight columns sat blank beside it, which is what the
  // studio reported as the item block looking broken.
  //
  // Measuring the real values keeps the wide case working (an inclusive bill
  // still gets its 9s, because that IS its widest value) while giving short
  // bills their space back. Every row and the header share one computed
  // width, so the columns still line up exactly.
  const colWidth = (header: string, values: string[]) =>
    Math.max(header.length, ...values.map((v) => v.length)) + 1;

  const itemCells = bill.items.map((item) => {
    const baseAmt = item.totalAmount - item.gstAmount;
    return {
      baseAmt,
      qty: `${item.qty} ${abbrUnit(item.unit)}`,
      price: formatAmt(item.qty ? Math.round(baseAmt / item.qty) : item.unitPrice),
      amt: formatAmt(baseAmt),
    };
  });

  const QTY_W = colWidth('Qty', itemCells.map((c) => c.qty));
  const PRICE_W = colWidth('Price', itemCells.map((c) => c.price));
  const AMT_W = colWidth('Amt', itemCells.map((c) => c.amt));

  lines.push(
    { text: dline, separator: true, center: true },
    {
      text: rpad(
        'SN  Product',
        `${colFit('Qty', QTY_W)}${colFit('Price', PRICE_W)}${colFit('Amt', AMT_W)}`,
        charWidth,
      ),
      bold: true,
    },
    { text: dline, separator: true, center: true },
  );

  // Per-item line: "N  <product name>   <qty+unit>  <price>  <amount>". No
  // per-item GST — the tax split lives only in the totals block below,
  // matching the reference template.
  //
  // Price/Amt always show the tax-excluded base, not item.unitPrice as
  // entered — for an exclusive bill those are the same number, but for an
  // inclusive bill unitPrice is the all-in sticker price, and printing that
  // next to Amt would make the item lines sum to more than the Sub Total row
  // below them. (item.totalAmount - item.gstAmount) is the tax-excluded
  // base in both modes, so this keeps every receipt internally consistent —
  // same as the "look the same as exclusive" ask, not just same labels.
  bill.items.forEach((item, i) => {
    // Cells were computed above so the column widths could be measured from
    // the real values; reuse them rather than recomputing, so what was
    // measured and what gets printed can never drift apart.
    const cell = itemCells[i]!;
    const totalsBlock = `${colFit(cell.qty, QTY_W)}${colFit(cell.price, PRICE_W)}${colFit(cell.amt, AMT_W)}`;

    // Product name wraps on its own (like the customer name above) instead
    // of going through emitWrapped's rpad-based truncation — a long name
    // (e.g. "Passport Size Photo Print") must never be cut down to
    // "Passport Siz..". The wrap width is reserved down to leave room for
    // the Qty/Price/Amt block on whichever line ends up last, e.g.:
    //   1  Baby Photo
    //      Shoot (1 hr)      2 Ses   500.00  1,000.00
    // rather than a name that only wraps once it's already too long to fit
    // next to the totals.
    // On narrow (58mm) paper the totals block alone eats most of the line,
    // so reserving room for it would force almost every name into unreadable
    // 3-4 char slivers — fall back to the old generous wrap + bail-the-totals-
    // to-their-own-line behavior there instead.
    // The serial number is padded to the width of the "SN" header so the name
    // starts in the same column as the word "Product" above it. Previously
    // this was `${i + 1}  ` — 3 characters for a single-digit row against the
    // header's 4 ("SN" + two spaces), so every row from 1 to 9 printed its
    // product name one character left of its own column heading, and rows
    // 10+ printed correctly. Subtle enough to read as generally "off" rather
    // than as a specific bug, which is how it survived several redesigns.
    const SN_HEADER = 'SN';
    const prefix = `${String(i + 1).padEnd(SN_HEADER.length)}  `;
    const MIN_READABLE_NAME_LEN = 8;
    const tightNameMaxLen = charWidth - totalsBlock.length - 1 - prefix.length;
    const nameMaxLen = tightNameMaxLen >= MIN_READABLE_NAME_LEN
      ? tightNameMaxLen
      : Math.max(1, charWidth - prefix.length - 1);
    // Continuation lines indent to line up under the product name's own
    // start column, not column 0 (under "SN") — printing flush left there
    // reads as if the row collapsed back into the item-number column.
    const indent = ' '.repeat(prefix.length);
    const nameChunks = splitText(item.productName, nameMaxLen);
    nameChunks.forEach((chunk, ci) => {
      lines.push({ text: ci === 0 ? `${prefix}${chunk}` : `${indent}${chunk}` });
    });

    const lastLine = lines[lines.length - 1]!;
    if (lastLine.text.length + totalsBlock.length + 1 <= charWidth) {
      lastLine.text = rpad(lastLine.text, totalsBlock, charWidth);
    } else {
      lines.push({ text: rpad('', totalsBlock, charWidth) });
    }
  });

  lines.push({ text: dline, separator: true, center: true });

  // grandTotal includes the round-off; without this line the printed items
  // wouldn't add up to the printed Grand Total. Derived (not a stored field
  // on the API's Bill shape): items-incl-GST − discount vs grand total.
  const itemsTotal = bill.items.reduce((s, i) => s + i.totalAmount, 0);
  const roundOff = bill.grandTotal - (itemsTotal - bill.discountAmount);
  // No "+" on a positive round-off — same convention as the A4 invoice
  // (lib/a4invoice.ts's totalRows amount formatting): a negative gets "-",
  // everything else (including positive) prints bare, matching how every
  // other total row (Sub Total, Grand Total) never carries a sign either.
  const roundOffAmt = `${roundOff < 0 ? '-' : ''}Rs ${formatAmt(Math.abs(roundOff))}`;

  // Same Sub Total / CGST / SGST / Round Off / Grand Total layout regardless
  // of GST inclusive/exclusive — only how subTotal/gstAmount were derived
  // differs (see billMath.ts), never how the receipt is printed.
  // Boxed like the reference layout: Sub Total on its own, then a divider,
  // then the CGST/SGST/Round Off group, then a divider before Grand Total.
  lines.push({ text: rpad('Sub Total', `Rs ${formatAmt(bill.subTotal)}`, charWidth) });
  lines.push({ text: dline, separator: true, center: true });

  if (bill.gstAmount > 0) {
    const gstRates = [...new Set(bill.items.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
    const halfRate = gstRates.length === 1 ? gstRates[0]! / 2 : null;
    const half = Math.floor(bill.gstAmount / 2);
    const cgstLabel = halfRate !== null ? `CGST ${halfRate}%` : 'CGST';
    const sgstLabel = halfRate !== null ? `SGST ${halfRate}%` : 'SGST';
    // Clustered together at the right edge (label + amount as one block),
    // unlike the other total rows which span the full line width.
    lines.push({ text: rightAlign(`${cgstLabel}  Rs ${formatAmt(half)}`, charWidth) });
    lines.push({ text: rightAlign(`${sgstLabel}  Rs ${formatAmt(bill.gstAmount - half)}`, charWidth) });
  }
  if (bill.discountAmount > 0) {
    lines.push({ text: rpad('Discount', `-Rs ${formatAmt(bill.discountAmount)}`, charWidth) });
  }
  // Only shown when there's an actual round-off — most bills land on an
  // exact rupee already, and a permanent "Round Off  Rs 0" row on every
  // single receipt reads as noise rather than useful info.
  if (roundOff !== 0) {
    lines.push({ text: rpad('Round Off', roundOffAmt, charWidth) });
  }

  lines.push({ text: dline, separator: true, center: true });
  lines.push({ text: rpad('Grand Total', `Rs ${formatAmt(bill.grandTotal)}`, charWidth), bold: true });
  lines.push({ text: '' });
  lines.push({ text: footer, center: true, bold: true });
  lines.push({ text: '' });
  lines.push({ text: '' });
  lines.push({ text: '' });

  return lines;
}

// ESC/POS byte commands
const ESC = 0x1b;
const GS = 0x1d;

function cmd(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

const INIT = cmd(ESC, 0x40);
const BOLD_ON = cmd(ESC, 0x45, 0x01);
const BOLD_OFF = cmd(ESC, 0x45, 0x00);
const CENTER = cmd(ESC, 0x61, 0x01);
const LEFT = cmd(ESC, 0x61, 0x00);
const CUT = cmd(GS, 0x56, 0x00);
const FEED = cmd(ESC, 0x64, 0x04);

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text + '\n');
}

/**
 * Printable width of the thermal head, in dots, at its native 203dpi.
 * Not the paper width: an 80mm roll prints ~72mm of it (576 dots), a 58mm
 * roll ~48mm (384 dots). Raster images must be built to exactly this width
 * or the printer either clips them or leaves them off-centre.
 */
export function getPrinterDots(paperWidth: '58' | '80'): number {
  return paperWidth === '58' ? 384 : 576;
}

/**
 * ESC/POS raster bit-image block (GS v 0).
 *
 * `bits` is packed one byte per 8 horizontal dots, MSB = leftmost dot, and a
 * set bit means "burn". This is how an image reaches a thermal printer
 * natively — as dots it prints 1:1, rather than as a PDF the OS rasterises
 * and antialiases first.
 */
export function escPosRaster(bits: Uint8Array, widthBytes: number, heightDots: number): Uint8Array {
  const header = cmd(
    GS, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    heightDots & 0xff, (heightDots >> 8) & 0xff,
  );
  return concat(header, bits);
}

export interface EscPosLogo {
  bits: Uint8Array;
  widthBytes: number;
  heightDots: number;
}

/**
 * Build the raw ESC/POS byte stream for a receipt.
 *
 * This is the path that actually produces crisp output on the RP3160. Printing
 * the PDF instead goes through the browser's print pipeline, which rasterises
 * the page with antialiasing — and a thermal head is 1-bit, so those grey edge
 * pixels get dithered into visible fuzz. Sending text as text lets the printer
 * use its own built-in font, which is exactly aligned to its dot grid.
 *
 * `logo` is optional and built by the caller (see lib/escposLogo.ts) because
 * converting a PNG to 1-bit needs a canvas, which this module deliberately
 * stays free of so it remains testable outside a browser.
 */
/** Font A cell width in dots on this printer class (12x24). */
const FONT_A_DOT_WIDTH = 12;
/** 203dpi head ≈ 8 dots per mm. */
const DOTS_PER_MM = 8;
/** Blank paper deliberately left down each edge, per the studio's request. */
export const ESCPOS_MARGIN_MM = 3;

/**
 * The print geometry raw ESC/POS output is laid out against.
 *
 * `charWidth` here is only meaningful to the text-mode FALLBACK path
 * (buildEscPosCommands below) — getCharWidth()'s 42 columns is a figure
 * chosen for that printer-font case, not what the printer's own font metrics
 * actually give at this print width (a 12-dot font across 576 printable dots
 * is really 48 columns; that mismatch is what broke alignment the first time
 * this path existed). The brand-font raster path
 * (lib/thermalRaster.ts) doesn't use `charWidth` at all — it measures real
 * text with the actual font instead.
 */
export function getEscPosGeometry(paperWidth: '58' | '80') {
  const totalDots = getPrinterDots(paperWidth);
  const marginDots = ESCPOS_MARGIN_MM * DOTS_PER_MM;
  const printDots = totalDots - marginDots * 2;
  return {
    totalDots,
    marginDots,
    printDots,
    charWidth: Math.floor(printDots / FONT_A_DOT_WIDTH),
  };
}

/** GS L — left margin, in dots from the physical left edge. */
const setLeftMargin = (dots: number) => cmd(GS, 0x4c, dots & 0xff, (dots >> 8) & 0xff);
/** GS W — printable area width, in dots. */
const setPrintWidth = (dots: number) => cmd(GS, 0x57, dots & 0xff, (dots >> 8) & 0xff);

/** Height of a divider rule, in dots. Thin but unmistakably a printed line. */
const RULE_DOTS = 2;
// Whitespace baked into the rule raster, above and below the bar itself.
//
// A text line advances the paper by the full line spacing (~30 dots for a
// 24-dot glyph), which leaves ~6 dots of leading under it before the next
// thing prints. A raster advances by EXACTLY its own height, so a bare 2-dot
// rule ends up with a little space above it and none at all below — which is
// how "Tax Bill" ended up sitting hard against the line above it. More
// padding below than above compensates for that leading, so the rule reads as
// centred in its own band rather than glued to whatever follows.
const RULE_PAD_ABOVE_DOTS = 3;
const RULE_PAD_BELOW_DOTS = 8;

/**
 * A divider drawn as a real rule — a solid raster bar — instead of a row of
 * underscore characters.
 *
 * Underscores cost a whole text line (~30 dots) and render near the bottom of
 * their glyph box, so each divider printed as a thin mark with a large empty
 * band above it. That is what the studio first saw as too much space around
 * the lines. lib/pdf.ts already solved this for the PDF by drawing real lines
 * (Phase 9); this is the same fix for the raw-printing path, which had been
 * left on the old character-based dividers.
 */
function escPosRule(printDots: number): Uint8Array {
  const widthBytes = Math.ceil(printDots / 8);
  const height = RULE_PAD_ABOVE_DOTS + RULE_DOTS + RULE_PAD_BELOW_DOTS;
  const bits = new Uint8Array(widthBytes * height); // zero = white
  // The last byte of a row can extend past printDots; mask the overhang so the
  // rule stops exactly at the print-area edge instead of nudging the printer
  // into wrapping.
  const overhang = widthBytes * 8 - printDots;
  const lastByte = overhang > 0 ? (0xff << overhang) & 0xff : 0xff;
  for (let row = RULE_PAD_ABOVE_DOTS; row < RULE_PAD_ABOVE_DOTS + RULE_DOTS; row++) {
    const base = row * widthBytes;
    bits.fill(0xff, base, base + widthBytes);
    bits[base + widthBytes - 1] = lastByte;
  }
  return escPosRaster(bits, widthBytes, height);
}

/**
 * Wraps one or more pre-dithered raster blocks (the studio logo, then the
 * AvantGarde-rendered text block — see lib/thermalRaster.ts) into a
 * complete, ready-to-send ESC/POS byte stream: init, margins, each raster
 * block in order, feed, cut.
 *
 * The text block is passed in as multiple chunks rather than one tall image
 * on purpose: some ESC/POS clone firmware (this printer's included) has a
 * raster buffer much smaller than the protocol's own 65535-dot height limit,
 * and a tall image sent as a single GS v 0 can print garbled or truncated.
 * Splitting into horizontal bands sidesteps that regardless of the actual
 * buffer size, which isn't documented for this printer class.
 */
export function buildEscPosRasterEnvelope(
  blocks: Array<{ bits: Uint8Array; widthBytes: number; heightDots: number }>,
  paperWidth: '58' | '80',
): Uint8Array {
  const { marginDots, printDots } = getEscPosGeometry(paperWidth);
  const parts: Uint8Array[] = [INIT, setLeftMargin(marginDots), setPrintWidth(printDots), LEFT];
  for (const block of blocks) {
    parts.push(escPosRaster(block.bits, block.widthBytes, block.heightDots));
  }
  parts.push(FEED, CUT);
  return concat(...parts);
}

/**
 * Build the raw ESC/POS byte stream for a receipt using the PRINTER'S OWN
 * built-in font (text mode, not a raster image).
 *
 * No longer the default print path — receipts now print in the studio's
 * AvantGarde brand font via lib/thermalRaster.ts, which requires rasterizing
 * the whole receipt as a dithered image (see buildEscPosRasterEnvelope
 * above). This function is kept as the fallback for when that rasterizing
 * fails for any reason (the brand font failing to load, a canvas being
 * unavailable) — printer-font text mode is guaranteed crisp and never
 * depends on a font file being present, so a font hiccup degrades the
 * receipt's look rather than blocking printing entirely.
 *
 * Two things here are deliberate and were the cause of the misaligned first
 * attempt when this WAS the default path:
 *
 * 1. The receipt is laid out at the column count that genuinely fits the
 *    print area, not the PDF's 42. Printing 42-column lines into the
 *    printer's real 48-column line left every rpad()'d right-hand column
 *    short of where it belonged.
 *
 * 2. Centred lines are padded HERE and everything is emitted left-aligned.
 *    Using the printer's own ESC a 1 centred those lines within the
 *    printer's line width while left-aligned rows started at column 0, so
 *    dividers and headings sat several characters right of the item table.
 *    The PDF never showed this because it centres against the same geometry
 *    it padded to. One coordinate system, applied once, is the fix.
 */
export function buildEscPosCommands(
  bill: Bill,
  settings: Partial<Settings>,
  logo?: EscPosLogo | null,
): Uint8Array {
  const paperWidth = normalizePaperWidth(settings.printer?.thermal_paper_width);
  const { marginDots, printDots, charWidth } = getEscPosGeometry(paperWidth);
  const lines = buildReceiptPreview(bill, settings, charWidth);

  const parts: Uint8Array[] = [
    INIT,
    // INIT resets these, so they must come after it.
    setLeftMargin(marginDots),
    setPrintWidth(printDots),
    LEFT,
  ];

  if (logo) {
    parts.push(escPosRaster(logo.bits, logo.widthBytes, logo.heightDots));
    // A raster advances the paper by exactly its own height, so without this
    // the studio name printed hard against the bottom of the logo.
    parts.push(textToBytes(''));
  }

  for (const line of lines) {
    // Dividers are rules, not text — see escPosRule().
    if (line.separator) {
      parts.push(escPosRule(printDots));
      continue;
    }
    if (line.bold) parts.push(BOLD_ON);
    // Centre by padding, not by ESC a — see the note above.
    const text = line.center ? centreIn(line.text, charWidth) : line.text;
    parts.push(textToBytes(text));
    if (line.bold) parts.push(BOLD_OFF);
  }

  parts.push(FEED);
  parts.push(CUT);

  return concat(...parts);
}

function centreIn(text: string, charWidth: number): string {
  if (text.length >= charWidth) return text;
  return ' '.repeat(Math.floor((charWidth - text.length) / 2)) + text;
}
