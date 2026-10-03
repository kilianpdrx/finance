import { describe, it, expect } from 'vitest';
import { nextSort } from './sort-header';

describe('nextSort', () => {
  it('starts a new column in its natural direction', () => {
    expect(nextSort(null, 'amount', 'desc')).toEqual({ col: 'amount', dir: 'desc' });
    expect(nextSort({ col: 'date', dir: 'asc' }, 'name', 'asc')).toEqual({ col: 'name', dir: 'asc' });
  });

  it('flips on the second click, then returns to the default order', () => {
    const first = nextSort(null, 'amount', 'desc');
    const second = nextSort(first, 'amount', 'desc');
    expect(second).toEqual({ col: 'amount', dir: 'asc' });
    expect(nextSort(second, 'amount', 'desc')).toBeNull();
  });
});
