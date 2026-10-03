import { test, expect, expectAppReady, useProfile } from "./fixtures";

/**
 * A first-time user created an account, landed on an empty dashboard and had no
 * idea where the bank statement goes: the welcome steps disappeared the moment
 * the first account existed. They must stay until something has been imported.
 */
test.describe("Premiers pas", () => {
  test("les étapes restent visibles jusqu'au premier import", async ({ page, api }) => {
    const profile = await api.createProfile("Premiers pas E2E");
    api.profileId = profile.id;
    try {
      await useProfile(page, profile.id);
      await page.goto("/");
      await expectAppReady(page);
      // No account yet: the welcome checklist is the whole page.
      await expect(page.getByRole("heading", { name: /Bienvenue/ })).toBeVisible();

      const account = await api.createAccount({ name: "Compte courant", bank_name: "Banque Test" });
      await page.reload();
      await expectAppReady(page);
      // Account created: the dashboard appears, with the next step above it.
      await expect(page.getByRole("heading", { name: "Votre compte est créé" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Importer un relevé/ })).toHaveAttribute("href", "/importer");
      await expect(page.getByText("Patrimoine").first()).toBeVisible();

      // The empty Transactions page points to the import as well.
      await page.goto("/transactions");
      await expectAppReady(page);
      await expect(page.getByText("Aucune transaction pour l'instant")).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: /Importer un relevé/ })).toHaveAttribute("href", "/importer");

      await api.importCsv(account.id, "Date;Libelle;Montant\n2026-09-14;CARTE X1234 14/09 FRANPRIX 5106 PARIS 11;-31,75\n");
      await page.goto("/");
      await expectAppReady(page);
      await expect(page.getByText("Patrimoine").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Votre compte est créé" })).toHaveCount(0);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });

  test("les étapes se masquent pour qui n'importe jamais", async ({ page, api }) => {
    const profile = await api.createProfile("Sans import E2E");
    api.profileId = profile.id;
    try {
      await api.createAccount({ name: "Compte courant", bank_name: "Banque Test" });
      await useProfile(page, profile.id);
      await page.goto("/");
      await expectAppReady(page);

      await page.getByRole("button", { name: "Masquer les premiers pas" }).click();
      await expect(page.getByRole("heading", { name: "Votre compte est créé" })).toHaveCount(0);
      await page.reload();
      await expectAppReady(page);
      await expect(page.getByText("Patrimoine").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Votre compte est créé" })).toHaveCount(0);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});
