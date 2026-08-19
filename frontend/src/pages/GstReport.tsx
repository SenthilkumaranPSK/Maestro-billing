import { useState } from 'react';
import { Download, FileBarChart2, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { billsApi } from '@/api/bills';
import { formatCurrency, paisaToRupee } from '@/types';
import { splitTaxP } from '@/lib/billMath';
import { computeHsnSummary } from '@/lib/hsnSummary';
import { csvEscape } from '@/lib/csv';

// Local, not lib/a4invoice.ts's formatDDMMYYYY — that file eagerly imports
// pdf-lib (~400KB), which must stay code-split behind a dynamic import and
// never land in this always-loaded page's bundle. Same DD-MM-YYYY format.
function formatDDMMYYYY(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(lastDay).padStart(2, '0')}`,
  };
}

interface RateRow {
  rate: number;
  taxableValue: number; // paise
  cgst: number;         // paise
  sgst: number;         // paise
  igst: number;         // paise
}

export default function GstReportPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth());
  const { from, to } = monthBounds(month);

  const { data, isLoading } = useQuery({
    queryKey: ['bills', 'gst-report', from, to],
    queryFn: () => billsApi.list({ from, to, limit: 2000, series: 'MAIN' }),
  });

  // Detailed bill-wise (HSN-wise) CSV export — a separate custom date range
  // from the rate-wise summary above, since a CA's filing cutoff often
  // doesn't line up with a calendar month. Defaults to the same month.
  const [detailFrom, setDetailFrom] = useState(from);
  const [detailTo, setDetailTo] = useState(to);

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['bills', 'gst-detail-report', detailFrom, detailTo],
    queryFn: () => billsApi.list({ from: detailFrom, to: detailTo, limit: 2000, series: 'MAIN' }),
    enabled: !!detailFrom && !!detailTo,
  });
  const detailBills = (detailData?.data ?? []).filter((b) => b.status !== 'CANCELLED');
  const detailTruncated = (detailData?.meta.total ?? 0) > (detailData?.data.length ?? 0);
  // One row per (bill, HSN code) — a bill with items spanning multiple HSN
  // codes gets one row per code rather than one row misrepresenting the
  // whole bill's taxable value under a single HSN. Same grouping mmA4invoice
  // uses for the MM Tax Invoice's own HSN summary table (lib/hsnSummary.ts).
  const detailRows = detailBills.flatMap((bill) =>
    computeHsnSummary(bill).map((g) => ({ bill, group: g })),
  );

  // Cancelled bills are excluded from tax figures.
  const bills = (data?.data ?? []).filter((b) => b.status !== 'CANCELLED');
  // The list endpoint caps at 2000 rows — past that the figures would be
  // silently wrong, which is unacceptable for a tax filing. Warn loudly.
  const truncated = (data?.meta.total ?? 0) > (data?.data.length ?? 0);

  // Aggregate item lines by GST rate.
  const byRate = new Map<number, RateRow>();
  for (const bill of bills) {
    for (const item of bill.items) {
      const row = byRate.get(item.gstRate) ?? {
        rate: item.gstRate,
        taxableValue: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
      };
      // Not qty*unitPrice — for a GST-inclusive item, unitPrice is the
      // all-in (tax-included) price, so that product overstates the
      // taxable base by the tax amount itself. totalAmount-gstAmount is
      // the actual taxable value in both inclusive and exclusive modes.
      row.taxableValue += item.totalAmount - item.gstAmount;
      // Same rate can have both intra-state and inter-state bills within one
      // month, so a rate row accumulates all three columns — whichever pair
      // is nonzero for a given bill depends on its own isInterState. Same
      // floor+remainder split as ReportService.ts.
      const { cgstP, sgstP, igstP } = splitTaxP(item.gstAmount, bill.isInterState);
      row.cgst += cgstP;
      row.sgst += sgstP;
      row.igst += igstP;
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

  const displayMonth = new Date(from + 'T00:00:00').toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
  });

  const handleExportCsv = () => {
    const lines: string[] = [];
    lines.push(`GST Summary,${displayMonth}`);
    lines.push('');
    lines.push('GST Rate (%),Taxable Value (Rs),CGST (Rs),SGST (Rs),IGST (Rs),Total Tax (Rs)');
    for (const r of rows) {
      lines.push(
        [
          r.rate,
          paisaToRupee(r.taxableValue).toFixed(2),
          paisaToRupee(r.cgst).toFixed(2),
          paisaToRupee(r.sgst).toFixed(2),
          paisaToRupee(r.igst).toFixed(2),
          paisaToRupee(r.cgst + r.sgst + r.igst).toFixed(2),
        ].join(','),
      );
    }
    lines.push(
      [
        'TOTAL',
        paisaToRupee(totalTaxable).toFixed(2),
        paisaToRupee(totalCgst).toFixed(2),
        paisaToRupee(totalSgst).toFixed(2),
        paisaToRupee(totalIgst).toFixed(2),
        paisaToRupee(totalCgst + totalSgst + totalIgst).toFixed(2),
      ].join(','),
    );
    lines.push('');
    lines.push(`Bills,${bills.length}`);
    lines.push(`Total Discount (Rs),${paisaToRupee(totalDiscount).toFixed(2)}`);
    lines.push(`Total Invoiced (Rs),${paisaToRupee(totalInvoiced).toFixed(2)}`);

    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GST-Report-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportDetailedCsv = () => {
    const lines: string[] = [];
    // Header text matches the client's own template exactly, "SGCT" typo
    // included — the underlying field is still SGST (sgstAmount) throughout
    // the app; only this displayed column label differs.
    lines.push('S.No,Bill No,Date,Name,GSTIN,HSN,Taxable Value (Before TAX),IGST,CGST,SGCT,NET Value');
    detailRows.forEach(({ bill, group: g }, i) => {
      const netValue = g.taxableValue + g.cgstAmount + g.sgstAmount + g.igstAmount;
      lines.push(
        [
          i + 1,
          csvEscape(bill.billNumber),
          formatDDMMYYYY(bill.billDate),
          csvEscape(bill.customer?.name ?? ''),
          csvEscape(bill.customer?.gstin ?? ''),
          csvEscape(g.hsnSac),
          paisaToRupee(g.taxableValue).toFixed(2),
          paisaToRupee(g.igstAmount).toFixed(2),
          paisaToRupee(g.cgstAmount).toFixed(2),
          paisaToRupee(g.sgstAmount).toFixed(2),
          paisaToRupee(netValue).toFixed(2),
        ].join(','),
      );
    });

    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GST-Detailed-Report-${detailFrom}_to_${detailTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate('/settings')} title="Back to Settings">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">GST Report</h2>
            <p className="text-sm text-muted-foreground">CGST / SGST / IGST summary for filing — {displayMonth}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            className="flex h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
          <Button variant="outline" onClick={handleExportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {truncated && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This month has {data!.meta.total} bills but only {data!.data.length} could be loaded —
          the figures below are incomplete. Narrow the period before filing.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Taxable Value</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(totalTaxable)}</p>
          </CardContent>
        </Card>
        <Card className="border-brand-500/30">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total GST</p>
            <p className="text-2xl font-bold mt-1 text-brand-700 tabular-nums">{formatCurrency(totalCgst + totalSgst + totalIgst)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Bills</p>
            <p className="text-2xl font-bold mt-1">{bills.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Rate-wise breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Rate-wise Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <FileBarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
              No bills in {displayMonth}.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b bg-slate-50/80">
                  <th className="text-left py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">GST Rate</th>
                  <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Taxable Value</th>
                  <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">CGST</th>
                  <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">SGST</th>
                  <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">IGST</th>
                  <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Tax</th>
                </tr>
              </thead>
              <tbody className="stagger-children">
                {rows.map((r) => (
                  <tr key={r.rate} className="border-b last:border-b-0">
                    <td className="py-2.5 px-4 text-sm font-medium">{r.rate}%</td>
                    <td className="py-2.5 px-4 text-sm text-right">{formatCurrency(r.taxableValue)}</td>
                    <td className="py-2.5 px-4 text-sm text-right">{formatCurrency(r.cgst)}</td>
                    <td className="py-2.5 px-4 text-sm text-right">{formatCurrency(r.sgst)}</td>
                    <td className="py-2.5 px-4 text-sm text-right">{formatCurrency(r.igst)}</td>
                    <td className="py-2.5 px-4 text-sm font-semibold text-right">{formatCurrency(r.cgst + r.sgst + r.igst)}</td>
                  </tr>
                ))}
                <tr className="bg-brand-50 border-t-2 border-brand-200">
                  <td className="py-2.5 px-4 text-sm font-bold">TOTAL</td>
                  <td className="py-2.5 px-4 text-sm font-bold text-right">{formatCurrency(totalTaxable)}</td>
                  <td className="py-2.5 px-4 text-sm font-bold text-right">{formatCurrency(totalCgst)}</td>
                  <td className="py-2.5 px-4 text-sm font-bold text-right">{formatCurrency(totalSgst)}</td>
                  <td className="py-2.5 px-4 text-sm font-bold text-right">{formatCurrency(totalIgst)}</td>
                  <td className="py-2.5 px-4 text-sm font-bold text-right">{formatCurrency(totalCgst + totalSgst + totalIgst)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Detailed bill-wise (HSN-wise) CSV export */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Detailed Bill-wise Export (HSN-wise)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            One row per bill per HSN/SAC code — Taxable Value, IGST, CGST, SGST and NET Value, for filing or
            handing to your CA. Uses its own date range, independent of the month picker above.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">From</label>
              <input
                type="date"
                className="flex h-9 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                value={detailFrom}
                max={detailTo}
                onChange={(e) => e.target.value && setDetailFrom(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">To</label>
              <input
                type="date"
                className="flex h-9 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                value={detailTo}
                min={detailFrom}
                onChange={(e) => e.target.value && setDetailTo(e.target.value)}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {detailLoading ? 'Loading…' : `${detailRows.length} row${detailRows.length === 1 ? '' : 's'} across ${detailBills.length} bill${detailBills.length === 1 ? '' : 's'}`}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={handleExportDetailedCsv}
              disabled={detailLoading || detailRows.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export Detailed CSV
            </Button>
          </div>
          {detailTruncated && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This range has {detailData!.meta.total} bills but only {detailData!.data.length} could be loaded —
              narrow the date range before exporting for filing.
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Note: taxable value is before discount. Discounts this month: {formatCurrency(totalDiscount)}.
        Figures cover all non-cancelled bills. Verify with your CA before filing.
      </p>
    </div>
  );
}
