import type { components } from "./api/schema";

type Account = components["schemas"]["AccountOut"];

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  CHF: "CHF",
  USD: "$",
  GBP: "£",
  JPY: "¥",
  CAD: "CA$",
};

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code;
}

interface MoneyOpts {
  sign?: boolean;
  decimals?: number;
}

/** Format integer cents with a currency symbol (fr-FR grouping). */
export function formatCents(cents: number, currency = "EUR", opts: MoneyOpts = {}): string {
  const { sign = false, decimals = 0 } = opts;
  const abs = Math.abs(cents);
  const formatted = (abs / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const base = `${formatted} ${currencySymbol(currency)}`;
  if (sign) return cents < 0 ? `−${base}` : `+${base}`;
  return cents < 0 ? `−${base}` : base;
}

/** Compact form for axis labels / chips, e.g. 12,3k €. */
export function formatCentsCompact(cents: number, currency = "EUR"): string {
  const abs = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  const sym = currencySymbol(currency);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}M ${sym}`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}k ${sym}`;
  return `${sign}${abs.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} ${sym}`;
}

/** Parse a free-text money input ("12 345,67", "12345.67") into integer cents. */
export function parseAmountToCents(s: string): number {
  const cleaned = s.replace(",", ".").replace(/\s/g, "").replace(/[^\d.-]/g, "");
  return Math.round(parseFloat(cleaned || "0") * 100);
}

export const CURRENCIES = [
  { code: "EUR", symbol: "€" },
  { code: "CHF", symbol: "CHF" },
  { code: "USD", symbol: "$" },
  { code: "GBP", symbol: "£" },
  { code: "JPY", symbol: "¥" },
  { code: "CAD", symbol: "CA$" },
];

export function formatPercent(value: number, opts: { sign?: boolean; decimals?: number } = {}): string {
  const { sign = false, decimals = 1 } = opts;
  const s = value.toLocaleString("fr-FR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (sign && value > 0) return `+${s} %`;
  return `${s} %`;
}

/** "2026-05" → "mai 2026" (short month label for charts/axes). */
const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export function formatMonthLabel(ym: string, opts: { withYear?: boolean } = {}): string {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  const label = MONTHS_FR[idx] ?? m;
  return opts.withYear ? `${label} ${y}` : label;
}

/** Derive a display currency from accounts + optional selection.
 *  Same currency across selection → that currency, else EUR (base). */
export function deriveCurrency(accounts: Account[], selectedIds: number[] | null): string {
  const relevant = selectedIds ? accounts.filter((a) => selectedIds.includes(a.id)) : accounts;
  if (relevant.length === 0) return "EUR";
  const first = relevant[0].currency;
  return relevant.every((a) => a.currency === first) ? first : "EUR";
}
