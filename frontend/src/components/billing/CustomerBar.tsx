import { useState, useRef, useEffect } from 'react';
import { User, Phone, UserCheck, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { customersApi } from '@/api/customers';

export interface CustomerInfo {
  id?: number;
  name: string;
  phone: string;
  gstin?: string;
}

interface CustomerBarProps {
  value: CustomerInfo;
  onChange: (info: CustomerInfo) => void;
  disabled?: boolean;
}

export function CustomerBar({ value, onChange, disabled }: CustomerBarProps) {
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

  const handleSelect = (c: { id: number; name: string; phone: string; gstin?: string }) => {
    onChange({ id: c.id, name: c.name, phone: c.phone, gstin: c.gstin ?? '' });
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
