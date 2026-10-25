import type { EscPosLogo } from '@/lib/thermal';
import { toGrayscale, ditherAndPack } from '@/lib/escposDither';

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
  const gray = toGrayscale(data, canvas.width, canvas.height);
  const { bits, widthBytes } = ditherAndPack(gray, canvas.width, canvas.height);

  return { bits, widthBytes, heightDots: canvas.height };
}
