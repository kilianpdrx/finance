import { describe, it, expect } from 'vitest';
import { amountConditionIssue, operatorsFor, parseRuleAmount, ruleSummary, previewBreakdown } from './rules';

describe('rules.ts', () => {
  describe('operatorsFor', () => {
    it('offers the operators that settle a conflict without priority', () => {
      const text = operatorsFor('description').map((o) => o.value);
      expect(text).toContain('not_contains');
      expect(text).toContain('word');
    });

    it('keeps numeric and boolean fields to their own operators', () => {
      expect(operatorsFor('amount').map((o) => o.value)).not.toContain('contains');
      expect(operatorsFor('is_debit').map((o) => o.value)).toEqual(['equals']);
    });
  });

  describe('ruleSummary', () => {
    it('joins a keyword list with OU', () => {
      expect(ruleSummary({
        logic_operator: 'OR',
        conditions: [
          { field: 'description', operator: 'contains', value: 'netflix' },
          { field: 'description', operator: 'word', value: 'free' },
        ],
      })).toBe('Libellé contient « netflix » OU Libellé mot entier « free »');
    });

    it('joins an exclusion with ET', () => {
      expect(ruleSummary({
        logic_operator: 'AND',
        conditions: [
          { field: 'description', operator: 'contains', value: 'amazon' },
          { field: 'description', operator: 'not_contains', value: 'prime' },
        ],
      })).toBe('Libellé contient « amazon » ET Libellé ne contient pas « prime »');
    });

    it('reads a direction condition as Dépense / Revenu, never true / false', () => {
      const sens = (value: string) => ruleSummary({ conditions: [{ field: 'is_debit', operator: 'equals', value }] });
      expect(sens('false')).toBe('Sens = Revenu');
      expect(sens('true')).toBe('Sens = Dépense');
      expect(sens('True')).toBe('Sens = Dépense');
    });

    it('falls back to the raw names for an unknown field or operator', () => {
      expect(ruleSummary({
        conditions: [{ field: 'memo', operator: 'fuzzy', value: 'x' }],
      })).toBe('memo fuzzy « x »');
    });
  });

  describe('parseRuleAmount', () => {
    it('reads amounts as people type them', () => {
      expect(parseRuleAmount('12,5')).toBe(12.5);
      expect(parseRuleAmount('12.5')).toBe(12.5);
      expect(parseRuleAmount(' 1 850 ')).toBe(1850);
      expect(parseRuleAmount('-3')).toBe(-3);
    });

    it('rejects what is not a number', () => {
      expect(parseRuleAmount('abc')).toBeNull();
      expect(parseRuleAmount('')).toBeNull();
      expect(parseRuleAmount('12,5,3')).toBeNull();
    });
  });

  describe('amountConditionIssue — an amount has no sign', () => {
    const amount = (operator: string, value: string) => amountConditionIssue({ field: 'amount', operator, value });

    it('flags a condition that is true for every transaction', () => {
      expect(amount('>', '0')).toBe('always');       // the classic "money coming in" attempt
      expect(amount('>=', '0')).toBe('always');
      expect(amount('>', '-10')).toBe('always');
    });

    it('flags a condition that can never be true', () => {
      expect(amount('<', '0')).toBe('never');        // the "money going out" attempt
      expect(amount('<=', '0')).toBe('never');
      expect(amount('<', '-5')).toBe('never');
      expect(amount('equals', '-20')).toBe('never');
    });

    it('accepts a real threshold', () => {
      expect(amount('>', '600')).toBeNull();
      expect(amount('<', '12,5')).toBeNull();
      expect(amount('equals', '0')).toBeNull();
    });

    it('flags a threshold that is not a number, but not an empty one being typed', () => {
      expect(amount('>', 'abc')).toBe('invalid');
      expect(amount('>', '')).toBeNull();
    });

    it('only looks at amount conditions', () => {
      expect(amountConditionIssue({ field: 'description', operator: 'contains', value: '0' })).toBeNull();
    });
  });

  describe('previewBreakdown', () => {
    const rows = [{ category_id: null }, { category_id: undefined }, { category_id: 3 }, { category_id: 3 }, { category_id: 7 }];

    it('tells apart what the rule can fill, what it already matches and what is filed elsewhere', () => {
      expect(previewBreakdown(rows, 3)).toEqual({ none: 2, same: 2, other: 1 });
      expect(previewBreakdown(rows, 7)).toEqual({ none: 2, same: 1, other: 2 });
    });

    it('counts every categorised row as "elsewhere" until a category is chosen', () => {
      expect(previewBreakdown(rows, null)).toEqual({ none: 2, same: 0, other: 3 });
      expect(previewBreakdown([], 3)).toEqual({ none: 0, same: 0, other: 0 });
    });
  });
});
