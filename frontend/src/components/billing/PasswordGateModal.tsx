import { useState, type FormEvent } from 'react';
import { Lock, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { settingsApi } from '@/api/settings';

interface PasswordGateModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

// Mirrors the seeded default in backend/src/seed.ts — used only if the
// setting is somehow missing (shouldn't happen post-seed, but a bill-edit
// gate must never silently become unlockable-by-nobody on a stale install).
const DEFAULT_EDIT_PASSWORD = '1234567890';

/**
 * Blocks entry into an edit flow (EditBillModal / MmEditBillModal) until the
 * bill-edit password (Settings → Security) is entered correctly. A soft
 * deterrent against casual/accidental edits — this app has no real auth
 * anywhere, deliberately (single trusted operator), so this isn't either;
 * it's checked client-side only, same trust model as the rest of the app.
 */
export function PasswordGateModal({ onConfirm, onCancel }: PasswordGateModalProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const correctPassword = settings?.security?.bill_edit_password || DEFAULT_EDIT_PASSWORD;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (value === correctPassword) {
      onConfirm();
    } else {
      setError(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-card text-card-foreground rounded-xl shadow-soft-lg w-full max-w-sm p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Password Required
          </h3>
          <Button type="button" variant="ghost" size="icon" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Editing a saved bill needs the bill-edit password (set in Settings → Security).
        </p>
        <Input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          placeholder="Enter password"
        />
        {error && <p className="text-sm text-destructive">Incorrect password.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Unlock</Button>
        </div>
      </form>
    </div>
  );
}
