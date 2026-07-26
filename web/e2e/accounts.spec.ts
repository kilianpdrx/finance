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

const MOCK_ACCOUNTS = [
  {
    id: 1,
    profile_id: 1,
    name: "Compte Courant",
    bank_name: "LCL",
    account_type: "courant",
    currency: "EUR",
    created_at: "2026-01-01T00:00:00Z",
  },
];

const MOCK_NET_WORTH = [
  {
    date: "2026-07-23",
    total: 150000,
    "Compte Courant": 150000,
    "Compte Courant_native": 150000,
  },
];

test.describe("Accounts Page E2E Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/profiles", async (route) => {
      await route.fulfill({ status: 200, json: MOCK_PROFILES });
    });

    await page.route("**/api/settings", async (route) => {
      await route.fulfill({ status: 200, json: { base_currency: "EUR" } });
    });

    await page.route("**/api/accounts", async (route) => {
      await route.fulfill({ status: 200, json: MOCK_ACCOUNTS });
    });

    await page.route("**/api/analytics/net-worth*", async (route) => {
      await route.fulfill({ status: 200, json: MOCK_NET_WORTH });
    });
  });

  test("Loads accounts and displays balance", async ({ page }) => {
    await page.goto("/comptes");
    
    // Check that the account name is visible
    await expect(page.getByText("Compte Courant").first()).toBeVisible();
    await expect(page.getByText("LCL").first()).toBeVisible();

    // Check that the balance is visible
    await expect(page.getByText(/1.*500.*€/).first()).toBeVisible();
  });

  test("Can open add account dialog", async ({ page }) => {
    await page.goto("/comptes");
    
    await page.getByRole("button", { name: /Nouveau compte/ }).click();
    await expect(page.getByText("Nouveau compte", { exact: true }).first()).toBeVisible();
    await expect(page.getByPlaceholder("Ex: Compte courant")).toBeVisible();
  });
});
