// Dates are stored/exchanged as ISO (YYYY-MM-DD) but shown to users as dd/mm/yyyy (NZ).
export function formatDMY(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
