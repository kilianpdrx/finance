import { test, expect, expectAppReady, useProfile, type Api } from "./fixtures";

/**
 * Classifying a first import. One row at a time is what a first-time user gave up
 * on: the same shop appears a dozen times, each with its own reference number.
 *
 * Labels are invented and match none of the default rules, so they import
 * uncategorised. Each test works in its own profile.
 */
const BIOCOOP = [
  "2026-07-03;CARTE X1234 03/07 BIOCOOP 2231 LYON 03;-42,00",
  "2026-08-05;CARTE X1234 05/08 BIOCOOP 2231 LYON 03;-38,50",
  "2026-09-02;CARTE X1234 02/09 BIOCOOP 2231 LYON 03;-45,20",
];
const OTHER = "2026-09-09;ZZZ INCONNU;-12,00";
const csv = (rows: string[]) => ["Date;Libelle;Montant", ...rows].join("\n") + "\n";

async function profileWith(api: Api, name: string, rows: string[]) {
  const profile = await api.createProfile(name);
  api.profileId = profile.id;
  const account = await api.createAccount({ name: "Compte courant", bank_name: "Banque Test" });
  await api.importCsv(account.id, csv(rows));
  return profile;
}

test.describe("Transactions", () => {
  test("classer une transaction propose de classer les autres du même libellé", async ({ page, api }) => {
    const profile = await profileWith(api, "Même libellé E2E", [...BIOCOOP, OTHER]);
    try {
      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);
      await expect(page.getByRole("button", { name: /4 sans catégorie/ })).toBeVisible();

      await page.getByRole("row", { name: /BIOCOOP/ }).first().getByRole("combobox").click();
      await page.getByRole("option", { name: /Alimentation/ }).click();

      // Offered, not done: the two other rows are still uncategorised.
      await expect(page.getByText(/2 autres transactions sans catégorie/)).toBeVisible();
      await expect(page.getByText(/BIOCOOP LYON/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /3 sans catégorie/ })).toBeVisible();

      await page.getByRole("button", { name: "Les classer en Alimentation" }).click();
      await expect(page.getByText("2 transactions classées en Alimentation")).toBeVisible();
      // Only the unrelated label is left.
      await expect(page.getByRole("button", { name: /1 sans catégorie/ })).toBeVisible();
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("le panneau « sans catégorie » classe un libellé entier", async ({ page, api }) => {
    const profile = await profileWith(api, "Par libellé E2E", [...BIOCOOP, OTHER]);
    try {
      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);

      await page.getByRole("button", { name: /4 sans catégorie/ }).click();
      const panel = page.getByRole("dialog", { name: "Classer par libellé" });
      // The most frequent label comes first.
      const first = panel.getByRole("listitem").first();
      await expect(first).toContainText("BIOCOOP LYON");
      await expect(first).toContainText("3×");

      await first.getByRole("combobox").click();
      await page.getByRole("option", { name: /Alimentation/ }).click();

      await expect(page.getByText("3 transactions classées en Alimentation")).toBeVisible();
      await expect(panel.getByText("BIOCOOP LYON")).toHaveCount(0);
      await expect(panel.getByRole("listitem")).toHaveCount(1);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("une règle se crée depuis la page, sans passer par les Paramètres", async ({ page, api }) => {
    const profile = await profileWith(api, "Règle depuis Transactions E2E", [OTHER]);
    try {
      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);

      await page.getByRole("button", { name: "Nouvelle règle" }).click();
      const dialog = page.getByRole("dialog", { name: "Nouvelle règle" });
      await expect(dialog.getByPlaceholder("Valeur")).toHaveValue("");

      await dialog.getByPlaceholder("Valeur").fill("zzz inconnu");
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: /Divers/ }).click();
      await dialog.getByRole("button", { name: "Enregistrer" }).click();

      // The usual follow-up: the rule can be applied straight away.
      const confirm = page.getByRole("dialog", { name: "Règle créée" });
      await confirm.getByRole("button", { name: "Appliquer" }).click();
      await expect(page.getByRole("row", { name: /ZZZ INCONNU/ }).getByText("Divers")).toBeVisible();
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("la recherche trouve aussi un montant", async ({ page, api }) => {
    const profile = await profileWith(api, "Recherche montant E2E", [
      "2026-09-20;BOUTIQUE ALPHA;-10,00",
      "2026-09-10;BOUTIQUE BETA;-300,00",
      "2026-09-15;BOUTIQUE GAMMA 300;-50,00",
    ]);
    try {
      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);
      const search = page.getByPlaceholder("Rechercher un libellé ou un montant…");
      const rows = page.locator("tbody tr");

      // An amount with its cents: that transaction only.
      await search.fill("300,00");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("BOUTIQUE BETA");

      // A bare number: the amount, and the labels that contain it.
      await search.fill("300");
      await expect(rows).toHaveCount(2);

      // Text still searches labels.
      await search.fill("alpha");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("BOUTIQUE ALPHA");
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("les colonnes se trient", async ({ page, api }) => {
    const profile = await profileWith(api, "Tri E2E", [
      "2026-09-20;BOUTIQUE ALPHA;-10,00",
      "2026-09-10;BOUTIQUE BETA;-300,00",
      "2026-09-15;BOUTIQUE GAMMA;-50,00",
    ]);
    try {
      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);

      const firstRow = page.locator("tbody tr").first();
      await expect(firstRow).toContainText("BOUTIQUE ALPHA");        // default: most recent first

      await page.getByRole("button", { name: "Trier par montant" }).click();
      await expect(firstRow).toContainText("BOUTIQUE BETA");         // biggest amount first

      await page.getByRole("button", { name: "Trier par date" }).click();
      await expect(firstRow).toContainText("BOUTIQUE BETA");         // oldest first
      await page.getByRole("button", { name: "Trier par description" }).click();
      await expect(firstRow).toContainText("BOUTIQUE ALPHA");        // A → Z
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("le compte a sa colonne, et un virement interne n'est pas « sans catégorie »", async ({ page, api }) => {
    const profile = await api.createProfile("Colonne compte E2E");
    api.profileId = profile.id;
    try {
      const courant = await api.createAccount({ name: "Compte courant", bank_name: "Banque Test" });
      const livret = await api.createAccount({ name: "Livret Bleu", bank_name: "Banque Test", account_type: "epargne" });
      await api.importCsv(courant.id, csv([...BIOCOOP, "2026-09-04;VIR VERS LIVRET BLEU;-300,00"]));
      await api.importCsv(livret.id, csv(["2026-09-04;VIR DEPUIS COMPTE COURANT;300,00"]));

      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);
      await page.getByRole("button", { name: "Détecter virements" }).click();

      // Two halves of a transfer have no category on purpose: they are counted
      // as transfers, not as work left to do.
      await expect(page.getByText(/2 virements?/)).toBeVisible();
      await expect(page.getByRole("button", { name: /3 sans catégorie/ })).toBeVisible();

      // The account is a column of its own, and the table sorts on it.
      await page.getByRole("switch").click();   // show the transfers again
      const byAccount = page.getByRole("button", { name: "Trier par compte" });
      const rows = page.locator("tbody tr");
      await expect(rows).toHaveCount(5);
      await byAccount.click();                                         // A → Z
      await expect(rows.first().getByRole("cell").nth(3)).toHaveText("Compte courant");
      await byAccount.click();                                         // Z → A
      await expect(rows.first().getByRole("cell").nth(3)).toHaveText("Livret Bleu");
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("une transaction classée par une règle porte « auto », et le filtre les sépare", async ({ page, api }) => {
    const profile = await api.createProfile("Auto E2E");
    api.profileId = profile.id;
    try {
      const account = await api.createAccount({ name: "Compte courant", bank_name: "Banque Test" });
      // The rule exists before the import: the three BIOCOOP rows arrive classified by it.
      await api.createContainsRule("Alimentation", "BIOCOOP");
      await api.importCsv(account.id, csv([...BIOCOOP, OTHER]));

      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);

      const auto = page.getByTitle("Classée automatiquement par une règle");
      await expect(auto).toHaveCount(3);

      // A category chosen by hand is not "auto".
      await page.getByRole("row", { name: /ZZZ INCONNU/ }).getByRole("combobox").click();
      await page.getByRole("option", { name: /Loisirs/ }).click();
      await expect(page.getByRole("row", { name: /ZZZ INCONNU/ })).toContainText("Loisirs");
      await expect(auto).toHaveCount(3);

      const rows = page.locator("tbody tr");
      const filter = page.getByRole("combobox").filter({ hasText: "Tout classement" });
      await filter.click();
      await page.getByRole("option", { name: "Classées à la main" }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("ZZZ INCONNU");

      await page.getByRole("combobox").filter({ hasText: "Classées à la main" }).click();
      await page.getByRole("option", { name: "Classées automatiquement" }).click();
      await expect(rows).toHaveCount(3);
      await expect(page.getByRole("row", { name: /ZZZ INCONNU/ })).toHaveCount(0);

      // Re-classifying an "auto" row by hand removes its badge.
      await rows.first().getByRole("combobox").click();
      await page.getByRole("option", { name: /Loisirs/ }).click();
      await expect(rows).toHaveCount(2);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("« Récurrents » liste les libellés qui reviennent, depuis la page Transactions", async ({ page, api }) => {
    const profile = await profileWith(api, "Récurrents E2E", [...BIOCOOP, OTHER]);
    try {
      await useProfile(page, profile.id);
      await page.goto("/transactions");
      await expectAppReady(page);
      await page.getByRole("tab", { name: "Récurrents" }).click();

      const row = page.getByRole("row", { name: /BIOCOOP LYON/ });
      await expect(row).toContainText("3×");
      // A label seen once is not recurring.
      await expect(page.getByRole("row", { name: /ZZZ INCONNU/ })).toHaveCount(0);
      // Expenses and income are listed apart.
      await page.getByRole("button", { name: "Revenus", exact: true }).click();
      await expect(page.getByText("Aucun revenu récurrent détecté")).toBeVisible();
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});
