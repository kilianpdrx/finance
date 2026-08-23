import { test, expect, expectAppReady } from "./fixtures";

/**
 * A5: a holdings account's value supersedes its balance, so uninvested cash used
 * to disappear from net worth entirely. Cash is a holding priced at 1.00 of its
 * own currency — this checks the amount actually lands in the account total.
 */
test.describe("Liquidités", () => {
  test("les liquidités comptent dans la valeur du compte", async ({ page, api }) => {
    const acc = await api.createAccount({
      name: "PEA E2E", bank_name: "Boursorama",
      account_type: "investissement", currency: "EUR",
    });

    const cash = await api.addHolding(acc.id, {
      ticker: "cash", name: "", quantity: 1500, cost_basis_cents: 0,
      currency: "EUR", asset_type: "cash",
    });

    expect(cash.ticker).toBe("CASH.EUR");
    expect(cash.current_value_cents).toBe(150000);
    expect(cash.gain_cents).toBe(0);

    await page.goto("/investissements");
    await expectAppReady(page);
    // An account with holdings is a « Live » account; accounts without any are
    // listed under « Long terme ». Holding cash is enough to make it live.
    await page.getByRole("tab", { name: /^Live/ }).click();

    await expect(page.getByText("PEA E2E").first()).toBeVisible();
    await expect(page.getByText(/1.*500/).first()).toBeVisible();
  });

  test("une ligne de liquidités ne demande jamais de cours", async ({ page, api }) => {
    const acc = await api.createAccount({
      name: "CTO E2E", bank_name: "IBKR",
      account_type: "investissement", currency: "EUR",
    });
    await api.addHolding(acc.id, {
      ticker: "cash", name: "", quantity: 800, cost_basis_cents: 0,
      currency: "EUR", asset_type: "cash",
    });

    const historyCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/investments/history/")) historyCalls.push(req.url());
    });

    await page.goto("/investissements");
    await expectAppReady(page);
    await page.waitForTimeout(1000);

    expect(historyCalls.filter((u) => u.toUpperCase().includes("CASH."))).toEqual([]);
  });
});
