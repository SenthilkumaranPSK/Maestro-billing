import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PrismaClient } from '@prisma/client';
import { splitTax } from '../utils/taxSplit';

export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportError';
  }
}

interface RateRow {
  rate: number;
  taxableValue: number; // paise
  cgst: number; // paise
  sgst: number; // paise
  igst: number; // paise
}

function paisaToRupee(paise: number): number {
  return paise / 100;
}

// pdf-lib's standard fonts use WinAnsi encoding, which cannot encode "₹"
// (U+20B9) — the frontend's own pdf-lib receipt generator (lib/thermal.ts)
// already works around this the same way: "Rs." instead of the rupee glyph.
function money(paise: number): string {
  return `Rs.${paisaToRupee(paise).toFixed(2)}`;
}

/** First/last calendar day of a "YYYY-MM" month, as Date objects covering the whole day range. */
function monthBounds(ym: string): { from: Date; to: Date } {
  const [y, m] = ym.split('-').map(Number);
  const from = new Date(y!, m! - 1, 1, 0, 0, 0, 0);
  const to = new Date(y!, m!, 0, 23, 59, 59, 999); // day 0 of next month = last day of this month
  return { from, to };
}

/** "YYYY-MM" for the calendar month immediately before the given date's month. */
export function previousMonthYm(now = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based; current month index doubles as "previous month" (1-based)
  const prev = new Date(y, m - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

export class ReportService {
  private readonly dbPath: string;
  private readonly reportsDir: string;

  constructor(private readonly prisma: PrismaClient) {
    const dbUrl = process.env.DATABASE_URL ?? 'file:../../database/studio.db';
    const filePath = dbUrl.replace(/^file:/, '');
    this.dbPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);
    // Sibling to backups/ (see BackupService) — same data folder, same
    // "operator can find it next to their backups" mental model.
    this.reportsDir = path.resolve(path.dirname(this.dbPath), 'reports');
  }

  list(): Array<{ name: string; size: number; createdAt: Date }> {
    if (!fs.existsSync(this.reportsDir)) return [];
    return fs
      .readdirSync(this.reportsDir)
      .filter((f) => f.endsWith('.pdf'))
      .map((f) => {
        const stat = fs.statSync(path.join(this.reportsDir, f));
        return { name: f, size: stat.size, createdAt: stat.mtime };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  resolveReportPath(fileName: string): string {
    const safe = path.basename(fileName);
    const p = path.join(this.reportsDir, safe);
    if (!fs.existsSync(p)) {
      throw new ReportError(`Report file not found: ${safe}`);
    }
    return p;
  }

  hasReportFor(ym: string): boolean {
    return fs.existsSync(path.join(this.reportsDir, `GST-Report-${ym}.pdf`));
  }

  /** Builds and saves the GST summary PDF for a "YYYY-MM" month. Overwrites if regenerated. */
  async generateGstReportPdf(ym: string): Promise<string> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) {
      throw new ReportError(`Invalid month "${ym}" — expected YYYY-MM`);
    }
    const { from, to } = monthBounds(ym);

    const [studioName, studioAddress, studioGstin, studioPhone] =
      await Promise.all(
        ['studio_name', 'studio_address', 'studio_gstin', 'studio_phone'].map(
          async (key) => (await this.prisma.setting.findUnique({ where: { key } }))?.value ?? '',
        ),
      );

    const bills = await this.prisma.bill.findMany({
      where: {
        billDate: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
        deletedAt: null,
        // MM bills have their own separate numbering series and product
        // catalog — mixing them into the studio's official GST report would
        // combine two unrelated invoice sequences into one filing.
        series: 'MAIN',
      },
      include: { items: true },
    });

    const byRate = new Map<number, RateRow>();
    for (const bill of bills) {
      for (const item of bill.items) {
        const row = byRate.get(item.gstRate) ?? { rate: item.gstRate, taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
        // Not qty*unitPrice — for a GST-inclusive item, unitPrice is the
        // all-in (tax-included) price, so that product overstates the
        // taxable base by the tax amount itself. totalAmount-gstAmount is
        // the actual taxable value in both inclusive and exclusive modes,
        // since that's how BillService already computes/stores each item.
        row.taxableValue += item.totalAmount - item.gstAmount;
        // Same rate can have both intra-state and inter-state bills within
        // one month, so a rate row accumulates all three columns — whichever
        // pair is nonzero for a given bill depends on its own isInterState.
        const { cgst, sgst, igst } = splitTax(item.gstAmount, bill.isInterState);
        row.cgst += cgst;
        row.sgst += sgst;
        row.igst += igst;
        byRate.set(item.gstRate, row);
      }
    }
    const rows = [...byRate.values()].sort((a, b) => a.rate - b.rate);
    const totalTaxable = rows.reduce((s, r) => s + r.taxableValue, 0);
    const totalCgst = rows.reduce((s, r) => s + r.cgst, 0);
    const totalSgst = rows.reduce((s, r) => s + r.sgst, 0);
    const totalIgst = rows.reduce((s, r) => s + r.igst, 0);
    const totalDiscount = bills.reduce((s, b) => s + b.discountAmount, 0);
    const totalInvoiced = bills.reduce((s, b) => s + b.grandTotal, 0);
    const displayMonth = from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const BLACK = rgb(0.1, 0.1, 0.12);
    const GRAY = rgb(0.45, 0.45, 0.48);
    const marginX = 48;
    let y = 780;

    page.drawText(studioName || 'GST Summary Report', { x: marginX, y, size: 18, font: bold, color: BLACK });
    y -= 22;
    if (studioAddress) {
      page.drawText(studioAddress, { x: marginX, y, size: 9, font, color: GRAY });
      y -= 13;
    }
    const contactLine = [studioGstin && `GSTIN: ${studioGstin}`, studioPhone && `Ph: ${studioPhone}`]
      .filter(Boolean)
      .join('   ');
    if (contactLine) {
      page.drawText(contactLine, { x: marginX, y, size: 9, font, color: GRAY });
      y -= 13;
    }

    y -= 16;
    page.drawText(`GST Summary — ${displayMonth}`, { x: marginX, y, size: 13, font: bold, color: BLACK });
    y -= 24;

    // Table
    const cols = [
      { key: 'rate', label: 'GST Rate', x: marginX, w: 65 },
      { key: 'taxable', label: 'Taxable Value', x: marginX + 65, w: 100 },
      { key: 'cgst', label: 'CGST', x: marginX + 165, w: 78 },
      { key: 'sgst', label: 'SGST', x: marginX + 243, w: 78 },
      { key: 'igst', label: 'IGST', x: marginX + 321, w: 78 },
      { key: 'total', label: 'Total Tax', x: marginX + 399, w: 100 },
    ];
    const rowH = 20;
    page.drawRectangle({ x: marginX, y: y - 6, width: 595.28 - marginX * 2, height: rowH, color: rgb(0.96, 0.96, 0.94) });
    for (const c of cols) {
      page.drawText(c.label, { x: c.x + 4, y: y, size: 9, font: bold, color: BLACK });
    }
    y -= rowH;

    const drawRow = (
      cells: [string, string, string, string, string, string],
      opts: { boldRow?: boolean } = {},
    ) => {
      const rowFont = opts.boldRow ? bold : font;
      cols.forEach((c, i) => {
        page.drawText(cells[i]!, { x: c.x + 4, y, size: 9.5, font: rowFont, color: BLACK });
      });
      y -= rowH;
    };

    if (rows.length === 0) {
      page.drawText('No bills in this month.', { x: marginX, y, size: 10, font, color: GRAY });
      y -= rowH;
    } else {
      for (const r of rows) {
        drawRow([
          `${r.rate}%`,
          money(r.taxableValue),
          money(r.cgst),
          money(r.sgst),
          money(r.igst),
          money(r.cgst + r.sgst + r.igst),
        ]);
      }
    }

    page.drawLine({
      start: { x: marginX, y: y + 12 },
      end: { x: 595.28 - marginX, y: y + 12 },
      thickness: 0.75,
      color: rgb(0.7, 0.7, 0.7),
    });
    y -= 4;
    drawRow(
      ['TOTAL', money(totalTaxable), money(totalCgst), money(totalSgst), money(totalIgst), money(totalCgst + totalSgst + totalIgst)],
      { boldRow: true },
    );

    y -= 20;
    page.drawText(`Bills: ${bills.length}`, { x: marginX, y, size: 9.5, font, color: BLACK });
    y -= 15;
    page.drawText(`Total Discount: ${money(totalDiscount)}`, { x: marginX, y, size: 9.5, font, color: BLACK });
    y -= 15;
    page.drawText(`Total Invoiced: ${money(totalInvoiced)}`, { x: marginX, y, size: 9.5, font, color: BLACK });

    y -= 28;
    page.drawText(
      'Note: taxable value is before discount (Total Discount is shown separately above). Figures cover all non-cancelled bills. Verify with your CA before filing.',
      { x: marginX, y, size: 8, font, color: GRAY },
    );
    y -= 12;
    page.drawText(`Generated automatically on ${new Date().toLocaleString('en-IN')}`, {
      x: marginX,
      y,
      size: 8,
      font,
      color: GRAY,
    });

    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
    const outPath = path.join(this.reportsDir, `GST-Report-${ym}.pdf`);
    fs.writeFileSync(outPath, await pdfDoc.save());
    return outPath;
  }
}
