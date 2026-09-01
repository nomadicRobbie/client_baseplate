// Dates are stored/exchanged as ISO (YYYY-MM-DD) but shown to users as dd/mm/yyyy (NZ).
export function formatDMY(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

// Local calendar date as YYYY-MM-DD — use instead of new Date().toISOString().slice(0,10)
// which returns UTC date and shows the wrong day in +offset timezones (e.g. NZ UTC+12/13).
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Local calendar date from a UTC ISO timestamp — use instead of isoStr.slice(0,10)
// when the value is a TIMESTAMPTZ (e.g. starts_at). DATE strings can use localDate() directly.
export function isoToLocalDate(iso: string): string {
  return localDate(new Date(iso));
}
