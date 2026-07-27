import type { EscPosLogo } from '@/lib/thermal';

/**
 * Converts the studio logo PNG into a 1-bit ESC/POS raster.
 *
 * Kept out of thermal.ts on purpose: this needs a canvas, and thermal.ts is
 * deliberately DOM-free so its layout can be checked outside a browser.
 *
 * A thermal head has no greys — every dot is burned or not — so the artwork
 * has to be reduced to 1-bit somewhere. Doing it here, deliberately, is the
 * whole point: the alternative is letting the OS print pipeline rasterise a
 * PDF and antialias it into greys the printer then dithers badly, which is
 * what made receipts look blurry.
 */

// The logo is a wordmark on transparent/white ground. A plain threshold turns
// its thin cursive strokes into broken speckle, so mid-tones are dithered
// instead (Floyd-Steinberg), which keeps the curves readable at 203dpi.
function floydSteinberg(gray: Float32Array, w: number, h: number, threshold: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i]!;
      const newVal = old < threshold ? 0 : 255;
      out[i] = newVal === 0 ? 1 : 0; // 1 = burn (dark)
      const err = old - newVal;
      // Spread the quantisation error to not-yet-visited neighbours.
      if (x + 1 < w) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) gray[i + w - 1] += (err * 3) / 16;
        gray[i + w] += (err * 5) / 16;
        if (x + 1 < w) gray[i + w + 1] += (err * 1) / 16;
      }
    }
  }
  return out;
}

/**
 * @param src        image URL (e.g. '/Logo-receipt.png')
 * @param widthDots  printable width of the head — the raster is built to
 *                   exactly this width with the artwork centred inside it
 * @param maxHeight  cap so an unexpected image can't feed metres of paper
 */
export async function buildLogoRaster(
  src: string,
  widthDots: number,
  maxHeight = 240,
): Promise<EscPosLogo | null> {
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`could not load ${src}`));
      el.src = src;
    });
  } catch {
    return null; // no logo is a perfectly fine receipt — never block printing
  }

  if (!img.naturalWidth || !img.naturalHeight) return null;

  // Share of the print area the logo occupies. The studio asked for it bigger
  // than the original 0.7 — at 0.9 it reads clearly on an 80mm roll while
  // still sitting inside the 3mm margins rather than running edge to edge.
  const LOGO_WIDTH_FRACTION = 0.9;
  const targetW = Math.min(widthDots, Math.round(widthDots * LOGO_WIDTH_FRACTION));
  let drawW = targetW;
  let drawH = Math.round((img.naturalHeight / img.naturalWidth) * drawW);
  if (drawH > maxHeight) {
    drawH = maxHeight;
    drawW = Math.round((img.naturalWidth / img.naturalHeight) * drawH);
  }

  const canvas = document.createElement('canvas');
  canvas.width = widthDots;
  canvas.height = drawH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // White ground first: the PNG has an alpha channel, and un-composited
  // transparent pixels read as black once alpha is discarded — which would
  // print the logo as a solid filled rectangle.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, Math.floor((widthDots - drawW) / 2), 0, drawW, drawH);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Float32Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Rec. 601 luma — closer to perceived brightness than a flat average,
    // which matters for keeping thin strokes from washing out.
    gray[p] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  }

  const dots = floydSteinberg(gray, canvas.width, canvas.height, 128);

  // Pack to one byte per 8 horizontal dots, MSB = leftmost.
  const widthBytes = Math.ceil(canvas.width / 8);
  const bits = new Uint8Array(widthBytes * canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (dots[y * canvas.width + x]) {
        bits[y * widthBytes + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }

  return { bits, widthBytes, heightDots: canvas.height };
}
