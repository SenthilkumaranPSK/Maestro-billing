import { useEffect, useState } from 'react';
import { X, Eye } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BillDetailModal } from '@/components/billing/BillDetailModal';
import { customersApi } from '@/api/customers';
import { settingsApi } from '@/api/settings';
import { formatCurrency, billStatusVariant, type Bill, type BillStatus, type Customer } from '@/types';
import { formatDate } from '@/lib/utils';

interface CustomerLedgerModalProps {
  customer: Customer;
  onClose: () => void;
}

export function CustomerLedgerModal({ customer, onClose }: CustomerLedgerModalProps) {
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);

  const { data: bills, isLoading } = useQuery({
    queryKey: ['customers', customer.id, 'bills'],
    queryFn: () => customersApi.getBills(customer.id),
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Cancelled bills don't count toward what the customer has actually spent.
  const activeBills = (bills ?? []).filter((b) => b.status !== 'CANCELLED');
  const totalSpend = activeBills.reduce((s, b) => s + b.grandTotal, 0);
  const lastVisit = bills?.[0]?.billDate; // list is billDate desc from the API

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in-0 duration-150"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="bg-white rounded-xl shadow-soft-lg w-full max-w-2xl max-h-[90vh] flex flex-col animate-in fade-in-0 zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <div>
              <h3 className="font-bold text-lg">{customer.name}</h3>
              <p className="text-xs text-muted-foreground">{customer.phone}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Content */}
          <div className="overflow-auto flex-1 p-6 space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Bills</p>
                <p className="text-xl font-bold mt-1">{activeBills.length}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Spend</p>
                <p className="text-xl font-bold mt-1 tabular-nums">{formatCurrency(totalSpend)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Last Visit</p>
                <p className="text-xl font-bold mt-1">{lastVisit ? formatDate(lastVisit) : '—'}</p>
              </div>
            </div>

            {/* Bills */}
            <div>
              {isLoading && <p className="text-center text-muted-foreground py-8 text-sm">Loading…</p>}
              {!isLoading && (bills?.length ?? 0) === 0 && (
                <p className="text-center text-muted-foreground py-8 text-sm">No bills for this customer yet.</p>
              )}
              {!isLoading && (bills?.length ?? 0) > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 font-medium">Bill No</th>
                      <th className="text-left py-2 font-medium">Date</th>
                      <th className="text-right py-2 font-medium">Amount</th>
                      <th className="text-left py-2 font-medium pl-3">Status</th>
                      <th className="text-right py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills!.map((bill) => (
                      <tr key={bill.id} className="border-b last:border-b-0 hover:bg-slate-50">
                        <td className="py-2.5 font-mono text-blue-600 font-medium">{bill.billNumber}</td>
                        <td className="py-2.5 text-slate-600">{formatDate(bill.billDate)}</td>
                        <td className="py-2.5 text-right font-semibold tabular-nums">{formatCurrency(bill.grandTotal)}</td>
                        <td className="py-2.5 pl-3">
                          <Badge variant={billStatusVariant[bill.status as BillStatus] ?? 'secondary'}>
                            {bill.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="View" onClick={() => setSelectedBill(bill)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedBill && (
        <BillDetailModal
          bill={selectedBill}
          settings={settings ?? {}}
          onClose={() => setSelectedBill(null)}
        />
      )}
    </>
  );
}
