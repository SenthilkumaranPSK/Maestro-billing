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
// instead of on every PDF generation. Logo-receipt.png is a ~8KB downscaled
// copy of the ~1MB Logo.png: pdf-lib embeds the PNG stream verbatim, so using
// the original would make every receipt PDF (and WhatsApp send) ~1MB.
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
// Address/phone/GSTIN header lines (line.small) render one size down.
const FONT_SIZE_SMALL = 7;
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

  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Courier);
  const boldFont = await pdfDoc.embedFont(StandardFonts.CourierBold);

  // Try the studio logo for the top of the receipt (same as thermal preview).
  let logo: { image: Awaited<ReturnType<PDFDocument['embedPng']>>; w: number; h: number } | null = null;
  try {
    const logoBytes = await fetchLogoBytes();
    if (logoBytes) {
      const image = await pdfDoc.embedPng(logoBytes);
      const w = Math.min(pageWidth * 0.55, 120);
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
      x: (pageWidth - logo.w) / 2,
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

    const font: PDFFont = line.bold ? boldFont : regularFont;
    const color = line.separator ? GRAY : BLACK;
    // Small lines are centered header text, never rpad-aligned columns, so a
    // different size can't break the amount-column alignment.
    const size = line.small ? FONT_SIZE_SMALL : FONT_SIZE;

    let x = marginX;
    if (line.center) {
      const w = font.widthOfTextAtSize(line.text, size);
      x = (pageWidth - w) / 2;
    }

    page.drawText(line.text, { x, y, size, font, color });
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
