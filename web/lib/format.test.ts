import { describe, it, expect } from 'vitest';
import {
  currencySymbol,
  formatCents,
  formatCentsCompact,
  parseAmountToCents,
  formatPercent,
  formatMonthLabel,
  deriveCurrency,
} from './format';
import type { components } from './api/schema';

describe('format.ts', () => {
  describe('currencySymbol', () => {
    it('returns correct symbols', () => {
      expect(currencySymbol('EUR')).toBe('€');
      expect(currencySymbol('USD')).toBe('$');
      expect(currencySymbol('CHF')).toBe('CHF');
      expect(currencySymbol('UNKNOWN')).toBe('UNKNOWN');
    });
  });

  describe('formatCents', () => {
    it('formats positive amount', () => {
      // Note: non-breaking spaces are used in format
      expect(formatCents(123456, 'EUR')).toBe('1 235 €'); // toLocaleString('fr-FR') behavior may vary slightly by env, usually it's "1 235 €"
    });

    it('formats negative amount', () => {
      expect(formatCents(-123456, 'USD')).toBe('−1 235 $');
    });

    it('includes decimals', () => {
      expect(formatCents(123456, 'EUR', { decimals: 2 })).toBe('1 234,56 €');
    });

    it('includes sign when requested', () => {
      expect(formatCents(123456, 'EUR', { sign: true })).toBe('+1 235 €');
      expect(formatCents(-123456, 'EUR', { sign: true })).toBe('−1 235 €');
    });
  });

  describe('formatCentsCompact', () => {
    it('formats under 1k', () => {
      expect(formatCentsCompact(50000, 'EUR')).toBe('500 €');
    });

    it('formats thousands', () => {
      expect(formatCentsCompact(150000, 'EUR')).toBe('1,5k €');
    });

    it('formats millions', () => {
      expect(formatCentsCompact(150000000, 'EUR')).toBe('1,5M €');
    });
    
    it('handles negative millions', () => {
      expect(formatCentsCompact(-150000000, 'EUR')).toBe('−1,5M €');
    });
  });

  describe('parseAmountToCents', () => {
    it('parses basic number', () => {
      expect(parseAmountToCents('123')).toBe(12300);
    });

    it('parses decimals', () => {
      expect(parseAmountToCents('123.45')).toBe(12345);
      expect(parseAmountToCents('123,45')).toBe(12345);
    });

    it('ignores spaces', () => {
      expect(parseAmountToCents('1 234.56')).toBe(123456);
    });

    it('handles negative', () => {
      expect(parseAmountToCents('-123.45')).toBe(-12345);
    });
    
    it('handles invalid input gracefully', () => {
      expect(parseAmountToCents('abc')).toBe(0);
    });
  });

  describe('formatPercent', () => {
    it('formats percent', () => {
      expect(formatPercent(12.34)).toBe('12,3 %');
    });

    it('formats with sign', () => {
      expect(formatPercent(12.34, { sign: true })).toBe('+12,3 %');
      expect(formatPercent(-12.34, { sign: true })).toBe('-12,3 %');
    });
  });

  describe('formatMonthLabel', () => {
    it('formats month', () => {
      expect(formatMonthLabel('2026-05')).toBe('mai');
    });

    it('formats month with year', () => {
      expect(formatMonthLabel('2026-05', { withYear: true })).toBe('mai 2026');
    });
  });

  describe('deriveCurrency', () => {
    const accs = [
      { id: 1, name: 'Bank A', bank_name: 'Bank A', account_type: 'courant', currency: 'EUR' } as any,
      { id: 2, name: 'Bank B', bank_name: 'Bank B', account_type: 'epargne', currency: 'USD' } as any,
      { id: 3, name: 'Credit', bank_name: 'Bank B', account_type: 'crédit', currency: 'USD' } as any,
    ];

    it('returns EUR if accounts have mixed currencies', () => {
      expect(deriveCurrency(accs, null)).toBe('EUR');
    });

    it('returns specific currency if selected accounts share it', () => {
      expect(deriveCurrency(accs, [2, 3])).toBe('USD');
    });

    it('returns EUR if no accounts selected', () => {
      expect(deriveCurrency(accs, [])).toBe('EUR');
    });
  });
});
