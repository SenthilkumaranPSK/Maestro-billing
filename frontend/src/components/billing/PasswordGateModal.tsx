import { useState, type FormEvent } from 'react';
import { Lock, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { settingsApi } from '@/api/settings';

interface PasswordGateModalProps {
  onConfirm: (pin: string) => void;
  onCancel: () => void;
  title?: string;
  description?: string;
}

export function PasswordGateModal({ onConfirm, onCancel, title, description }: PasswordGateModalProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const pin = value.trim();
    if (!pin) {
      setError('Please enter the Security PIN.');
      return;
    }
    setIsVerifying(true);
    setError('');
    try {
      const res = await settingsApi.verifyPin(pin);
      if (res.data?.valid) {
        onConfirm(pin);
      } else {
        setError('Incorrect Security PIN.');
      }
    } catch {
      setError('Could not verify PIN. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isVerifying) onCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-card text-card-foreground rounded-xl shadow-soft-lg w-full max-w-sm p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-base flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {title || 'Security PIN Required'}
          </h3>
          <Button type="button" variant="ghost" size="icon" onClick={onCancel} disabled={isVerifying}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {description || 'Modifying or editing a saved bill requires the Security PIN (set in Settings).'}
        </p>
        <Input
          type="password"
          autoFocus
          value={value}
          disabled={isVerifying}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          placeholder="Enter Security PIN"
        />
        {error && <p className="text-sm text-destructive font-medium">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isVerifying}>
            Cancel
          </Button>
          <Button type="submit" disabled={isVerifying}>
            {isVerifying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Verifying…
              </>
            ) : (
              'Unlock'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
