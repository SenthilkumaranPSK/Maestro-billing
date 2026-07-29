import { useState } from 'react';
import { Plus, Pencil, Trash2, PackagePlus, History, AlertTriangle } from 'lucide-react';
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
import type { MmProduct, MmStockMovement } from '@/types';
import { formatDate } from '@/lib/utils';

// MM billing module's own product catalog — a fully separate page/table from
// the studio's normal Products page, mirroring its UI exactly.
const UNITS = ['Kgs', 'Grams', 'no', 'piece', 'set', 'box'];

const EMPTY: Partial<MmProduct> = { name: '', unit: 'Kgs', unitPrice: 0, gstRate: 5, hsnSac: '210690', stockQty: 0, reorderLevel: 0, isActive: true };

const MOVEMENT_LABELS: Record<MmStockMovement['type'], string> = {
  SALE: 'Sale',
  RESTORE: 'Restored',
  PURCHASE: 'Purchase',
  CORRECTION: 'Correction',
};
const MOVEMENT_BADGE_VARIANT: Record<MmStockMovement['type'], 'success' | 'info' | 'destructive' | 'warning'> = {
  SALE: 'destructive',
  RESTORE: 'info',
  PURCHASE: 'success',
  CORRECTION: 'warning',
};

export default function MmProductsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<MmProduct> & { priceRupees?: number } | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  // Restock — a proper Goods Received entry (qty + supplier/cost/invoice/
  // notes), not just a number bump. Separate dialog from the full Edit form.
  const [restockProduct, setRestockProduct] = useState<MmProduct | null>(null);
  const [restockForm, setRestockForm] = useState({ qty: '', supplierName: '', purchaseCost: '', invoiceRef: '', notes: '' });

  // Stock Ledger — full movement history for one product.
  const [ledgerProduct, setLedgerProduct] = useState<MmProduct | null>(null);

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

  const { data: movements, isLoading: movementsLoading } = useQuery({
    queryKey: ['mm-products', ledgerProduct?.id, 'stock-movements'],
    queryFn: () => mmProductsApi.getStockMovements(ledgerProduct!.id),
    enabled: !!ledgerProduct,
  });

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

  const restockMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof mmProductsApi.restock>[1] }) => mmProductsApi.restock(id, data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['mm-products'] });
      setRestockProduct(null);
      toast({ title: 'Stock received', description: `${updated.name} is now ${updated.stockQty} ${updated.unit}.`, variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not record restock', description: err.message, variant: 'destructive' });
    },
  });

  const openRestock = (p: MmProduct) => {
    setRestockProduct(p);
    setRestockForm({ qty: '', supplierName: '', purchaseCost: '', invoiceRef: '', notes: '' });
  };

  const handleRestock = () => {
    if (!restockProduct) return;
    const qty = parseFloat(restockForm.qty);
    if (!restockForm.qty.trim() || isNaN(qty) || qty === 0) {
      toast({ title: 'Enter a quantity received', variant: 'destructive' });
      return;
    }
    restockMutation.mutate({
      id: restockProduct.id,
      data: {
        qty,
        supplierName: restockForm.supplierName.trim() || undefined,
        purchaseCost: restockForm.purchaseCost.trim() ? rupeeToPaisa(parseFloat(restockForm.purchaseCost)) : undefined,
        invoiceRef: restockForm.invoiceRef.trim() || undefined,
        notes: restockForm.notes.trim() || undefined,
      },
    });
  };

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

  const isLowStock = (p: MmProduct) => p.reorderLevel > 0 && p.stockQty <= p.reorderLevel;

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
                  {['Product Name', 'Unit', 'Price', 'GST %', 'HSN/SAC', 'Stock', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="stagger-children">
                {isLoading && <tr><td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Loading…</td></tr>}
                {!isLoading && products?.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No MM products found</td></tr>}
                {products?.map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-medium text-sm">{p.name}</p>
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{p.unit}</td>
                    <td className="py-3 px-4 text-sm font-semibold tabular-nums">{formatCurrency(p.unitPrice)}</td>
                    <td className="py-3 px-4 text-sm">{p.gstRate}%</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground font-mono">{p.hsnSac ?? '—'}</td>
                    <td className="py-3 px-4 text-sm">
                      <div>
                        <span className={`font-semibold tabular-nums ${p.stockQty <= 0 ? 'text-red-600' : 'text-slate-700'}`}>
                          {p.stockQty} {p.unit}
                        </span>
                        {isLowStock(p) && (
                          <div className="mt-0.5">
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" /> Low Stock
                            </Badge>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={p.isActive ? 'success' : 'secondary'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:text-emerald-700" title="Restock" onClick={() => openRestock(p)}>
                          <PackagePlus className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Stock history" onClick={() => setLedgerProduct(p)}>
                          <History className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => openEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          title="Deactivate"
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

      {/* Add / Edit MM Product */}
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
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div className="space-y-1.5">
                  <Label>Stock Qty ({editing.unit ?? 'Kgs'})</Label>
                  <Input
                    type="number"
                    value={editing.stockQty ?? 0}
                    step={0.01}
                    onChange={(e) => setEditing({ ...editing, stockQty: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Reorder Level ({editing.unit ?? 'Kgs'})</Label>
                  <Input
                    type="number"
                    value={editing.reorderLevel ?? 0}
                    min={0}
                    step={0.01}
                    onChange={(e) => setEditing({ ...editing, reorderLevel: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-1.5">
                Use the <PackagePlus className="h-3 w-3 inline -mt-0.5" /> Restock action on the product row when new stock arrives — edit Stock Qty here only to correct a wrong count.
                Reorder Level flags this product as low stock once it reaches that number (0 = no alert).
              </p>
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

      {/* Restock — Goods Received entry */}
      <Dialog open={!!restockProduct} onOpenChange={(o) => !o && setRestockProduct(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Restock — {restockProduct?.name}</DialogTitle>
          </DialogHeader>
          {restockProduct && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Current stock: <span className="font-semibold text-slate-700">{restockProduct.stockQty} {restockProduct.unit}</span>
              </p>
              <div className="space-y-1.5">
                <Label>Quantity Received ({restockProduct.unit}) *</Label>
                <Input
                  type="number"
                  autoFocus
                  step={0.01}
                  placeholder="e.g. 100"
                  value={restockForm.qty}
                  onChange={(e) => setRestockForm({ ...restockForm, qty: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Supplier</Label>
                  <Input
                    placeholder="Optional"
                    value={restockForm.supplierName}
                    onChange={(e) => setRestockForm({ ...restockForm, supplierName: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Purchase Cost (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="Optional"
                    value={restockForm.purchaseCost}
                    onChange={(e) => setRestockForm({ ...restockForm, purchaseCost: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Invoice / Reference No.</Label>
                <Input
                  placeholder="Optional"
                  value={restockForm.invoiceRef}
                  onChange={(e) => setRestockForm({ ...restockForm, invoiceRef: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Input
                  placeholder="Optional"
                  value={restockForm.notes}
                  onChange={(e) => setRestockForm({ ...restockForm, notes: e.target.value })}
                />
              </div>
              {restockForm.qty.trim() && !isNaN(parseFloat(restockForm.qty)) && (
                <p className="text-sm">
                  New stock will be{' '}
                  <span className="font-semibold text-brand-700">
                    {restockProduct.stockQty + parseFloat(restockForm.qty)} {restockProduct.unit}
                  </span>
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestockProduct(null)}>Cancel</Button>
            <Button onClick={handleRestock} disabled={restockMutation.isPending}>
              <PackagePlus className="h-4 w-4 mr-1.5" />
              {restockMutation.isPending ? 'Recording…' : 'Record Restock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Ledger — full movement history */}
      <Dialog open={!!ledgerProduct} onOpenChange={(o) => !o && setLedgerProduct(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Stock History — {ledgerProduct?.name}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            {movementsLoading && <p className="text-center text-muted-foreground py-8 text-sm">Loading…</p>}
            {!movementsLoading && (movements?.length ?? 0) === 0 && (
              <p className="text-center text-muted-foreground py-8 text-sm">No stock movements yet.</p>
            )}
            {!movementsLoading && (movements?.length ?? 0) > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 font-medium">Date</th>
                    <th className="text-left py-2 font-medium">Type</th>
                    <th className="text-right py-2 font-medium">Qty Change</th>
                    <th className="text-right py-2 font-medium">Balance</th>
                    <th className="text-left py-2 font-medium pl-3">Reference</th>
                  </tr>
                </thead>
                <tbody className="stagger-children">
                  {movements!.map((m) => (
                    <tr key={m.id} className="border-b last:border-b-0">
                      <td className="py-2 text-slate-600 whitespace-nowrap">{formatDate(m.createdAt)}</td>
                      <td className="py-2">
                        <Badge variant={MOVEMENT_BADGE_VARIANT[m.type]}>{MOVEMENT_LABELS[m.type]}</Badge>
                      </td>
                      <td className={`py-2 text-right font-semibold tabular-nums ${m.qtyChange < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                        {m.qtyChange > 0 ? '+' : ''}{m.qtyChange}
                      </td>
                      <td className="py-2 text-right tabular-nums">{m.balanceAfter}</td>
                      <td className="py-2 pl-3 text-slate-600">
                        {m.bill?.billNumber && <span>Bill {m.bill.billNumber}</span>}
                        {m.type === 'PURCHASE' && (
                          <span>
                            {m.supplierName ?? '—'}
                            {m.invoiceRef ? ` · ${m.invoiceRef}` : ''}
                            {m.purchaseCost ? ` · ${formatCurrency(m.purchaseCost)}` : ''}
                          </span>
                        )}
                        {m.type === 'CORRECTION' && !m.bill?.billNumber && (m.notes ?? 'Manual correction')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLedgerProduct(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
