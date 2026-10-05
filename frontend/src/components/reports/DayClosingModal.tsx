import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { billsApi } from '@/api/bills';
import { settingsApi } from '@/api/settings';
import { formatCurrency } from '@/types';
import { formatDate } from '@/lib/utils';
import { exportToCsv } from '@/lib/csv';
import { splitTaxP } from '@/lib/billMath';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Printer,
  Download,
  Calendar,
  Wallet,
  CreditCard,
  QrCode,
  CheckCircle2,
  Receipt,
} from 'lucide-react';
import { PDFDocument, rgb } from 'pdf-lib';
import { embedBrandFonts } from '@/lib/brandFont';
import { normalizePaperWidth } from '@/lib/thermal';

interface DayClosingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: string;
}

export function DayClosingModal({
  open,
  onOpenChange,
  initialDate,
}: DayClosingModalProps) {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    enabled: open,
  });

  const [selectedDate, setSelectedDate] = useState<string>(
    initialDate || new Date().toISOString().slice(0, 10),
  );
  const [seriesFilter, setSeriesFilter] = useState<'ALL' | 'MAIN' | 'MM'>('ALL');
  const [isPrinting, setIsPrinting] = useState(false);

  const { data: billsData, isLoading } = useQuery({
    queryKey: ['day-closing-bills', selectedDate],
    queryFn: () => billsApi.list({ from: selectedDate, to: selectedDate, limit: 1000 }),
    enabled: open,
  });

  const bills = useMemo(() => {
    const all = billsData?.data || [];
    return all.filter((b) => {
      if (b.status === 'CANCELLED') return false;
      if (seriesFilter === 'MAIN') return (b.series || 'MAIN') === 'MAIN';
      if (seriesFilter === 'MM') return b.series === 'MM';
      return true;
    });
  }, [billsData, seriesFilter]);

  // Aggregate metrics
  const metrics = useMemo(() => {
    let totalGross = 0;
    let totalCash = 0;
    let totalUpi = 0;
    let totalCard = 0;
    let totalSplit = 0;
    let totalTax = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    for (const b of bills) {
      totalGross += b.grandTotal;
      totalTax += b.gstAmount;
      const tax = splitTaxP(b.gstAmount, b.isInterState);
      totalCgst += tax.cgstP;
      totalSgst += tax.sgstP;
      totalIgst += tax.igstP;

      const mode = (b.paymentMode || '').toUpperCase();
      if (mode === 'CASH') totalCash += b.grandTotal;
      else if (mode === 'UPI') totalUpi += b.grandTotal;
      else if (mode === 'CARD') totalCard += b.grandTotal;
      else if (mode === 'SPLIT') totalSplit += b.grandTotal;
      else totalCash += b.grandTotal; // default fallback
    }

    return {
      billCount: bills.length,
      totalGross,
      totalCash,
      totalUpi,
      totalCard,
      totalSplit,
      totalTax,
      totalCgst,
      totalSgst,
      totalIgst,
      firstBill: bills.length > 0 ? bills[bills.length - 1]?.billNumber : '—',
      lastBill: bills.length > 0 ? bills[0]?.billNumber : '—',
    };
  }, [bills]);

  const handlePrintSlip = async () => {
    try {
      setIsPrinting(true);
      const MM_TO_PT = 72 / 25.4;
      const paperWidthMm = normalizePaperWidth(settings?.printer?.thermal_paper_width);
      const paperWidthPt = Number(paperWidthMm) * MM_TO_PT;
      const printableWidthPt = paperWidthPt - 8 * MM_TO_PT; // margins

      const pdfDoc = await PDFDocument.create();
      const font = await embedBrandFonts(pdfDoc);

      const LINE_H = 12;
      const totalEstimatedLines = 30 + bills.length;
      const pageHeightPt = Math.max(260, totalEstimatedLines * LINE_H + 40);

      const page = pdfDoc.addPage([paperWidthPt, pageHeightPt]);
      const marginX = 4 * MM_TO_PT;
      let y = pageHeightPt - 16;

      const drawText = (
        text: string,
        x: number,
        yPos: number,
        bold = false,
        size = 8.5,
        color = rgb(0, 0, 0),
      ) => {
        page.drawText(text, {
          x,
          y: yPos,
          size,
          font: bold ? font.bold : font.regular,
          color,
        });
      };

      const drawCenter = (text: string, yPos: number, bold = false, size = 9) => {
        const textWidth = (bold ? font.bold : font.regular).widthOfTextAtSize(text, size);
        const x = marginX + (printableWidthPt - textWidth) / 2;
        drawText(text, x, yPos, bold, size);
      };

      const drawRow = (left: string, right: string, yPos: number, bold = false) => {
        drawText(left, marginX, yPos, bold, 8.5);
        const rWidth = (bold ? font.bold : font.regular).widthOfTextAtSize(right, 8.5);
        drawText(right, marginX + printableWidthPt - rWidth, yPos, bold, 8.5);
      };

      const drawDivider = (yPos: number) => {
        page.drawLine({
          start: { x: marginX, y: yPos },
          end: { x: marginX + printableWidthPt, y: yPos },
          thickness: 0.5,
          color: rgb(0.3, 0.3, 0.3),
        });
      };

      // Header
      drawCenter((settings?.studio?.studio_name || 'MAESTRO STUDIO').toUpperCase(), y, true, 11);
      y -= LINE_H + 2;
      drawCenter('DAY CLOSING SUMMARY', y, true, 9.5);
      y -= LINE_H;
      drawCenter(`Date: ${selectedDate}  |  Printed: ${new Date().toLocaleTimeString('en-IN')}`, y, false, 7.5);
      y -= 6;
      drawDivider(y);
      y -= LINE_H;

      // Summary
      drawRow('Total Bills:', `${metrics.billCount}`, y, true);
      y -= LINE_H;
      drawRow('First Bill:', `${metrics.firstBill}`, y);
      y -= LINE_H;
      drawRow('Last Bill:', `${metrics.lastBill}`, y);
      y -= 6;
      drawDivider(y);
      y -= LINE_H;

      // Payments Breakdown
      drawCenter('COLLECTIONS BY PAYMENT MODE', y, true, 8);
      y -= LINE_H;
      drawRow('Cash in Drawer:', formatCurrency(metrics.totalCash), y, true);
      y -= LINE_H;
      drawRow('UPI Payments:', formatCurrency(metrics.totalUpi), y);
      y -= LINE_H;
      drawRow('Card / POS:', formatCurrency(metrics.totalCard), y);
      y -= LINE_H;
      if (metrics.totalSplit > 0) {
        drawRow('Split Payments:', formatCurrency(metrics.totalSplit), y);
        y -= LINE_H;
      }
      y -= 4;
      drawDivider(y);
      y -= LINE_H;
      drawRow('GROSS TOTAL:', formatCurrency(metrics.totalGross), y, true);
      y -= 6;
      drawDivider(y);
      y -= LINE_H;

      // GST Breakdown
      if (metrics.totalTax > 0) {
        drawCenter('GST SUMMARY', y, true, 8);
        y -= LINE_H;
        if (metrics.totalCgst > 0) {
          drawRow('CGST Total:', formatCurrency(metrics.totalCgst), y);
          y -= LINE_H;
        }
        if (metrics.totalSgst > 0) {
          drawRow('SGST Total:', formatCurrency(metrics.totalSgst), y);
          y -= LINE_H;
        }
        if (metrics.totalIgst > 0) {
          drawRow('IGST Total:', formatCurrency(metrics.totalIgst), y);
          y -= LINE_H;
        }
        drawRow('Total GST Tax:', formatCurrency(metrics.totalTax), y, true);
        y -= 6;
        drawDivider(y);
        y -= LINE_H;
      }

      // Footer
      y -= 10;
      drawCenter('--- END OF DAY REPORT ---', y, false, 7.5);

      const bytes = await pdfDoc.save();
      const blob = new Blob([bytes.buffer.slice(0) as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          if (iframe.parentNode) document.body.removeChild(iframe);
          URL.revokeObjectURL(url);
          setIsPrinting(false);
        };
        iframe.contentWindow?.addEventListener('afterprint', cleanup);
        iframe.contentWindow?.print();
        setTimeout(cleanup, 60_000);
      };
    } catch {
      setIsPrinting(false);
    }
  };

  const handleExportCsv = () => {
    const rows = bills.map((b) => ({
      'Bill Number': b.billNumber,
      'Date': b.billDate,
      'Customer': b.customer?.name || b.mmCustomer?.name || 'Walk-in',
      'Phone': b.customer?.phone || b.mmCustomer?.phone || '',
      'Payment Mode': b.paymentMode || '',
      'Billed By': b.billedByName || '',
      'Tax Amount (Rs)': (b.gstAmount / 100).toFixed(2),
      'Grand Total (Rs)': (b.grandTotal / 100).toFixed(2),
    }));
    exportToCsv(`Day_Closing_${selectedDate}.csv`, rows);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Day Cash & Revenue Closing
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verify today's cash drawer, payment breakdown, and print end-of-day closing slip.
            </p>
          </div>
        </DialogHeader>

        {/* Date & Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 bg-slate-50 rounded-lg px-3 border border-slate-200">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-700">Closing Date:</span>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="h-8 w-38 text-xs bg-white"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-600 mr-1">Series:</span>
            {(['ALL', 'MAIN', 'MM'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeriesFilter(s)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  seriesFilter === s
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {s === 'ALL' ? 'All Series' : s === 'MAIN' ? 'Main Studio' : 'MM Store'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={bills.length === 0}
              className="h-8 text-xs gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
            <Button
              size="sm"
              onClick={handlePrintSlip}
              disabled={bills.length === 0 || isPrinting}
              className="h-8 text-xs gap-1.5 bg-brand-600 hover:bg-brand-700 text-white"
            >
              <Printer className="h-3.5 w-3.5" />
              {isPrinting ? 'Preparing Slip…' : 'Print Closing Slip'}
            </Button>
          </div>
        </div>

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-4 gap-3 py-2">
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 flex flex-col">
            <div className="flex items-center justify-between text-emerald-800">
              <span className="text-xs font-semibold uppercase tracking-wider">Cash in Drawer</span>
              <Wallet className="h-4 w-4 text-emerald-600" />
            </div>
            <span className="text-xl font-bold text-emerald-950 mt-1">
              {formatCurrency(metrics.totalCash)}
            </span>
            <span className="text-[11px] text-emerald-700 mt-0.5 font-medium">
              Physical cash collected
            </span>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 flex flex-col">
            <div className="flex items-center justify-between text-blue-800">
              <span className="text-xs font-semibold uppercase tracking-wider">UPI / QR</span>
              <QrCode className="h-4 w-4 text-blue-600" />
            </div>
            <span className="text-xl font-bold text-blue-950 mt-1">
              {formatCurrency(metrics.totalUpi)}
            </span>
            <span className="text-[11px] text-blue-700 mt-0.5 font-medium">
              GPay / PhonePe / QR
            </span>
          </div>

          <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 flex flex-col">
            <div className="flex items-center justify-between text-purple-800">
              <span className="text-xs font-semibold uppercase tracking-wider">Card & Split</span>
              <CreditCard className="h-4 w-4 text-purple-600" />
            </div>
            <span className="text-xl font-bold text-purple-950 mt-1">
              {formatCurrency(metrics.totalCard + metrics.totalSplit)}
            </span>
            <span className="text-[11px] text-purple-700 mt-0.5 font-medium">
              POS Card / Split modes
            </span>
          </div>

          <div className="rounded-lg bg-slate-900 text-white p-3 flex flex-col shadow-sm">
            <div className="flex items-center justify-between text-slate-300">
              <span className="text-xs font-semibold uppercase tracking-wider">Gross Total</span>
              <Receipt className="h-4 w-4 text-slate-300" />
            </div>
            <span className="text-xl font-bold text-white mt-1">
              {formatCurrency(metrics.totalGross)}
            </span>
            <span className="text-[11px] text-slate-300 mt-0.5">
              {metrics.billCount} bills · Tax: {formatCurrency(metrics.totalTax)}
            </span>
          </div>
        </div>

        {/* Bills Table Preview */}
        <div className="flex-1 min-h-0 flex flex-col border rounded-lg overflow-hidden mt-1">
          <div className="bg-slate-100 px-3 py-2 border-b text-xs font-semibold text-slate-700 flex justify-between items-center">
            <span>BILLS FOR {selectedDate} ({bills.length})</span>
            {bills.length > 0 && (
              <span className="text-slate-500 font-normal">
                Range: {metrics.firstBill} → {metrics.lastBill}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 text-xs">
            {isLoading ? (
              <div className="py-8 text-center text-slate-400">Loading bills...</div>
            ) : bills.length === 0 ? (
              <div className="py-8 text-center text-slate-400">No bills saved for this date.</div>
            ) : (
              bills.map((b) => (
                <div
                  key={b.id}
                  className="px-3 py-2 flex items-center justify-between hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono font-medium text-slate-900 w-24 truncate">
                      {b.billNumber}
                    </span>
                    <span className="text-slate-600 truncate max-w-[160px]">
                      {b.customer?.name || b.mmCustomer?.name || 'Walk-in'}
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      {b.billedByName ? `by ${b.billedByName}` : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        b.paymentMode === 'CASH'
                          ? 'bg-emerald-100 text-emerald-800'
                          : b.paymentMode === 'UPI'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-purple-100 text-purple-800'
                      }`}
                    >
                      {b.paymentMode || 'CASH'}
                    </span>
                    <span className="font-semibold text-slate-900 w-20 text-right">
                      {formatCurrency(b.grandTotal)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
