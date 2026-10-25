import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { staffApi } from '@/api/staff';

interface BilledBySelectProps {
  value: number | '';
  onChange: (billedById: number | '') => void;
  disabled?: boolean;
}

/**
 * Which staff member billed this sale — required on the New Bill and Edit
 * Bill forms (unlike Payment Mode, there's no "Not set" option here on
 * purpose). Staff list is managed in Settings → Staff (see api/staff.ts and
 * backend schema.prisma Staff); Bill.billedById/billedByName is what's
 * actually stored, denormalized, so a bill keeps printing correctly even
 * after this list changes later.
 */
export function BilledBySelect({ value, onChange, disabled }: BilledBySelectProps) {
  const { data: staff } = useQuery({
    queryKey: ['staff'],
    queryFn: () => staffApi.list(),
  });

  return (
    <Select
      value={value === '' ? undefined : String(value)}
      onValueChange={(v) => onChange(Number(v))}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder="Billed By" />
      </SelectTrigger>
      <SelectContent>
        {staff?.map((s) => (
          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
