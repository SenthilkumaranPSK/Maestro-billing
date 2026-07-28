import { useState, useRef, useEffect } from 'react';
import { User, Phone, UserCheck, FileText, MapPin } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { customersApi } from '@/api/customers';

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
}

export function CustomerBar({ value, onChange, disabled, showAddress }: CustomerBarProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const barRef = useRef<HTMLDivElement>(null);

  const activeSearch = searchTerm.length >= 2 ? searchTerm : '';

  const { data: suggestions } = useQuery({
    queryKey: ['customers', 'suggest', activeSearch],
    queryFn: () => customersApi.list({ search: activeSearch, limit: 6 }),
    enabled: !!activeSearch,
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
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
    <div className="relative" ref={barRef}>
      <div className="flex items-center gap-2">
        {/* Name */}
        <div className="relative flex-1">
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
            Existing customers
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
