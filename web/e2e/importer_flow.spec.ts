import { test, expect } from "@playwright/test";

test.describe("CSV Importer E2E Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/profiles", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1, name: "Kilian", color: "#6366f1", is_default: true, enabled_modules: ["banking", "budgeting", "investments"] }]),
      });
    });

    await page.route("**/api/accounts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1, name: "Compte Courant", bank_name: "Revolut", account_type: "courant", currency: "EUR" }]),
      });
    });

    await page.route("**/api/categories", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
  });

  test("Importer page loads dropzone and account selector", async ({ page }) => {
    await page.goto("/importer");

    // Verify Importer page content
    await expect(page.getByText("Compte destination")).toBeVisible();
    await expect(page.getByText(/glissez-déposez votre relevé csv/i)).toBeVisible();
    await expect(page.getByText("Sélectionner un fichier")).toBeVisible();
  });
});
