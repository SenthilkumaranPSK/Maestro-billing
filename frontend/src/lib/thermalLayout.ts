import type { Bill, Settings } from '@/types';
import { paisaToRupee } from '@/types';
import { formatAmt, abbrUnit } from '@/lib/thermal';
import { splitTaxP } from '@/lib/billMath';

/**
 * Renderer-agnostic thermal receipt layout, built once and consumed by BOTH
 * the downloadable/WhatsApp PDF (lib/pdf.ts, pdf-lib) and the physical
 * printer's rasterized output (lib/thermalRaster.ts, HTML canvas).
 *
 * Why this exists: the receipt used to be built as pre-padded monospace
 * strings (rpad/rpad3/colFit in lib/thermal.ts), which only line up in a
 * fixed-width font. AvantGarde (the studio's brand font) is proportional, so
 * padding with spaces no longer produces aligned columns — every "SN Product
 * Qty Price Amt" row, every Name/Date pair, would drift. Positions have to be
 * computed from REAL measured text widths instead.
 *
 * PDF (points) and the print raster (printer dots) are different unit
 * systems, so this can't share literal pixel constants between them. What it
 * DOES share is every content/wrapping/fit decision — which text goes where,
 * when a pair stacks instead of sitting side by side, where a product name
 * wraps, whether the item totals land on the same line as the last name
 * chunk or their own line below. Each caller supplies a `measure()` callback
 * in its own units (pdf-lib's font.widthOfTextAtSize, canvas's
 * ctx.measureText) and its own printWidth in that same unit system; the
 * layout math below only ever compares widths within one caller's own units,
 * so the same algorithm produces correct, independently-scaled output for
 * both renderers — which is what keeps the PDF and the physical receipt
 * showing identical content instead of slowly drifting apart.
 */

export type Measure = (text: string, bold?: boolean) => number;

export interface ThermalColumns {
  /** Left edge item names start at (after the SN prefix + gap). */
  productX: number;
  /** Right edges each numeric column right-aligns to. */
  qtyRight: number;
  priceRight: number;
  amtRight: number;
}

export type ThermalRow =
  | { kind: 'blank' }
  | { kind: 'divider' }
  | { kind: 'line'; text: string; align: 'left' | 'center' | 'right'; bold?: boolean }
  /** Two anchors: `left` at the line start, `right` at the line end. */
  | { kind: 'split'; left: string; right: string; bold?: boolean }
  | { kind: 'itemHeader' }
  | {
      kind: 'itemRow';
      sn: string;
      nameLines: string[];
      // Whether qty/price/amt draw on the same row as the LAST name line, or
      // on a fresh row below it — mirrors the original's "append totals to
      // the last wrapped chunk if it fits, else give them their own line".
      totalsOnLastLine: boolean;
      qty: string;
      price: string;
      amt: string;
    };

export interface ThermalLayout {
  rows: ThermalRow[];
  columns: ThermalColumns;
}

/**
 * Vertical footprint of one row, in the caller's own line-height unit
 * (pdf-lib points in lib/pdf.ts, printer dots in lib/thermalRaster.ts) — the
 * single source of truth both draw loops mirror to size their page/canvas
 * upfront, instead of each keeping its own copy of this switch. A second
 * hand-maintained copy previously drifted silently whenever a new
 * `ThermalRow` kind was added, since TypeScript's `default:` fallthrough
 * doesn't flag an un-updated duplicate.
 */
export function thermalRowHeight(row: ThermalRow, lineHeight: number): number {
  switch (row.kind) {
    case 'blank':
      return lineHeight * 0.6;
    case 'divider':
      return lineHeight * 0.5;
    case 'itemRow':
      return row.nameLines.length * lineHeight + (row.totalsOnLastLine ? 0 : lineHeight);
    default:
      return lineHeight;
  }
}

function wrapByWidth(measure: Measure, text: string, maxWidth: number, bold = false): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current && measure(word, bold) > maxWidth) {
      // A single word wider than the whole line — hard-wrap character by
      // character rather than overflowing (matches lib/thermal.ts's
      // character-count splitText for the same long-word case).
      let remaining = word;
      while (remaining.length > 1 && measure(remaining, bold) > maxWidth) {
        let cut = remaining.length - 1;
        while (cut > 1 && measure(remaining.slice(0, cut), bold) > maxWidth) cut--;
        lines.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut);
      }
      current = remaining;
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measure(candidate, bold) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export function buildThermalLayout(
  bill: Bill,
  settings: Partial<Settings>,
  printWidth: number,
  measure: Measure,
): ThermalLayout {
  const studio = settings.studio;
  const studioOwner = studio?.studio_owner ?? '';
  const studioPhone = studio?.studio_phone ?? '';
  const studioGstin = studio?.studio_gstin ?? '';
  const studioAddress = studio?.studio_address ?? '';
  const footer = settings.invoice?.invoice_footer ?? 'Thank You';

  const GAP = Math.max(measure(' ', false), 1);
  const rows: ThermalRow[] = [];

  const billDate = new Date(bill.billDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // ── Studio header ──────────────────────────────────────────────────────
  if (studioOwner) rows.push({ kind: 'line', text: studioOwner, align: 'center', bold: true });
  if (studioAddress) {
    studioAddress.split('\n').forEach((paragraph) => {
      wrapByWidth(measure, paragraph.trim(), printWidth).forEach((addrLine) => {
        rows.push({ kind: 'line', text: addrLine, align: 'center' });
      });
    });
  }
  if (studioPhone) rows.push({ kind: 'line', text: `Mobile : ${studioPhone}`, align: 'center' });
  if (studioGstin) rows.push({ kind: 'line', text: `GSTIN : ${studioGstin}`, align: 'center' });

  rows.push(
    { kind: 'divider' },
    { kind: 'line', text: 'Tax Bill', align: 'center', bold: true },
    { kind: 'divider' },
  );

  // When the customer has their own GSTIN (a B2B bill), the bill number gets
  // its own centered line under "Tax Bill" so Name can pair with Gstin
  // instead. Otherwise it stays paired with Name, as usual.
  const hasCustomerGstin = !!bill.customer?.gstin;
  if (hasCustomerGstin) {
    rows.push({ kind: 'line', text: `Bill Num : ${bill.billNumber}`, align: 'center' });
  }

  // Two-anchor row that falls back to stacking (label on its own line, value
  // right-aligned on the next) when it wouldn't fit side by side — a long
  // name or GSTIN must never be truncated just to squeeze onto one line.
  const pairOrStack = (leftText: string, rightText: string) => {
    if (measure(leftText) + measure(rightText) + GAP <= printWidth) {
      rows.push({ kind: 'split', left: leftText, right: rightText });
    } else {
      if (leftText) rows.push({ kind: 'line', text: leftText, align: 'left' });
      rows.push({ kind: 'split', left: '', right: rightText });
    }
  };

  const isPlaceholderCustomer = bill.customer?.phone === '0000000000';
  const custName = !bill.customer || isPlaceholderCustomer ? 'Customer' : bill.customer.name;
  pairOrStack(
    `Name : ${custName}`,
    hasCustomerGstin ? `Gstin : ${bill.customer!.gstin}` : `Bill Num : ${bill.billNumber}`,
  );
  const showPhone = !!bill.customer?.phone && !isPlaceholderCustomer;
  pairOrStack(showPhone ? `Mobile : ${bill.customer!.phone}` : '', `Date : ${billDate}`);

  // ── Item table ──────────────────────────────────────────────────────────
  // Column widths sized to THIS bill's widest actual value (not a fixed
  // guess) — see lib/thermal.ts's colWidth comment for why: a GST-inclusive
  // bill's paisa-remainder amounts need more room than a plain exclusive
  // bill's round rupee figures, and reserving worst-case width on every
  // receipt would starve the product name column for no reason.
  const itemCells = bill.items.map((item) => {
    const baseAmt = item.totalAmount - item.gstAmount;
    return {
      baseAmt,
      qty: `${item.qty} ${abbrUnit(item.unit)}`,
      price: formatAmt(item.qty ? Math.round(baseAmt / item.qty) : item.unitPrice),
      amt: formatAmt(baseAmt),
    };
  });

  // A gap of one space character (~7px at this font/size) is enough
  // separation in a monospace font, where the original character-based
  // version reserved "+1 char" between columns — but in a proportional font
  // that's thin enough to read as the numbers running together (reported:
  // "Qty Price Amt seems too close"). Reserve a more generous gap between
  // these specific right-aligned numeric columns.
  const COL_GAP = GAP * 2.5;
  const colWidth = (header: string, values: string[]) =>
    Math.max(measure(header, true), ...values.map((v) => measure(v, false))) + COL_GAP;

  const qtyW = colWidth('Qty', itemCells.map((c) => c.qty));
  const priceW = colWidth('Price', itemCells.map((c) => c.price));
  const amtW = colWidth('Amt', itemCells.map((c) => c.amt));

  const amtRight = printWidth;
  const priceRight = amtRight - amtW;
  const qtyRight = priceRight - priceW;
  // SN column: fixed at 2 characters' worth in the original (padEnd to the
  // "SN" header's own length, however many digits the row number actually
  // has) — reproduced here by measuring "SN" itself as the reserved width,
  // same as the header cell it lines up under.
  const snWidth = measure('SN', true) + COL_GAP;
  const productX = snWidth + GAP;
  const productWidth = Math.max(GAP, qtyRight - productX - GAP);

  rows.push({ kind: 'divider' }, { kind: 'itemHeader' }, { kind: 'divider' });

  bill.items.forEach((item, i) => {
    const cell = itemCells[i]!;
    const totalsWidth = measure(cell.qty) + measure(cell.price) + measure(cell.amt);

    // Wrap at the FULL product column width first — this always produces the
    // fewest possible lines. Only pull the totals block onto that last line
    // if there's genuinely room left over once the name is wrapped;
    // otherwise they get one line of their own below.
    //
    // A "reserve room for the totals on every line up front" pass was tried
    // here first, but for a short product name whose pixel width is still a
    // large fraction of the column — an ordinary case with a proportional
    // font, unlike the old monospace layout where reserving that space
    // barely cost anything — that reservation could force an unnecessarily
    // narrow wrap even though the whole name would have fit on one line at
    // full width. Confirmed against a real reported case: "Baby Photo Shoot
    // (1 hr)" measures 268px against a 329px-wide column (fits easily on one
    // line), but reserving room for "1 Ses / 3,000 / 3,000" up front left
    // only ~129px, wrapping it into three near-empty lines for no reason.
    const nameLines = wrapByWidth(measure, item.productName, productWidth);

    const lastLineWidth = measure(nameLines[nameLines.length - 1]!);
    const totalsOnLastLine = lastLineWidth + totalsWidth + GAP <= productWidth;

    rows.push({
      kind: 'itemRow',
      sn: String(i + 1),
      nameLines,
      totalsOnLastLine,
      qty: cell.qty,
      price: cell.price,
      amt: cell.amt,
    });
  });

  rows.push({ kind: 'divider' });

  // grandTotal includes the round-off; without this the printed items
  // wouldn't add up to the printed Grand Total. Derived, not a stored field.
  const itemsTotal = bill.items.reduce((s, i) => s + i.totalAmount, 0);
  const roundOff = bill.grandTotal - (itemsTotal - bill.discountAmount);
  const roundOffAmt = `${roundOff < 0 ? '-' : ''}Rs ${formatAmt(Math.abs(roundOff))}`;

  rows.push({ kind: 'split', left: 'Sub Total', right: `Rs ${formatAmt(bill.subTotal)}` });
  rows.push({ kind: 'divider' });

  if (bill.gstAmount > 0) {
    const gstRates = [...new Set(bill.items.filter((i) => i.gstRate > 0).map((i) => i.gstRate))];
    // Clustered together at the right edge as one block, unlike the other
    // total rows which span the full line width — reuse `split` with an
    // empty left side, which right-aligns `right` exactly the same way.
    if (bill.isInterState) {
      const fullRate = gstRates.length === 1 ? gstRates[0]! : null;
      const igstLabel = fullRate !== null ? `IGST ${fullRate}%` : 'IGST';
      rows.push({ kind: 'split', left: '', right: `${igstLabel}  Rs ${formatAmt(bill.gstAmount)}` });
    } else {
      const halfRate = gstRates.length === 1 ? gstRates[0]! / 2 : null;
      const { cgstP, sgstP } = splitTaxP(bill.gstAmount, false);
      const cgstLabel = halfRate !== null ? `CGST ${halfRate}%` : 'CGST';
      const sgstLabel = halfRate !== null ? `SGST ${halfRate}%` : 'SGST';
      rows.push({ kind: 'split', left: '', right: `${cgstLabel}  Rs ${formatAmt(cgstP)}` });
      rows.push({ kind: 'split', left: '', right: `${sgstLabel}  Rs ${formatAmt(sgstP)}` });
    }
  }
  if (bill.discountAmount > 0) {
    rows.push({ kind: 'split', left: 'Discount', right: `-Rs ${formatAmt(bill.discountAmount)}` });
  }
  // Only shown when there's an actual round-off — a permanent "Round Off Rs 0"
  // on every receipt reads as noise, not information.
  if (roundOff !== 0) {
    rows.push({ kind: 'split', left: 'Round Off', right: roundOffAmt });
  }

  rows.push({ kind: 'divider' });
  rows.push({ kind: 'split', left: 'Grand Total', right: `Rs ${formatAmt(bill.grandTotal)}`, bold: true });
  // A bill saved before this field existed has no billedByName — shown as
  // "—" rather than skipping the line, so the receipt always has a
  // consistent footer shape instead of silently missing a row.
  rows.push({ kind: 'line', text: `Billed By : ${bill.billedByName || '—'}`, align: 'left' });
  rows.push({ kind: 'blank' });
  rows.push({ kind: 'line', text: footer, align: 'center', bold: true });

  return { rows, columns: { productX, qtyRight, priceRight, amtRight } };
}

// Re-exported so callers only need one import for both the layout builder
// and the small formatting helpers a renderer's own header-drawing code
// needs (e.g. writing "Qty"/"Price"/"Amt" at the columns this returned).
export { formatAmt, abbrUnit };
export function paise(n: number): number {
  return paisaToRupee(n);
}
