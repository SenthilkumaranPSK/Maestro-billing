import { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { productsApi } from '@/api/products';
import type { BillItemForm } from '@/types';
import { paisaToRupee } from '@/types';

interface LineItemRowProps {
  index: number;
  item: BillItemForm;
  onChange: (updated: BillItemForm) => void;
  onRemove: () => void;
  /**
   * When editing a saved bill, we want the product picker to include products
   * that have been deactivated since the bill was created (so the user can
   * still find and reuse the same item). New bills keep the default of false
   * so inactive products don't pollute the autocomplete.
   */
  includeInactive?: boolean;
  /** Pressing Enter in the price field asks the parent to append a new row. */
  onRequestNewRow?: () => void;
}

export function LineItemRow({ index, item, onChange, onRemove, includeInactive = false, onRequestNewRow }: LineItemRowProps) {
  const [productSearch, setProductSearch] = useState(item.productName);
  const [showDropdown, setShowDropdown] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus the product field when an empty row mounts (i.e. right after
  // "Add Item"), so the operator can keep typing without reaching for the mouse.
  useEffect(() => {
    if (!item.productName) nameInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: products } = useQuery({
    queryKey: ['products', 'search', productSearch, includeInactive],
    queryFn: () =>
      productsApi.list({
        search: productSearch || undefined,
        // The backend only widens beyond active products for the literal
        // string 'false' — omitting the param means active-only.
        active: includeInactive ? false : true,
      }),
    enabled: showDropdown,
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const lineTotal = item.qty * item.unitPrice;
  const gstAmt = (lineTotal * item.gstRate) / 100;
  const totalWithGst = lineTotal + gstAmt;

  return (
    <tr className="border-b group animate-in fade-in slide-in-from-top-1 duration-200">
      <td className="py-2 px-2 text-center text-sm text-muted-foreground w-10">{index + 1}</td>

      {/* Product Name */}
      <td className="py-2 px-2" ref={ref}>
        <div className="relative">
          <Input
            ref={nameInputRef}
            className="h-8 text-sm"
            value={productSearch}
            onChange={(e) => {
              setProductSearch(e.target.value);
              // Price is fixed by the selected product; typing a name breaks
              // the product link, so the old price must not linger silently.
              onChange({ ...item, productName: e.target.value, productId: undefined, unitPrice: 0 });
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Product name…"
          />
          {showDropdown && (
            <div className="absolute z-50 w-full min-w-[250px] mt-1 bg-white border rounded-lg shadow-soft-md overflow-y-auto max-h-60 animate-in fade-in-0 zoom-in-95 duration-150">
              {products?.map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm border-b last:border-b-0"
                  onClick={() => {
                    setProductSearch(p.name);
                    onChange({
                      ...item,
                      productId: p.id,
                      productName: p.name,
                      unit: p.unit,
                      unitPrice: paisaToRupee(p.unitPrice),
                      gstRate: p.gstRate,
                    });
                    setShowDropdown(false);
                  }}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground ml-2">₹{paisaToRupee(p.unitPrice).toFixed(2)}</span>
                </button>
              ))}
              {products?.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center">No products found</div>
              )}
            </div>
          )}
        </div>
      </td>

      {/* Qty — Enter here appends the next row since price is no longer editable */}
      <td className="py-2 px-2 w-20">
        <Input
          type="number"
          className="h-8 text-sm text-right"
          value={item.qty}
          min={0.01}
          step={0.01}
          onChange={(e) => onChange({ ...item, qty: parseFloat(e.target.value) || 0 })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onRequestNewRow) {
              e.preventDefault();
              onRequestNewRow();
            }
          }}
        />
      </td>

      {/* Price — fixed by the selected product, shown read-only */}
      <td className="py-2 px-2 w-28 text-right text-sm tabular-nums font-medium">
        {item.unitPrice > 0 ? `₹${item.unitPrice.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
      </td>

      {/* GST % */}
      <td className="py-2 px-2 w-20 text-right text-sm text-muted-foreground pr-4 font-medium">
        {item.gstRate}%
      </td>

      {/* Amount */}
      <td className="py-2 px-2 w-28 text-right">
        <div>
          <p className="text-sm font-medium tabular-nums">₹{totalWithGst.toFixed(2)}</p>
          {item.gstRate > 0 && (
            <p className="text-xs text-muted-foreground">₹{lineTotal.toFixed(2)} + GST</p>
          )}
        </div>
      </td>

      {/* Remove */}
      <td className="py-2 px-2 w-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}
