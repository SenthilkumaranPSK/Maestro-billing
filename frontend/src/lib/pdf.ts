import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import type { Bill, Settings } from '@/types';
import { buildReceiptPreview, normalizePaperWidth, getCharWidth } from '@/lib/thermal';

/**
 * The downloadable/WhatsApp PDF uses the SAME receipt template as the thermal
 * printer (buildReceiptPreview) — one look everywhere. The page is sized like
 * the paper roll: 80mm (or 58mm) wide, height fitted to the content.
 *
 * Courier (monospace) is required: the receipt lines are pre-padded with
 * spaces by rpad() to align the amount column, which only lines up when every
 * character has the same width.
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
const FONT_SIZE = 8;
const LINE_HEIGHT = 10.5;
const COURIER_CHAR_WIDTH = 0.6 * FONT_SIZE; // Courier glyphs are 0.6em wide

export async function generateBillPDF(
  bill: Bill,
  settings: Partial<Settings>,
): Promise<Uint8Array> {
  const lines = buildReceiptPreview(bill, settings);
  const paperWidth = normalizePaperWidth(settings.printer?.thermal_paper_width);

  const pageWidth = (paperWidth === '58' ? 58 : 80) * MM_TO_PT;
  // Single source of truth: rpad() pads lines to this width in thermal.ts —
  // a divergent copy here would shift the amount column off the page.
  const charWidth = getCharWidth(paperWidth);
  const textWidth = charWidth * COURIER_CHAR_WIDTH;
  const marginX = Math.max(4, (pageWidth - textWidth) / 2);

  // Bias the existing left/right margin budget toward the left, instead of
  // it being split evenly. This can only ever borrow from margin that's
  // already idle — it can't add net-new space, because the page is exactly
  // the width of the physical paper roll (58/80mm); shifting past the
  // natural margin would print off the paper's edge. (An earlier version of
  // this used `0.5 * MM_TO_PT`, which is 0.5 MILLIMETRES, not 0.5cm — a
  // units bug that made that fix ~10x too small to notice. Fixed here.)
  // Requested total so far: 1cm, capped to whatever's actually safely
  // available on this paper width, minus a small safety buffer so the right
  // edge never gets cut. On 80mm paper that's ~3.7mm of the 1cm asked for;
  // on 58mm paper there's only ~1.2mm of margin to give either way — beyond
  // this cap, the only real fix left is the printer driver's own left-offset
  // /margin setting, which PDF content has no way to reach.
  const REQUESTED_SHIFT = 1.0 * 10 * MM_TO_PT; // 1cm
  const RIGHT_SAFETY_PT = 2;
  const LEFT_SHIFT = Math.max(0, Math.min(REQUESTED_SHIFT, marginX - RIGHT_SAFETY_PT));

  const pdfDoc = await PDFDocument.create();
  // Courier-Bold only (no regular weight): at the ~200dpi a thermal head
  // prints at, hairline-weight strokes fall between dot rows and come out
  // grey/soft, while bold strokes span enough dots to print crisp. Emphasis
  // lines (line.bold) get an extra hairline double-strike on top so TOTAL/
  // headers still stand out from body text that's already bold.
  const boldFont = await pdfDoc.embedFont(StandardFonts.CourierBold);

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

  const topPad = 14;
  const bottomPad = 14;
  const logoBlock = logo ? logo.h + 8 : 0;
  const pageHeight = topPad + logoBlock + lines.length * LINE_HEIGHT + bottomPad;

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

  for (const line of lines) {
    y -= LINE_HEIGHT;
    if (!line.text) continue;

    const font: PDFFont = boldFont;
    const color = line.separator ? GRAY : BLACK;
    const size = FONT_SIZE;

    let x = marginX;
    if (line.center) {
      const w = font.widthOfTextAtSize(line.text, size);
      x = (pageWidth - w) / 2;
    }
    x += LEFT_SHIFT;

    // Faux bold via stroke expansion: repeat the draw offset right AND down
    // so BOTH vertical strokes (I, l, |) and horizontal ones (T top, -, _)
    // gain width, not just one axis — a single-axis offset left horizontal
    // strokes on non-bold lines just as thin as before. Emphasis lines
    // (TOTAL, headers) get a 4th, diagonal pass to stay heavier than body text.
    page.drawText(line.text, { x, y, size, font, color });
    page.drawText(line.text, { x: x + 0.3, y, size, font, color });
    page.drawText(line.text, { x, y: y + 0.3, size, font, color });
    if (line.bold) {
      page.drawText(line.text, { x: x + 0.3, y: y + 0.3, size, font, color });
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
  const bytes = await generateBillPDF(bill, settings);
  const blob = new Blob([bytes.buffer.slice(0) as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    }, 2000);
  };
}
