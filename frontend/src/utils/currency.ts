import type { Account } from '../types'

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€',
  CHF: 'CHF',
  USD: '$',
  GBP: '£',
  JPY: '¥',
  CAD: 'CA$',
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code
}

/** Format integer cents with the given currency symbol. */
export function formatCents(cents: number, currency = 'EUR', opts?: { sign?: boolean; decimals?: number }): string {
  const abs = Math.abs(cents)
  const decimals = opts?.decimals ?? 0
  const formatted = (abs / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  const sym = currencySymbol(currency)
  const base = `${formatted} ${sym}`
  if (opts?.sign) {
    return cents < 0 ? `-${base}` : `+${base}`
  }
  return cents < 0 ? `-${base}` : base
}

/** Derive the display currency from a list of accounts and an optional selection.
 *  If all selected accounts share the same currency, return it. Otherwise "EUR". */
export function deriveCurrency(accounts: Account[], selectedIds: number[] | null): string {
  const relevant = selectedIds
    ? accounts.filter(a => selectedIds.includes(a.id))
    : accounts
  if (relevant.length === 0) return 'EUR'
  const first = relevant[0].currency
  return relevant.every(a => a.currency === first) ? first : 'EUR'
}
