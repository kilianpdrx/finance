import { test, expect, expectAppReady, useProfile, type Api } from "./fixtures";

/**
 * Rules as a first-time user meets them. Each of these was reported by a tester
 * and none was visible to a unit test alone — they live at the seam between what
 * the API returns and what the screen does with it.
 *
 * Every test works in its own profile (deleted afterwards), on invented labels.
 */

// Card payments whose label carries a reference in the MIDDLE, as real banks do.
const BIOCOOP = [
  "2026-07-03;CARTE X1234 03/07 BIOCOOP 2231 LYON 03;-42,00",
  "2026-08-05;CARTE X1234 05/08 BIOCOOP 2231 LYON 03;-38,50",
  "2026-09-02;CARTE X1234 02/09 BIOCOOP 2231 LYON 03;-45,20",
];
const csv = (rows: string[]) => ["Date;Libelle;Montant", ...rows].join("\n") + "\n";

async function freshProfile(api: Api, name: string, currency = "EUR") {
  const profile = await api.createProfile(name);
  api.profileId = profile.id;
  const account = await api.createAccount({ name: "Compte courant", bank_name: "Banque Test", currency });
  return { profile, account };
}

test.describe("Règles", () => {
  test("une règle créée depuis « Sans règle » correspond aux vraies transactions et s'applique", async ({ page, api }) => {
    const { profile, account } = await freshProfile(api, "Règles E2E");
    try {
      await api.importCsv(account.id, csv(BIOCOOP));

      await useProfile(page, profile.id);
      await page.goto("/analyses");
      await expectAppReady(page);
      await page.getByRole("tab", { name: "Sans règle" }).click();

      const row = page.getByRole("row", { name: /BIOCOOP LYON/ });
      await expect(row).toBeVisible();
      await row.hover();
      await row.getByRole("button", { name: /Règle/ }).click();

      // The cleaned-up keyword "BIOCOOP LYON" appears in no real label (a
      // reference sits between the two words): the prefill must be a fragment
      // that does, or the rule classifies nothing.
      const dialog = page.getByRole("dialog", { name: "Nouvelle règle" });
      await expect(dialog.getByPlaceholder("Valeur")).toHaveValue("BIOCOOP");
      await dialog.getByRole("button", { name: "Tester" }).click();
      await expect(dialog.getByText("3 transaction(s) correspond(ent) à ces conditions.")).toBeVisible();

      // No category is preselected: the rule cannot be saved under one nobody chose.
      const save = dialog.getByRole("button", { name: "Enregistrer" });
      await expect(save).toBeDisabled();
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: /Alimentation/ }).click();
      await save.click();

      // Saving alone changes nothing; the app must say so and offer to apply.
      const confirm = page.getByRole("dialog", { name: "Règle créée" });
      await expect(confirm.getByText(/3 transaction\(s\) sans catégorie/)).toBeVisible();
      await confirm.getByRole("button", { name: "Appliquer" }).click();

      await expect(page.getByText("3 transaction(s) catégorisée(s)")).toBeVisible();
      await expect(page.getByText(/Toutes les dépenses récurrentes sont couvertes/)).toBeVisible();
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("deux règles qui se contredisent : pas de catégorie, et le badge ouvre la règle", async ({ page, api }) => {
    const { profile, account } = await freshProfile(api, "Conflit E2E");
    try {
      // The default rules file FRANPRIX under Alimentation; this one disagrees.
      await api.createContainsRule("Transport", "franprix");
      const imported = await api.importCsv(account.id, csv(["2026-09-14;CARTE X1234 14/09 FRANPRIX 5106 PARIS 11;-31,75"]));
      expect(imported.categorized, "no rule may win a conflict").toBe(0);

      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);

      const row = page.getByRole("row", { name: /FRANPRIX/ });
      await expect(row.getByText("Sans catégorie")).toBeVisible();
      await row.getByRole("button", { name: /conflit/ }).click();

      await expect(page.getByText("Des règles se contredisent")).toBeVisible();
      await expect(page.getByText("Libellé contient « franprix »", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Modifier cette règle" }).last().click();

      const dialog = page.getByRole("dialog", { name: "Modifier la règle" });
      await expect(dialog.getByPlaceholder("Valeur")).toHaveValue("franprix");
    } finally {
      await api.deleteProfile(profile.id);
    }
  });


  test("« montant > 0 » : l'éditeur propose Sens = Revenu, et la règle laisse les dépenses", async ({ page, api }) => {
    const { profile, account } = await freshProfile(api, "Sens E2E");
    try {
      // The same label once as income and once as an expense.
      await api.importCsv(account.id, csv([
        "2026-09-01;VERSEMENT ACME CORP;1850,00",
        "2026-09-05;PRELEVEMENT ACME CORP;-40,00",
      ]));

      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);
      await page.getByRole("button", { name: "Nouvelle règle" }).click();
      const dialog = page.getByRole("dialog", { name: "Nouvelle règle" });

      await dialog.getByPlaceholder("Valeur").fill("acme corp");
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: /Revenus/ }).click();

      // Second condition: Montant > 0 — what one writes to mean "money coming in".
      await dialog.getByRole("button", { name: "Condition" }).click();
      await dialog.getByRole("combobox").nth(4).click();
      await page.getByRole("option", { name: "Montant" }).click();
      await dialog.getByPlaceholder("Valeur").nth(1).fill("0");

      // An amount has no sign in a rule: the editor says so and offers the fix.
      await expect(dialog.getByText(/Un montant se compare sans son signe/)).toBeVisible();
      await dialog.getByRole("button", { name: "Remplacer par Sens = Revenu" }).click();
      await expect(dialog.getByText(/Un montant se compare sans son signe/)).toHaveCount(0);
      await expect(dialog.getByRole("combobox", { name: "Sens" })).toHaveText("Revenu");

      await dialog.getByRole("button", { name: "Enregistrer" }).click();
      const confirm = page.getByRole("dialog", { name: "Règle créée" });
      await expect(confirm.getByText(/1 transaction\(s\) sans catégorie/)).toBeVisible();
      await confirm.getByRole("button", { name: "Appliquer" }).click();

      // The income is classified; the expense with the same label is left alone.
      await expect(page.getByRole("row", { name: /VERSEMENT ACME CORP/ }).getByText("Revenus")).toBeVisible();
      await expect(page.getByRole("row", { name: /PRELEVEMENT ACME CORP/ }).getByText("Sans catégorie")).toBeVisible();
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});

test.describe("Devise de base", () => {
  // The base currency normally follows the first account (pinned by the backend
  // tests). This is the install that predates that: totals converted to a
  // currency no account uses, with nothing on screen saying why.
  test("le tableau de bord signale une devise de base qu'aucun compte n'utilise", async ({ page, api }) => {
    const { profile } = await freshProfile(api, "Devise E2E", "EUR");
    try {
      await api.setBaseCurrency("CHF");

      await useProfile(page, profile.id);
      await page.goto("/");
      await expectAppReady(page);

      const notice = page.getByText(/Les montants sont convertis en CHF/);
      await expect(notice).toBeVisible();
      await expect(page.getByRole("link", { name: "Changer la devise de base" })).toHaveAttribute("href", "/parametres");

      await page.getByRole("button", { name: "Masquer ce message" }).click();
      await expect(notice).toHaveCount(0);
      await page.reload();
      await expectAppReady(page);
      await expect(page.getByText("Patrimoine").first()).toBeVisible();
      await expect(notice).toHaveCount(0);   // dismissed for good
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});
