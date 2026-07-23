const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0-99 → words. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return TENS[tens] + (ones ? ` ${ONES[ones]}` : '');
}

/** 0-999 → words, in the "Two Hundred and Forty" style used by the sample invoice. */
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(hundreds ? `and ${twoDigits(rest)}` : twoDigits(rest));
  return parts.join(' ');
}

/**
 * Whole non-negative integer → words using the Indian numbering system
 * (crore / lakh / thousand, not the Western million/billion grouping).
 */
export function numberToIndianWords(value: number): string {
  let num = Math.floor(Math.abs(value));
  if (num === 0) return 'Zero';

  const crore = Math.floor(num / 1e7);
  num %= 1e7;
  const lakh = Math.floor(num / 1e5);
  num %= 1e5;
  const thousand = Math.floor(num / 1e3);
  num %= 1e3;
  const hundred = num;

  const segments: string[] = [];
  if (crore) segments.push(`${twoDigits(crore)} Crore`);
  if (lakh) segments.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) segments.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) segments.push(threeDigits(hundred));

  return segments.join(' ');
}

/**
 * Formats an integer-paise amount as "INR - <words> only" (or "... and NN
 * Paise only" when there's a fractional rupee part) — matches the wording
 * used on the A4 "Service Bill" invoice layout.
 */
export function amountInWordsINR(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const paiseRemainder = Math.round(paise) % 100;
  const rupeeWords = numberToIndianWords(rupees);
  const paiseWords = paiseRemainder ? ` and ${numberToIndianWords(paiseRemainder)} Paise` : '';
  return `INR - ${rupeeWords}${paiseWords} only`;
}
