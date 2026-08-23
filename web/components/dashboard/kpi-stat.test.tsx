import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { KpiStat } from './kpi-stat';
import { Home } from 'lucide-react';
import { formatCents, formatPercent } from '@/lib/format';

// Mock framer-motion so the animation is instantaneous
vi.mock('framer-motion', () => ({
  animate: (from: any, to: any, options: any) => {
    if (options.onUpdate) {
      options.onUpdate(to);
    }
    return { stop: vi.fn() };
  },
}));

describe('KpiStat', () => {
  it('renders label and correctly formats value', () => {
    const { container } = render(
      <KpiStat label="Total Net Worth" valueCents={150000} currency="EUR" icon={Home} />
    );

    expect(screen.getByText('Total Net Worth')).toBeInTheDocument();
    expect(container.querySelector('.nums')).toHaveTextContent(/1.*500/);
  });

  it('renders negative values correctly', () => {
    const { container } = render(
      <KpiStat label="Debts" valueCents={-150000} currency="EUR" icon={Home} />
    );

    expect(container.querySelector('.nums')).toHaveTextContent(/-?1.*500/);
  });

  it('renders positive delta', () => {
    const { container } = render(
      <KpiStat label="Net Worth" valueCents={150000} currency="EUR" icon={Home} deltaPercent={5.5} />
    );

    expect(container).toHaveTextContent(/5,5/);
  });

  it('renders negative delta', () => {
    const { container } = render(
      <KpiStat label="Net Worth" valueCents={150000} currency="EUR" icon={Home} deltaPercent={-2.3} />
    );

    expect(container).toHaveTextContent(/2,3/);
  });

  it('renders hint', () => {
    render(
      <KpiStat label="Net Worth" valueCents={150000} currency="EUR" icon={Home} hint="since last month" />
    );

    expect(screen.getByText('since last month')).toBeInTheDocument();
  });
});
