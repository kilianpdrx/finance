import { test, expect } from "@playwright/test";

const MOCK_PROFILES = [
  {
    id: 1,
    name: "Kilian",
    color: "#6366f1",
    is_default: true,
    enabled_modules: ["banking", "budgeting", "investments"],
  },
];

test.describe("Navigation & Module Adaptability E2E Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Mock profiles API endpoint
    await page.route("**/api/profiles", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PROFILES),
      });
    });

    // Mock settings API endpoint
    await page.route("**/api/settings", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ base_currency: "CHF" }),
      });
    });

    // Mock accounts API endpoint
    await page.route("**/api/accounts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
  });

  test("Dashboard loads and sidebar navigation links are present", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Finance/i);

    // Verify main navigation links
    const sidebar = page.locator("aside, nav");
    await expect(sidebar.getByText("Tableau de bord")).toBeVisible();
    await expect(sidebar.getByText("Transactions")).toBeVisible();
    await expect(sidebar.getByText("Comptes")).toBeVisible();
    await expect(sidebar.getByText("Paramètres")).toBeVisible();
  });

  test("Settings page opens and displays Modules section", async ({ page }) => {
    await page.goto("/parametres");

    // Verify Settings tabs
    await expect(page.getByText("Général")).toBeVisible();
    await expect(page.getByText("Catégories")).toBeVisible();
    await expect(page.getByText("Sauvegarde & Données")).toBeVisible();

    // Verify Modules & Fonctionnalités card
    await expect(page.getByText("Modules & Fonctionnalités")).toBeVisible();
    await expect(page.getByText("Investissements & Bourse")).toBeVisible();
    await expect(page.getByText("Budget & Prévisions")).toBeVisible();
  });
});
