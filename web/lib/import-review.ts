/** The import review's choices, kept by ROW rather than by `import_hash`.
 *
 *  The hash includes the destination account, so it changes when the user picks
 *  another account and the preview runs again. The file and its row order do
 *  not change: a choice made on row 3 is still row 3's. The choices become
 *  hashes only for confirming, from the rows as they are then. */

export interface ReviewRow { import_hash: string; is_duplicate: boolean }

export function choicesForConfirm<T extends ReviewRow>(
  rows: T[],
  overrides: Record<number, number | null>,
  force: Set<number>,
): { overrides: Record<string, number | null>; force: string[] } {
  const byHash: Record<string, number | null> = {};
  for (const [row, category] of Object.entries(overrides)) {
    const t = rows[Number(row)];
    if (t) byHash[t.import_hash] = category;
  }
  // Only a row that is (still) a duplicate needs forcing.
  return { overrides: byHash, force: [...force].filter((i) => rows[i]?.is_duplicate).map((i) => rows[i].import_hash) };
}
