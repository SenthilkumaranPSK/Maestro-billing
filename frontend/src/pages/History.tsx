import { useState, useDeferredValue } from 'react';
import { Search, FileText, Printer, ScanEye, Pencil, Ban, ChevronLeft, ChevronRight } from 'lucide-react';
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
import { PdfPreviewModal } from '@/components/billing/PdfPreviewModal';
import { PasswordGateModal } from '@/components/billing/PasswordGateModal';
import { EditBillModal } from '@/components/billing/EditBillModal';
import { LayoutToggle, guessBillLayout, type BillLayout } from '@/components/billing/LayoutToggle';
import { billsApi } from '@/api/bills';
import { settingsApi } from '@/api/settings';
// pdf-lib is heavy (~400KB) — loaded on demand so the app starts fast.
const loadPdfLib = () => import('@/lib/pdf');
const loadA4Lib = () => import('@/lib/a4invoice');
const loadMmA4Lib = () => import('@/lib/mmA4invoice');
import { formatCurrency, billStatusVariant, type BillStatus, type Bill } from '@/types';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const statusVariant = billStatusVariant;

export default function HistoryPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  // Defer the search term so fast typing doesn't fire a request per keystroke
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [previewBill, setPreviewBill] = useState<Bill | null>(null);
  // Editing a bill is gated behind the bill-edit password (Settings →
  // Security) — this holds the bill until the password is confirmed or
  // cancelled.
  const [pendingEdit, setPendingEdit] = useState<Bill | null>(null);
  const requestEdit = (bill: Bill) => setPendingEdit(bill);
  // Per-row Thermal/A4 choice for the row's own Download PDF icon.
  const [rowLayout, setRowLayout] = useState<Record<number, BillLayout>>({});
  const LIMIT = 15;

  const { data, isLoading } = useQuery({
    queryKey: ['bills', 'history', deferredSearch, status, from, to, page],
    queryFn: () =>
      billsApi.list({
        search: deferredSearch || undefined,
        status: status !== 'ALL' ? status : undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        limit: LIMIT,
        // MM bills have their own separate MmHistoryPage — never mixed in here.
        series: 'MAIN',
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
      toast({ title: 'Bill cancelled', variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not cancel bill', description: err.message, variant: 'destructive' });
    },
  });

  const handleCancel = (bill: Bill) => {
    const ok = confirm(
      `Cancel bill ${bill.billNumber} (${formatCurrency(bill.grandTotal)})?\n\n` +
        'It will be marked CANCELLED and excluded from revenue and GST reports. This cannot be undone.',
    );
    if (ok) cancelMutation.mutate(bill.id);
  };

  const totalPages = Math.ceil((data?.meta.total ?? 0) / LIMIT);

  // Falls back to a guess (A4-only fields present -> 'a4'), not a hardcoded
  // 'thermal', so a bill that was actually created in A4 mode doesn't
  // silently download/print as the thermal receipt just because nobody
  // clicked the row's A4 toggle first. See guessBillLayout for the reasoning.
  const layoutFor = (bill: Bill): BillLayout => rowLayout[bill.id] ?? guessBillLayout(bill);

  const handleDownloadPDF = async (bill: Bill) => {
    const layout = layoutFor(bill);
    if (layout === 'mm_a4') {
      const { downloadMmA4InvoicePDF } = await loadMmA4Lib();
      await downloadMmA4InvoicePDF(bill, settings ?? {});
    } else if (layout === 'a4') {
      const { downloadA4InvoicePDF } = await loadA4Lib();
      await downloadA4InvoicePDF(bill, settings ?? {});
    } else {
      const { downloadBillPDF } = await loadPdfLib();
      await downloadBillPDF(bill, settings ?? {});
    }
  };

  const handlePrint = async (bill: Bill) => {
    const layout = layoutFor(bill);
    if (layout === 'mm_a4') {
      const { printMmA4InvoicePDF } = await loadMmA4Lib();
      await printMmA4InvoicePDF(bill, settings ?? {});
      return;
    }
    if (layout === 'a4') {
      const { printA4InvoicePDF } = await loadA4Lib();
      await printA4InvoicePDF(bill, settings ?? {});
      return;
    }
    try {
      const { printThermalReceipt } = await import('@/lib/printThermal');
      await printThermalReceipt(bill, settings ?? {});
    } catch (err) {
      toast({
        title: 'Could not print the receipt',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
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
                  placeholder="Search bill number…"
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
            Bills ({data?.meta.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-slate-50/80">
                  {['Bill No', 'Date', 'Customer', 'Items', 'Amount', 'Payment', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="stagger-children">
                {isLoading && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-muted-foreground text-sm">Loading…</td>
                  </tr>
                )}
                {!isLoading && data?.data.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-muted-foreground text-sm">No bills found</td>
                  </tr>
                )}
                {data?.data.map((bill) => (
                  <tr key={bill.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-mono text-sm font-semibold text-blue-600">{bill.billNumber}</td>
                    <td className="py-3 px-4 text-sm">{formatDate(bill.billDate)}</td>
                    <td className="py-3 px-4 text-sm">
                      {bill.customer ? (
                        <Link
                          to={`/customers?id=${bill.customer.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {bill.customer.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Walk-in</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{bill.items?.length ?? 0} items</td>
                    <td className="py-3 px-4 text-sm font-semibold tabular-nums">{formatCurrency(bill.grandTotal)}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{bill.paymentMode ?? '—'}</td>
                    <td className="py-3 px-4">
                      <Badge variant={statusVariant[bill.status as BillStatus] ?? 'secondary'}>
                        {bill.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1 items-center">
                        {bill.status !== 'CANCELLED' && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:text-amber-700" title="Edit" onClick={() => requestEdit(bill)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <LayoutToggle
                          compact
                          value={layoutFor(bill)}
                          onChange={(v) => setRowLayout((prev) => ({ ...prev, [bill.id]: v }))}
                        />
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

      {editingBill && (
        <EditBillModal
          bill={editingBill}
          onClose={() => setEditingBill(null)}
          onSaved={() => {
            setEditingBill(null);
          }}
        />
      )}

      {previewBill && (
        <PdfPreviewModal
          bill={previewBill}
          settings={settings ?? {}}
          layout={layoutFor(previewBill)}
          onClose={() => setPreviewBill(null)}
        />
      )}

      {pendingEdit && (
        <PasswordGateModal
          onCancel={() => setPendingEdit(null)}
          onConfirm={() => {
            setEditingBill(pendingEdit);
            setPendingEdit(null);
          }}
        />
      )}
    </div>
  );
}
