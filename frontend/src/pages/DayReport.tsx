import { useRef, useEffect } from 'react';
import { Printer, Calendar, ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { billsApi } from '@/api/bills';
import { settingsApi } from '@/api/settings';
import { formatCurrency } from '@/types';
import { todayISO } from '@/lib/utils';

export default function DayReportPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Persist the selected date in the URL (?date=YYYY-MM-DD) so a refresh or
  // shared link keeps the same view. Default to today.
  const dateParam = searchParams.get('date');
  const isValid = !!dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
  const date = isValid ? dateParam! : todayISO();
  const printRef = useRef<HTMLDivElement>(null);

  // If the URL has no `?date=` or has an invalid one, replace the URL so
  // the displayed date and the URL stay in sync (refresh / share works).
  useEffect(() => {
    if (!isValid) {
      setSearchParams({}, { replace: true });
    }
  }, [isValid, setSearchParams]);

  const setDate = (value: string) => {
    if (value === todayISO()) {
      // Keep the URL clean for the default view.
      setSearchParams({});
    } else {
      setSearchParams({ date: value });
    }
  };

  const { data: billsData } = useQuery({
    queryKey: ['bills', 'day', date],
    queryFn: () => billsApi.list({ from: date, to: date, limit: 1000 }),
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
  const studioName = (settings?.studio?.studio_owner || settings?.studio?.studio_name || 'Studio').toUpperCase();
  const studioAddressLines = (settings?.studio?.studio_address ?? '').split('\n').filter(Boolean);

  // Cancelled bills are excluded from the day's revenue figures.
  const bills = (billsData?.data ?? []).filter((b) => b.status !== 'CANCELLED');
  const totalRevenue = bills.reduce((s, b) => s + b.grandTotal, 0);
  const truncated = (billsData?.meta.total ?? 0) > (billsData?.data.length ?? 0);

  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Controls */}
      <div className="flex items-center justify-between no-print">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate('/settings')} title="Back to Settings">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">Day Report</h2>
            <p className="text-sm text-muted-foreground">End-of-day closing summary</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
            />
          </div>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      {/* Printable area */}
      <div ref={printRef} className="space-y-4">
        {/* Print header */}
        <div className="hidden print:block text-center pb-4 border-b-2 border-black">
          <p className="font-bold text-lg">{studioName}</p>
          {studioAddressLines.map((line, i) => (
            <p key={i} className="text-sm">{line}</p>
          ))}
          <p className="font-semibold mt-2">DAY CLOSING REPORT</p>
          <p className="text-sm">{displayDate}</p>
        </div>

        {/* Date heading (screen) */}
        <div className="print:hidden">
          <p className="text-base font-semibold text-slate-700">{displayDate}</p>
        </div>

        {truncated && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 no-print">
            This day has {billsData!.meta.total} bills but only {billsData!.data.length} could be
            loaded — the totals below are incomplete.
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Bills</p>
              <p className="text-3xl font-bold mt-1">{bills.length}</p>
            </CardContent>
          </Card>
          <Card className="border-brand-500/30">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Revenue</p>
              <p className="text-2xl font-bold mt-1 text-brand-700 tabular-nums">{formatCurrency(totalRevenue)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Bills list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Bills ({bills.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {bills.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">No bills on this date.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-slate-50/80">
                    <th className="text-left py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bill No</th>
                    <th className="text-left py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customer</th>
                    <th className="text-right py-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody className="stagger-children">
                  {bills.map((bill) => (
                    <tr key={bill.id} className="border-b last:border-b-0">
                      <td className="py-2.5 px-4 text-sm font-medium">{bill.billNumber}</td>
                      <td className="py-2.5 px-4 text-sm text-slate-600">{bill.customer?.name ?? 'Walk-in'}</td>
                      <td className="py-2.5 px-4 text-sm font-semibold text-right">{formatCurrency(bill.grandTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Print footer */}
        <div className="hidden print:block text-center pt-4 border-t text-xs text-gray-500">
          <p>Generated on {new Date().toLocaleString('en-IN')}</p>
          <p className="mt-1">The Maestro Studio's — Day Closing Report</p>
        </div>
      </div>
    </div>
  );
}
