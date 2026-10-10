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
