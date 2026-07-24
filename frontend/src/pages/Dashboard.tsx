import { useState } from 'react';
import { Plus, Eye } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BillDetailModal } from '@/components/billing/BillDetailModal';
import { billsApi } from '@/api/bills';
import { settingsApi } from '@/api/settings';
import { formatCurrency, billStatusVariant, type Bill, type BillStatus } from '@/types';
import { formatDate, todayISO } from '@/lib/utils';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, '0')}` };
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const today = todayISO();
  const { from: monthFrom, to: monthTo } = monthBounds(currentMonth());

  const { data: monthData } = useQuery({
    queryKey: ['bills', 'dashboard', 'month', monthFrom, monthTo],
    queryFn: () => billsApi.list({ from: monthFrom, to: monthTo, limit: 2000 }),
  });

  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: ['bills', 'dashboard', 'recent'],
    queryFn: () => billsApi.list({ limit: 8 }),
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  // Today is always inside the current month's window, so today's figures
  // are derived from the same month query instead of firing a second request.
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
          <h2 className="text-lg font-semibold">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            {new Date(today + 'T00:00:00').toLocaleDateString('en-IN', {
              weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            })}
          </p>
        </div>
        <Button onClick={() => navigate('/billing')}>
          <Plus className="h-4 w-4 mr-1" /> New Bill
        </Button>
      </div>

      {truncated && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This month has {monthData!.meta.total} bills but only {monthData!.data.length} could be
          loaded — the figures below are incomplete.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Today's Bills</p>
            <p className="text-3xl font-bold mt-1">{todayBills.length}</p>
          </CardContent>
        </Card>
        <Card className="border-brand-500/30">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Today's Revenue</p>
            <p className="text-2xl font-bold mt-1 text-brand-700 tabular-nums">{formatCurrency(todayRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">This Month's Bills</p>
            <p className="text-3xl font-bold mt-1">{monthBills.length}</p>
          </CardContent>
        </Card>
        <Card className="border-brand-500/30">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">This Month's Revenue</p>
            <p className="text-2xl font-bold mt-1 text-brand-700 tabular-nums">{formatCurrency(monthRevenue)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent bills */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Recent Bills</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentLoading && <p className="text-center text-muted-foreground py-8 text-sm">Loading…</p>}
          {!recentLoading && recentBills.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">No bills yet — create your first one.</p>
          )}
          {!recentLoading && recentBills.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="border-b bg-slate-50/80">
                  {['Bill No', 'Date', 'Customer', 'Amount', 'Status', ''].map((h) => (
                    <th key={h} className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentBills.map((bill) => (
                  <tr key={bill.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-sm font-semibold text-blue-600">{bill.billNumber}</td>
                    <td className="py-3 px-4 text-sm">{formatDate(bill.billDate)}</td>
                    <td className="py-3 px-4 text-sm">{bill.customer?.name ?? 'Walk-in'}</td>
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
        <BillDetailModal
          bill={selectedBill}
          settings={settings ?? {}}
          onClose={() => setSelectedBill(null)}
        />
      )}
    </div>
  );
}
