import { useState } from 'react';
import { Download, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { billsApi } from '@/api/bills';
import { paisaToRupee, formatCurrency } from '@/types';
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

function currentMonthBounds(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const lastDay = new Date(y, m, 0).getDate();
  return {
    from: `${y}-${String(m).padStart(2, '0')}-01`,
    to: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

// GST Report — a single bill-wise (HSN-wise) CSV export matching the
// client-supplied template exactly (column names, "SGCT" typo included; the
// underlying field is still SGST/sgstAmount everywhere else in the app). The
// earlier rate-wise summary view was dropped — this export is the only thing
// actually used for filing.
export default function GstReportPage() {
  const navigate = useNavigate();
  const initial = currentMonthBounds();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const { data, isLoading } = useQuery({
    queryKey: ['bills', 'gst-detail-report', from, to],
    queryFn: () => billsApi.list({ from, to, limit: 2000, series: 'MAIN' }),
    enabled: !!from && !!to,
  });
  const bills = (data?.data ?? []).filter((b) => b.status !== 'CANCELLED');
  const truncated = (data?.meta.total ?? 0) > (data?.data.length ?? 0);
  // One row per (bill, HSN code) — a bill with items spanning multiple HSN
  // codes gets one row per code rather than one row misrepresenting the
  // whole bill's taxable value under a single HSN. Same grouping mmA4invoice
  // uses for the MM Tax Invoice's own HSN summary table (lib/hsnSummary.ts).
  const rows = bills.flatMap((bill) => computeHsnSummary(bill).map((g) => ({ bill, group: g })));
  const totalDiscount = bills.reduce((s, b) => s + b.discountAmount, 0);

  const handleExportCsv = () => {
    const lines: string[] = [];
    // Header text matches the client's own template exactly, "SGCT" typo
    // included — the underlying field is still SGST (sgstAmount) throughout
    // the app; only this displayed column label differs.
    lines.push('S.No,Bill No,Date,Name,GSTIN,HSN,Taxable Value (Before TAX),IGST,CGST,SGCT,NET Value');
    rows.forEach(({ bill, group: g }, i) => {
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
    a.download = `GST-Report-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => navigate('/settings')} title="Back to Settings">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">GST Report</h2>
          <p className="text-sm text-muted-foreground">Bill-wise, HSN-wise export for filing or handing to your CA</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            One row per bill per HSN/SAC code — S.No, Bill No, Date, Name, GSTIN, HSN, Taxable Value, IGST,
            CGST, SGCT and NET Value.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">From</label>
              <input
                type="date"
                className="flex h-9 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                value={from}
                max={to}
                onChange={(e) => e.target.value && setFrom(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">To</label>
              <input
                type="date"
                className="flex h-9 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                value={to}
                min={from}
                onChange={(e) => e.target.value && setTo(e.target.value)}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {isLoading ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'} across ${bills.length} bill${bills.length === 1 ? '' : 's'}`}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={handleExportCsv}
              disabled={isLoading || rows.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
          {truncated && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This range has {data!.meta.total} bills but only {data!.data.length} could be loaded —
              narrow the date range before exporting for filing.
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Note: taxable value is before discount. Discounts in this range: {formatCurrency(totalDiscount)}.
        Figures cover all non-cancelled bills. Verify with your CA before filing.
      </p>
    </div>
  );
}
