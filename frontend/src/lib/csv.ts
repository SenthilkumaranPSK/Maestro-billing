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

export function exportToCsv(filename: string, rows: Record<string, string | number>[]): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const csvContent = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h] ?? '')).join(',')),
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
