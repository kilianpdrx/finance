import type { Account } from "./api/hooks";

export interface AccountGroup<T> {
  key: string;
  label: string;
  items: T[];
}

/** Group items carrying an `account_id` into sections: global (null) first,
 *  then one section per account (in the accounts list order). Empty sections omitted. */
export function groupByAccount<T extends { account_id?: number | null }>(items: T[], accounts: Account[]): AccountGroup<T>[] {
  const groups: AccountGroup<T>[] = [
    { key: "global", label: "Tous les comptes", items: items.filter((i) => i.account_id == null) },
    ...accounts.map((a) => ({ key: String(a.id), label: a.name, items: items.filter((i) => i.account_id === a.id) })),
  ];
  // Catch any items referencing an unknown/inactive account.
  const known = new Set<number | null | undefined>([null, undefined, ...accounts.map((a) => a.id)]);
  const orphans = items.filter((i) => !known.has(i.account_id));
  if (orphans.length) groups.push({ key: "other", label: "Autres comptes", items: orphans });
  return groups.filter((g) => g.items.length > 0);
}
