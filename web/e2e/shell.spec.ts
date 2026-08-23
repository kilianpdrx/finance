import { test, expect, expectAppReady } from "./fixtures";

test.describe("Coquille de l'application", () => {
  test("le tableau de bord se charge avec la navigation", async ({ page }) => {
    await page.goto("/");
    await expectAppReady(page);

    await expect(page).toHaveTitle(/Finance/i);
    const nav = page.locator("aside, nav").first();
    for (const label of ["Tableau de bord", "Transactions", "Comptes", "Paramètres"]) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("les onglets des paramètres sont présents", async ({ page }) => {
    await page.goto("/parametres");
    await expectAppReady(page);

    for (const tab of ["Général", "Catégories", "Règles", "Sauvegarde & Données"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
  });

  test("la sauvegarde propose téléchargement et restauration", async ({ page }) => {
    await page.goto("/parametres");
    await expectAppReady(page);
    await page.getByRole("tab", { name: "Sauvegarde & Données" }).click();

    await expect(page.getByText(/sauvegarde de la base/i)).toBeVisible();
    await expect(page.getByText(/restauration/i).first()).toBeVisible();
  });

  test("l'importateur affiche la zone de dépôt", async ({ page }) => {
    await page.goto("/importer");
    await expectAppReady(page);

    // « Compte destination » only appears once a file has been parsed — the
    // landing step is the dropzone and the file picker.
    await expect(page.getByText(/glissez-déposez/i)).toBeVisible();
    await expect(page.getByText(/sélectionner un fichier/i)).toBeVisible();
  });
});
