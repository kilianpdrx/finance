import { test, expect, expectAppReady, useProfile } from "./fixtures";

test.describe("Comptes", () => {
  test("un compte créé via l'API s'affiche avec sa banque", async ({ page, api }) => {
    await api.createAccount({ name: "Compte Courant E2E", bank_name: "LCL" });

    await page.goto("/comptes");
    await expectAppReady(page);

    await expect(page.getByText("Compte Courant E2E").first()).toBeVisible();
    await expect(page.getByText("LCL").first()).toBeVisible();
  });

  test("le dialogue de création s'ouvre", async ({ page }) => {
    await page.goto("/comptes");
    await expectAppReady(page);

    await page.getByRole("button", { name: /nouveau compte/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByPlaceholder(/ex: compte courant/i)).toBeVisible();
  });

  test("un compte clôturé reste consultable", async ({ page, api }) => {
    // P3: closing an account is a soft close — the history stays, only the
    // balance leaves net worth. If it vanished from the UI the money would
    // look lost.
    const acc = await api.createAccount({ name: "Livret Fermé E2E", bank_name: "BNP" });

    await page.goto("/comptes");
    await expectAppReady(page);
    await expect(page.getByText("Livret Fermé E2E").first()).toBeVisible();
    expect(acc.is_active).toBe(true);
  });

  test("un compte clôturé peut être supprimé définitivement, avec ce qu'il contient", async ({ page, api }) => {
    const profile = await api.createProfile("Suppression compte E2E");
    api.profileId = profile.id;
    try {
      const kept = await api.createAccount({ name: "Compte gardé", bank_name: "Banque Test" });
      const old = await api.createAccount({ name: "Ancien compte", bank_name: "Vieille Banque" });
      await api.importCsv(kept.id, "Date;Libelle;Montant\n2026-09-01;ACHAT GARDE;-10,00\n");
      await api.importCsv(old.id, "Date;Libelle;Montant\n2026-01-05;ACHAT ANCIEN;-25,00\n2026-02-05;ACHAT ANCIEN;-31,00\n");
      await api.addSnapshot(old.id, { date: "2026-02-28", amount_cents: 14400 });

      await useProfile(page, profile.id);
      await page.goto("/comptes");
      await expectAppReady(page);

      // An open account can only be closed: deleting is offered once it is.
      await expect(page.getByRole("button", { name: "Supprimer définitivement" })).toHaveCount(0);
      await api.closeAccount(old.id);
      await page.reload();
      await expectAppReady(page);
      await page.getByRole("button", { name: /Comptes clôturés · 1/ }).click();
      await page.getByRole("button", { name: "Supprimer définitivement" }).click();

      // The confirmation says what goes with the account.
      const confirm = page.getByRole("dialog", { name: "Supprimer définitivement « Ancien compte » ?" });
      await expect(confirm).toContainText("2 transaction(s)");
      await expect(confirm).toContainText("1 relevé(s) de solde");
      await expect(confirm).toContainText("Paramètres → Sauvegarde");

      // Cancelling deletes nothing.
      await confirm.getByRole("button", { name: "Annuler" }).click();
      expect(await api.transactionCount()).toBe(3);

      await page.getByRole("button", { name: "Supprimer définitivement" }).click();
      await confirm.getByRole("button", { name: "Supprimer définitivement" }).click();
      await expect(page.getByText("Compte « Ancien compte » supprimé définitivement")).toBeVisible();
      await expect(page.getByRole("button", { name: /Comptes clôturés/ })).toHaveCount(0);

      // Gone with its history; the other account is untouched.
      expect((await api.accounts(true)).map((a) => a.name)).toEqual(["Compte gardé"]);
      expect(await api.transactionCount()).toBe(1);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});
