import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildMonths,
  cellDisplayValue,
  cellType,
  parentSubtotalRow,
  yearOf,
  type MergedCell,
  type MergedRow,
} from './budget';

/** Une cellule vide, surchargée champ par champ selon le cas testé. */
function cell(over: Partial<MergedCell> = {}): MergedCell {
  return {
    month: '2026-08',
    actual_cents: 0,
    expected_cents: 0,
    planned_cents: 0,
    planned_matched: false,
    planned_id: null,
    ...over,
  };
}

afterEach(() => vi.useRealTimers());

describe('cellType — quatre états, dont un qui demande confirmation', () => {
  it('« planned » : dépense prévue, aucune transaction encore', () => {
    expect(cellType(cell({ planned_cents: 5000 }))).toBe('planned');
  });

  it('« confirm » : une transaction est apparue, mais pas au montant prévu', () => {
    // C'est le cœur de la fonctionnalité : un montant différent n'est pas
    // rapproché automatiquement, l'utilisateur doit confirmer que c'est bien
    // la dépense prévue — sinon on compterait deux fois.
    expect(cellType(cell({ planned_cents: 5000, actual_cents: 4800 }))).toBe('confirm');
  });

  it('pas de confirmation quand le montant correspond exactement', () => {
    expect(cellType(cell({ planned_cents: 5000, actual_cents: 5000 }))).not.toBe('confirm');
  });

  it('une prévision déjà rapprochée ne réclame plus rien', () => {
    expect(cellType(cell({ planned_cents: 5000, actual_cents: 4800, planned_matched: true })))
      .toBe('regular');
  });

  it('« manual » : ajustement saisi à la main', () => {
    expect(cellType(cell({ expected_cents: 2000 }))).toBe('manual');
  });

  it('« regular » : cellule ordinaire', () => {
    expect(cellType(cell({ actual_cents: 1234 }))).toBe('regular');
  });
});

describe('cellDisplayValue — le réalisé compte toujours', () => {
  it('additionne réalisé et ajustement manuel', () => {
    expect(cellDisplayValue(cell({ actual_cents: 1000, expected_cents: 250 }))).toBe(1250);
  });

  it('ajoute la prévision tant que rien n’a été dépensé', () => {
    expect(cellDisplayValue(cell({ planned_cents: 5000 }))).toBe(5000);
  });

  it('remplace la prévision par le réel dès qu’une transaction existe', () => {
    // Le piège que la règle évite : additionner prévu ET réalisé, donc compter
    // la dépense deux fois dans le mois où elle se concrétise.
    expect(cellDisplayValue(cell({ planned_cents: 5000, actual_cents: 4800 }))).toBe(4800);
  });

  it('ignore une prévision rapprochée même sans transaction visible', () => {
    expect(cellDisplayValue(cell({ planned_cents: 5000, planned_matched: true }))).toBe(0);
  });
});

describe('parentSubtotalRow', () => {
  const row = (name: string, cells: MergedCell[]): MergedRow => ({
    category_id: 1, category_name: name, category_color: '#000',
    is_investment: false, cells,
  });

  it('somme le parent et ses enfants, mois par mois', () => {
    const parent = row('Logement', [cell({ actual_cents: 100 }), cell({ actual_cents: 0 })]);
    const kids = [
      row('Loyer', [cell({ actual_cents: 90000 }), cell({ actual_cents: 90000 })]),
      row('Électricité', [cell({ actual_cents: 4500 }), cell({ actual_cents: 5200 })]),
    ];

    const totals = parentSubtotalRow(parent, kids).cells;
    expect(totals.map((c) => c.actual_cents)).toEqual([94600, 95200]);
  });

  it('applique la règle prévu/réalisé aux enfants aussi', () => {
    const parent = row('Logement', [cell()]);
    const kids = [row('Loyer', [cell({ planned_cents: 90000, actual_cents: 88000 })])];

    // 88 000 (le réel), pas 178 000.
    expect(parentSubtotalRow(parent, kids).cells[0].actual_cents).toBe(88000);
  });

  it('neutralise prévu/manuel dans la ligne de sous-total', () => {
    // Le sous-total est déjà une valeur affichée : y laisser planned/expected
    // le ferait recompter à l'étage au-dessus.
    const parent = row('Logement', [cell({ expected_cents: 700 })]);
    const c = parentSubtotalRow(parent, []).cells[0];
    expect([c.expected_cents, c.planned_cents, c.planned_matched]).toEqual([0, 0, false]);
  });
});

describe('buildMonths', () => {
  it('produit une plage continue autour du mois courant', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15)); // août 2026
    expect(buildMonths(-2, 1)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
  });

  it('franchit les fins d’année', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 3)); // décembre 2026
    expect(buildMonths(-1, 2)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('renvoie un seul mois quand début et fin coïncident', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31)); // 31 janvier : pas de débordement sur février
    expect(buildMonths(0, 0)).toEqual(['2026-01']);
  });
});

describe('yearOf', () => {
  it('extrait l’année d’un mois ISO', () => {
    expect(yearOf('2026-08')).toBe('2026');
  });
});
