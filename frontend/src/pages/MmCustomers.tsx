import { useState, useEffect, useRef } from 'react';
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { MmCustomerLedgerModal } from '@/components/customers/MmCustomerLedgerModal';
import { mmCustomersApi } from '@/api/mmCustomers';
import { useToast } from '@/hooks/use-toast';
import type { MmCustomer } from '@/types';

// MM billing module's own customer database — a fully separate page/table
// from the studio's normal Customers page, mirroring its UI exactly.
const EMPTY: Partial<MmCustomer> = { name: '', phone: '', email: '', address: '', gstin: '', notes: '' };

export default function MmCustomersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Partial<MmCustomer> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [ledgerCustomer, setLedgerCustomer] = useState<MmCustomer | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = Number(searchParams.get('id') ?? 0) || null;
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LIMIT = 15;

  const { data, isLoading } = useQuery({
    queryKey: ['mm-customers', search, page],
    queryFn: () => mmCustomersApi.list({ search, page, limit: LIMIT }),
    placeholderData: (prev) => prev,
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<MmCustomer>) => mmCustomersApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mm-customers'] }); setEditing(null); toast({ title: 'MM Customer created', variant: 'success' }); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MmCustomer> }) => mmCustomersApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mm-customers'] }); setEditing(null); toast({ title: 'MM Customer updated', variant: 'success' }); },
  });

  const deleteMutation = useMutation({
    mutationFn: mmCustomersApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mm-customers'] }); toast({ title: 'MM Customer deleted' }); },
  });

  const handleSave = () => {
    if (!editing?.name || !editing?.phone) {
      toast({ title: 'Name and phone are required', variant: 'destructive' }); return;
    }
    if (isNew) createMutation.mutate(editing);
    else updateMutation.mutate({ id: editing.id!, data: editing });
  };

  useEffect(() => {
    if (!highlightId) return;
    const row = document.getElementById(`mm-customer-${highlightId}`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      next.delete('id');
      setSearchParams(next, { replace: true });
    }, 2000);
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, data?.data.length]);

  const totalPages = Math.ceil((data?.meta.total ?? 0) / LIMIT);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">MM Customers</h2>
        <Button onClick={() => { setEditing({ ...EMPTY }); setIsNew(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add MM Customer
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="relative w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or phone…"
              className="pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-slate-50/80">
                {['Name', 'Phone', 'Email', 'GSTIN', 'Actions'].map((h) => (
                  <th key={h} className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="stagger-children">
              {isLoading && <tr><td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">Loading…</td></tr>}
              {!isLoading && data?.data.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No MM customers found</td></tr>}
              {data?.data.map((c) => (
                <tr
                  key={c.id}
                  id={`mm-customer-${c.id}`}
                  className={`border-b last:border-b-0 transition-colors ${
                    highlightId === c.id
                      ? 'bg-brand-100/50 ring-2 ring-brand-500 ring-inset'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="py-3 px-4 font-medium text-sm">
                    <button
                      type="button"
                      className="text-blue-600 hover:underline text-left"
                      onClick={() => setLedgerCustomer(c)}
                      title="View MM bill history"
                    >
                      {c.name}
                    </button>
                  </td>
                  <td className="py-3 px-4 text-sm">{c.phone}</td>
                  <td className="py-3 px-4 text-sm text-muted-foreground">{c.email ?? '—'}</td>
                  <td className="py-3 px-4 text-sm text-muted-foreground font-mono">{c.gstin ?? '—'}</td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(c); setIsNew(false); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => { if (confirm('Delete this MM customer?')) deleteMutation.mutate(c.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
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

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isNew ? 'Add MM Customer' : 'Edit MM Customer'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Name *</Label>
                  <Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone *</Label>
                  <Input value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input value={editing.address ?? ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>GSTIN</Label>
                <Input value={editing.gstin ?? ''} onChange={(e) => setEditing({ ...editing, gstin: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Input value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              {isNew ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ledgerCustomer && (
        <MmCustomerLedgerModal customer={ledgerCustomer} onClose={() => setLedgerCustomer(null)} />
      )}
    </div>
  );
}
