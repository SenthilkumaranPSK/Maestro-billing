import { useState } from 'react';
import { Plus, Pencil, Trash2, PackagePlus, History, AlertTriangle, ArrowUpDown, ChevronUp, ChevronDown, Check, X, Zap } from 'lucide-react';
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
import { MmBulkRestockModal } from '@/components/inventory/MmBulkRestockModal';

// MM billing module's own product catalog — a fully separate page/table from
// the studio's normal Products page, mirroring its UI exactly.
const UNITS = ['Kgs', 'Grams', 'No', 'Piece', 'Set', 'Box'];

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
  const [showBulkRestock, setShowBulkRestock] = useState(false);
  // Rearrange mode reorders the FULL active catalog, so it forces search off
  // and inactive-hidden while on — see Products.tsx for the same reasoning.
  const [rearranging, setRearranging] = useState(false);

  // Restock — a proper Goods Received entry (qty + supplier/cost/invoice/
  // notes), not just a number bump. Separate dialog from the full Edit form.
  const [restockProduct, setRestockProduct] = useState<MmProduct | null>(null);
  const [restockForm, setRestockForm] = useState({ qty: '', supplierName: '', purchaseCost: '', invoiceRef: '', notes: '' });

  // Quick inline stock adding & batch sheet
  const [quickStockId, setQuickStockId] = useState<number | null>(null);
  const [quickStockQty, setQuickStockQty] = useState('');
  const [showQuickSheet, setShowQuickSheet] = useState(false);
  const [quickSheetEntries, setQuickSheetEntries] = useState<Record<number, string>>({});

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

  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) => mmProductsApi.reorder(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mm-products'] }),
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

  const restockMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof mmProductsApi.restock>[1] }) => mmProductsApi.restock(id, data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['mm-products'] });
      setRestockProduct(null);
      setQuickStockId(null);
      setQuickStockQty('');
      toast({ title: 'Stock updated', description: `${updated.name} stock is now ${updated.stockQty} ${updated.unit}.`, variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not update stock', description: err.message, variant: 'destructive' });
    },
  });

  const bulkRestockMutation = useMutation({
    mutationFn: (data: Parameters<typeof mmProductsApi.bulkRestock>[0]) => mmProductsApi.bulkRestock(data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['mm-products'] });
      setShowQuickSheet(false);
      setQuickSheetEntries({});
      toast({ title: 'Stock updated!', description: `Successfully updated stock for ${updated.length} items.`, variant: 'success' });
    },
    onError: (err: Error) => {
      toast({ title: 'Could not update stock', description: err.message, variant: 'destructive' });
    },
  });

  const submitQuickStock = (productId: number) => {
    const qty = parseFloat(quickStockQty);
    if (!quickStockQty.trim() || isNaN(qty) || qty === 0) {
      toast({ title: 'Enter a valid quantity', variant: 'destructive' });
      return;
    }
    restockMutation.mutate({ id: productId, data: { qty } });
  };

  const handleQuickSheetSave = () => {
    const items = Object.entries(quickSheetEntries)
      .map(([id, q]) => ({ productId: Number(id), qty: parseFloat(q) }))
      .filter((item) => !isNaN(item.qty) && item.qty !== 0);

    if (items.length === 0) {
      toast({ title: 'No stock entered', description: 'Enter quantity to add for at least one item.', variant: 'destructive' });
      return;
    }

    bulkRestockMutation.mutate({ items });
  };

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

  const [onlyLowStock, setOnlyLowStock] = useState(false);

  const isLowStock = (p: MmProduct) => p.reorderLevel > 0 && p.stockQty <= p.reorderLevel;

  const lowStockCount = products?.filter(isLowStock).length ?? 0;
  const displayedProducts = products?.filter((p) => !onlyLowStock || isLowStock(p));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">MM/Products</h2>
          {lowStockCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {lowStockCount} Low Stock
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setQuickSheetEntries({});
              setShowQuickSheet(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
          >
            <Zap className="h-4 w-4 mr-1.5" /> Quick Stock Entry
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowBulkRestock(true)}
            className="border-slate-300 text-slate-700 hover:bg-slate-50 text-xs"
          >
            <PackagePlus className="h-3.5 w-3.5 mr-1 text-slate-500" /> Supplier Inward
          </Button>
          <Button onClick={() => { setEditing({ ...EMPTY, gstRate: defaultGstRate, priceRupees: paisaToRupee(EMPTY.unitPrice ?? 0) }); setIsNew(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add MM Product
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex gap-3 items-center justify-between">
            <div className="flex gap-4 items-center">
              <Input
                placeholder="Search MM products…"
                className="w-72"
                value={search}
                disabled={rearranging}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={showInactive} disabled={rearranging} onChange={(e) => setShowInactive(e.target.checked)} />
                Show inactive
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer font-medium text-amber-700">
                <input type="checkbox" checked={onlyLowStock} disabled={rearranging} onChange={(e) => setOnlyLowStock(e.target.checked)} />
                Low stock only
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
                  {['Product Name', 'Unit', 'Price', 'GST %', 'HSN/SAC', 'Stock', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="stagger-children">
                {isLoading && <tr><td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Loading…</td></tr>}
                {!isLoading && displayedProducts?.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No MM products found</td></tr>}
                {displayedProducts?.map((p, i) => (

                  <tr key={p.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-medium text-sm">{p.name}</p>
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{p.unit}</td>
                    <td className="py-3 px-4 text-sm font-semibold tabular-nums">{formatCurrency(p.unitPrice)}</td>
                    <td className="py-3 px-4 text-sm">{p.gstRate}%</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground font-mono">{p.hsnSac ?? '—'}</td>
                    <td className="py-3 px-4 text-sm">
                      {quickStockId === p.id ? (
                        <div className="space-y-1.5 bg-emerald-50/90 p-2 rounded-lg border border-emerald-300 shadow-sm min-w-[210px]">
                          <div className="text-[11px] font-semibold text-emerald-900 flex justify-between items-center">
                            <span>Add Stock:</span>
                            <span className="text-slate-500 font-normal">Now: {p.stockQty} {p.unit}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-bold text-emerald-800">+</span>
                            <input
                              type="number"
                              autoFocus
                              step="any"
                              placeholder="Qty"
                              value={quickStockQty}
                              onChange={(e) => setQuickStockQty(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitQuickStock(p.id);
                                if (e.key === 'Escape') setQuickStockId(null);
                              }}
                              className="w-16 h-7 text-xs px-2 rounded border border-emerald-300 bg-white font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <span className="text-xs font-medium text-slate-600">{p.unit}</span>
                            <Button
                              size="sm"
                              className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700 text-white ml-auto text-xs"
                              onClick={() => submitQuickStock(p.id)}
                              disabled={restockMutation.isPending}
                            >
                              <Check className="h-3.5 w-3.5 mr-0.5" /> Save
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-slate-400 hover:text-slate-600"
                              onClick={() => setQuickStockId(null)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <div className="flex gap-1 pt-0.5">
                            {['5', '10', '25', '50'].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setQuickStockQty(preset)}
                                className="text-[10px] bg-white border border-emerald-200 hover:bg-emerald-100 text-emerald-800 font-semibold px-1.5 py-0.5 rounded transition-colors"
                              >
                                +{preset}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold tabular-nums ${p.stockQty <= 0 ? 'text-red-600' : 'text-slate-700'}`}>
                              {p.stockQty} {p.unit}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setQuickStockId(p.id);
                                setQuickStockQty('10');
                              }}
                              className="text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-all"
                              title="Quick add stock"
                            >
                              <Plus className="h-3 w-3" /> Add
                            </button>
                          </div>
                          {isLowStock(p) && (
                            <div>
                              <Badge variant="destructive" className="gap-1 text-[10px] py-0 px-1.5">
                                <AlertTriangle className="h-2.5 w-2.5" /> Low Stock
                              </Badge>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
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
                            disabled={i === (products?.length ?? 0) - 1 || reorderMutation.isPending}
                            onClick={() => moveProduct(i, 1)}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
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
                      )}
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
            <DialogTitle>Add Stock — {restockProduct?.name}</DialogTitle>
          </DialogHeader>
          {restockProduct && (
            <div className="space-y-4">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex justify-between items-center text-sm">
                <span className="text-slate-600">Current Stock:</span>
                <span className="font-bold text-slate-800 text-base">{restockProduct.stockQty} {restockProduct.unit}</span>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">Quantity to Add ({restockProduct.unit}) *</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    autoFocus
                    step="any"
                    placeholder="e.g. 50"
                    className="text-lg font-bold h-11"
                    value={restockForm.qty}
                    onChange={(e) => setRestockForm({ ...restockForm, qty: e.target.value })}
                  />
                  <span className="text-sm font-semibold text-slate-500">{restockProduct.unit}</span>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="text-xs text-muted-foreground mr-1">Quick add:</span>
                  {[5, 10, 25, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        const current = parseFloat(restockForm.qty) || 0;
                        setRestockForm({ ...restockForm, qty: String(current + num) });
                      }}
                      className="text-xs bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 font-semibold px-2.5 py-1 rounded transition-colors"
                    >
                      +{num}
                    </button>
                  ))}
                </div>
              </div>

              {restockForm.qty.trim() && !isNaN(parseFloat(restockForm.qty)) && (
                <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-md flex justify-between items-center text-sm text-emerald-900 font-medium">
                  <span>New Total Stock:</span>
                  <span className="font-bold text-base text-emerald-700">
                    {restockProduct.stockQty + parseFloat(restockForm.qty)} {restockProduct.unit}
                  </span>
                </div>
              )}

              {/* Collapsible optional supplier & invoice fields */}
              <details className="text-xs text-slate-500 group border-t border-slate-100 pt-2">
                <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900 py-1 flex items-center justify-between select-none">
                  <span>+ Optional: Supplier / Invoice details</span>
                  <span className="text-[10px] text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="pt-2 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Supplier</Label>
                      <Input
                        placeholder="Optional"
                        value={restockForm.supplierName}
                        onChange={(e) => setRestockForm({ ...restockForm, supplierName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Cost (₹)</Label>
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
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Invoice Ref</Label>
                      <Input
                        placeholder="Optional"
                        value={restockForm.invoiceRef}
                        onChange={(e) => setRestockForm({ ...restockForm, invoiceRef: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Notes</Label>
                      <Input
                        placeholder="Optional"
                        value={restockForm.notes}
                        onChange={(e) => setRestockForm({ ...restockForm, notes: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              </details>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRestockProduct(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              onClick={handleRestock}
              disabled={restockMutation.isPending}
            >
              <Check className="h-4 w-4 mr-1.5" />
              {restockMutation.isPending ? 'Saving…' : 'Add to Stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Multi-Stock Sheet */}
      <Dialog open={showQuickSheet} onOpenChange={setShowQuickSheet}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              Quick Stock Update (Batch)
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">
            Enter the quantity to add for each snack. Leave blank for items with no new stock.
          </p>
          <div className="overflow-y-auto flex-1 -mx-6 px-6 border-y border-slate-100 my-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-slate-500 text-xs">
                  <th className="text-left py-2.5 font-semibold">Product</th>
                  <th className="text-right py-2.5 font-semibold">Current Stock</th>
                  <th className="text-center py-2.5 font-semibold w-52">Add Stock (+)</th>
                  <th className="text-right py-2.5 font-semibold">New Stock</th>
                </tr>
              </thead>
              <tbody>
                {products?.filter(p => p.isActive).map((p) => {
                  const addQty = parseFloat(quickSheetEntries[p.id] || '0') || 0;
                  const newQty = p.stockQty + addQty;
                  return (
                    <tr key={p.id} className="border-b last:border-b-0 hover:bg-slate-50">
                      <td className="py-2.5 font-medium">{p.name}</td>
                      <td className="py-2.5 text-right tabular-nums text-slate-600">
                        {p.stockQty} {p.unit}
                      </td>
                      <td className="py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="font-bold text-emerald-700">+</span>
                          <Input
                            type="number"
                            step="any"
                            placeholder="0"
                            className="w-20 h-8 text-center text-xs font-semibold tabular-nums"
                            value={quickSheetEntries[p.id] || ''}
                            onChange={(e) =>
                              setQuickSheetEntries({ ...quickSheetEntries, [p.id]: e.target.value })
                            }
                          />
                          <span className="text-xs text-muted-foreground mr-1">{p.unit}</span>
                          <div className="flex gap-1">
                            {[10, 25, 50].map((chip) => (
                              <button
                                key={chip}
                                type="button"
                                onClick={() => {
                                  const cur = parseFloat(quickSheetEntries[p.id] || '0') || 0;
                                  setQuickSheetEntries({
                                    ...quickSheetEntries,
                                    [p.id]: String(cur + chip),
                                  });
                                }}
                                className="text-[10px] bg-slate-100 hover:bg-emerald-100 hover:text-emerald-800 text-slate-700 px-1.5 py-0.5 rounded font-semibold transition-colors"
                              >
                                +{chip}
                              </button>
                            ))}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-bold text-slate-800">
                        <span className={addQty > 0 ? 'text-emerald-700' : ''}>
                          {newQty} {p.unit}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowQuickSheet(false)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              onClick={handleQuickSheetSave}
              disabled={bulkRestockMutation.isPending}
            >
              <Check className="h-4 w-4 mr-1.5" />
              {bulkRestockMutation.isPending ? 'Saving...' : 'Save All Stock'}
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

      {showBulkRestock && (
        <MmBulkRestockModal
          open={showBulkRestock}
          onOpenChange={setShowBulkRestock}
          products={products || []}
        />
      )}
    </div>
  );
}
