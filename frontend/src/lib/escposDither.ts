/**
 * Shared 1-bit conversion for anything drawn to a canvas before being sent to
 * the thermal printer as an ESC/POS raster image (GS v 0) — the studio logo
 * (lib/escposLogo.ts) and, now that receipts print in the brand font, the
 * entire text block too (lib/thermalRaster.ts).
 *
 * Extracted out of escposLogo.ts rather than duplicated: a thermal head has
 * no greys, so anything drawn as anti-aliased canvas output has to be reduced
 * to 1-bit somewhere, and a plain brightness threshold turns thin strokes
 * (the cursive logo, AvantGarde's lighter weights) into broken speckle.
 * Floyd–Steinberg dithering keeps curves and thin glyph strokes readable at
 * 203dpi instead.
 */

/** Rec. 601 luma from an ImageData buffer — closer to perceived brightness
 * than a flat RGB average, which matters for keeping thin strokes visible. */
export function toGrayscale(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  }
  return gray;
}

function floydSteinberg(gray: Float32Array, w: number, h: number, threshold: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i]!;
      const newVal = old < threshold ? 0 : 255;
      out[i] = newVal === 0 ? 1 : 0; // 1 = burn (dark)
      const err = old - newVal;
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
 * Dithers a grayscale buffer to 1-bit and packs it into ESC/POS raster format
 * — one byte per 8 horizontal dots, MSB = leftmost dot, a set bit meaning
 * "burn". `gray` is mutated in place (Floyd–Steinberg spreads error into
 * not-yet-visited neighbours) — pass a copy if the caller needs the original.
 */
export function ditherAndPack(
  gray: Float32Array,
  width: number,
  height: number,
  threshold = 128,
): { bits: Uint8Array; widthBytes: number } {
  const dots = floydSteinberg(gray, width, height, threshold);
  const widthBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (dots[y * width + x]) {
        bits[y * widthBytes + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }
  return { bits, widthBytes };
}
