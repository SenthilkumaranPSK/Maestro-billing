/**
 * Escapes a single CSV field per RFC 4180 — wraps in double quotes and
 * doubles any embedded quotes whenever the value contains a comma, quote,
 * or newline (e.g. a customer name like `Doe, John "Jr"`). Values with none
 * of those are returned as-is, matching how spreadsheet apps write CSV.
 */
export function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
