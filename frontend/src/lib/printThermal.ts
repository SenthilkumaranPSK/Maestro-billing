import type { Bill, Settings } from '@/types';
import { printerApi } from '@/api/printer';

export type ThermalPrintRoute = 'raw' | 'raw-fallback' | 'pdf';

/**
 * Print a thermal receipt by the best route available.
 *
 * Raw ESC/POS whenever the configured thermal printer is actually connected.
 * The receipt is rendered in the studio's brand font (AvantGarde) onto a
 * canvas and sent as a dithered raster image (lib/thermalRaster.ts) — the
 * printer has no way to use an arbitrary TTF as ESC/POS text, so a custom
 * font on paper is only possible as an image, same mechanism (and same
 * dithering trade-off) as the studio logo already used.
 *
 * The PDF path is kept for when there is no thermal printer attached, where
 * the browser dialog is genuinely useful (print to any printer, or to PDF).
 *
 * Deliberately NOT a silent fallback to the PDF path if the thermal printer
 * is connected but the raw send fails: that would hide a real hardware/driver
 * problem behind output that goes through a completely different pipeline.
 * The ONE silent fallback that does exist — brand-font rasterizing failing
 * (font not loaded, no canvas) drops back to the plain-text ESC/POS path,
 * still on the same printer, just without the brand font — exists because
 * that failure has nothing to do with the printer or the bill data, and
 * printing a plainer-looking receipt beats printing nothing.
 */
export async function printThermalReceipt(
  bill: Bill,
  settings: Partial<Settings>,
): Promise<ThermalPrintRoute> {
  let useRaw = false;
  try {
    const status = await printerApi.getStatus();
    useRaw = status.available && !status.offline;
  } catch {
    // Status check itself failed (PowerShell blocked, etc.) — treat as "no
    // thermal printer" and let the browser dialog handle it.
    useRaw = false;
  }

  if (useRaw) {
    const [{ getEscPosGeometry, normalizePaperWidth, buildEscPosRasterEnvelope, buildEscPosCommands }, { buildLogoRaster }] =
      await Promise.all([import('@/lib/thermal'), import('@/lib/escposLogo')]);

    const paper = normalizePaperWidth(settings.printer?.thermal_paper_width);
    const { printDots } = getEscPosGeometry(paper);

    // Same logo asset/handling as before — this part never depended on the
    // brand font (it's already a rasterized PNG), so it's unaffected by
    // whether the AvantGarde text-rendering step below succeeds.
    const logo = await buildLogoRaster('/Logo-receipt.png', printDots);

    const { renderThermalReceiptRaster } = await import('@/lib/thermalRaster');
    const textChunks = await renderThermalReceiptRaster(bill, settings);

    if (textChunks) {
      const blocks = logo ? [logo, ...textChunks] : textChunks;
      await printerApi.printRaw(buildEscPosRasterEnvelope(blocks, paper));
      return 'raw';
    }

    // Brand font couldn't be rasterized (not loaded, no canvas support) —
    // fall back to the printer's own crisp built-in font rather than not
    // printing at all. Still includes the logo, since that never depended on
    // the font.
    await printerApi.printRaw(buildEscPosCommands(bill, settings, logo));
    return 'raw-fallback';
  }

  const { printBillPDF } = await import('@/lib/pdf');
  await printBillPDF(bill, settings);
  return 'pdf';
}
