/** The board's widgets, and how a saved layout is read.
 *
 *  A situation (a backend "pack") proposes its widgets in order; the user hides,
 *  shows and reorders them. The layout is saved per profile (setting
 *  `payroll_board`) as the ids in order plus the hidden ones. A widget added in
 *  a later version is not in anyone's saved layout: `mergeLayout` shows it,
 *  right after the widget it follows by default — at the end of a long board
 *  it went unseen. */

export const WIDGETS: Record<string, { title: string; description: string }> = {
  month: { title: "Le mois", description: "Du brut au net versé, ligne par ligne." },
  evolution: { title: "Évolution", description: "Brut, cotisations, impôt et net, mois par mois ou par année." },
  ytd: { title: "Depuis janvier", description: "Les totaux de l'année, face aux mêmes mois de l'an dernier." },
  rates: { title: "Taux", description: "Cotisations, impôt, autres retenues et le tout, en part du brut : mois par mois et année par année." },
  deposits: { title: "Versements", description: "Le salaire retrouvé sur le compte, mois par mois." },
  payslips: { title: "Fiches de paie", description: "La liste : ouvrir le PDF, corriger, supprimer." },
  retained: { title: "Retenues en attente", description: "Ce que l'employeur retient jusqu'à la fin du contrat, et ce qui reste à recevoir." },
};

export interface BoardLayout {
  order: string[];
  hidden: string[];
}

export function parseLayout(text: string | null | undefined): BoardLayout | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value?.order) && Array.isArray(value?.hidden)) {
      return { order: value.order.filter((x: unknown) => typeof x === "string"), hidden: value.hidden.filter((x: unknown) => typeof x === "string") };
    }
  } catch { /* an unreadable layout is no layout */ }
  return null;
}

/** The widgets to show, in order: the saved order for those it knows, and
 *  each widget the saved layout does not know after the one it follows in the
 *  situation's defaults (first, when none of those is there). */
export function mergeLayout(saved: BoardLayout | null, defaults: string[]): { id: string; visible: boolean }[] {
  const known = defaults.filter((id) => id in WIDGETS);
  const order = [...new Set((saved?.order ?? []).filter((id) => known.includes(id)))];
  known.forEach((id, i) => {
    if (order.includes(id)) return;
    const before = known.slice(0, i).reverse().find((x) => order.includes(x));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  });
  return order.map((id) => ({ id, visible: !saved?.hidden.includes(id) }));
}

export function toLayout(items: { id: string; visible: boolean }[]): BoardLayout {
  return { order: items.map((i) => i.id), hidden: items.filter((i) => !i.visible).map((i) => i.id) };
}
