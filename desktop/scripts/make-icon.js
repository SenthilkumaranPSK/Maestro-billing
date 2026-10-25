// Regenerates desktop/build/icon-256.png and build/icon.ico directly from
// frontend/public/Logo.png.
//
// The wordmark's cursive "M" monogram is hairline linework — even cropped
// square and centered (the Phase 6 fix), the strokes are too thin to read
// once Windows downscales them to a 16x16/32x32 taskbar icon; they just
// disappear against whatever the taskbar's own background color is. Fixing
// that for real needs two things a plain crop can't give it:
//   1. A solid-color badge behind the mark, so the icon is a visible colored
//      shape at any size even when the fine linework blurs away.
//   2. Boldened strokes (blur-then-threshold the alpha mask — spreads
//      coverage outward, then snaps it back to fully solid/transparent, net
//      effect = fatter strokes without gray fringing).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const LOGO = path.join(__dirname, '..', '..', 'frontend', 'public', 'Logo.png');
const OUT_PNG = path.join(__dirname, '..', 'build', 'icon-256.png');
const OUT_ICO = path.join(__dirname, '..', 'build', 'icon.ico');

const CANVAS = 1024;
const BRAND_GREEN = { r: 0x63, g: 0x8a, b: 0x00, alpha: 1 }; // matches --brand-700

async function main() {
  // 1. Crop the monogram off the left of the wordmark (well clear of the
  //    "THE MAESTRO STUDIO'S" text and ring mark), then trim to its tight
  //    bounding box.
  const meta = await sharp(LOGO).metadata();
  const cropWidth = Math.round(meta.width * 0.25);
  // (extract + trim must be separate sharp() pipelines — chaining them on
  // one instance throws "extract_area: bad extract area" in this version.)
  const extracted = await sharp(LOGO)
    .extract({ left: 0, top: 0, width: cropWidth, height: meta.height })
    .toBuffer();
  const cropped = await sharp(extracted).trim().toBuffer();

  // 2. Fit the trimmed monogram into a square, transparent, padded.
  const markSize = Math.round(CANVAS * 0.62);
  const fitted = await sharp(cropped)
    .resize(markSize, markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();

  // 3. Bolden: blur the alpha mask outward, then threshold it back to solid.
  const boldAlpha = await sharp(fitted)
    .extractChannel('alpha')
    .blur(7)
    .threshold(50)
    .raw()
    .toBuffer();

  // 4. Recolor the boldened mark solid white by writing a fresh RGBA buffer
  //    (R=G=B=255, alpha = boldened mask) — avoids any blend-mode ambiguity.
  const rgba = Buffer.alloc(markSize * markSize * 4);
  for (let i = 0, j = 0; i < boldAlpha.length; i++, j += 4) {
    rgba[j] = 255;
    rgba[j + 1] = 255;
    rgba[j + 2] = 255;
    rgba[j + 3] = boldAlpha[i];
  }
  const whiteMark = await sharp(rgba, { raw: { width: markSize, height: markSize, channels: 4 } })
    .png()
    .toBuffer();

  // 5. Solid brand-green rounded-square badge as the backdrop.
  const radius = Math.round(CANVAS * 0.22);
  const roundedMask = Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}"><rect width="${CANVAS}" height="${CANVAS}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  );
  const badge = await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: BRAND_GREEN },
  })
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 6. Composite the white mark centered on the badge, downscale to 256.
  // (Two separate pipelines — sharp always applies resize() before
  // composite() internally regardless of call order, so chaining .resize()
  // straight onto a .composite() call shrinks the base first and then fails
  // to fit the overlay.)
  const offset = Math.round((CANVAS - markSize) / 2);
  const composited = await sharp(badge)
    .composite([{ input: whiteMark, left: offset, top: offset }])
    .png()
    .toBuffer();
  const final = await sharp(composited).resize(256, 256).png().toBuffer();

  fs.writeFileSync(OUT_PNG, final);
  console.log('icon-256.png written:', final.length, 'bytes');

  const ico = await pngToIco(OUT_PNG);
  fs.writeFileSync(OUT_ICO, ico);
  console.log('icon.ico written:', ico.length, 'bytes');
}

main().catch((err) => {
  console.error('icon generation failed:', err);
  process.exit(1);
});
