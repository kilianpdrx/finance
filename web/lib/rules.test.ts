import { describe, it, expect } from 'vitest';
import { operatorsFor, ruleSummary } from './rules';

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

    it('reads a direction condition without the operator label', () => {
      expect(ruleSummary({
        logic_operator: 'AND',
        conditions: [{ field: 'is_debit', operator: 'equals', value: 'false' }],
      })).toBe('Débit ? = false');
    });

    it('falls back to the raw names for an unknown field or operator', () => {
      expect(ruleSummary({
        conditions: [{ field: 'memo', operator: 'fuzzy', value: 'x' }],
      })).toBe('memo fuzzy « x »');
    });
  });
});
