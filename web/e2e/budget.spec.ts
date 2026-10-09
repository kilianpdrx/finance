import { test, expect, expectAppReady, useProfile, type Api } from "./fixtures";

/**
 * The budget table: every amount is a sum of transactions, and the user must be
 * able to see which ones — and to tell at a glance whether a balance is positive.
 *
 * Dates are relative to today because the table opens on the current month.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const lastMonth = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;

// Too long for the panel's one-line rows: it is cut there, and shown whole on hover.
const LONG_LABEL = "CARTE X1234 FRANPRIX 5107 PARIS 12 AVENUE DE LA REPUBLIQUE MAGASIN DU CENTRE VILLE";

async function budgetProfile(api: Api, name: string) {
  const profile = await api.createProfile(name);
  api.profileId = profile.id;
  const account = await api.createAccount({ name: "Compte courant", bank_name: "Banque Test" });
  await api.setFixedExpense("Logement");
  await api.importCsv(account.id, [
    "Date;Libelle;Montant",
    // Last month: rent only → both balances are negative.
    `${lastMonth}-03;PRLV SEPA LOYER DUPONT;-620,00`,
    // This month: salary, rent, two grocery runs → both balances are positive.
    `${thisMonth}-01;VIREMENT SALAIRE ACME;1850,00`,
    `${thisMonth}-01;PRLV SEPA LOYER DUPONT;-620,00`,
    `${thisMonth}-01;CARTE X1234 FRANPRIX 5106 PARIS 11;-23,40`,
    `${thisMonth}-02;${LONG_LABEL};-18,10`,
  ].join("\n") + "\n");
  return profile;
}

test.describe("Budget", () => {
  test("cliquer un montant liste ses transactions à droite du tableau", async ({ page, api }) => {
    const profile = await budgetProfile(api, "Budget détail E2E");
    try {
      await useProfile(page, profile.id);
      await page.goto("/budget");
      await expectAppReady(page);

      const panel = page.getByRole("complementary", { name: "Transactions de la cellule sélectionnée" });
      await expect(panel.getByText("Cliquez sur une cellule")).toBeVisible();

      // 23,40 + 18,10: the month cell comes before the year total in the row.
      const groceries = page.getByRole("row", { name: /Alimentation/ }).locator("td", { hasText: "41,5" });
      await groceries.first().click();
      await expect(panel.getByText("Alimentation")).toBeVisible();
      await expect(panel.getByText(/FRANPRIX 5106/)).toBeVisible();
      await expect(panel.getByText(/FRANPRIX 5107/)).toBeVisible();
      await expect(panel.getByText("2 transactions")).toBeVisible();
      await expect(panel.getByText(/LOYER/)).toHaveCount(0);

      // The year total of the same row covers the whole year.
      await groceries.last().click();
      await expect(panel.getByText(/Année \d{4}/)).toBeVisible();
      await expect(panel.getByText("2 transactions")).toBeVisible();

      // A section total lists the transactions of every category it adds up.
      await page.getByRole("row", { name: /TOTAL DÉPENSES FIXES/ }).locator("td", { hasText: "620,0" }).last().click();
      await expect(panel.getByText("TOTAL DÉPENSES FIXES")).toBeVisible();
      await expect(panel.getByText(/LOYER DUPONT/).first()).toBeVisible();
      await expect(panel.getByText(/FRANPRIX/)).toHaveCount(0);

      // A single click selects; a double click still opens the manual adjustment.
      await groceries.first().dblclick();
      await expect(page.locator("tbody input")).toBeVisible();
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("une transaction du panneau montre son libellé entier et change de catégorie", async ({ page, api }) => {
    const profile = await budgetProfile(api, "Budget édition E2E");
    try {
      await useProfile(page, profile.id);
      await page.goto("/budget");
      await expectAppReady(page);

      const panel = page.getByRole("complementary", { name: "Transactions de la cellule sélectionnée" });
      const groceries = page.getByRole("row", { name: /Alimentation/ }).locator("td", { hasText: "41,5" });
      await groceries.first().click();
      await expect(panel.getByText("2 transactions")).toBeVisible();

      // Hover: the label is cut in the list, the whole of it floats next to the row.
      const row = panel.getByRole("button", { name: /FRANPRIX 5107/ });
      await row.hover();
      await expect(page.getByRole("tooltip")).toHaveText(LONG_LABEL);

      // Click: a category picker opens in place. Moving the transaction updates
      // the table, the panel's list and the panel's amount together.
      await row.click();
      await panel.getByRole("combobox").click();
      await page.getByRole("option", { name: /Restaurants/ }).click();
      await expect(page.getByText("Classée en Restaurants")).toBeVisible();

      await expect(panel.getByText("1 transaction", { exact: true })).toBeVisible();
      await expect(panel.getByText(/FRANPRIX 5107/)).toHaveCount(0);
      await expect(panel.getByText(/23,40/).first()).toBeVisible();
      await expect(page.getByRole("row", { name: /Alimentation/ }).locator("td", { hasText: "23,4" }).first()).toBeVisible();
      await expect(page.getByRole("row", { name: /Restaurants/ }).locator("td", { hasText: "18,1" }).first()).toBeVisible();
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("les soldes sont verts au-dessus de zéro et rouges en dessous", async ({ page, api }) => {
    const profile = await budgetProfile(api, "Budget soldes E2E");
    try {
      await useProfile(page, profile.id);
      await page.goto("/budget");
      await expectAppReady(page);

      // RESTE = revenus − dépenses fixes: 1850 − 620 this month, 0 − 620 last month.
      const reste = page.getByRole("row", { name: /RESTE POUR DÉPENSES VARIABLES/ });
      await expect(reste.locator("td", { hasText: /1.230,0/ }).first()).toHaveClass(/text-positive/);
      await expect(reste.locator("td", { hasText: /620,0/ }).first()).toHaveClass(/text-negative/);

      // SOLDE NET = revenus − toutes les dépenses: 1850 − 620 − 41,50, then −620.
      const solde = page.getByRole("row", { name: /SOLDE NET/ });
      await expect(solde.locator("td", { hasText: /1.188,5/ }).first()).toHaveClass(/text-positive/);
      await expect(solde.locator("td", { hasText: /620,0/ }).first()).toHaveClass(/text-negative/);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("planifier une dépense se fait avec un mois ET une année", async ({ page, api }) => {
    const profile = await budgetProfile(api, "Planifier E2E");
    try {
      await useProfile(page, profile.id);
      await page.goto("/budget");
      await expectAppReady(page);
      await page.getByRole("button", { name: "Planifier", exact: true }).click();

      const dialog = page.getByRole("dialog", { name: "Planifier un montant" });
      await dialog.getByRole("combobox").filter({ hasText: "Choisir une catégorie" }).click();
      await page.getByRole("option", { name: /Alimentation/ }).click();
      await dialog.getByRole("spinbutton").first().fill("250");

      // The month is a list, the year a field next to it: March of next year.
      await dialog.getByRole("combobox", { name: "Mois : mois" }).click();
      await page.getByRole("option", { name: "mars", exact: true }).click();
      await dialog.getByLabel("Mois : année").fill("2027");

      // Repeating until a given month: it starts a year after the first one…
      await dialog.getByRole("button", { name: "Récurrent" }).click();
      await dialog.getByRole("combobox").filter({ hasText: "La fin de l'année" }).click();
      await page.getByRole("option", { name: "Un mois précis" }).click();
      const endYear = dialog.getByLabel("Mois de fin : année");
      await expect(endYear).toHaveValue("2028");
      await expect(dialog.getByRole("combobox", { name: "Mois de fin : mois" })).toContainText("mars");

      // …and an end before the start is refused, not silently planned.
      const plan = dialog.getByRole("button", { name: "Planifier" });
      await endYear.fill("2026");
      await expect(dialog.getByRole("alert")).toHaveText("Le mois de fin précède le mois de départ.");
      await expect(plan).toBeDisabled();

      await endYear.fill("2027");
      await dialog.getByRole("combobox", { name: "Mois de fin : mois" }).click();
      await page.getByRole("option", { name: "mai", exact: true }).click();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      await plan.click();

      await expect(page.getByText("3 dépense(s) planifiée(s)")).toBeVisible();
      const planned = await api.plannedExpenses();
      expect(planned.map((p) => p.month).sort()).toEqual(["2027-03", "2027-04", "2027-05"]);
      expect(planned.every((p) => p.amount_cents === 25000)).toBe(true);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});
