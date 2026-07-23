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

  // Every rule on this layout is the same thin weight — no heavier "="
  // divider anywhere, matching the reference template.
  const dline = '-'.repeat(charWidth);

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

  // Customer + bill info as a two-column layout: name/GSTIN on the left,
  // bill date/number right-aligned on the same lines. A long name or GSTIN
  // must never be truncated with ".." just to fit next to the date/number —
  // fall back to stacking them on their own line instead when they don't fit.
  const pairOrStack = (leftText: string, rightText: string) => {
    if (leftText.length + rightText.length + 1 <= charWidth) {
      lines.push({ text: rpad(leftText, rightText, charWidth) });
    } else {
      if (leftText) lines.push({ text: leftText });
      lines.push({ text: rpad('', rightText, charWidth) });
    }
  };

  const custName = bill.customer?.name ?? 'Walk-in Customer';
  pairOrStack(`Name : ${custName}`, `Bill Date : ${billDate}`);
  pairOrStack(bill.customer?.gstin ? `Gstin : ${bill.customer.gstin}` : '', `Bill Num : ${bill.billNumber}`);

  // Item table header.
  lines.push(
    { text: dline, separator: true, center: true },
    { text: rpad('SN  Product', 'Amt', charWidth), bold: true },
    { text: dline, separator: true, center: true },
  );

  // Per-item lines: "N  <product name>            <amount>" then a
  // "qty x price" breakdown line. No per-item GST — the tax split lives only
  // in the totals block below, matching the reference template.
  bill.items.forEach((item, i) => {
    const amt = formatAmt(item.qty * item.unitPrice);
    emitWrapped(lines, `${i + 1}  `, item.productName, charWidth, { right: amt });
    lines.push({ text: `   ${item.qty} ${item.unit} x Rs${formatAmt(item.unitPrice)}` });
  });

  lines.push({ text: dline, separator: true, center: true });

  // GST-inclusive bills print as a single all-in figure — no Sub Total/CGST/
  // SGST breakdown — same rule as the A4 invoice (see lib/a4invoice.ts).
  if (!bill.gstInclusive) {
    const totalQty = bill.items.reduce((s, i) => s + i.qty, 0);
    lines.push({ text: rpad3('Sub Total', `${totalQty} No`, `Rs ${formatAmt(bill.subTotal)}`, charWidth) });

    if (bill.gstAmount > 0) {
      const gstRates = [...new Set(bill.items.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
      const halfRate = gstRates.length === 1 ? gstRates[0]! / 2 : null;
      const half = Math.floor(bill.gstAmount / 2);
      lines.push({ text: rpad(halfRate !== null ? `CGST ${halfRate}%` : 'CGST', `Rs ${formatAmt(half)}`, charWidth) });
      lines.push({ text: rpad(halfRate !== null ? `SGST ${halfRate}%` : 'SGST', `Rs ${formatAmt(bill.gstAmount - half)}`, charWidth) });
    }
  }

  if (bill.discountAmount > 0) {
    lines.push({ text: rpad('Discount', `-Rs ${formatAmt(bill.discountAmount)}`, charWidth) });
  }

  // grandTotal includes the round-off; without this line the printed items
  // wouldn't add up to the printed Grand Total. Derived (not a stored field
  // on the API's Bill shape): items-incl-GST − discount vs grand total.
  const itemsTotal = bill.items.reduce((s, i) => s + i.totalAmount, 0);
  const roundOff = bill.grandTotal - (itemsTotal - bill.discountAmount);
  if (roundOff !== 0) {
    lines.push({
      text: rpad('Round Off', `${roundOff > 0 ? '+' : '-'}Rs ${formatAmt(Math.abs(roundOff))}`, charWidth),
    });
  }

  lines.push({ text: dline, separator: true, center: true });
  lines.push({ text: rpad('Grand Total', `Rs ${formatAmt(bill.grandTotal)}`, charWidth), bold: true });
  if (bill.gstInclusive && bill.gstAmount > 0) {
    lines.push({ text: '(Price incl. of GST)', center: true });
  }
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
