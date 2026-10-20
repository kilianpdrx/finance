import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BinanceTab } from './binance-tab';

const mutate = vi.fn();
const testKey = vi.fn();

// The API never sends the key or the secret back: the tab only learns whether
// each is stored.
vi.mock('@/lib/api/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/hooks')>()),
  useBinanceStatus: () => ({
    data: { configured: true, has_key: true, has_secret: true, account_id: 4, auto_sync: false,
            last_sync: null, last_status: null },
  }),
  useInvestmentAccounts: () => ({ data: [{ id: 4, name: 'Crypto', bank_name: 'Binance' }] }),
  useSettingMutation: () => ({ mutate, isPending: false }),
  useBinanceTest: () => ({ mutate: testKey, isPending: false }),
}));

describe('BinanceTab', () => {
  beforeEach(() => { mutate.mockReset(); testKey.mockReset(); });

  it('keeps the key and the secret write-only', () => {
    render(<BinanceTab />);
    const secret = screen.getByLabelText('Clé secrète') as HTMLInputElement;
    expect(secret.type).toBe('password');
    expect(secret.value).toBe('');
    expect(secret.placeholder).toContain('enregistrée');

    fireEvent.change(secret, { target: { value: '  s3cr3t  ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enregistrer' })[1]);
    expect(mutate).toHaveBeenCalledWith({ key: 'binance_api_secret', value: 's3cr3t' }, expect.anything());
    expect(secret.value).toBe('');            // not left on screen once saved
  });

  it('says why a key is refused', () => {
    testKey.mockImplementation((_: unknown, { onError }: { onError: (e: Error) => void }) =>
      onError(new Error('Cette clé peut aussi trader. Créez une clé en lecture seule.')));
    render(<BinanceTab />);
    fireEvent.click(screen.getByRole('button', { name: /Tester la connexion/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Cette clé peut aussi trader');
  });
});
