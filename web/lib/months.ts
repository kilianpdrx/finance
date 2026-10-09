/** `YYYY-MM` helpers for the month + year fields. */

export const MONTH_NAMES = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** "2027-03" → { year: 2027, month: 3 }; null when it is not a month. */
export function splitMonth(ym: string | null | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
}

/** (2027, 3) → "2027-03". */
export function joinMonth(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** "2026-11" + 3 → "2027-02". An unreadable month is returned as is. */
export function addMonths(ym: string, n: number): string {
  const parts = splitMonth(ym);
  if (!parts) return ym;
  const index = parts.year * 12 + (parts.month - 1) + n;
  return joinMonth(Math.floor(index / 12), (index % 12 + 12) % 12 + 1);
}

/** A year someone could plan in — typing "2" on the way to "2027" is not one. */
export function parseYear(text: string): number | null {
  if (!/^\d{4}$/.test(text.trim())) return null;
  const year = Number(text);
  return year >= 1990 && year <= 2100 ? year : null;
}
