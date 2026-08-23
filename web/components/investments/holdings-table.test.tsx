import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HoldingsTable } from './holdings-table';
import type { HoldingOut } from '@/lib/api/hooks';

// The table only needs the mutation hook's shape; nothing here mutates.
vi.mock('@/lib/api/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/hooks')>()),
  useHoldingMutations: () => ({
    remove: { mutate: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    create: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

// Expanding a row renders the price chart, which would fetch. Stub it so an
// accidental expansion is visible as a rendered element rather than a network call.
vi.mock('./holding-price-chart', () => ({
  HoldingPriceChart: ({ ticker }: { ticker: string }) => <div data-testid="price-chart">{ticker}</div>,
}));

function holding(over: Partial<HoldingOut>): HoldingOut {
  return {
    id: 1, account_id: 1, ticker: 'AI.PA', isin: null, name: 'Air Liquide',
    quantity: 5, cost_basis_cents: 80000, currency: 'EUR', asset_type: 'stock',
    added_date: null, notes: null, price_locked: false,
    current_price_cents: 17000, current_value_cents: 85000,
    gain_cents: 5000, gain_pct: 6.25, price_currency: 'EUR',
    price_fetched_at: null, value_in_account_ccy_cents: 85000,
    price_status: 'ok',
    ...over,
  } as HoldingOut;
}

const CASH = holding({
  id: 2, ticker: 'CASH.EUR', name: 'Liquidités', asset_type: 'cash',
  quantity: 1234.56, cost_basis_cents: 123456, current_price_cents: 100,
  current_value_cents: 123456, gain_cents: 0, gain_pct: 0,
  value_in_account_ccy_cents: 123456, price_locked: true, price_status: 'cash',
});

describe('HoldingsTable — cash positions', () => {
  it('labels cash in French and shows its full amount', () => {
    render(<HoldingsTable holdings={[CASH]} currency="EUR" />);

    // Twice: once as the position's name, once as its asset-type label.
    expect(screen.getAllByText('Liquidités')).toHaveLength(2);
    expect(screen.getAllByText(/1.*234.*56/).length).toBeGreaterThan(0);
  });

  it('does not badge cash as a locked or missing quote', () => {
    const { container } = render(<HoldingsTable holdings={[CASH]} currency="EUR" />);

    // The lock icon means "excluded from auto-refresh, price may be stale", which
    // would be alarming and wrong for cash — its value is exact.
    expect(container.querySelector('[title*="Prix verrouillé"]')).toBeNull();
    expect(container.querySelector('[title*="Cours indisponible"]')).toBeNull();
  });

  it('is not expandable, so no chart is ever requested for CASH.*', async () => {
    const { container } = render(<HoldingsTable holdings={[CASH]} currency="EUR" />);

    const row = container.querySelector('tbody tr') as HTMLElement;
    row.click();

    expect(screen.queryByTestId('price-chart')).toBeNull();
  });

  it('still expands a real holding', async () => {
    const { container } = render(<HoldingsTable holdings={[holding({})]} currency="EUR" />);

    const row = container.querySelector('tbody tr') as HTMLElement;
    row.click();

    expect(await screen.findByTestId('price-chart')).toHaveTextContent('AI.PA');
  });
});
