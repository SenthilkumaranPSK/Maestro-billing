import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { servicesApi } from '@/api/services';

interface ServiceDescriptionInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Free-text Service Description field with autocomplete against the Services
 * catalog (Services page) — same suggestion-dropdown pattern as CustomerBar,
 * but picking a suggestion just fills the text, no linked record to track.
 */
export function ServiceDescriptionInput({ value, onChange, disabled }: ServiceDescriptionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: suggestions } = useQuery({
    queryKey: ['services', 'suggest', value],
    queryFn: () => servicesApi.list({ search: value }),
    enabled: showSuggestions,
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <Input
        placeholder="e.g. Product Video Shoot Services"
        value={value}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setShowSuggestions(true); }}
        onFocus={() => setShowSuggestions(true)}
      />
      {showSuggestions && suggestions && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border rounded-lg shadow-soft-md overflow-hidden max-h-60 overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-150">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-brand-50 transition-colors text-sm border-b last:border-b-0"
              onMouseDown={(e) => { e.preventDefault(); onChange(s.name); setShowSuggestions(false); }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
