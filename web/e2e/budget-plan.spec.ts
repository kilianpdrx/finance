import { test, expect, expectAppReady, useProfile, type Api } from "./fixtures";

/**
 * The monthly budget plan: a few envelopes per account, set once and checked
 * during the month.
 *
 * Dates are relative to today — the plan reads the current month, and proposes
 * amounts from the full months before it. One account, in EUR:
 *   three past months of salary (2 000), rent (700) and groceries (300);
 *   this month so far: rent, 120 of groceries, and a 900 garage bill.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const month = (offset: number) => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + offset, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const GARAGE = "CARTE X1234 GARAGE MARTIN REPARATION";

async function household(api: Api, name: string) {
  const profile = await api.createProfile(name);
  api.profileId = profile.id;
  const account = await api.createAccount({ name: "Compte courant", bank_name: "Banque Test" });
  await api.setFixedExpense("Logement");
  const rows = ["Date;Libelle;Montant"];
  for (const offset of [-3, -2, -1]) {
    rows.push(
      `${month(offset)}-02;VIREMENT SALAIRE ACME SAS;2000,00`,
      `${month(offset)}-03;PRLV LOYER RESIDENCE DES LILAS;-700,00`,
      `${month(offset)}-05;CARTE X1234 CARREFOUR MARKET LYON;-300,00`,
    );
  }
  rows.push(
    `${month(0)}-01;PRLV LOYER RESIDENCE DES LILAS;-700,00`,
    `${month(0)}-01;CARTE X1234 CARREFOUR MARKET LYON;-120,00`,
    `${month(0)}-01;${GARAGE};-900,00`,
  );
  await api.importCsv(account.id, rows.join("\n") + "\n");
  return { profile, account };
}

const PLAN = [
  { name: "Revenus", kind: "income", amount_cents: 200000, categories: ["Revenus"] },
  { name: "Logement", kind: "expense", amount_cents: 70000, categories: ["Logement"] },
  { name: "Courses", kind: "expense", amount_cents: 25000, categories: ["Alimentation"] },
  { name: "Imprévus", kind: "unplanned", amount_cents: 15000 },
];

test.describe("Plan de budget", () => {
  test("le plan part d'une proposition, s'enregistre, et se lit pendant le mois", async ({ page, api }) => {
    const { profile } = await household(api, "Plan E2E");
    try {
      await useProfile(page, profile.id);
      await page.goto("/budget");
      await expectAppReady(page);
      await page.getByRole("tab", { name: "Plan" }).click();

      // One current account: nothing to choose. No plan yet: the app proposes one.
      await expect(page.getByText("Pas encore de plan pour ce compte")).toBeVisible();
      await page.getByRole("button", { name: "Créer mon plan" }).click();
      const editor = page.getByRole("dialog", { name: "Plan de budget · Compte courant" });
      await expect(editor.getByText(/Proposition de départ/)).toBeVisible();

      // Each amount is a typical month of the last three.
      const amountOf = (envelope: string) => editor.getByRole("region", { name: envelope }).getByLabel(/Montant mensuel/);
      await expect(amountOf("Revenus")).toHaveValue("2000");
      await expect(amountOf("Dépenses fixes")).toHaveValue("700");
      await expect(amountOf("Dépenses variables")).toHaveValue("300");
      await expect(editor.getByRole("region", { name: "Dépenses fixes" }).getByRole("button", { name: "Logement" })).toBeVisible();

      // It is only a starting point: rename an envelope, lower its amount.
      const variable = editor.getByRole("region", { name: "Dépenses variables" });
      await variable.getByLabel("Nom de l'enveloppe").fill("Courses");
      await amountOf("Courses").fill("250");
      await editor.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByText("Plan enregistré")).toBeVisible();

      // The month so far, against what was planned.
      const lines = page.getByRole("list", { name: "Enveloppes" }).getByRole("listitem");
      const line = (name: string) => lines.filter({ hasText: name });
      await expect(line("Courses")).toContainText(/120\s€ dépensés/);
      await expect(line("Courses")).toContainText(/reste 130\s€/);
      await expect(line("Dépenses fixes")).toContainText(/700\s€ dépensés/);
      await expect(line("Revenus")).toContainText(/manque 2\s000\s€/);
      // The garage bill has no category: no envelope covers it, and it still shows.
      await expect(lines.filter({ hasText: "Hors enveloppes" })).toContainText(/900\s€ dépensés/);
      // 2 000 − 700 − 250, nothing set aside yet.
      await expect(page.getByText("Non affecté").locator("xpath=..")).toContainText(/\+1\s050\s€/);

      // An amount changes in place, from this month on.
      await line("Courses").getByRole("button", { name: /250\s€/ }).click();
      await page.getByLabel("Montant mensuel de Courses").fill("100");
      await page.keyboard.press("Enter");
      await expect(page.getByText(/Courses : 100\s€ par mois, à partir de ce mois-ci/)).toBeVisible();
      await expect(line("Courses")).toContainText(/dépassé de 20\s€/);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("une dépense inhabituelle est proposée, et sort de son enveloppe une fois marquée", async ({ page, api }) => {
    const { profile, account } = await household(api, "Imprévu E2E");
    try {
      const [garage] = await api.transactions({ search: "GARAGE" });
      await api.setCategory(garage.id, "Alimentation");
      await api.savePlan(account.id, PLAN);

      await useProfile(page, profile.id);
      await page.goto("/budget?vue=plan");
      await expectAppReady(page);

      const lines = page.getByRole("list", { name: "Enveloppes" }).getByRole("listitem");
      await expect(lines.filter({ hasText: "Courses" })).toContainText(/1\s020\s€ dépensés/);

      // The app asks; it does not decide. The rent, just as large, is a habit: not asked.
      const asked = page.getByRole("list", { name: "Dépenses inhabituelles" }).getByRole("listitem");
      await expect(asked).toHaveCount(1);
      await expect(asked.first()).toContainText("GARAGE MARTIN REPARATION");
      await asked.first().getByRole("button", { name: "Imprévu" }).click();
      await expect(page.getByText(/Marquée comme imprévue/)).toBeVisible();

      // It left its envelope for the provision, and is not asked about again.
      await expect(lines.filter({ hasText: "Courses" })).toContainText(/120\s€ dépensés/);
      await expect(lines.filter({ hasText: "Imprévus" })).toContainText(/900\s€ d'imprévus/);
      await expect(lines.filter({ hasText: "Imprévus" })).toContainText(/dépassé de 750\s€/);
      await expect(page.getByText(/Aucune dépense inhabituelle/)).toBeVisible();

      // Its category did not change; the transaction only carries the mark.
      await page.goto("/transactions");
      const row = page.getByRole("row", { name: /GARAGE MARTIN REPARATION/ });
      await expect(row).toContainText("imprévu");
      await expect(row).toContainText("Alimentation");
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("le détail par catégorie : une enveloppe devient la somme de ses lignes", async ({ page, api }) => {
    const { profile } = await household(api, "Détail E2E");
    try {
      await useProfile(page, profile.id);
      await page.goto("/budget?vue=plan");
      await expectAppReady(page);
      await page.getByRole("button", { name: "Créer mon plan" }).click();
      const editor = page.getByRole("dialog", { name: "Plan de budget · Compte courant" });
      await editor.getByRole("tab", { name: "Détail par catégorie" }).click();

      // One line per category, with what it usually does; the envelope is still one figure.
      const sheet = editor.getByRole("table", { name: "Détail par catégorie" });
      const variable = sheet.getByRole("rowgroup", { name: "Dépenses variables" });
      await expect(variable.getByLabel("Montant mensuel de Dépenses variables")).toHaveValue("300");
      await expect(variable.getByRole("row", { name: /Alimentation/ }).getByRole("button", { name: /300\s€/ })).toBeVisible();

      // Detail it: each category starts from its typical month, and the envelope is their sum.
      await variable.getByRole("button", { name: "Détailler avec le mois type" }).click();
      await expect(sheet.getByLabel("Montant prévu pour Alimentation")).toHaveValue("300");
      await expect(variable.getByLabel("Montant mensuel de Dépenses variables")).toHaveCount(0);

      // A category nothing held joins the envelope, with a line of its own.
      const outside = sheet.getByRole("rowgroup", { name: "Hors enveloppes" });
      await outside.getByLabel("Enveloppe de Transport").click();
      await page.getByRole("option", { name: "Dépenses variables" }).click();
      await sheet.getByLabel("Montant prévu pour Transport").fill("80");
      await expect(variable.getByRole("row").first()).toContainText(/380\s€/);
      // 2 000 − (700 + 380), nothing set aside.
      await expect(editor.getByText(/non affectés/)).toContainText(/\+920\s€/);

      // The other view shows the same plan: the amount there is the sum, not a field.
      await editor.getByRole("tab", { name: "Enveloppes" }).click();
      await expect(editor.getByRole("region", { name: "Dépenses variables" }).getByRole("button", { name: /380\s€.*détaillé/ })).toBeVisible();
      await editor.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByText("Plan enregistré")).toBeVisible();

      // In the plan, the envelope unfolds into its categories, each against its line.
      const envelopes = page.getByRole("list", { name: "Enveloppes" });
      const line = envelopes.getByRole("listitem").filter({ hasText: "Dépenses variables" });
      await expect(line).toContainText(/plafond \/ mois · détaillé/);
      await expect(line).toContainText(/reste 260\s€/);
      await line.getByRole("button", { name: "Détail de Dépenses variables" }).click();
      const categories = page.getByRole("list", { name: "Catégories de Dépenses variables" }).getByRole("listitem");
      await expect(categories).toHaveCount(2);
      await expect(categories.filter({ hasText: "Alimentation" })).toContainText(/120\s€ dépensés/);
      await expect(categories.filter({ hasText: "Alimentation" })).toContainText(/reste 180\s€/);
      await expect(categories.filter({ hasText: "Transport" })).toContainText(/reste 80\s€/);

      // An envelope kept as one figure unfolds too: what each category did, and its typical month.
      await envelopes.getByRole("button", { name: "Détail de Dépenses fixes" }).click();
      const fixed = page.getByRole("list", { name: "Catégories de Dépenses fixes" }).getByRole("listitem");
      await expect(fixed).toContainText(/700\s€ dépensés/);
      await expect(fixed).toContainText(/mois type 700\s€/);

      // The sum is not typed over: its amount opens the sheet, where it can become one figure again.
      await line.getByRole("button", { name: /^380\s€$/ }).click();
      await expect(editor.getByRole("tab", { name: "Détail par catégorie" })).toHaveAttribute("aria-selected", "true");
      await editor.getByRole("button", { name: "Revenir à un seul montant" }).click();
      const total = editor.getByLabel("Montant mensuel de Dépenses variables");
      await expect(total).toHaveValue("380");

      // Escape leaves a list or a field, never the popup: nothing typed is lost.
      await total.fill("395");
      await editor.getByLabel("Enveloppe de Transport").click();
      await expect(page.getByRole("option", { name: "Hors enveloppes" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("option", { name: "Hors enveloppes" })).toBeHidden();
      await total.focus();
      await page.keyboard.press("Escape");
      await expect(editor).toBeVisible();
      await expect(total).toHaveValue("395");
      // A click outside the box closes it, like Annuler.
      await page.mouse.click(8, 8);
      await expect(editor).toBeHidden();
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("« planifiés » est un rappel : il ne change aucun montant du plan", async ({ page, api }) => {
    const { profile, account } = await household(api, "Planifié E2E");
    try {
      await api.savePlan(account.id, PLAN);
      await api.planExpense(account.id, "Alimentation", month(0), 31000);

      await useProfile(page, profile.id);
      await page.goto("/budget?vue=plan");
      await expectAppReady(page);

      // The plan reads as it was saved: 250 of ceiling and 120 spent, 2 000 − 950 − 150 left
      // unassigned. The 310 planned in the budget table are named, and added to nothing.
      const line = page.getByRole("list", { name: "Enveloppes" }).getByRole("listitem").filter({ hasText: "Courses" });
      const unassigned = page.getByText("Non affecté").locator("xpath=..");
      await expect(line).toContainText(/reste 130\s€/);
      await expect(unassigned).toContainText(/\+900\s€/);
      await line.getByRole("button", { name: /^310\s€ planifiés ce mois-ci$/ }).click();

      const planned = page.getByRole("list", { name: "Dépenses planifiées" }).getByRole("listitem");
      await expect(page.getByText(/ne change ni le montant de l'enveloppe, ni les totaux du plan/)).toBeVisible();
      await expect(planned).toHaveCount(1);
      await expect(planned).toContainText("Alimentation");
      await expect(planned).toContainText(/310\s€/);

      // Withdrawing it removes the reminder — here and in the budget table — and no amount moves.
      await planned.getByRole("button", { name: "Retirer la dépense planifiée de Alimentation" }).click();
      await expect(page.getByText("Dépense planifiée retirée")).toBeVisible();
      await expect(line).not.toContainText("planifiés");
      await expect(line).toContainText(/reste 130\s€/);
      await expect(unassigned).toContainText(/\+900\s€/);
      expect(await api.plannedExpenses()).toHaveLength(0);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("le plan se choisit par compte : pas de « Tous »", async ({ page, api }) => {
    const { profile } = await household(api, "Comptes E2E");
    try {
      await api.createAccount({ name: "Compte joint", bank_name: "Banque Test" });
      await useProfile(page, profile.id);
      await page.goto("/budget");
      await expectAppReady(page);

      // The table adds the accounts up: « Tous » is there, and selected.
      await expect(page.getByRole("button", { name: "Tous", exact: true })).toHaveAttribute("aria-pressed", "true");

      // A plan is per account: no « Tous », the first account is shown at once.
      for (const tab of ["Plan", "Évolution"]) {
        await page.getByRole("tab", { name: tab }).click();
        await expect(page.getByRole("button", { name: "Tous", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Compte courant", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByText("Choisissez un compte")).toHaveCount(0);
      }
      await page.getByRole("tab", { name: "Plan" }).click();
      await expect(page.getByText("Pas encore de plan pour ce compte")).toBeVisible();
      await page.getByRole("button", { name: "Compte joint", exact: true }).click();
      await expect(page.getByRole("button", { name: "Compte joint", exact: true })).toHaveAttribute("aria-pressed", "true");
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("l'évolution montre chaque mois, et le tableau de bord le mois en cours", async ({ page, api }) => {
    const { profile, account } = await household(api, "Évolution E2E");
    try {
      await useProfile(page, profile.id);
      // Before any plan, the dashboard has nothing to show about it.
      await page.goto("/");
      await expectAppReady(page);
      await expect(page.getByText("Budget du mois")).toHaveCount(0);

      await api.savePlan(account.id, PLAN);
      await page.goto("/budget");
      await page.getByRole("tab", { name: "Évolution" }).click();

      // Six months, the current one flagged; one row per envelope, then what is left.
      const table = page.locator("table");
      await expect(table.getByRole("columnheader")).toHaveCount(8);
      await expect(table.getByRole("columnheader").nth(6)).toContainText("*");
      const courses = table.getByRole("row", { name: /Courses/ });
      await expect(courses.getByRole("cell").nth(5)).toHaveText(/300\s€/);      // last month
      await expect(courses.getByRole("cell").nth(6)).toHaveText(/120\s€/);      // this month so far
      await expect(table.getByRole("row", { name: /Reste du mois/ }).getByRole("cell").nth(5)).toHaveText(/\+1\s000\s€/);

      // A row's curve, full size; and a longer view.
      await courses.getByRole("button", { name: "Courses" }).click();
      await expect(page.getByRole("heading", { name: "Courses" })).toBeVisible();
      await page.getByRole("button", { name: "12 mois" }).click();
      await expect(table.getByRole("columnheader")).toHaveCount(14);

      // The same month on the dashboard, with a way back to the plan.
      await page.goto("/");
      const card = page.getByRole("list", { name: "Budget du mois" });
      await expect(card.getByRole("listitem")).toHaveCount(4);
      await expect(card.getByRole("listitem").filter({ hasText: "Courses" })).toContainText(/120\s€ dépensés/);
      await page.getByRole("link", { name: "Voir le plan" }).click();
      await expect(page).toHaveURL(/\/budget\?vue=plan&compte=\d+/);
      await expect(page.getByRole("tab", { name: "Plan" })).toHaveAttribute("data-state", "active");
      await expect(page.getByRole("list", { name: "Enveloppes" })).toBeVisible();
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});
