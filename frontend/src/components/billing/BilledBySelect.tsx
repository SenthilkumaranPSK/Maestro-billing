import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STAFF_LIST } from '@/lib/staff';

interface BilledBySelectProps {
  value: number | '';
  onChange: (billedById: number | '') => void;
  disabled?: boolean;
}

/**
 * Which staff member billed this sale — required on the New Bill and Edit
 * Bill forms (unlike Payment Mode, there's no "Not set" option here on
 * purpose). See lib/staff.ts for the hardcoded staff list and
 * Bill.billedById/billedByName in schema.prisma for how it's stored.
 */
export function BilledBySelect({ value, onChange, disabled }: BilledBySelectProps) {
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
        {STAFF_LIST.map((staff) => (
          <SelectItem key={staff.id} value={String(staff.id)}>{staff.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
