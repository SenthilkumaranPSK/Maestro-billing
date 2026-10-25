import { useState, useRef, useEffect } from 'react';
import { User, Phone, UserCheck, FileText, MapPin, Sparkles, History, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { customersApi } from '@/api/customers';
import { mmCustomersApi } from '@/api/mmCustomers';
import { formatDate } from '@/lib/utils';
import { formatCurrency } from '@/types';

export interface CustomerInfo {
  id?: number;
  name: string;
  phone: string;
  gstin?: string;
  // A4-only (see showAddress below) — the thermal receipt has no room for it
  // and never prints it, so there is no reason to ask for it there.
  address?: string;
}

interface CustomerBarProps {
  value: CustomerInfo;
  onChange: (info: CustomerInfo) => void;
  disabled?: boolean;
  // Shows the address input. Only meaningful for the A4 "Service Bill"
  // invoice, which is the only layout that prints a customer address
  // (lib/a4invoice.ts's "Service Bill To" block) — the thermal receipt's
  // layout has no field for it, so asking for it there would just be a
  // field nobody's answer ever shows up on.
  showAddress?: boolean;
  isMm?: boolean;
}

export function CustomerBar({ value, onChange, disabled, showAddress, isMm }: CustomerBarProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showInsightsPopover, setShowInsightsPopover] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const barRef = useRef<HTMLDivElement>(null);

  const activeSearch = searchTerm.length >= 2 ? searchTerm : '';

  const { data: suggestions } = useQuery({
    queryKey: [isMm ? 'mm-customers' : 'customers', 'suggest', activeSearch],
    queryFn: () =>
      isMm
        ? mmCustomersApi.list({ search: activeSearch, limit: 6 })
        : customersApi.list({ search: activeSearch, limit: 6 }),
    enabled: !!activeSearch,
  });

  const { data: insights } = useQuery({
    queryKey: [isMm ? 'mm-customer-insights' : 'customer-insights', value.id],
    queryFn: () =>
      isMm
        ? mmCustomersApi.getInsights(value.id!)
        : customersApi.getInsights(value.id!),
    enabled: !!value.id,
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setShowInsightsPopover(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleNameChange = (name: string) => {
    setSearchTerm(name);
    onChange({ ...value, name, id: undefined });
    setShowSuggestions(true);
  };

  const handlePhoneChange = (phone: string) => {
    // Phone field does not drive name-based autocomplete; only update value
    onChange({ ...value, phone, id: undefined });
  };

  const handleSelect = (c: { id: number; name: string; phone: string; gstin?: string; address?: string }) => {
    onChange({ id: c.id, name: c.name, phone: c.phone, gstin: c.gstin ?? '', address: c.address ?? '' });
    setSearchTerm('');
    setShowSuggestions(false);
  };

  const isLinked = !!value.id;

  return (
    <div className="relative space-y-1.5" ref={barRef}>
      {/* flex-wrap so this degrades to Name on its own row, then Phone+GSTIN
          below, instead of squeezing Name down to near-nothing — the three
          fixed-width fields (Phone/GSTIN) otherwise "win" against Name's
          flex-1 in a narrow container (e.g. a sidebar-width form column).
          Nothing wraps at the widths this already ran at, so no visual
          change there. */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Name */}
        <div className="relative flex-1 min-w-[160px]">
          <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          {isLinked && (
            <UserCheck className="absolute right-3 top-2.5 h-4 w-4 text-brand-600 pointer-events-none" />
          )}
          <Input
            className={`pl-9 ${isLinked ? 'pr-9 border-brand-400 bg-brand-50/50' : ''}`}
            placeholder="Customer name…"
            value={value.name}
            onChange={(e) => handleNameChange(e.target.value)}
            onFocus={() => value.name.length >= 2 && setShowSuggestions(true)}
            disabled={disabled}
            autoComplete="off"
          />
        </div>

        {/* Phone */}
        <div className="relative w-36">
          <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Phone"
            value={value.phone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            disabled={disabled}
            autoComplete="off"
          />
        </div>

        {/* GSTIN (optional) */}
        <div className="relative w-44">
          <FileText className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 text-xs"
            placeholder="GSTIN (optional)"
            value={value.gstin ?? ''}
            onChange={(e) => onChange({ ...value, gstin: e.target.value.toUpperCase() })}
            disabled={disabled}
            autoComplete="off"
            maxLength={15}
          />
        </div>
      </div>

      {/* Smart Customer Insights Badge */}
      {isLinked && insights && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowInsightsPopover(!showInsightsPopover)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1 rounded-md bg-amber-50/80 hover:bg-amber-100/90 border border-amber-200/80 text-[11px] text-amber-900 transition-colors shadow-xs"
          >
            <div className="flex items-center gap-2 min-w-0 truncate">
              <span className="flex items-center gap-1 font-semibold text-amber-800">
                <Sparkles className="w-3 h-3 text-amber-600 shrink-0" />
                {insights.visitCount > 1 ? `Visit #${insights.visitCount + 1}` : '1st Repeat Visit'}
              </span>
              <span className="text-amber-400">·</span>
              <span className="font-medium text-amber-900">
                Total Spend: {formatCurrency(insights.lifetimeSpend)}
              </span>
              {insights.lastBillDate && (
                <>
                  <span className="text-amber-400">·</span>
                  <span className="text-amber-700 truncate">
                    Last: {formatDate(insights.lastBillDate)} ({formatCurrency(insights.lastBillAmount || 0)})
                  </span>
                </>
              )}
            </div>
            <span className="flex items-center gap-0.5 text-amber-700 text-[10px] font-medium shrink-0">
              <History className="w-3 h-3" />
              History
              {showInsightsPopover ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </span>
          </button>

          {/* Recent Bills Dropdown Popover */}
          {showInsightsPopover && (
            <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-amber-200 rounded-lg shadow-soft-lg p-2.5 animate-in fade-in-0 zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-100 text-[11px]">
                <span className="font-semibold text-slate-800">
                  {value.name}'s Previous Bills ({insights.visitCount})
                </span>
                <span className="text-slate-500 font-mono">
                  Total: {formatCurrency(insights.lifetimeSpend)}
                </span>
              </div>
              {insights.recentBills.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-1 text-center">No previous bills.</p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto divide-y divide-slate-100">
                  {insights.recentBills.map((rb) => (
                    <div key={rb.id} className="pt-1 first:pt-0 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-blue-600 font-medium">{rb.billNumber}</span>
                        <span className="text-slate-500 text-[11px]">{formatDate(rb.billDate)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-medium">
                          {rb.paymentMode}
                        </span>
                        <span className="font-semibold text-slate-800">
                          {formatCurrency(rb.grandTotal)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Address — A4 invoice only, see showAddress on CustomerBarProps */}
      {showAddress && (
        <div className="relative mt-2">
          <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 text-sm"
            placeholder="Customer address (optional — printed on the A4 invoice)"
            value={value.address ?? ''}
            onChange={(e) => onChange({ ...value, address: e.target.value })}
            disabled={disabled}
            autoComplete="off"
            maxLength={500}
          />
        </div>
      )}

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions && suggestions.data.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border rounded-lg shadow-soft-md overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-slate-50 border-b font-medium tracking-wide uppercase">
            Existing {isMm ? 'MM' : ''} customers
          </div>
          {suggestions.data.map((c) => (
            <button
              key={c.id}
              className="w-full text-left px-4 py-2.5 hover:bg-brand-50 transition-colors flex items-center gap-3 border-b last:border-b-0"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(c); }}
            >
              <div className="w-8 h-8 bg-brand-200 rounded-full flex items-center justify-center shrink-0">
                <span className="text-brand-900 font-semibold text-sm">
                  {c.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-800">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.phone}</p>
              </div>
            </button>
          ))}
          <button
            className="w-full text-left px-4 py-2.5 text-muted-foreground hover:bg-slate-50 text-xs border-t"
            onMouseDown={(e) => { e.preventDefault(); setShowSuggestions(false); }}
          >
            Continue with "{value.name}" as new customer
          </button>
        </div>
      )}
    </div>
  );
}

