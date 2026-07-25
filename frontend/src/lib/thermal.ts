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
 * Three-column row: `left` at the start, `right` right-aligned at the end,
 * `mid` squeezed into the gap between them (used only for the Sub Total row's
 * total-quantity figure). Silently drops `mid` if there isn't room for all
 * three on narrow (58mm) paper — `left`/`right` still always fit.
 */
function rpad3(left: string, mid: string, right: string, charWidth: number): string {
  const chars = new Array(charWidth).fill(' ');
  const place = (s: string, start: number) => {
    for (let i = 0; i < s.length && start + i < charWidth; i++) chars[start + i] = s[i];
  };
  place(left, 0);
  const rightStart = Math.max(0, charWidth - right.length);
  place(right, rightStart);
  const midStart = rightStart - mid.length - 2;
  if (midStart >= left.length + 1) place(mid, midStart);
  return chars.join('');
}

/**
 * Whole-rupee amounts print without decimals (e.g. "5,000"); anything with a
 * paisa remainder always gets exactly 2 decimals, never a stray 1 decimal.
 */
function formatAmt(paise: number): string {
  const hasFraction = Math.round(paise) % 100 !== 0;
  return paisaToRupee(paise).toLocaleString('en-IN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
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

export function buildReceiptPreview(bill: Bill, settings: Partial<Settings>): ThermalPreviewLine[] {
  const studio = settings.studio;
  const studioOwner = studio?.studio_owner ?? '';
  const studioPhone = studio?.studio_phone ?? '';
  const studioGstin = studio?.studio_gstin ?? '';
  const studioAddress = studio?.studio_address ?? '';
  // Fallback matches the seeded default so the footer never changes just
  // because the settings row is missing.
  const footer = settings.invoice?.invoice_footer ?? 'Thank You';
  const paperWidth = normalizePaperWidth(settings.printer?.thermal_paper_width);
  const charWidth = getCharWidth(paperWidth);

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
  const QTY_W = 6;
  // Wide enough for a plain "1,500" AND a two-decimal "1,271.19" — GST-
  // inclusive bills extract tax from the entered price, which almost always
  // leaves a paisa remainder, so ".XX" prices are the norm in that mode, not
  // an edge case.
  const PRICE_W = 9;
  const AMT_W = 9;
  // Right-aligns into `width`. Never truncates on overflow (e.g. a price
  // wider than PRICE_W/AMT_W were sized for) — silently chopping digits off
  // a printed amount is far worse than a column running slightly wide. Adds
  // a leading space in that case so it never runs straight into its
  // neighbour with zero gap.
  const colFit = (text: string, width: number) =>
    text.length >= width ? ` ${text}` : text.padStart(width, ' ');
  const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // Product.unit is a full word ("piece", "session", …) sized for the
  // Products page and the A4 invoice, where there's room for it. On the
  // thermal receipt's fixed 6-char Qty column, a full word (e.g. "1 Piece")
  // overflows and throws the Price/Amt columns out of alignment with the
  // header above them — abbreviate to keep every row the same width as the
  // header, whatever unit the product is set to.
  const UNIT_ABBR: Record<string, string> = {
    piece: 'Pc', photo: 'Ph', album: 'Al', set: 'Set',
    frame: 'Fr', session: 'Ses', roll: 'Rl', print: 'Pr', no: 'No',
  };
  const abbrUnit = (u: string) => UNIT_ABBR[u.toLowerCase()] ?? capitalize(u).slice(0, 3);

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
    const baseAmt = item.totalAmount - item.gstAmount;
    const baseUnitPrice = item.qty ? Math.round(baseAmt / item.qty) : item.unitPrice;
    const qtyStr = colFit(`${item.qty} ${abbrUnit(item.unit)}`, QTY_W);
    const priceStr = colFit(formatAmt(baseUnitPrice), PRICE_W);
    const amtStr = colFit(formatAmt(baseAmt), AMT_W);
    const totalsBlock = `${qtyStr}${priceStr}${amtStr}`;

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
    const prefix = `${i + 1}  `;
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
  const roundOffAmt = `${roundOff > 0 ? '+' : roundOff < 0 ? '-' : ''}Rs ${formatAmt(Math.abs(roundOff))}`;

  // Same Sub Total / CGST / SGST / Round Off / Grand Total layout regardless
  // of GST inclusive/exclusive — only how subTotal/gstAmount were derived
  // differs (see billMath.ts), never how the receipt is printed.
  // Boxed like the reference layout: Sub Total on its own, then a divider,
  // then the CGST/SGST/Round Off group, then a divider before Grand Total.
  const totalQty = bill.items.reduce((s, i) => s + i.qty, 0);
  lines.push({ text: rpad3('Sub Total', `${totalQty} No`, `Rs ${formatAmt(bill.subTotal)}`, charWidth) });
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

export function buildEscPosCommands(bill: Bill, settings: Partial<Settings>): Uint8Array {
  const lines = buildReceiptPreview(bill, settings);
  const parts: Uint8Array[] = [INIT];

  for (const line of lines) {
    parts.push(line.center ? CENTER : LEFT);
    if (line.bold) parts.push(BOLD_ON);
    parts.push(textToBytes(line.text));
    if (line.bold) parts.push(BOLD_OFF);
  }

  parts.push(FEED);
  parts.push(CUT);

  return concat(...parts);
}
