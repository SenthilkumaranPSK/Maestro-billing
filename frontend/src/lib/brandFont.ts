import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * The studio's brand font (AvantGarde Bk BT — "Book" for body text, "Demi"
 * for headings/emphasis), embeddable into any pdf-lib document. Shared by
 * lib/a4invoice.ts and lib/pdf.ts so both PDFs use the exact same font files
 * and fallback behaviour rather than two independently-drifting copies.
 *
 * Fetched once per session (not once per PDF) and cached module-wide. Falls
 * back to Helvetica if the files are ever missing so PDF generation never
 * hard-fails on a fresh checkout that hasn't copied the font files yet.
 */
let bookCache: ArrayBuffer | null | undefined;
let demiCache: ArrayBuffer | null | undefined;

async function fetchFontBytes(path: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(path);
    if (response.ok) return await response.arrayBuffer();
  } catch {
    // fall through to null — caller falls back to a standard font
  }
  return null;
}

export async function embedBrandFonts(doc: PDFDocument): Promise<{ regular: PDFFont; bold: PDFFont }> {
  doc.registerFontkit(fontkit);
  if (bookCache === undefined) bookCache = await fetchFontBytes('/fonts/AvantGarde-Book.ttf');
  if (demiCache === undefined) demiCache = await fetchFontBytes('/fonts/AvantGarde-Demi.ttf');
  const regular = bookCache ? await doc.embedFont(bookCache) : await doc.embedFont(StandardFonts.Helvetica);
  const bold = demiCache ? await doc.embedFont(demiCache) : await doc.embedFont(StandardFonts.HelveticaBold);
  return { regular, bold };
}
