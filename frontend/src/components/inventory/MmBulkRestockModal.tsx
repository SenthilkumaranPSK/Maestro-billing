import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mmProductsApi } from '@/api/mmProducts';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, rupeeToPaisa } from '@/types';
import type { MmProduct } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PackagePlus, Plus, Trash2, Building2, Receipt, AlertCircle } from 'lucide-react';

interface BulkRestockRow {
  productId: number;
  qty: string;
  purchaseCostRupees: string;
}

interface MmBulkRestockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: MmProduct[];
}

export function MmBulkRestockModal({
  open,
  onOpenChange,
  products,
}: MmBulkRestockModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [supplierName, setSupplierName] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [notes, setNotes] = useState('');

  const activeProducts = products.filter((p) => p.isActive);

  const [rows, setRows] = useState<BulkRestockRow[]>([
    {
      productId: activeProducts[0]?.id || 0,
      qty: '',
      purchaseCostRupees: '',
    },
  ]);

  const addRow = () => {
    // Pick the first unused product if possible
    const usedIds = new Set(rows.map((r) => r.productId));
    const nextProd = activeProducts.find((p) => !usedIds.has(p.id)) || activeProducts[0];
    if (!nextProd) return;
    setRows([...rows, { productId: nextProd.id, qty: '', purchaseCostRupees: '' }]);
  };

  const removeRow = (index: number) => {
    if (rows.length === 1) return;
    setRows(rows.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof BulkRestockRow, value: any) => {
    setRows(
      rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  };

  const bulkMutation = useMutation({
    mutationFn: mmProductsApi.bulkRestock,
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['mm-products'] });
      toast({
        title: 'Inward Restock Recorded!',
        description: `Successfully restocked ${updated.length} product(s).`,
        variant: 'success',
      });
      onOpenChange(false);
      // Reset form
      setSupplierName('');
      setInvoiceRef('');
      setNotes('');
      setRows([{ productId: activeProducts[0]?.id || 0, qty: '', purchaseCostRupees: '' }]);
    },
    onError: (err: Error) => {
      toast({
        title: 'Bulk Restock Failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const validItems: Array<{ productId: number; qty: number; purchaseCost?: number }> = [];

    for (const r of rows) {
      if (!r.productId) {
        toast({ title: 'Please select a product for all rows', variant: 'destructive' });
        return;
      }
      const qtyNum = parseFloat(r.qty);
      if (isNaN(qtyNum) || qtyNum <= 0) {
        toast({ title: 'Enter a valid positive quantity for all items', variant: 'destructive' });
        return;
      }
      const costPaisa = r.purchaseCostRupees.trim()
        ? rupeeToPaisa(parseFloat(r.purchaseCostRupees))
        : undefined;

      validItems.push({
        productId: r.productId,
        qty: qtyNum,
        purchaseCost: costPaisa,
      });
    }

    if (validItems.length === 0) {
      toast({ title: 'Add at least one item to restock', variant: 'destructive' });
      return;
    }

    bulkMutation.mutate({
      items: validItems,
      supplierName: supplierName.trim() || undefined,
      invoiceRef: invoiceRef.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  const totalCost = rows.reduce((sum, r) => {
    const cost = parseFloat(r.purchaseCostRupees);
    return sum + (isNaN(cost) ? 0 : cost);
  }, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-100">
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-brand-600" />
            MM Bulk Inward Purchase Restock
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Receive and record multiple products from a supplier delivery into inventory in a single batch.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 space-y-4">
          {/* Supplier & Delivery Info */}
          <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mb-1">
                <Building2 className="w-3.5 h-3.5 text-slate-500" /> Supplier / Vendor
              </Label>
              <Input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="e.g. Royal Mills Pvt Ltd"
                className="h-8 text-xs bg-white"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1 mb-1">
                <Receipt className="w-3.5 h-3.5 text-slate-500" /> Supplier Bill / DC Ref
              </Label>
              <Input
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                placeholder="e.g. INV-2026-9481"
                className="h-8 text-xs bg-white"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-slate-700 block mb-1">
                Shipment Notes
              </Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Batch #44 / Verified count"
                className="h-8 text-xs bg-white"
              />
            </div>
          </div>

          {/* Items Inward Grid */}
          <div className="flex-1 min-h-0 flex flex-col border rounded-lg overflow-hidden">
            <div className="bg-slate-100 px-3 py-2 border-b text-[11px] font-semibold uppercase tracking-wider text-slate-600 grid grid-cols-12 gap-3 items-center">
              <span className="col-span-5">Product Name & Unit</span>
              <span className="col-span-2 text-center">Stock On Hand</span>
              <span className="col-span-2">Added Qty (+)</span>
              <span className="col-span-2">Total Cost (₹)</span>
              <span className="col-span-1 text-center">Action</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 space-y-2">
              {rows.map((row, index) => {
                const prod = activeProducts.find((p) => p.id === row.productId);
                return (
                  <div key={index} className="grid grid-cols-12 gap-3 items-center pt-2 first:pt-0">
                    <div className="col-span-5">
                      <select
                        value={row.productId}
                        onChange={(e) => updateRow(index, 'productId', Number(e.target.value))}
                        className="w-full h-8 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-brand-500"
                      >
                        {activeProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.unit})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-span-2 text-center text-xs font-mono text-slate-600 bg-slate-50 py-1.5 rounded border border-slate-200">
                      {prod ? `${prod.stockQty} ${prod.unit}` : '—'}
                    </div>

                    <div className="col-span-2">
                      <Input
                        type="number"
                        step="any"
                        value={row.qty}
                        onChange={(e) => updateRow(index, 'qty', e.target.value)}
                        placeholder={`Qty (${prod?.unit || ''})`}
                        className="h-8 text-xs font-semibold"
                        autoFocus={index === rows.length - 1}
                      />
                    </div>

                    <div className="col-span-2">
                      <Input
                        type="number"
                        step="any"
                        value={row.purchaseCostRupees}
                        onChange={(e) => updateRow(index, 'purchaseCostRupees', e.target.value)}
                        placeholder="₹ Cost (opt)"
                        className="h-8 text-xs font-mono"
                      />
                    </div>

                    <div className="col-span-1 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(index)}
                        disabled={rows.length === 1}
                        className="h-7 w-7 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              className="h-8 text-xs gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Product Line
            </Button>

            {totalCost > 0 && (
              <span className="text-xs font-semibold text-slate-700">
                Total Inward Cost: <span className="font-mono text-brand-700">₹{totalCost.toFixed(2)}</span>
              </span>
            )}
          </div>

          <DialogFooter className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={bulkMutation.isPending}
              className="bg-brand-600 hover:bg-brand-700 text-white gap-1.5"
            >
              <PackagePlus className="h-4 w-4" />
              {bulkMutation.isPending ? 'Processing Restock…' : `Confirm Restock (${rows.length} Items)`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
