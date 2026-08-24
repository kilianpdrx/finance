import { describe, it, expect } from 'vitest';
import { groupByAccount, orderCategoryTree } from './group';
import type { Account } from './api/hooks';

const acc = (id: number, name: string) => ({ id, name }) as Account;

describe('groupByAccount', () => {
  const accounts = [acc(1, 'Compte courant'), acc(2, 'Livret A')];

  it('place le global en tête, puis chaque compte dans l’ordre de la liste', () => {
    const items = [
      { account_id: 2, k: 'b' },
      { account_id: null, k: 'g' },
      { account_id: 1, k: 'a' },
    ];
    expect(groupByAccount(items, accounts).map((g) => g.key)).toEqual(['global', '1', '2']);
  });

  it('omet les sections vides', () => {
    const groups = groupByAccount([{ account_id: 1, k: 'a' }], accounts);
    expect(groups.map((g) => g.key)).toEqual(['1']);
  });

  it('récupère les éléments d’un compte inconnu au lieu de les perdre', () => {
    // Un compte clôturé n'est plus dans la liste ; sans ce filet, ses lignes
    // disparaîtraient de l'écran sans que rien ne le signale.
    const groups = groupByAccount([{ account_id: 99, k: 'orphan' }], accounts);
    expect(groups.map((g) => g.key)).toEqual(['other']);
    expect(groups[0].items).toHaveLength(1);
  });

  it('traite `undefined` comme global, pas comme orphelin', () => {
    const groups = groupByAccount([{ k: 'x' } as { account_id?: number | null; k: string }], accounts);
    expect(groups.map((g) => g.key)).toEqual(['global']);
  });
});

describe('orderCategoryTree', () => {
  it('place chaque enfant juste après son parent', () => {
    const cats = [
      { id: 1, parent_id: null },
      { id: 2, parent_id: null },
      { id: 11, parent_id: 1 },
      { id: 21, parent_id: 2 },
      { id: 12, parent_id: 1 },
    ];
    expect(orderCategoryTree(cats).map((r) => [r.cat.id, r.child]))
      .toEqual([[1, false], [11, true], [12, true], [2, false], [21, true]]);
  });

  it('remonte au premier niveau un enfant dont le parent est absent', () => {
    // Arrive quand le parent est archivé ou filtré : l'enfant doit rester
    // visible plutôt que disparaître avec son parent.
    const cats = [{ id: 5, parent_id: 999 }];
    expect(orderCategoryTree(cats)).toEqual([{ cat: cats[0], child: false }]);
  });

  it('ne perd aucune catégorie', () => {
    const cats = [
      { id: 1, parent_id: null },
      { id: 11, parent_id: 1 },
      { id: 7, parent_id: 404 },
      { id: 2, parent_id: null },
    ];
    expect(orderCategoryTree(cats)).toHaveLength(cats.length);
  });

  it('gère une liste vide', () => {
    expect(orderCategoryTree([])).toEqual([]);
  });
});
