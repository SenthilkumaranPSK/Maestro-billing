import type { Bill, Settings } from '@/types';
import { paisaToRupee } from '@/types';

export interface ThermalPreviewLine {
  text: string;
  bold?: boolean;
  center?: boolean;
  separator?: boolean;
  /** Rendered one size smaller (studio address/phone/GSTIN header block). */
  small?: boolean;
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

  const line = '='.repeat(charWidth);
  const dline = '-'.repeat(charWidth);

  const billDate = new Date(bill.billDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const billTime = new Date(bill.billDate).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const lines: ThermalPreviewLine[] = [
    { text: line, separator: true, center: true },
  ];

  // Proprietor name — sits right below the logo, above the address.
  if (studioOwner) {
    lines.push({ text: studioOwner, center: true, bold: true, small: true });
  }

  if (studioAddress) {
    // "\n" in the setting forces a line break at that exact point (e.g. street
    // vs city/pincode); each resulting segment is still word-wrapped so it
    // never overflows narrow (58mm) paper.
    studioAddress.split('\n').forEach((paragraph) => {
      splitText(paragraph.trim(), charWidth).forEach((addrLine) => {
        lines.push({ text: addrLine, center: true, small: true });
      });
    });
  }

  if (studioPhone) {
    lines.push({ text: `Ph: ${studioPhone}`, center: true, small: true });
  }
  if (studioGstin) {
    lines.push({ text: `GSTIN: ${studioGstin}`, center: true, small: true });
  }

  // Customer + Bill info as a two-column layout: customer name/phone on the
  // left, bill number/date+time right-aligned on the same lines.
  lines.push(
    { text: line, separator: true, center: true },
    { text: rpad(`Name: ${bill.customer?.name ?? 'Walk-in'}`, `Bill: ${bill.billNumber}`, charWidth) },
  );

  const phoneLeft = bill.customer?.phone ? `Ph: ${bill.customer.phone}` : '';
  const dateRight = `Dt: ${billDate} ${billTime}`;

  if (phoneLeft.length + dateRight.length + 1 <= charWidth) {
    lines.push({ text: rpad(phoneLeft, dateRight, charWidth) });
  } else {
    // Not enough room on this paper width to pair phone + date without
    // rpad() truncating the phone number — a phone number must never be cut
    // off, so fall back to stacking them on their own lines instead.
    if (phoneLeft) lines.push({ text: phoneLeft });
    lines.push({ text: rpad('', dateRight, charWidth) });
  }
  // Items header.
  lines.push(
    { text: line, separator: true, center: true },
    { text: rpad('ITEM', 'AMOUNT', charWidth), bold: true },
    { text: dline, separator: true, center: true },
  );

  // Per-item lines: wrap product name, right-align subtotal on the last name chunk,
  // then a qty × price breakdown line (no amount — the incl.-GST figure here
  // read like a duplicate), then a "+ GST @rate%:" line so the tax split stays
  // auditable. Item subtotals + GST lines add up to the bill TOTAL.
  bill.items.forEach((item, i) => {
    const subtotal = paisaToRupee(item.qty * item.unitPrice).toFixed(2);
    const unitPrice = paisaToRupee(item.unitPrice).toFixed(2);

    // Line 1: "1. <product name chunks>                                  <subtotal>"
    emitWrapped(lines, `${i + 1}. `, item.productName, charWidth, { right: subtotal });

    // Line 2: "   <qty> x <unit price>"
    lines.push({
      text: `   ${item.qty} ${item.unit} x ${unitPrice}`,
    });

    // Line 3 (only when GST applies): explicit tax detail.
    if (item.gstRate > 0) {
      const gstAmt = paisaToRupee(item.gstAmount).toFixed(2);
      lines.push({
        text: rpad(`   + GST @${item.gstRate}%:`, `+${gstAmt}`, charWidth),
      });
    }
  });

  // Per-item lines already show the GST split, so the summary stays minimal:
  // discount and round-off (when present) and the total.
  if (bill.discountAmount > 0) {
    lines.push({ text: dline, separator: true, center: true });
    lines.push({
      text: rpad('Discount:', `-${paisaToRupee(bill.discountAmount).toFixed(2)}`, charWidth),
    });
  }

  // grandTotal includes the round-off; without this line the printed items
  // wouldn't add up to the printed TOTAL. Derived (not a stored field on the
  // API's Bill shape): items-incl-GST − discount vs grand total.
  const itemsTotal = bill.items.reduce((s, i) => s + i.totalAmount, 0);
  const roundOff = bill.grandTotal - (itemsTotal - bill.discountAmount);
  if (roundOff !== 0) {
    if (bill.discountAmount <= 0) lines.push({ text: dline, separator: true, center: true });
    lines.push({
      text: rpad('Round Off:', `${roundOff > 0 ? '+' : '-'}${paisaToRupee(Math.abs(roundOff)).toFixed(2)}`, charWidth),
    });
  }

  lines.push({ text: line, separator: true, center: true });
  lines.push({
    text: rpad('TOTAL:', `Rs.${paisaToRupee(bill.grandTotal).toFixed(2)}`, charWidth),
    bold: true,
  });
  lines.push({ text: line, separator: true, center: true });
  lines.push({ text: footer, center: true, bold: true });
  lines.push({ text: line, separator: true, center: true });
  lines.push({ text: '' });
  lines.push({ text: '' });
  lines.push({ text: '' });

  return lines;
}

export function buildReceiptPrintHtml(bill: Bill, settings: Partial<Settings>): string {
  const lines = buildReceiptPreview(bill, settings);
  const paperWidth = normalizePaperWidth(settings.printer?.thermal_paper_width);
  const pageWidth = paperWidth === '58' ? '58mm' : '80mm';
  // 9px is readable on both 58mm and 80mm at 12×24 dot density; 7px is too small.
  const fontSize = '9px';

  const body = lines
    .map((line) => {
      const styles: string[] = ['white-space: pre'];
      if (line.center) styles.push('text-align: center');
      if (line.bold) styles.push('font-weight: bold');
      if (line.separator) styles.push('color: #94a3b8');
      // Small lines are centered header text (address/phone/GSTIN), never
      // rpad-aligned columns, so a different size can't break alignment.
      if (line.small) styles.push('font-size: 8px');
      // Trailing spaces on rpad'd lines are load-bearing — they push the right
      // column to the exact char-width edge. We must use a non-breaking space
      // (&#160;) at the end so the browser doesn't collapse trailing whitespace
      // on lines that happen to end with one. For the empty separator lines we
      // emit &#160; to keep the line box alive.
      const needsNbsp = line.text.length > 0 && line.text.endsWith(' ') && !line.separator;
      const content = line.text.length > 0
        ? escapeHtml(line.text) + (needsNbsp ? '&#160;' : '')
        : '&#160;';
      return `<div style="${styles.join('; ')};">${content}</div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt - ${escapeHtml(bill.billNumber)}</title>
<style>
  @page { size: ${pageWidth} auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: 'Courier New', 'Consolas', monospace;
    font-size: ${fontSize};
    line-height: 1.2;
    /* No padding: thermal paper is exactly pageWidth wide, and the lines are
       already pre-padded by rpad() to fill that width. Any padding would
       shrink the body and clip the rightmost characters. */
    width: ${pageWidth};
    background: #fff;
    color: #000;
  }
  @media print {
    @page { margin: 0; }
  }
</style></head>
<body>${body}
<script>
  // Auto-open the print dialog once the receipt has rendered, and close the
  // popup after printing so the operator never has to touch this window.
  window.onload = function () {
    window.print();
    window.onafterprint = function () { window.close(); };
  };
</script>
</body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
