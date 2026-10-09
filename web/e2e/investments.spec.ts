import { test, expect, expectAppReady, useProfile } from "./fixtures";

/**
 * Investissements → Synthèse: four figures, then where the money is. The
 * portfolio is invented and needs no market price — cash is worth what it is,
 * and the other account is followed by statements.
 *
 *   PEA             1 500 € of cash                         → no gain
 *   Assurance-vie   10 000 € paid in, 10 500 € a month later → +500 €
 */
test.describe("Investissements · Synthèse", () => {
  test("les quatre chiffres, puis chaque compte avec sa part et sa plus-value", async ({ page, api }) => {
    const profile = await api.createProfile("Synthèse E2E");
    api.profileId = profile.id;
    try {
      const pea = await api.createAccount({ name: "PEA Synthèse", bank_name: "Courtier Test", account_type: "investissement" });
      await api.addHolding(pea.id, { ticker: "cash", name: "", quantity: 1500, cost_basis_cents: 0, currency: "EUR", asset_type: "cash" });
      const av = await api.createAccount({ name: "Assurance-vie Synthèse", bank_name: "Assureur Test", account_type: "investissement" });
      await api.addSnapshot(av.id, { date: "2026-08-31", amount_cents: 1_000_000, contribution_cents: 1_000_000 });
      await api.addSnapshot(av.id, { date: "2026-09-30", amount_cents: 1_050_000 });

      await useProfile(page, profile.id);
      await page.goto("/investissements");
      await expectAppReady(page);

      const main = page.locator("main");
      // 1 500 + 10 500; +500 on the 11 500 put in.
      await expect(main.getByText("Valeur totale").locator("xpath=ancestor::div[contains(@class,'p-5')][1]")).toContainText(/12\s000\s€/);
      const gain = main.getByText("Plus-value", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'p-5')][1]");
      await expect(gain).toContainText(/\+500\s€/);
      await expect(gain).toContainText(/4,3\s%/);
      await expect(main.getByText("Dividendes estimés / an")).toBeVisible();

      // One line per account, the largest first, with its share of the whole.
      const byAccount = main.locator("table").filter({ hasText: "Part du total" }).filter({ hasText: "Suivi" });
      const rows = byAccount.locator("tbody tr");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText("Assurance-vie Synthèse");
      await expect(rows.nth(0)).toContainText("Long terme");
      await expect(rows.nth(0)).toContainText(/87,5\s%/);
      await expect(rows.nth(0)).toContainText("5.0%");
      await expect(rows.nth(1)).toContainText("PEA Synthèse");
      await expect(rows.nth(1)).toContainText("Live");
      await expect(rows.nth(1)).toContainText(/12,5\s%/);

      // Cash is a position like another in "where is the money".
      await expect(main.getByText("Principales positions")).toBeVisible();
      await expect(main.getByText("CASH.EUR")).toBeVisible();

      // A row opens the account, unfolded, in its own tab.
      await byAccount.getByRole("button", { name: "Assurance-vie Synthèse" }).click();
      await expect(page.getByRole("tab", { name: /^Long terme/ })).toHaveAttribute("data-state", "active");
      await expect(page.getByText("Relevés manuels (2)")).toBeVisible();
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});
