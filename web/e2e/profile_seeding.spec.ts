import { test, expect, expectAppReady, useProfile } from "./fixtures";

/**
 * A6: `create_profile` used to insert a row and nothing else, and the seeding
 * guard counted categories globally — so every profile after the first landed on
 * zero categories, zero rules and no auto-categorisation. This spec is the
 * end-to-end version of that: a second household member must find a working app.
 */
test.describe("Nouveau profil", () => {
  test("un nouveau profil arrive avec ses catégories par défaut", async ({ page, api }) => {
    const created = await api.createProfile("Profil E2E");
    try {
      const cats = await api.categories(created.id);
      expect(cats.length).toBeGreaterThan(0);

      await useProfile(page, created.id);
      await page.goto("/parametres");
      await expectAppReady(page);
      await page.getByRole("tab", { name: "Catégories" }).click();

      // A category every default install has.
      await expect(page.getByText("Alimentation").first()).toBeVisible();
    } finally {
      await api.deleteProfile(created.id);
    }
  });

  test("les catégories d'un profil ne fuient pas dans un autre", async ({ api }) => {
    const created = await api.createProfile("Profil Cloisonné E2E");
    try {
      const theirs = await api.categories(created.id);
      const ours = await api.categories(api.profileId);
      const theirIds = new Set(theirs.map((c: { id: number }) => c.id));

      expect(theirs.length).toBeGreaterThan(0);
      expect(ours.some((c: { id: number }) => theirIds.has(c.id))).toBe(false);
    } finally {
      await api.deleteProfile(created.id);
    }
  });
});
