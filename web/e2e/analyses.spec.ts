import { test, expect, expectAppReady, useProfile } from "./fixtures";

/**
 * Analyses speak the selected accounts' currency: one CHF account alone is shown
 * in CHF, untouched — as the budget table does — not converted into the base
 * currency and labelled €.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

test.describe("Analyses", () => {
  test("un compte en CHF sélectionné seul s'affiche en CHF", async ({ page, api }) => {
    const profile = await api.createProfile("Analyses CHF E2E");
    api.profileId = profile.id;
    try {
      await api.createAccount({ name: "Konto EUR", bank_name: "Bank A", currency: "EUR" });
      const chf = await api.createAccount({ name: "UBS Courant", bank_name: "UBS", currency: "CHF" });
      await api.importCsv(chf.id, ["Date;Libelle;Montant", `${thisMonth}-01;COOP ZURICH HB;-142,50`].join("\n") + "\n");
      const [coop] = await api.transactions({ search: "COOP" });
      await api.setCategory(coop.id, "Alimentation");

      await useProfile(page, profile.id);
      await page.goto("/analyses");
      await expectAppReady(page);
      await page.getByRole("button", { name: "UBS Courant", exact: true }).click();
      const row = page.getByRole("row", { name: /Alimentation/ }).first();
      await expect(row).toContainText(/143\sCHF|142,50\sCHF/);
      await expect(row).not.toContainText("€");
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});
