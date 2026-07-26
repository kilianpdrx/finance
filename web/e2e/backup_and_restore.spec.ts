import { test, expect } from "@playwright/test";

test.describe("Backup & Data Export E2E Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/profiles", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1, name: "Kilian", color: "#6366f1", is_default: true, enabled_modules: ["banking", "budgeting", "investments"] }]),
      });
    });

    await page.route("**/api/settings", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ base_currency: "CHF" }),
      });
    });

    await page.route("**/api/accounts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
  });

  test("Backup tab renders download and restore actions", async ({ page }) => {
    await page.goto("/parametres");

    // Click Sauvegarde & Données tab
    await page.getByRole("tab", { name: "Sauvegarde & Données" }).click();

    // Verify sections
    await expect(page.getByText("Sauvegarde de la base de données")).toBeVisible();
    await expect(page.getByText("Restauration de la base de données")).toBeVisible();
    await expect(page.getByText(/Exportation des transactions/i)).toBeVisible();

    // Verify action buttons
    await expect(page.getByRole("link", { name: /télécharger la sauvegarde/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /exporter les transactions/i })).toBeVisible();
  });
});
