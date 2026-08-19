// A GSTIN's first 2 digits are the GST state code (e.g. "33" = Tamil Nadu) —
// used to auto-suggest the inter-state (IGST) toggle without needing a
// dedicated "state" field on Customer/MmCustomer/Settings.
export function gstinStateCode(gstin?: string): string | undefined {
  const trimmed = gstin?.trim();
  return trimmed && trimmed.length >= 2 ? trimmed.slice(0, 2) : undefined;
}

/**
 * Suggests whether a bill should be inter-state (IGST) by comparing the
 * seller's and buyer's GSTIN state codes. Returns null — not enough
 * information to suggest anything — when either GSTIN is missing, leaving
 * the toggle exactly as the operator last set it.
 */
export function suggestInterState(sellerGstin?: string, buyerGstin?: string): boolean | null {
  const sellerCode = gstinStateCode(sellerGstin);
  const buyerCode = gstinStateCode(buyerGstin);
  if (!sellerCode || !buyerCode) return null;
  return sellerCode !== buyerCode;
}
