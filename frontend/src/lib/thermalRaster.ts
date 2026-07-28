import type { Bill, Settings } from '@/types';
import { buildThermalLayout, thermalRowHeight, type Measure } from '@/lib/thermalLayout';
import { normalizePaperWidth, getEscPosGeometry } from '@/lib/thermal';
import { toGrayscale, ditherAndPack } from '@/lib/escposDither';

/**
 * Renders the thermal receipt onto an HTML canvas in the studio's brand font
 * (AvantGarde) and converts it to dithered ESC/POS raster chunks — this is
 * what makes the physical printer output use the brand font at all, since
 * ESC/POS text mode can only use the printer's own resident fonts.
 *
 * This trades away some of the crispness the plain-text ESC/POS path
 * (lib/thermal.ts's buildEscPosCommands) has: any canvas-drawn glyph still
 * has to be dithered to 1-bit for a thermal head, the same mechanism that
 * made the old PDF-print path blurry. Kept as legible as this reasonably
 * allows via Floyd–Steinberg dithering (lib/escposDither.ts) rather than a
 * flat threshold, chosen deliberately by the studio over keeping the
 * printer's own crisp built-in font.
 */

const FONT_FAMILY = 'AvantGarde';
// ~9.2pt-equivalent at 203dpi (26/203*72) — close to the PDF's 8.2pt body
// size, adjusted up slightly because AvantGarde reads lighter than Courier
// did at the same nominal size.
const BODY_SIZE = 26;
const LINE_HEIGHT = Math.round(BODY_SIZE * 1.3);
const TOP_PAD = 12;
const BOTTOM_PAD = 12;
// Dots per GS v 0 command. The ESC/POS protocol allows up to 65535, but this
// printer class's actual raster buffer isn't documented, and some clone
// firmware garbles or truncates a single very tall image — banding into
// chunks this size sidesteps that regardless of the real limit.
const MAX_CHUNK_HEIGHT = 200;

function fontAt(bold: boolean): string {
  return `${bold ? 'bold ' : ''}${BODY_SIZE}px ${FONT_FAMILY}`;
}

/**
 * Forces the brand font to actually load before anything measures or draws
 * with it. Declaring @font-face in CSS (index.css) is not enough on its own
 * for canvas — canvas text does not trigger a lazy font-face load the way
 * on-page text does, so without this the very first receipt (or one printed
 * before any AvantGarde text has painted elsewhere in the app) would
 * silently measure and draw in a fallback system font instead.
 */
async function ensureFontLoaded(): Promise<boolean> {
  try {
    await Promise.all([document.fonts.load(fontAt(false)), document.fonts.load(fontAt(true))]);
    await document.fonts.ready;
    return document.fonts.check(fontAt(false)) && document.fonts.check(fontAt(true));
  } catch {
    return false;
  }
}

export interface RasterChunk {
  bits: Uint8Array;
  widthBytes: number;
  heightDots: number;
}

/**
 * Returns null (never throws) when the brand font isn't actually available —
 * the caller (lib/printThermal.ts) falls back to the plain-text ESC/POS
 * path, which is guaranteed to print something crisp rather than nothing.
 */
export async function renderThermalReceiptRaster(
  bill: Bill,
  settings: Partial<Settings>,
): Promise<RasterChunk[] | null> {
  if (!(await ensureFontLoaded())) return null;

  const paperWidth = normalizePaperWidth(settings.printer?.thermal_paper_width);
  const { printDots } = getEscPosGeometry(paperWidth);

  // A separate off-screen canvas purely for measuring, so the real canvas
  // can be created at its final size once total height is known — canvas
  // dimensions can't be changed after the fact without clearing the content
  // already drawn.
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  if (!mctx) return null;

  const measure: Measure = (text, bold = false) => {
    mctx.font = fontAt(bold);
    return mctx.measureText(text).width;
  };

  const layout = buildThermalLayout(bill, settings, printDots, measure);

  // Mirrors the draw loop's own y-advancement exactly (same shared height
  // rule as lib/pdf.ts) so the canvas is sized to precisely what gets drawn
  // — computed once here, upfront, since canvas height can't grow mid-draw.
  // Rounded per-row (not just the total) since dots must land on whole
  // pixels the same way each draw call below does.
  const rowHeight = (row: (typeof layout.rows)[number]) => Math.round(thermalRowHeight(row, LINE_HEIGHT));
  const contentHeight = layout.rows.reduce((sum, r) => sum + rowHeight(r), 0);

  const canvas = document.createElement('canvas');
  canvas.width = printDots;
  canvas.height = TOP_PAD + contentHeight + BOTTOM_PAD;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';

  const drawAt = (text: string, x: number, yTop: number, bold: boolean) => {
    if (!text) return;
    ctx.font = fontAt(bold);
    ctx.fillText(text, x, yTop + BASELINE_OFFSET);
  };
  const rightX = (text: string, edge: number, bold: boolean) => edge - measure(text, bold);
  const centerX = (text: string, bold: boolean) => (printDots - measure(text, bold)) / 2;
  const BASELINE_OFFSET = Math.round(BODY_SIZE * 0.8);

  const { columns } = layout;
  let y = TOP_PAD;

  for (const row of layout.rows) {
    switch (row.kind) {
      case 'blank': {
        y += rowHeight(row);
        break;
      }
      case 'divider': {
        const h = rowHeight(row);
        ctx.fillRect(0, y + Math.round(h / 2), printDots, 2);
        y += h;
        break;
      }
      case 'line': {
        const bold = !!row.bold;
        const x =
          row.align === 'center' ? centerX(row.text, bold) : row.align === 'right' ? rightX(row.text, printDots, bold) : 0;
        drawAt(row.text, x, y, bold);
        y += LINE_HEIGHT;
        break;
      }
      case 'split': {
        const bold = !!row.bold;
        if (row.left) drawAt(row.left, 0, y, bold);
        if (row.right) drawAt(row.right, rightX(row.right, printDots, bold), y, bold);
        y += LINE_HEIGHT;
        break;
      }
      case 'itemHeader': {
        drawAt('SN', 0, y, true);
        drawAt('Product', columns.productX, y, true);
        drawAt('Qty', rightX('Qty', columns.qtyRight, true), y, true);
        drawAt('Price', rightX('Price', columns.priceRight, true), y, true);
        drawAt('Amt', rightX('Amt', columns.amtRight, true), y, true);
        y += LINE_HEIGHT;
        break;
      }
      case 'itemRow': {
        row.nameLines.forEach((nameLine, i) => {
          if (i === 0) drawAt(row.sn, 0, y, false);
          drawAt(nameLine, columns.productX, y, false);
          const isLastNameLine = i === row.nameLines.length - 1;
          if (isLastNameLine && row.totalsOnLastLine) {
            drawAt(row.qty, rightX(row.qty, columns.qtyRight, false), y, false);
            drawAt(row.price, rightX(row.price, columns.priceRight, false), y, false);
            drawAt(row.amt, rightX(row.amt, columns.amtRight, false), y, false);
          }
          y += LINE_HEIGHT;
        });
        if (!row.totalsOnLastLine) {
          drawAt(row.qty, rightX(row.qty, columns.qtyRight, false), y, false);
          drawAt(row.price, rightX(row.price, columns.priceRight, false), y, false);
          drawAt(row.amt, rightX(row.amt, columns.amtRight, false), y, false);
          y += LINE_HEIGHT;
        }
        break;
      }
    }
  }

  // Dither the WHOLE canvas once, then slice the packed bytes into
  // printer-safe bands — slicing AFTER packing keeps Floyd–Steinberg's error
  // diffusion continuous across a band boundary instead of restarting (and
  // potentially banding visibly) at every chunk edge.
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = toGrayscale(data, canvas.width, canvas.height);
  const { bits, widthBytes } = ditherAndPack(gray, canvas.width, canvas.height);

  const chunks: RasterChunk[] = [];
  for (let rowStart = 0; rowStart < canvas.height; rowStart += MAX_CHUNK_HEIGHT) {
    const chunkHeight = Math.min(MAX_CHUNK_HEIGHT, canvas.height - rowStart);
    const start = rowStart * widthBytes;
    const end = start + chunkHeight * widthBytes;
    chunks.push({ bits: bits.slice(start, end), widthBytes, heightDots: chunkHeight });
  }
  return chunks;
}
