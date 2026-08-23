import { describe, it, expect } from 'vitest';
import { balancesFromNetWorth, patrimoineByType } from './networth';
import type { Account, NetWorthPoint } from './api/hooks';

describe('networth.ts', () => {
  const accs: Account[] = [
    { id: 1, name: 'Bank A', bank_name: 'Bank A', account_type: 'courant', currency: 'EUR' } as Account,
    { id: 2, name: 'Bank B', bank_name: 'Bank B', account_type: 'epargne', currency: 'USD' } as Account,
    { id: 3, name: 'Credit', bank_name: 'Bank B', account_type: 'crédit', currency: 'EUR' } as Account,
  ];

  describe('balancesFromNetWorth', () => {
    it('returns empty when no points', () => {
      expect(balancesFromNetWorth([], accs)).toEqual({});
    });

    it('returns native balances if available', () => {
      const points: NetWorthPoint[] = [
        {
          month: '2026-07-23',
          total: 15000,
          'Bank A': 10000,
          'Bank B': 5000,
          'Bank B_native': 6000,
        },
      ];
      expect(balancesFromNetWorth(points, accs)).toEqual({
        1: 10000, // Bank A falls back to non-native
        2: 6000,  // Bank B uses native
      });
    });
  });

  describe('patrimoineByType', () => {
    it('returns empty when no points', () => {
      expect(patrimoineByType([], accs)).toEqual({});
    });

    it('groups positive balances by type', () => {
      const points: NetWorthPoint[] = [
        {
          month: '2026-07-23',
          total: 10000,
          'Bank A': 10000,
          'Bank B': 5000,
          'Credit': -5000, // should be excluded
        },
      ];
      expect(patrimoineByType(points, accs)).toEqual({
        'courant': 10000,
        'epargne': 5000,
      });
    });
  });
});
