import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionBanner } from './connection-banner';

const health = vi.hoisted(() => ({
  value: { isError: false, isFetching: false, refetch: vi.fn() },
}));

vi.mock('@/lib/api/hooks', () => ({
  useBackendHealth: () => health.value,
}));

beforeEach(() => {
  health.value = { isError: false, isFetching: false, refetch: vi.fn() };
});

/**
 * L'invariant : un backend injoignable ne doit JAMAIS ressembler à des données
 * vides. Sans ce bandeau, chaque page affiche son état vide (« Aucun compte »,
 * l'assistant de premier lancement…) et quelqu'un dont la base est parfaitement
 * intacte croit tout avoir perdu.
 */
describe('ConnectionBanner', () => {
  it('reste invisible quand le serveur répond', () => {
    const { container } = render(<ConnectionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('dit que les données sont intactes, pas seulement qu’il y a une erreur', () => {
    health.value = { isError: true, isFetching: false, refetch: vi.fn() };
    render(<ConnectionBanner />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Serveur inaccessible')).toBeInTheDocument();
    // La formulation est le cœur du correctif : rassurer explicitement.
    expect(screen.getByText(/vos données sont intactes/i)).toBeInTheDocument();
  });

  it('propose de réessayer, et relance la vérification', () => {
    const refetch = vi.fn();
    health.value = { isError: true, isFetching: false, refetch };
    render(<ConnectionBanner />);

    screen.getByRole('button', { name: /réessayer/i }).click();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('désactive le bouton pendant la vérification', () => {
    health.value = { isError: true, isFetching: true, refetch: vi.fn() };
    render(<ConnectionBanner />);

    expect(screen.getByRole('button', { name: /réessayer/i })).toBeDisabled();
  });
});
