import type { Bill, Settings } from '@/types';
import { printerApi } from '@/api/printer';

export type ThermalPrintRoute = 'raw' | 'pdf';

/**
 * Print a thermal receipt by the best route available.
 *
 * Raw ESC/POS whenever the configured thermal printer is actually connected:
 * the printer then renders text with its own built-in font and the logo as
 * dots we quantised ourselves, so nothing is rasterised or rescaled on the way
 * out. Printing the PDF instead hands the page to the browser's print
 * pipeline, which antialiases it — and on a 1-bit thermal head those greys
 * dither into visible fuzz, which is what made receipts look blurry.
 *
 * The PDF path is kept for when there is no thermal printer attached, where
 * the browser dialog is genuinely useful (print to any printer, or to PDF).
 *
 * Deliberately NOT a silent fallback: if the thermal printer is connected but
 * the raw send fails, this throws. Quietly printing the blurry PDF version
 * instead would hide a real hardware/driver problem behind output the studio
 * already told us looks wrong.
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
    const [{ buildEscPosCommands, normalizePaperWidth, getEscPosGeometry }, { buildLogoRaster }] =
      await Promise.all([import('@/lib/thermal'), import('@/lib/escposLogo')]);

    const paper = normalizePaperWidth(settings.printer?.thermal_paper_width);
    // Built to the PRINT AREA width, not the head's full width: the stream
    // sets a left margin, so a raster sized to the whole head would start at
    // that margin and run off the right edge.
    // Same asset the PDF receipt uses. buildLogoRaster returns null rather
    // than throwing if it can't be loaded — a receipt without the logo still
    // beats no receipt.
    const logo = await buildLogoRaster('/Logo-receipt.png', getEscPosGeometry(paper).printDots);
    await printerApi.printRaw(buildEscPosCommands(bill, settings, logo));
    return 'raw';
  }

  const { printBillPDF } = await import('@/lib/pdf');
  await printBillPDF(bill, settings);
  return 'pdf';
}
