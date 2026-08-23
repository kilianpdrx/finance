import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TopExpenses } from './top-expenses';
import { useTransactions, useCategories } from '@/lib/api/hooks';

vi.mock('@/lib/api/hooks', () => ({
  useTransactions: vi.fn(),
  useCategories: vi.fn(),
}));

vi.mock('@/lib/format', () => ({
  formatCents: (cents: number, curr: string) => `${cents / 100} ${curr}`,
}));

describe('TopExpenses', () => {
  it('renders empty state when no transactions', () => {
    vi.mocked(useTransactions).mockReturnValue({ data: [] } as any);
    vi.mocked(useCategories).mockReturnValue({ data: [] } as any);

    render(<TopExpenses query={{}} currency="EUR" />);
    expect(screen.getByText('Aucune dépense sur la période')).toBeInTheDocument();
  });

  it('renders top transactions ordered by amount descending', () => {
    vi.mocked(useCategories).mockReturnValue({
      data: [{ id: 1, name: 'Groceries' }],
    } as any);

    vi.mocked(useTransactions).mockReturnValue({
      data: [
        {
          id: 1,
          date: '2026-07-20',
          description: 'Small purchase',
          amount_cents: 1500,
          currency: 'EUR',
          category_id: 1,
          account_name: 'Checking',
        },
        {
          id: 2,
          date: '2026-07-21',
          description: 'Big purchase',
          amount_cents: 15000,
          currency: 'EUR',
          category_id: null,
        },
      ],
    } as any);

    const { container } = render(<TopExpenses query={{}} currency="EUR" />);
    const listItems = container.querySelectorAll('li');
    expect(listItems).toHaveLength(2);

    // Big purchase should be first
    expect(listItems[0]).toHaveTextContent('Big purchase');
    expect(listItems[0]).toHaveTextContent('Non catégorisé');
    expect(listItems[0].querySelector('.nums')).toHaveTextContent('−150 EUR');

    // Small purchase should be second
    expect(listItems[1]).toHaveTextContent('Small purchase');
    expect(listItems[1]).toHaveTextContent('Groceries');
    expect(listItems[1]).toHaveTextContent('Checking');
    expect(listItems[1].querySelector('.nums')).toHaveTextContent('−15 EUR');
  });
});
