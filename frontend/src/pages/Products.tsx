import { useState } from 'react';
import { Plus, Pencil, Trash2, ArrowUpDown, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { productsApi } from '@/api/products';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, paisaToRupee, rupeeToPaisa } from '@/types';
import type { Product } from '@/types';

const UNITS = ['No', 'Set', 'Piece', 'Photo', 'Album', 'Frame', 'Session', 'Roll', 'Print'];

const EMPTY: Partial<Product> = { name: '', description: '', unit: 'Piece', unitPrice: 0, gstRate: 18, hsnSac: '', isActive: true };

export default function ProductsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<Product> & { priceRupees?: number } | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  // Rearrange mode reorders the FULL active catalog, so it forces search off
  // and inactive-hidden while on — reordering against a filtered subset
  // would leave whatever's hidden with stale sortOrder values, since the
  // reorder call only reassigns sortOrder for the ids it's actually given.
  const [rearranging, setRearranging] = useState(false);

  const { data: products, isLoading } = useQuery({
    queryKey: ['products', search, showInactive],
    queryFn: () => productsApi.list({ search, active: !showInactive }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Product>) => productsApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); setEditing(null); toast({ title: 'Product created', variant: 'success' }); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Product> }) => productsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); setEditing(null); toast({ title: 'Product updated', variant: 'success' }); },
  });

  const deleteMutation = useMutation({
    mutationFn: productsApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); toast({ title: 'Product deactivated' }); },
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) => productsApi.reorder(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
    onError: (err: Error) => toast({ title: 'Could not reorder', description: err.message, variant: 'destructive' }),
  });

  const moveProduct = (index: number, direction: -1 | 1) => {
    if (!products) return;
    const target = index + direction;
    if (target < 0 || target >= products.length) return;
    const ids = products.map((p) => p.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderMutation.mutate(ids);
  };

  const toggleRearranging = () => {
    if (!rearranging) {
      setSearch('');
      setShowInactive(false);
    }
    setRearranging((r) => !r);
  };

  const handleSave = () => {
    if (!editing?.name) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    const priceInPaisa = rupeeToPaisa(editing.priceRupees ?? 0);
    const payload = { ...editing, unitPrice: priceInPaisa };
    delete (payload as any).priceRupees;

    if (isNew) createMutation.mutate(payload);
    else updateMutation.mutate({ id: editing.id!, data: payload });
  };

  const openEdit = (p: Product) => {
    setEditing({ ...p, priceRupees: paisaToRupee(p.unitPrice) });
    setIsNew(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Products & Services</h2>
        <Button onClick={() => { setEditing({ ...EMPTY, priceRupees: 0 }); setIsNew(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Product
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex gap-3 items-center justify-between">
            <div className="flex gap-3 items-center">
              <Input
                placeholder="Search products…"
                className="w-72"
                value={search}
                disabled={rearranging}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={showInactive} disabled={rearranging} onChange={(e) => setShowInactive(e.target.checked)} />
                Show inactive
              </label>
            </div>
            <Button variant={rearranging ? 'default' : 'outline'} size="sm" onClick={toggleRearranging}>
              {rearranging ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />}
              {rearranging ? 'Done' : 'Rearrange'}
            </Button>
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
                {!isLoading && products?.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No products found</td></tr>}
                {products?.map((p, i) => (
                  <tr key={p.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-medium text-sm">{p.name}</p>
                      {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{p.unit}</td>
                    <td className="py-3 px-4 text-sm font-semibold tabular-nums">{formatCurrency(p.unitPrice)}</td>
                    <td className="py-3 px-4 text-sm">{p.gstRate}%</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground font-mono">{p.hsnSac ?? '—'}</td>
                    <td className="py-3 px-4">
                      <Badge variant={p.isActive ? 'success' : 'secondary'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="py-3 px-4">
                      {rearranging ? (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Move up"
                            disabled={i === 0 || reorderMutation.isPending}
                            onClick={() => moveProduct(i, -1)}
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Move down"
                            disabled={i === products.length - 1 || reorderMutation.isPending}
                            onClick={() => moveProduct(i, 1)}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => { if (confirm('Deactivate this product?')) deleteMutation.mutate(p.id); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
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
            <DialogTitle>{isNew ? 'Add Product' : 'Edit Product'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Product Name *</Label>
                <Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Unit</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editing.unit ?? 'Piece'}
                    onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                  >
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>GST %</Label>
                  <Input
                    type="number"
                    value={editing.gstRate ?? 18}
                    min={0}
                    max={100}
                    onChange={(e) => setEditing({ ...editing, gstRate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>HSN / SAC Code</Label>
                <Input
                  placeholder="e.g. 998386 — printed on A4 invoices"
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
                  id="product-is-active"
                  checked={editing.isActive ?? false}
                  onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
                <Label htmlFor="product-is-active" className="cursor-pointer">Active Product</Label>
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
