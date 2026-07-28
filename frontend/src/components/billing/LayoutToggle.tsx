import { Receipt, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Bill } from '@/types';

export type BillLayout = 'thermal' | 'a4';

/**
 * Best-effort guess at which layout a saved bill was actually created in.
 *
 * There is no stored "layout" field on Bill — both templates render off the
 * same data, and the toggle is purely a print-time choice that defaults to
 * 'thermal' on every fresh render (History rows, BillDetailModal). For a bill
 * that was genuinely created in A4 mode, that meant Print/Download from Bill
 * History silently gave the thermal receipt unless the operator remembered to
 * click A4 first — reported as "downloading a PDF only gives the thermal
 * preview, even for an A4 bill".
 *
 * serviceDescription/serviceFrom/serviceTo/serviceDates are A4-only fields
 * (see BillingPage's Service Details section, shown only when layout ===
 * 'a4') — any of them being set is strong evidence the bill was an A4
 * "Service Bill" invoice. This only changes the toggle's INITIAL value; it
 * stays fully editable, so a wrong guess costs one click, not a wrong
 * download.
 */
export function guessBillLayout(
  bill: Pick<Bill, 'serviceDescription' | 'serviceFrom' | 'serviceTo' | 'serviceDates'>,
): BillLayout {
  return bill.serviceDescription || bill.serviceFrom || bill.serviceTo || bill.serviceDates?.length ? 'a4' : 'thermal';
}

interface LayoutToggleProps {
  value: BillLayout;
  onChange: (value: BillLayout) => void;
  /** Compact icon-only mode for tight spaces like a table row. */
  compact?: boolean;
}

/**
 * Thermal-receipt vs A4-invoice choice, reused wherever a bill can be
 * printed / downloaded / sent — BillingPage, BillDetailModal, History rows.
 */
export function LayoutToggle({ value, onChange, compact = false }: LayoutToggleProps) {
  const base = 'inline-flex items-center gap-1 rounded-md border font-medium transition-colors';
  const size = compact ? 'h-6 px-1.5 text-[10px]' : 'h-7 px-2.5 text-xs';

  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Print layout">
      <button
        type="button"
        title="Thermal receipt (58/80mm)"
        onClick={() => onChange('thermal')}
        className={cn(
          base,
          size,
          value === 'thermal' ? 'bg-white shadow-sm text-brand-700' : 'text-slate-500 hover:text-slate-700',
          'border-transparent',
        )}
      >
        <Receipt className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        {!compact && 'Thermal'}
      </button>
      <button
        type="button"
        title="A4 invoice"
        onClick={() => onChange('a4')}
        className={cn(
          base,
          size,
          value === 'a4' ? 'bg-white shadow-sm text-brand-700' : 'text-slate-500 hover:text-slate-700',
          'border-transparent',
        )}
      >
        <FileText className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        {!compact && 'A4'}
      </button>
    </div>
  );
}
