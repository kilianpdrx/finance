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
});
