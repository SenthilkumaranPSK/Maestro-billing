import { useState } from 'react';
import { Plus, Eye, IndianRupee } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MmBillDetailModal } from '@/components/billing/MmBillDetailModal';
import { billsApi } from '@/api/bills';
import { settingsApi } from '@/api/settings';
import { formatCurrency, billStatusVariant, type Bill, type BillStatus } from '@/types';
import { formatDate, todayISO } from '@/lib/utils';

// MM billing module's own dashboard — mirrors Dashboard.tsx, scoped entirely
// to series='MM' bills and bill.mmCustomer.

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, '0')}` };
}

export default function MmDashboardPage() {
  const navigate = useNavigate();
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const today = todayISO();
  const { from: monthFrom, to: monthTo } = monthBounds(currentMonth());

  const { data: monthData } = useQuery({
    queryKey: ['bills', 'mm-dashboard', 'month', monthFrom, monthTo],
    queryFn: () => billsApi.list({ from: monthFrom, to: monthTo, limit: 2000, series: 'MM' }),
  });

  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: ['bills', 'mm-dashboard', 'recent'],
    queryFn: () => billsApi.list({ limit: 8, series: 'MM' }),
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const monthBills = (monthData?.data ?? []).filter((b) => b.status !== 'CANCELLED');
  const todayBills = monthBills.filter((b) => b.billDate.slice(0, 10) === today);
  const monthRevenue = monthBills.reduce((s, b) => s + b.grandTotal, 0);
  const todayRevenue = todayBills.reduce((s, b) => s + b.grandTotal, 0);
  const truncated = (monthData?.meta.total ?? 0) > (monthData?.data.length ?? 0);

  const recentBills = recentData?.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">MM Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            {new Date(today + 'T00:00:00').toLocaleDateString('en-IN', {
              weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            })}
          </p>
        </div>
        <Button onClick={() => navigate('/mm-billing')}>
          <Plus className="h-4 w-4 mr-1" /> New MM Bill
        </Button>
      </div>

      {truncated && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This month has {monthData!.meta.total} MM bills but only {monthData!.data.length} could be
          loaded — the figures below are incomplete.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Today's MM Bills</p>
            <p className="text-3xl font-bold mt-1">{todayBills.length}</p>
          </CardContent>
        </Card>
        <Card className="border-brand-500/30 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-brand-500" />
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Today's Revenue</p>
              <div className="h-7 w-7 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
                <IndianRupee className="h-4 w-4 text-primary-foreground" />
              </div>
            </div>
            <p className="text-2xl font-bold mt-1 text-brand-700 tabular-nums">{formatCurrency(todayRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">This Month's MM Bills</p>
            <p className="text-3xl font-bold mt-1">{monthBills.length}</p>
          </CardContent>
        </Card>
        <Card className="border-brand-500/30 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-brand-500" />
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">This Month's Revenue</p>
              <div className="h-7 w-7 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
                <IndianRupee className="h-4 w-4 text-primary-foreground" />
              </div>
            </div>
            <p className="text-2xl font-bold mt-1 text-brand-700 tabular-nums">{formatCurrency(monthRevenue)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent bills */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Recent MM Bills</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentLoading && <p className="text-center text-muted-foreground py-8 text-sm">Loading…</p>}
          {!recentLoading && recentBills.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">No MM bills yet — create your first one.</p>
          )}
          {!recentLoading && recentBills.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="border-b bg-slate-50/80">
                  {['MM Bill No', 'Date', 'Customer', 'Amount', 'Status', ''].map((h) => (
                    <th key={h} className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="stagger-children">
                {recentBills.map((bill) => (
                  <tr key={bill.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-sm font-semibold text-blue-600">{bill.billNumber}</td>
                    <td className="py-3 px-4 text-sm">{formatDate(bill.billDate)}</td>
                    <td className="py-3 px-4 text-sm">{bill.mmCustomer?.name ?? 'Walk-in'}</td>
                    <td className="py-3 px-4 text-sm font-semibold tabular-nums">{formatCurrency(bill.grandTotal)}</td>
                    <td className="py-3 px-4">
                      <Badge variant={billStatusVariant[bill.status as BillStatus] ?? 'secondary'}>
                        {bill.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="View" onClick={() => setSelectedBill(bill)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {selectedBill && (
        <MmBillDetailModal
          bill={selectedBill}
          settings={settings ?? {}}
          onClose={() => setSelectedBill(null)}
        />
      )}
    </div>
  );
}
