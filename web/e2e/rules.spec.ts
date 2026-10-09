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
      await page.goto("/transactions");
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

  test("« Sans règle » : une ligne se déplie sur ses vraies transactions", async ({ page, api }) => {
    const { profile, account } = await freshProfile(api, "Déplier E2E");
    try {
      await api.importCsv(account.id, csv(BIOCOOP));

      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);
      await page.getByRole("tab", { name: "Sans règle" }).click();

      const toggle = page.getByRole("button", { name: "Voir les transactions de BIOCOOP LYON" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();

      // The keyword "BIOCOOP LYON" is a summary: what unfolds is each label as
      // the bank wrote it, most recent first, with where it stands today.
      const list = page.getByRole("list", { name: "Transactions de BIOCOOP LYON" });
      const items = list.getByRole("listitem");
      await expect(items).toHaveCount(3);
      await expect(items.nth(0)).toContainText("CARTE X1234 02/09 BIOCOOP 2231 LYON 03");
      await expect(items.nth(2)).toContainText("CARTE X1234 03/07 BIOCOOP 2231 LYON 03");
      await expect(items.nth(0)).toContainText("Compte courant");
      await expect(items.nth(0)).toContainText("Sans catégorie");

      // Clicking the row itself folds it back; "Règle" does not toggle it.
      await page.getByRole("cell", { name: "3×" }).click();
      await expect(list).toHaveCount(0);
      await page.getByRole("cell", { name: "3×" }).click();
      await expect(items).toHaveCount(3);
      await page.getByRole("button", { name: /^Règle/ }).click();
      await expect(page.getByRole("dialog", { name: "Nouvelle règle" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(items).toHaveCount(3);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("tester une règle montre la catégorie actuelle de chaque transaction", async ({ page, api }) => {
    const { profile, account } = await freshProfile(api, "Catégorie actuelle E2E");
    try {
      await api.importCsv(account.id, csv(BIOCOOP));
      const [latest] = await api.transactions({ search: "02/09" });
      await api.setCategory(latest.id, "Loisirs");

      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);
      await page.getByRole("button", { name: "Nouvelle règle" }).click();
      const dialog = page.getByRole("dialog", { name: "Nouvelle règle" });
      await dialog.getByPlaceholder("Valeur").fill("BIOCOOP");
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: /Alimentation/ }).click();
      await dialog.getByRole("button", { name: "Tester" }).click();

      await expect(dialog.getByText("3 transaction(s) correspond(ent) à ces conditions.")).toBeVisible();
      // What the rule would meet, before anything is applied.
      await expect(dialog.getByText(/2 sans catégorie · 0 déjà en « Alimentation » · 1 dans une autre catégorie/)).toBeVisible();
      await expect(dialog.getByRole("columnheader", { name: "Catégorie actuelle" })).toBeVisible();
      const rows = dialog.locator("tbody tr");
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toContainText("02/09 BIOCOOP");
      await expect(rows.nth(0).getByRole("cell").nth(3)).toHaveText("Loisirs");
      await expect(rows.nth(1).getByRole("cell").nth(3)).toHaveText("Sans catégorie");
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("réappliquer à toutes garde ce qui est classé à la main, et le signale", async ({ page, api }) => {
    const { profile, account } = await freshProfile(api, "Réappliquer E2E");
    try {
      // The rule exists before the import: the three BIOCOOP rows arrive "auto".
      await api.createContainsRule("Alimentation", "BIOCOOP");
      await api.importCsv(account.id, csv([...BIOCOOP, "2026-09-09;ZZZ INCONNU;-12,00", "2026-09-11;YYY ARTISAN DUVAL;-30,00"]));
      // By hand: one against its rule, one that no rule covers.
      const [against] = await api.transactions({ search: "02/09" });
      const [alone] = await api.transactions({ search: "ZZZ INCONNU" });
      const loisirs = await api.setCategory(against.id, "Loisirs");
      await api.setCategory(alone.id, "Loisirs");
      // A rule written afterwards: the only thing "à toutes" has to do.
      await api.createContainsRule("Logement", "ARTISAN");

      await useProfile(page, profile.id);
      await page.goto("/parametres");
      await expectAppReady(page);
      await page.getByRole("tab", { name: /Règles/ }).click();
      await page.getByRole("button", { name: /Réappliquer les règles/ }).click();
      await page.getByRole("menuitem", { name: /À toutes les transactions/ }).click();

      // Says what would change BEFORE changing it.
      const confirm = page.getByRole("dialog", { name: "Réappliquer les règles à toutes les transactions ?" });
      await expect(confirm).toContainText("1 transaction(s) classée(s) par une règle, ou sans catégorie, changeraient de catégorie.");
      await expect(confirm).toContainText("classées à la main et celles marquées « vérifié » ne sont jamais modifiées");
      await expect(confirm).toContainText("1 transaction(s) classée(s) à la main contredisent une règle");
      await confirm.getByRole("button", { name: "Réappliquer" }).click();
      await expect(page.getByText("1 transaction(s) recatégorisée(s)")).toBeVisible();

      // Both hand labels survived — including the one no rule matches, which
      // used to be wiped.
      const after = await api.transactions();
      const state = (needle: string) => {
        const t = after.find((x) => x.description.includes(needle))!;
        return [t.category_id, t.category_source];
      };
      expect(state("02/09")).toEqual([loisirs, "manual"]);
      expect(state("ZZZ INCONNU")).toEqual([loisirs, "manual"]);
      expect(state("ARTISAN")[1]).toBe("rule");

      // "Voir" leads to the disagreement, flagged on the row.
      await page.getByRole("button", { name: "Voir" }).click();
      await expect(page).toHaveURL(/\/transactions\?classement=desaccord/);
      const rows = page.locator("tbody tr");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("02/09 BIOCOOP");
      await expect(rows.first()).toContainText("Loisirs");
      await rows.first().getByRole("button", { name: "≠ règle" }).click();
      await expect(page.getByText(/Vous avez classé cette transaction en « Loisirs »\. Vos règles la classeraient\s+en « Alimentation »/)).toBeVisible();

      // Following the rule is the user's own click, and makes the row "auto".
      await page.getByRole("button", { name: "Suivre la règle : classer en « Alimentation »" }).click();
      await expect(page.getByText("Classée en Alimentation par la règle")).toBeVisible();
      await expect(rows).toHaveCount(0);
      const followed = (await api.transactions({ search: "02/09" }))[0];
      expect(followed.category_source).toBe("rule");
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
