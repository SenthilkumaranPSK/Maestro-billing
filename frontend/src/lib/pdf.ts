import { PDFDocument, rgb } from 'pdf-lib';
import type { Bill, Settings } from '@/types';
import { normalizePaperWidth } from '@/lib/thermal';
import { buildThermalLayout, type ThermalRow, type Measure } from '@/lib/thermalLayout';
import { embedBrandFonts } from '@/lib/brandFont';

/**
 * The downloadable/WhatsApp PDF uses the SAME receipt layout DECISIONS as the
 * physical thermal print (lib/thermalLayout.ts's buildThermalLayout) — one
 * look everywhere, even though this renders in points via pdf-lib and the
 * physical print renders in printer dots via a canvas
 * (lib/thermalRaster.ts). Both pass the shared layout builder a `measure()`
 * callback in their own units; the layout only ever compares widths within
 * one caller's unit system, so the same algorithm positions correctly for
 * both without the two ever needing to share a literal pixel constant.
 *
 * Body text is the studio's brand font (AvantGarde), not Courier — Courier
 * was required back when lines were pre-padded with spaces to align columns,
 * which only works in a monospace font. Column positions are now computed
 * from real measured text widths instead, so any proportional font works.
 */

const MM_TO_PT = 72 / 25.4;

// The logo never changes at runtime — fetch and decode it once per session
// instead of on every PDF generation. Logo-receipt.png is a ~23KB downscaled
// copy of the ~1MB Logo.png (640x168 — enough pixels to stay sharp at this
// file's largest print width, ~150pt, at thermal-head resolution): pdf-lib
// embeds the PNG stream verbatim, so using the original would make every
// receipt PDF (and WhatsApp send) ~1MB.
let logoBytesCache: ArrayBuffer | null | undefined;
async function fetchLogoBytes(): Promise<ArrayBuffer | null> {
  if (logoBytesCache !== undefined) return logoBytesCache;
  logoBytesCache = null;
  for (const path of ['/Logo-receipt.png', '/Logo.png']) {
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
const FONT_SIZE = 8.2;
const LINE_HEIGHT = 8.7;

export async function generateBillPDF(
  bill: Bill,
  settings: Partial<Settings>,
  // Only meaningful for an actual physical thermal printer, whose print
  // head can cut off content right at the paper's left edge — compensating
  // by shifting content rightward. downloadBillPDF/generateBillPDFBase64
  // (WhatsApp) show this same PDF on a screen, where there's no such
  // hardware cutoff to compensate for, so it must default off; applying it
  // there just adds a lopsided blank margin down the left side of a
  // downloaded/viewed copy for no reason. Only printBillPDF passes true.
  compensatePrinterMargin = false,
): Promise<Uint8Array> {
  const paperWidth = normalizePaperWidth(settings.printer?.thermal_paper_width);
  const pageWidth = (paperWidth === '58' ? 58 : 80) * MM_TO_PT;

  // 3mm each side — the same margin convention the physical raster print
  // uses (lib/thermal.ts's ESCPOS_MARGIN_MM), so the PDF and the printed
  // receipt frame their content identically.
  const marginX = 3 * MM_TO_PT;
  const printWidth = pageWidth - marginX * 2;

  // Bias content rightward for an actual physical thermal printer, whose
  // head can cut off content right at the paper's left edge. Can only ever
  // borrow from the fixed margin above, never shrink printWidth itself, so a
  // real right margin always survives no matter how tight the paper is.
  const REQUESTED_SHIFT = 1.0 * 10 * MM_TO_PT; // 1cm
  const MAX_SHIFT_FRACTION = 0.4; // never give away more than 40% of the margin
  const LEFT_SHIFT = compensatePrinterMargin
    ? Math.max(0, Math.min(REQUESTED_SHIFT, marginX * MAX_SHIFT_FRACTION))
    : 0;

  const pdfDoc = await PDFDocument.create();
  const { regular: regularFont, bold: boldFont } = await embedBrandFonts(pdfDoc);
  const measure: Measure = (text, bold = false) => (bold ? boldFont : regularFont).widthOfTextAtSize(text, FONT_SIZE);

  const layout = buildThermalLayout(bill, settings, printWidth, measure);

  // Try the studio logo for the top of the receipt (same as thermal preview).
  let logo: { image: Awaited<ReturnType<PDFDocument['embedPng']>>; w: number; h: number } | null = null;
  try {
    const logoBytes = await fetchLogoBytes();
    if (logoBytes) {
      const image = await pdfDoc.embedPng(logoBytes);
      const w = Math.min(pageWidth * 0.7, 150);
      const h = image.height * (w / image.width);
      logo = { image, w, h };
    }
  } catch {
    // no logo — receipt still fine
  }

  // Mirrors the draw loop's own y-advancement exactly, computed upfront
  // since the page height has to be fixed before anything is drawn.
  const rowHeight = (row: ThermalRow): number => {
    switch (row.kind) {
      case 'blank':
        return LINE_HEIGHT * 0.6;
      case 'divider':
        return LINE_HEIGHT * 0.5;
      case 'itemRow':
        return row.nameLines.length * LINE_HEIGHT + (row.totalsOnLastLine ? 0 : LINE_HEIGHT);
      default:
        return LINE_HEIGHT;
    }
  };
  const contentHeight = layout.rows.reduce((sum, r) => sum + rowHeight(r), 0);

  const topPad = 14;
  const bottomPad = 14;
  const logoBlock = logo ? logo.h + 8 : 0;
  const pageHeight = topPad + logoBlock + contentHeight + bottomPad;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - topPad;

  if (logo) {
    page.drawImage(logo.image, {
      x: (pageWidth - logo.w) / 2 + LEFT_SHIFT,
      y: y - logo.h,
      width: logo.w,
      height: logo.h,
    });
    y -= logo.h + 8;
  }

  const BLACK = rgb(0, 0, 0);
  const GRAY = rgb(0.45, 0.45, 0.45);

  const drawAt = (text: string, x: number, yPos: number, bold: boolean) => {
    if (!text) return;
    page.drawText(text, { x: x + LEFT_SHIFT, y: yPos, size: FONT_SIZE, font: bold ? boldFont : regularFont, color: BLACK });
  };
  const rightX = (text: string, edge: number, bold: boolean) => edge - measure(text, bold);
  const centerX = (text: string, bold: boolean) => (printWidth - measure(text, bold)) / 2;
  const { columns } = layout;

  for (const row of layout.rows) {
    switch (row.kind) {
      case 'blank': {
        y -= rowHeight(row);
        break;
      }
      case 'divider': {
        const h = rowHeight(row);
        y -= h;
        const lineY = y + h / 2;
        page.drawLine({
          start: { x: marginX + LEFT_SHIFT, y: lineY },
          end: { x: marginX + printWidth + LEFT_SHIFT, y: lineY },
          thickness: 0.75,
          color: GRAY,
        });
        break;
      }
      case 'line': {
        y -= LINE_HEIGHT;
        const bold = !!row.bold;
        const x =
          row.align === 'center' ? centerX(row.text, bold) : row.align === 'right' ? rightX(row.text, printWidth, bold) : 0;
        drawAt(row.text, marginX + x, y, bold);
        break;
      }
      case 'split': {
        y -= LINE_HEIGHT;
        const bold = !!row.bold;
        if (row.left) drawAt(row.left, marginX, y, bold);
        if (row.right) drawAt(row.right, marginX + rightX(row.right, printWidth, bold), y, bold);
        break;
      }
      case 'itemHeader': {
        y -= LINE_HEIGHT;
        drawAt('SN', marginX, y, true);
        drawAt('Product', marginX + columns.productX, y, true);
        drawAt('Qty', marginX + rightX('Qty', columns.qtyRight, true), y, true);
        drawAt('Price', marginX + rightX('Price', columns.priceRight, true), y, true);
        drawAt('Amt', marginX + rightX('Amt', columns.amtRight, true), y, true);
        break;
      }
      case 'itemRow': {
        row.nameLines.forEach((nameLine, i) => {
          y -= LINE_HEIGHT;
          if (i === 0) drawAt(row.sn, marginX, y, false);
          drawAt(nameLine, marginX + columns.productX, y, false);
          const isLastNameLine = i === row.nameLines.length - 1;
          if (isLastNameLine && row.totalsOnLastLine) {
            drawAt(row.qty, marginX + rightX(row.qty, columns.qtyRight, false), y, false);
            drawAt(row.price, marginX + rightX(row.price, columns.priceRight, false), y, false);
            drawAt(row.amt, marginX + rightX(row.amt, columns.amtRight, false), y, false);
          }
        });
        if (!row.totalsOnLastLine) {
          y -= LINE_HEIGHT;
          drawAt(row.qty, marginX + rightX(row.qty, columns.qtyRight, false), y, false);
          drawAt(row.price, marginX + rightX(row.price, columns.priceRight, false), y, false);
          drawAt(row.amt, marginX + rightX(row.amt, columns.amtRight, false), y, false);
        }
        break;
      }
    }
  }

  return pdfDoc.save();
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function generateBillPDFBase64(
  bill: Bill,
  settings: Partial<Settings>,
): Promise<string> {
  const bytes = await generateBillPDF(bill, settings);
  return bytesToBase64(bytes);
}

export async function downloadBillPDF(bill: Bill, settings: Partial<Settings>) {
  const bytes = await generateBillPDF(bill, settings);
  const blob = new Blob([bytes.buffer.slice(0) as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${bill.billNumber}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function printBillPDF(bill: Bill, settings: Partial<Settings>) {
  const bytes = await generateBillPDF(bill, settings, true);
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
