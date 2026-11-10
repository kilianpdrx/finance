import { test, expect, expectAppReady, useProfile } from "./fixtures";

/**
 * The import preview runs the rules against the DESTINATION account: a rule
 * bound to one account fires once that account is chosen, and the bank's next
 * file opens on the account its files went to. Two current accounts, the first
 * one in EUR, a UBS one in CHF with a rule of its own.
 */
test.describe("Importer", () => {
  test("le choix du compte relance la prévisualisation, et la banque s'en souvient", async ({ page, api }) => {
    const profile = await api.createProfile("Import E2E");
    api.profileId = profile.id;
    try {
      await api.createAccount({ name: "Konto EUR", bank_name: "Bank A", currency: "EUR" });
      const ubs = await api.createAccount({ name: "UBS Courant", bank_name: "UBS", currency: "CHF" });
      await api.createContainsRule("Alimentation", "COOP", ubs.id);
      await api.saveBankProfile("UBS test");
      const csv = { name: "ubs.csv", mimeType: "text/csv", buffer: Buffer.from("Date;Libelle;Montant\n2026-10-03;COOP ZURICH HB;-42,50\n", "utf-8") };

      await useProfile(page, profile.id);
      await page.goto("/importer");
      await expectAppReady(page);
      await page.locator('input[type="file"]').setInputFiles(csv);
      await expect(page.getByText("Révision avant import")).toBeVisible();
      const row = page.getByRole("row", { name: /COOP ZURICH HB/ });
      // Opened on the first current account: the UBS rule does not apply there.
      await expect(row.getByRole("combobox")).not.toContainText("Alimentation");

      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: /UBS Courant/ }).click();
      await expect(row.getByRole("combobox")).toContainText("Alimentation");
      await page.getByRole("button", { name: /Importer 1 transaction/ }).click();
      await expect(page.getByText(/importée/i).first()).toBeVisible();

      // The next file of this bank opens on the UBS account, rule applied.
      await page.goto("/importer");
      await expectAppReady(page);
      await page.locator('input[type="file"]').setInputFiles({ ...csv, buffer: Buffer.from("Date;Libelle;Montant\n2026-10-09;COOP BERN;-18,20\n", "utf-8") });
      await expect(page.getByText("Révision avant import")).toBeVisible();
      await expect(page.getByRole("combobox").first()).toContainText("UBS Courant");
      await expect(page.getByRole("row", { name: /COOP BERN/ }).getByRole("combobox")).toContainText("Alimentation");
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});
