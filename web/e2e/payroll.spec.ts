import { fileURLToPath } from "node:url";
import type { Locator } from "@playwright/test";
import { test, expect, expectAppReady, useProfile } from "./fixtures";

/**
 * Salaire & impôts: a situation, a payslip PDF read on this computer and
 * checked before it is saved, the salary found in the bank, a board arranged
 * by the user. The PDFs are INVENTED (e2e/files): a Zurich « Lohnabrechnung »
 * for September 2026 — 9 000 gross, a canteen line the vocabulary does not
 * know, 7 005,75 paid — and October, without the NBU line and with 310 held
 * back until the end of the contract (« Rückbehalt »).
 */
const PDF = fileURLToPath(new URL("./files/lohnabrechnung-2026-09-demo.pdf", import.meta.url));
const PDF_OCTOBER = fileURLToPath(new URL("./files/lohnabrechnung-2026-10-demo.pdf", import.meta.url));

/** The labels of a block, top to bottom. */
const labelsIn = (block: Locator) =>
  block.getByLabel("Libellé", { exact: true }).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test.describe("Salaire & impôts", () => {
  test("une fiche lue, vérifiée, enregistrée, retrouvée à la banque", async ({ page, api }) => {
    const profile = await api.createProfile("Salaire E2E");
    api.profileId = profile.id;
    try {
      await api.enableModules(profile.id, ["banking", "budgeting", "payroll"]);
      const account = await api.createAccount({ name: "Konto CHF", bank_name: "Bank Test", currency: "CHF" });
      await api.importCsv(account.id, "Date;Libelle;Montant\n2026-09-25;LOHN BEISPIEL AG;7005,75\n");

      await useProfile(page, profile.id);
      await page.goto("/salaire");
      await expectAppReady(page);

      // The situation first.
      await page.getByRole("button", { name: "Choisir ma situation" }).click();
      const situation = page.getByRole("dialog", { name: "Votre situation" });
      await situation.getByRole("radio", { name: /Suisse · Zurich/ }).click();
      await expect(situation.getByLabel("Barème de l'impôt à la source")).toHaveValue("A0N");
      await situation.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByText("Zurich · impôt à la source · A0N")).toBeVisible();

      // The PDF is read; nothing is saved before the review.
      await page.getByRole("button", { name: "Importer des fiches" }).first().click();
      const importer = page.getByRole("dialog", { name: "Importer des fiches de paie" });
      await importer.getByLabel("Fiches de paie (PDF)").setInputFiles(PDF);
      const file = importer.getByRole("button", { name: /septembre 2026/ });
      await expect(file).toContainText("à vérifier");

      // A new employer, paid into the CHF account.
      await importer.getByLabel("Employeur").click();
      await page.getByRole("option", { name: "+ Nouvel employeur…" }).click();
      await importer.getByLabel("Nom").fill("Beispiel AG");
      await importer.getByLabel("Compte où arrive le salaire").click();
      await page.getByRole("option", { name: /Konto CHF/ }).click();
      await importer.getByRole("button", { name: "Ajouter" }).click();

      // The line the app does not know is classified once; the net then adds up.
      await expect(importer.getByText(/1 ligne à classer/)).toBeVisible();
      await importer.getByLabel("Ce que fait Kantinenabzug").click();
      await page.getByRole("option", { name: "Autre retenue" }).click();
      await expect(importer.getByText("Les lignes retombent exactement sur le net versé.")).toBeVisible();
      await expect(file).toContainText("prête");

      // The PDF beside the review: drawn, zoomable, the line being checked highlighted.
      const viewer = importer.getByRole("region", { name: "Aperçu du PDF" });
      await expect(viewer.locator("canvas")).toHaveCount(1);
      const zoom = viewer.getByLabel("Zoom", { exact: true });
      const fitted = await zoom.textContent();
      await viewer.getByRole("button", { name: "Zoom avant" }).click();
      await expect(zoom).not.toHaveText(fitted ?? "");
      await importer.getByLabel("Montant de Quellensteuer A0N").click();
      await expect(viewer.getByTestId("pdf-highlight")).toBeVisible();

      // Lines in blocks, each closed by a subtotal checked against the PDF; BVG moved up.
      await expect(importer.getByRole("rowgroup", { name: "Salaire brut" })).toContainText("Total brut");
      await expect(importer.getByRole("rowgroup", { name: "Salaire brut" })).not.toContainText("fiche :");
      const contributions = importer.getByRole("rowgroup", { name: "Cotisations" });
      await contributions.getByRole("button", { name: "Monter BVG / Pensionskasse" }).click();
      await contributions.getByRole("button", { name: "Monter BVG / Pensionskasse" }).click();
      expect(await labelsIn(contributions)).toEqual(["AHV/IV/EO", "BVG / Pensionskasse", "ALV", "NBU"]);
      await importer.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(page.getByText("Fiche de paie enregistrée")).toBeVisible();
      await expect(file).toContainText("enregistrée");
      await importer.getByRole("button", { name: "Fermer" }).first().click();

      // The board: the month, from gross to net; the salary found in the bank.
      const month = page.getByLabel("Le mois");
      await expect(month).toContainText(/7\s005,75/);
      await expect(month).toContainText("Impôt à la source");
      await expect(page.getByLabel("Versements", { exact: true })).toContainText("versé");
      await expect(page.getByLabel("Évolution")).toBeVisible();

      // October follows September: its order, its types, and what changed.
      await page.getByRole("button", { name: "Importer des fiches" }).first().click();
      await importer.getByLabel("Fiches de paie (PDF)").setInputFiles(PDF_OCTOBER);
      const october = importer.getByRole("button", { name: /octobre 2026/ });
      await expect(october).toContainText("à vérifier");
      await expect(importer.getByText("Fait suite à septembre 2026.")).toBeVisible();
      expect(await labelsIn(contributions)).toEqual(["AHV/IV/EO", "BVG / Pensionskasse", "ALV"]);
      expect(await labelsIn(importer.getByRole("rowgroup", { name: "Retenu jusqu'à la fin du contrat" })))
        .toEqual(["Total Rückbehalt kumulierte Lohnarten"]);
      const missing = importer.getByRole("region", { name: "Lignes absentes" });
      await expect(missing).toContainText("NBU");
      await missing.getByRole("button", { name: "Reprendre NBU" }).click();
      expect(await labelsIn(contributions)).toEqual(["AHV/IV/EO", "BVG / Pensionskasse", "ALV", "NBU"]);
      await expect(missing).toHaveCount(0);
      await importer.getByRole("button", { name: "Retirer NBU" }).click();
      await expect(importer.getByText("Les lignes retombent exactement sur le net versé.")).toBeVisible();
      await importer.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(october).toContainText("enregistrée");
      await importer.getByRole("button", { name: "Fermer" }).first().click();
      await expect(page.getByLabel("Le mois")).toContainText("à recevoir en fin de contrat");
      await expect(page.getByLabel("Le mois")).toContainText(/310,00/);
      // The rate of the year: its tax over its gross (950,40 twice over 9 000 twice).
      await expect(page.getByRole("table", { name: "Taux par année" })).toContainText(/2026\s·\s2 mois.*10,56 %/);
      const held = page.getByLabel("Retenues en attente", { exact: true });
      await expect(held.getByLabel("En attente")).toHaveText(/310,00/);
      await expect(held.getByRole("table", { name: "Retenues par mois" })).toContainText("octobre 2026");

      // The board is the user's: a card hidden stays hidden.
      await page.getByRole("button", { name: "Personnaliser" }).click();
      const custom = page.getByRole("dialog", { name: "Personnaliser le tableau" });
      await custom.getByLabel("Afficher « Taux »").click();
      await custom.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByText("Tableau enregistré")).toBeVisible();
      await page.reload();
      await expectAppReady(page);
      await expect(page.getByLabel("Le mois")).toBeVisible();
      await expect(page.getByLabel("Taux", { exact: true })).toHaveCount(0);
    } finally {
      await api.deleteProfile(profile.id);
    }
  });
});
