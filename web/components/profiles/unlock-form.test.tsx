import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnlockForm } from './unlock-form';

const mutateAsync = vi.fn();

vi.mock('@/lib/api/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/hooks')>()),
  useProfilePin: () => ({ unlock: { mutateAsync, isPending: false } }),
}));

describe('UnlockForm', () => {
  beforeEach(() => { mutateAsync.mockReset(); });

  it('keeps digits only, masked, and unlocks', async () => {
    const onUnlocked = vi.fn();
    mutateAsync.mockResolvedValue({ token: 't' });
    render(<UnlockForm profileId={1} profileName="Kilian" onUnlocked={onUnlocked} />);
    const input = screen.getByLabelText('Code PIN de Kilian') as HTMLInputElement;
    // A text field masked by CSS: the browser does not offer to save it as a password.
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('numeric');
    expect(input.className).toContain('[-webkit-text-security:disc]');

    const button = screen.getByRole('button', { name: /Déverrouiller/ });
    fireEvent.change(input, { target: { value: '12a' } });
    expect(input.value).toBe('12');
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: '1234' } });
    fireEvent.click(button);
    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({ id: 1, pin: '1234' });
    expect(input.value).toBe('');
  });

  it("shows the API's message and clears the field on a wrong PIN", async () => {
    const onUnlocked = vi.fn();
    mutateAsync.mockImplementation(async () => { throw new Error('Code PIN incorrect.'); });
    render(<UnlockForm profileId={1} profileName="Kilian" onUnlocked={onUnlocked} />);
    const input = screen.getByLabelText('Code PIN de Kilian') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: /Déverrouiller/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Code PIN incorrect.');
    expect(input.value).toBe('');
    expect(onUnlocked).not.toHaveBeenCalled();
  });
});
