import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Topbar } from './topbar';

const version = vi.hoisted(() => ({ value: { data: undefined as { is_desktop?: boolean } | undefined } }));

vi.mock('@/lib/api/hooks', () => ({
  useAppVersion: () => version.value,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/transactions',
}));

beforeEach(() => {
  version.value = { data: undefined };
});

describe('Topbar « Quitter »', () => {
  it('is offered when the servers were started by hand or by Docker', () => {
    version.value = { data: { is_desktop: false } };
    render(<Topbar onMenuClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Quitter' })).toBeInTheDocument();
  });

  it('is not offered in the desktop app, which closes with its window', () => {
    version.value = { data: { is_desktop: true } };
    render(<Topbar onMenuClick={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Quitter' })).not.toBeInTheDocument();
  });

  it('waits for the build to be known, so it never flashes in the desktop app', () => {
    render(<Topbar onMenuClick={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Quitter' })).not.toBeInTheDocument();
  });
});
