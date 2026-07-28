import { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { productsApi } from '@/api/products';
import type { BillItemForm } from '@/types';
import { paisaToRupee } from '@/types';
import { computeItemLineTotal } from '@/lib/billMath';

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
  /** Show an editable HSN/SAC column — A4 invoice layout only. */
  showHsnSac?: boolean;
  /**
   * Whether the entered price is the all-in (tax-included) price or the
   * pre-tax base — changes which of Actual Amount / Total this row's own
   * price represents. Without this, the row always displayed as if
   * exclusive regardless of the bill's actual GST mode.
   */
  gstInclusive?: boolean;
  /**
   * Locks the row. Used once a bill has been SAVED: the rest of the form
   * (customer, service details, add/remove row) already locks at that point,
   * but these fields didn't — so qty/price stayed editable while Print, PDF
   * and WhatsApp all render from the saved server response. Editing them
   * moved the on-screen Summary and changed nothing that actually printed,
   * which reads as "the price and qty cannot be changed". Editing a bill
   * after saving is what Bill History → Edit Bill is for.
   */
  disabled?: boolean;
}

export function LineItemRow({ index, item, onChange, onRemove, includeInactive = false, onRequestNewRow, showHsnSac = false, gstInclusive = false, disabled = false }: LineItemRowProps) {
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

  // Integer-paise rounding, matching the backend's BillService.computeItemTotals
  // exactly — otherwise a fractional qty/price can show a row total here that
  // differs by a paisa or two from what the bill actually saves and charges.
  // gstInclusive changes which side of the split the entered price lands on:
  // exclusive treats it as the base (GST added on top); inclusive treats it
  // as the final price (GST backed out of it instead).
  const { subTotalP, gstAmountP, totalP } = computeItemLineTotal(
    { qty: item.qty, unitPrice: item.unitPrice, gstRate: item.gstRate },
    gstInclusive,
  );
  const actualAmount = paisaToRupee(subTotalP);
  const gstAmt = paisaToRupee(gstAmountP);
  const totalWithGst = paisaToRupee(totalP);

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
              // the product link, so the old price (and HSN/SAC) must not
              // linger silently.
              onChange({ ...item, productName: e.target.value, productId: undefined, unitPrice: 0, hsnSac: undefined });
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Product name…"
            disabled={disabled}
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
                      hsnSac: p.hsnSac,
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

      {/* Qty — arrow buttons step by whole units; Enter appends the next row.
          min must sit on the same 1-unit lattice as step, or the browser's
          spin buttons snap to min + n*step (0.01, 1.01, 2.01…) instead of
          whole numbers the moment the value doesn't already land on it. */}
      <td className="py-2 px-2 w-20">
        <Input
          type="number"
          className="h-8 text-sm text-right"
          value={item.qty}
          min={1}
          step={1}
          disabled={disabled}
          onChange={(e) => onChange({ ...item, qty: parseFloat(e.target.value) || 0 })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onRequestNewRow) {
              e.preventDefault();
              onRequestNewRow();
            }
          }}
        />
      </td>

      {/* Price — defaults from the selected product but stays editable, e.g.
          for a negotiated/discounted price on a single bill. Arrow buttons
          step by whole rupees; typing still accepts paisa (e.g. 499.50). */}
      <td className="py-2 px-2 w-28">
        <Input
          type="number"
          className="h-8 text-sm text-right"
          value={item.unitPrice}
          min={0}
          step={1}
          disabled={disabled}
          onChange={(e) => onChange({ ...item, unitPrice: parseFloat(e.target.value) || 0 })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onRequestNewRow) {
              e.preventDefault();
              onRequestNewRow();
            }
          }}
        />
      </td>

      {/* GST % */}
      <td className="py-2 px-2 w-20 text-right text-sm text-muted-foreground pr-4 font-medium">
        {item.gstRate}%
      </td>

      {/* HSN/SAC — A4 invoice layout only */}
      {showHsnSac && (
        <td className="py-2 px-2 w-24">
          <Input
            className="h-8 text-sm font-mono"
            placeholder="HSN/SAC"
            value={item.hsnSac ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ ...item, hsnSac: e.target.value })}
          />
        </td>
      )}

      {/* Amount */}
      <td className="py-2 px-2 w-28 text-right">
        <div>
          <p className="text-sm font-medium tabular-nums">₹{totalWithGst.toFixed(2)}</p>
          {item.gstRate > 0 && (
            <p className="text-xs text-muted-foreground">₹{actualAmount.toFixed(2)} + ₹{gstAmt.toFixed(2)} GST</p>
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
