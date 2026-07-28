import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// A disposable React list key — never sent to the server, never used for
// anything security-sensitive. `crypto.randomUUID()` only exists in a
// "secure context" (HTTPS or localhost); connecting to the Main PC over
// plain LAN HTTP in two-PC mode is not one, so it silently doesn't exist
// there and crashed the instant a page tried to create a new bill item
// ("crypto.randomUUID is not a function"). This never needed cryptographic
// randomness in the first place, so it no longer depends on the Web Crypto
// API at all.
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayISO(): string {
  // Build from local date parts — toISOString() is UTC and returns yesterday's
  // date between 00:00 and 05:30 IST.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Validate an Indian phone number for WhatsApp delivery.
 * Accepts either a 10-digit number (e.g. "9843096461") or a 12-digit number
 * prefixed with the country code "91" (e.g. "919843096461"). All other
 * characters (spaces, dashes, parens) are stripped before checking.
 */
export function isValidIndianPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return /^[6-9]\d{9}$/.test(digits);
  if (digits.length === 12) return /^91[6-9]\d{9}$/.test(digits);
  return false;
}
