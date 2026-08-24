/**
 * Les types d'actif d'une position, et leurs libellés.
 *
 * Cette table était recopiée dans quatre composants, qui ont fini par diverger :
 * la revue d'import ne connaissait pas `cash` et affichait « cash » brut à la place
 * de « Liquidités ». Un seul endroit, donc — ajouter un type ici suffit.
 *
 * Deux formes de libellé, volontairement : le singulier désigne UNE position
 * (tableau, sélecteur), le pluriel une CATÉGORIE (part du donut de répartition).
 * Les aplatir ferait lire « Action 64 % » sur un graphique de répartition.
 */
export const CASH_ASSET_TYPE = "cash";

export const ASSET_TYPES = [
  { value: "stock", label: "Action", plural: "Actions" },
  { value: "etf", label: "ETF", plural: "ETFs" },
  { value: "crypto", label: "Crypto", plural: "Crypto" },
  { value: "bond", label: "Obligation", plural: "Obligations" },
  { value: "fund", label: "Fonds", plural: "Fonds" },
  { value: CASH_ASSET_TYPE, label: "Liquidités", plural: "Liquidités" },
] as const;

export type AssetType = (typeof ASSET_TYPES)[number]["value"];

const BY_VALUE = new Map(ASSET_TYPES.map((t) => [t.value as string, t]));

/** Libellé d'une position. Un type inconnu retombe sur sa valeur brute plutôt que
 *  sur du vide : mieux vaut afficher « warrant » que rien. */
export function assetTypeLabel(type: string): string {
  return BY_VALUE.get(type)?.label ?? type;
}

/** Libellé d'un groupe de positions. `other` est le fourre-tout de l'analytique
 *  côté backend (`allocation_by_type`), il n'a pas de type de position associé. */
export function assetTypeLabelPlural(type: string): string {
  if (type === "other") return "Autre";
  return BY_VALUE.get(type)?.plural ?? type;
}

export function isCashType(type: string | null | undefined): boolean {
  return type === CASH_ASSET_TYPE;
}
