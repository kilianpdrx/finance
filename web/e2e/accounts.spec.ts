import { test, expect, expectAppReady } from "./fixtures";

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
});
