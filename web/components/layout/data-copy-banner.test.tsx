import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataCopyBanner } from './data-copy-banner';

const version = vi.hoisted(() => ({ value: { data: undefined as { data_copied_at?: string | null } | undefined } }));

vi.mock('@/lib/api/hooks', () => ({
  useAppVersion: () => version.value,
}));

beforeEach(() => {
  version.value = { data: undefined };
});

describe('DataCopyBanner', () => {
  it('stays out of the way on real data', () => {
    version.value = { data: { data_copied_at: null } };
    const { container } = render(<DataCopyBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says the data is a copy, and from when', () => {
    version.value = { data: { data_copied_at: '2026-10-11T21:40' } };
    render(<DataCopyBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Copie de test');
    expect(screen.getByRole('status')).toHaveTextContent(/copiées le 11 octobre/);
    expect(screen.getByRole('status')).toHaveTextContent(/ne touche pas l'application installée/);
  });
});
