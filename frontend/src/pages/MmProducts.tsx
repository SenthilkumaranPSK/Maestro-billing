import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { mmProductsApi } from '@/api/mmProducts';
import { settingsApi } from '@/api/settings';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, paisaToRupee, rupeeToPaisa } from '@/types';
import type { MmProduct } from '@/types';

// MM billing module's own product catalog — a fully separate page/table from
// the studio's normal Products page, mirroring its UI exactly.
const UNITS = ['Kgs', 'Grams', 'no', 'piece', 'set', 'box'];

const EMPTY: Partial<MmProduct> = { name: '', unit: 'Kgs', unitPrice: 0, gstRate: 5, hsnSac: '210690', isActive: true };

export default function MmProductsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<MmProduct> & { priceRupees?: number } | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data: products, isLoading } = useQuery({
    queryKey: ['mm-products', search, showInactive],
    queryFn: () => mmProductsApi.list({ search, active: !showInactive }),
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
  // Editable on the MM Settings page — falls back to the seeded 5% until
  // that setting exists.
  const defaultGstRate = Number(settings?.mm?.mm_default_gst_rate ?? 5);

  const createMutation = useMutation({
    mutationFn: (data: Partial<MmProduct>) => mmProductsApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mm-products'] }); setEditing(null); toast({ title: 'MM product created', variant: 'success' }); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MmProduct> }) => mmProductsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mm-products'] }); setEditing(null); toast({ title: 'MM product updated', variant: 'success' }); },
  });

  const deleteMutation = useMutation({
    mutationFn: mmProductsApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mm-products'] }); toast({ title: 'MM product deactivated' }); },
  });

  const handleSave = () => {
    if (!editing?.name) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    const priceInPaisa = rupeeToPaisa(editing.priceRupees ?? 0);
    const payload = { ...editing, unitPrice: priceInPaisa };
    delete (payload as any).priceRupees;

    if (isNew) createMutation.mutate(payload);
    else updateMutation.mutate({ id: editing.id!, data: payload });
  };

  const openEdit = (p: MmProduct) => {
    setEditing({ ...p, priceRupees: paisaToRupee(p.unitPrice) });
    setIsNew(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">MM/Products</h2>
        <Button onClick={() => { setEditing({ ...EMPTY, gstRate: defaultGstRate, priceRupees: paisaToRupee(EMPTY.unitPrice ?? 0) }); setIsNew(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add MM Product
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex gap-3 items-center">
            <Input
              placeholder="Search MM products…"
              className="w-72"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1">
            <table className="w-full bg-white">
              <thead>
                <tr className="border-b bg-slate-50/80">
                  {['Product Name', 'Unit', 'Price', 'GST %', 'HSN/SAC', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="stagger-children">
                {isLoading && <tr><td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Loading…</td></tr>}
                {!isLoading && products?.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No MM products found</td></tr>}
                {products?.map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-medium text-sm">{p.name}</p>
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{p.unit}</td>
                    <td className="py-3 px-4 text-sm font-semibold tabular-nums">{formatCurrency(p.unitPrice)}</td>
                    <td className="py-3 px-4 text-sm">{p.gstRate}%</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground font-mono">{p.hsnSac ?? '—'}</td>
                    <td className="py-3 px-4">
                      <Badge variant={p.isActive ? 'success' : 'secondary'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => { if (confirm('Deactivate this MM product?')) deleteMutation.mutate(p.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isNew ? 'Add MM Product' : 'Edit MM Product'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Product Name *</Label>
                <Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Unit</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editing.unit ?? 'Kgs'}
                    onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                  >
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>GST %</Label>
                  <Input
                    type="number"
                    value={editing.gstRate ?? 5}
                    min={0}
                    max={100}
                    onChange={(e) => setEditing({ ...editing, gstRate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>HSN / SAC Code</Label>
                <Input
                  placeholder="e.g. 210690"
                  value={editing.hsnSac ?? ''}
                  onChange={(e) => setEditing({ ...editing, hsnSac: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Price (₹)</Label>
                <Input
                  type="number"
                  value={editing.priceRupees ?? 0}
                  min={0}
                  step={0.01}
                  onChange={(e) => setEditing({ ...editing, priceRupees: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-center gap-2 pt-1.5">
                <input
                  type="checkbox"
                  id="mm-product-is-active"
                  checked={editing.isActive ?? false}
                  onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
                <Label htmlFor="mm-product-is-active" className="cursor-pointer">Active Product</Label>
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
    </div>
  );
}
