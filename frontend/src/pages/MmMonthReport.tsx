import { useRef, useState } from 'react';
import { Printer, ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { billsApi } from '@/api/bills';
import { settingsApi } from '@/api/settings';
import { formatCurrency } from '@/types';

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

// MM billing module's own Month Report — mirrors MonthReport.tsx, scoped to
// series='MM' and bill.mmCustomer.
export default function MmMonthReportPage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth());
  const { from, to } = monthBounds(month);
  const printRef = useRef<HTMLDivElement>(null);

  const { data: billsData } = useQuery({
    queryKey: ['bills', 'mm-month-report', from, to],
    queryFn: () => billsApi.list({ from, to, limit: 2000, series: 'MM' }),
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
  const studioName = (settings?.studio?.studio_owner || settings?.studio?.studio_name || 'Studio').toUpperCase();
  const studioAddressLines = (settings?.studio?.studio_address ?? '').split('\n').filter(Boolean);

  const bills = (billsData?.data ?? []).filter((b) => b.status !== 'CANCELLED');
  const totalRevenue = bills.reduce((s, b) => s + b.grandTotal, 0);
  const totalGst = bills.reduce((s, b) => s + b.gstAmount, 0);
  const truncated = (billsData?.meta.total ?? 0) > (billsData?.data.length ?? 0);

  const displayMonth = new Date(from + 'T00:00:00').toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between no-print">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate('/mm-settings')} title="Back to MM Settings">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">MM Month Report</h2>
            <p className="text-sm text-muted-foreground">Monthly closing summary</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            className="flex h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      <div ref={printRef} className="space-y-4">
        <div className="hidden print:block text-center pb-4 border-b-2 border-black">
          <p className="font-bold text-lg">{studioName}</p>
          {studioAddressLines.map((line, i) => (
            <p key={i} className="text-sm">{line}</p>
          ))}
          <p className="font-semibold mt-2">MM MONTH CLOSING REPORT</p>
          <p className="text-sm">{displayMonth}</p>
        </div>

        <div className="print:hidden">
          <p className="text-base font-semibold text-slate-700">{displayMonth}</p>
        </div>

        {truncated && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 no-print">
            This month has {billsData!.meta.total} MM bills but only {billsData!.data.length} could be
            loaded — the totals below are incomplete.
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total MM Bills</p>
              <p className="text-3xl font-bold mt-1">{bills.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total GST</p>
              <p className="text-2xl font-bold mt-1">{formatCurrency(totalGst)}</p>
            </CardContent>
          </Card>
          <Card className="border-brand-500/30">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Revenue</p>
              <p className="text-2xl font-bold mt-1 text-brand-700 tabular-nums">{formatCurrency(totalRevenue)}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">MM Bills ({bills.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {bills.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">No MM bills this month.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-slate-50/80">
                    <th className="text-left py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">MM Bill No</th>
                    <th className="text-left py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customer</th>
                    <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody className="stagger-children">
                  {bills.map((bill) => (
                    <tr key={bill.id} className="border-b last:border-b-0">
                      <td className="py-2.5 px-4 text-sm font-medium">{bill.billNumber}</td>
                      <td className="py-2.5 px-4 text-sm text-slate-600">{bill.mmCustomer?.name ?? 'Walk-in'}</td>
                      <td className="py-2.5 px-4 text-sm font-semibold text-right">{formatCurrency(bill.grandTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <div className="hidden print:block text-center pt-4 border-t text-xs text-gray-500">
          <p>Generated on {new Date().toLocaleString('en-IN')}</p>
          <p className="mt-1">MM Billing — Month Closing Report</p>
        </div>
      </div>
    </div>
  );
}
