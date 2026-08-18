import { useState, useDeferredValue } from 'react';
import { Search, FileText, Printer, Eye, ScanEye, Pencil, Ban, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MmBillDetailModal } from '@/components/billing/MmBillDetailModal';
import { PdfPreviewModal } from '@/components/billing/PdfPreviewModal';
import { MmEditBillModal } from '@/components/billing/MmEditBillModal';
import { billsApi } from '@/api/bills';
import { settingsApi } from '@/api/settings';
// pdf-lib is heavy (~400KB) — loaded on demand so the app starts fast.
const loadMmA4Lib = () => import('@/lib/mmA4invoice');
import { formatCurrency, billStatusVariant, type BillStatus, type Bill } from '@/types';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// MM's own bill history — filtered to series='MM' only, entirely separate
// from the main Bill History page. Always prints/downloads as the MM/A4 Tax
// Invoice layout (no Thermal/A4 toggle — MM bills are never anything else).
const statusVariant = billStatusVariant;

export default function MmHistoryPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [previewBill, setPreviewBill] = useState<Bill | null>(null);
  const LIMIT = 15;

  const { data, isLoading } = useQuery({
    queryKey: ['bills', 'mm-history', deferredSearch, status, from, to, page],
    queryFn: () =>
      billsApi.list({
        search: deferredSearch || undefined,
        status: status !== 'ALL' ? status : undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        limit: LIMIT,
        series: 'MM',
      }),
    placeholderData: (prev) => prev,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => billsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bills'] });
      toast({ title: 'MM bill cancelled', variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not cancel bill', description: err.message, variant: 'destructive' });
    },
  });

  const handleCancel = (bill: Bill) => {
    const ok = confirm(
      `Cancel MM bill ${bill.billNumber} (${formatCurrency(bill.grandTotal)})?\n\n` +
        'It will be marked CANCELLED. This cannot be undone.',
    );
    if (ok) cancelMutation.mutate(bill.id);
  };

  const totalPages = Math.ceil((data?.meta.total ?? 0) / LIMIT);

  const handleDownloadPDF = async (bill: Bill) => {
    const { downloadMmA4InvoicePDF } = await loadMmA4Lib();
    await downloadMmA4InvoicePDF(bill, settings ?? {});
  };

  const handlePrint = async (bill: Bill) => {
    const { printMmA4InvoicePDF } = await loadMmA4Lib();
    await printMmA4InvoicePDF(bill, settings ?? {});
  };

  return (
    <div className="space-y-5">
      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-48">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search MM bill number…"
                  className="pl-9"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                />
              </div>
            </div>
            <div className="w-36">
              <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Input type="date" className="w-36" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
              <span className="text-muted-foreground text-sm">to</span>
              <Input type="date" className="w-36" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setSearch(''); setStatus('ALL'); setFrom(''); setTo(''); setPage(1); }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bills Table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">
            MM Bills ({data?.meta.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-slate-50/80">
                  {['MM Bill No', 'Date', 'Customer', 'Items', 'Amount', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="stagger-children">
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground text-sm">Loading…</td>
                  </tr>
                )}
                {!isLoading && data?.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground text-sm">No MM bills found</td>
                  </tr>
                )}
                {data?.data.map((bill) => (
                  <tr key={bill.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-sm font-semibold text-blue-600">{bill.billNumber}</td>
                    <td className="py-3 px-4 text-sm">{formatDate(bill.billDate)}</td>
                    <td className="py-3 px-4 text-sm">
                      {bill.mmCustomer ? (
                        <Link
                          to={`/mm-customers?id=${bill.mmCustomer.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {bill.mmCustomer.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Walk-in</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{bill.items?.length ?? 0} items</td>
                    <td className="py-3 px-4 text-sm font-semibold tabular-nums">{formatCurrency(bill.grandTotal)}</td>
                    <td className="py-3 px-4">
                      <Badge variant={statusVariant[bill.status as BillStatus] ?? 'secondary'}>
                        {bill.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1 items-center">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="View" onClick={() => setSelectedBill(bill)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {bill.status !== 'CANCELLED' && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:text-amber-700" title="Edit" onClick={() => setEditingBill(bill)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Preview" onClick={() => setPreviewBill(bill)}>
                          <ScanEye className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Print" onClick={() => handlePrint(bill)}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Download PDF" onClick={() => handleDownloadPDF(bill)}>
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                        {bill.status !== 'CANCELLED' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            title="Cancel bill"
                            onClick={() => handleCancel(bill)}
                            disabled={cancelMutation.isPending}
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({data?.meta.total} total)
              </p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedBill && (
        <MmBillDetailModal
          bill={selectedBill}
          settings={settings ?? {}}
          onClose={() => setSelectedBill(null)}
          onEdit={selectedBill.status !== 'CANCELLED' ? () => { setEditingBill(selectedBill); setSelectedBill(null); } : undefined}
        />
      )}

      {editingBill && (
        <MmEditBillModal
          bill={editingBill}
          onClose={() => setEditingBill(null)}
          onSaved={(updated) => {
            setEditingBill(null);
            setSelectedBill(updated);
          }}
        />
      )}

      {previewBill && (
        <PdfPreviewModal
          bill={previewBill}
          settings={settings ?? {}}
          layout="mm_a4"
          onClose={() => setPreviewBill(null)}
        />
      )}
    </div>
  );
}
