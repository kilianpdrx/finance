import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";

const BACKEND = process.env.E2E_BACKEND_URL ?? "http://127.0.0.1:8801";

/**
 * Helpers for talking to the real backend directly. Setting a test's data up
 * through the API rather than by clicking keeps each spec about the one thing it
 * actually asserts, and keeps failures readable.
 */
export class Api {
  constructor(private request: APIRequestContext, public profileId = 1) {}

  private headers() {
    return { "X-Profile-Id": String(this.profileId) };
  }

  async profiles() {
    const res = await this.request.get(`${BACKEND}/api/profiles`);
    expect(res.ok(), "backend must be reachable").toBeTruthy();
    return res.json();
  }

  async defaultProfileId(): Promise<number> {
    const list = await this.profiles();
    const def = list.find((p: { is_default: boolean }) => p.is_default) ?? list[0];
    return def.id;
  }

  async createAccount(body: Record<string, unknown>) {
    const res = await this.request.post(`${BACKEND}/api/accounts`, {
      headers: this.headers(),
      data: { account_type: "courant", currency: "EUR", ...body },
    });
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  }

  async createProfile(name: string) {
    const res = await this.request.post(`${BACKEND}/api/profiles`, { data: { name } });
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  }

  async deleteProfile(id: number) {
    await this.request.delete(`${BACKEND}/api/profiles/${id}`);
  }

  async categories(profileId = this.profileId) {
    const res = await this.request.get(`${BACKEND}/api/categories`, {
      headers: { "X-Profile-Id": String(profileId) },
    });
    return res.json();
  }

  async addHolding(accountId: number, body: Record<string, unknown>) {
    const res = await this.request.post(
      `${BACKEND}/api/investments/accounts/${accountId}/holdings`,
      { headers: this.headers(), data: body },
    );
    expect(res.ok(), await res.text()).toBeTruthy();
    return res.json();
  }

  /** Import a `Date;Libelle;Montant` statement (ISO dates) into an account. */
  async importCsv(accountId: number, csv: string) {
    const res = await this.request.post(`${BACKEND}/api/upload/confirm`, {
      headers: this.headers(),
      multipart: {
        file: { name: "releve.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") },
        account_id: String(accountId),
        column_mapping: JSON.stringify({ date: "Date", description: "Libelle", amount: "Montant" }),
        date_format: "%Y-%m-%d",
        delimiter: ";",
        encoding: "utf-8",
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return res.json();
  }

  /** A "libellé contient …" rule towards the category with this name. */
  async createContainsRule(categoryName: string, value: string) {
    const cats: { id: number; name: string }[] = await this.categories();
    const cat = cats.find((c) => c.name === categoryName);
    expect(cat, `category ${categoryName} must exist`).toBeTruthy();
    const res = await this.request.post(`${BACKEND}/api/categories/${cat!.id}/rules`, {
      headers: this.headers(),
      data: {
        category_id: cat!.id,
        logic_operator: "AND",
        conditions: [{ field: "description", operator: "contains", value }],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    return res.json();
  }

  /** Make a category a fixed expense (the budget's « DÉPENSES FIXES » section). */
  async setFixedExpense(categoryName: string) {
    const cats: { id: number; name: string }[] = await this.categories();
    const cat = cats.find((c) => c.name === categoryName);
    expect(cat, `category ${categoryName} must exist`).toBeTruthy();
    const res = await this.request.put(`${BACKEND}/api/categories/${cat!.id}`, {
      headers: this.headers(),
      data: { expense_type: "fixed" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  /** A balance statement on an account (`contribution_cents`: money paid in). */
  async addSnapshot(accountId: number, body: { date: string; amount_cents: number; contribution_cents?: number }) {
    const res = await this.request.post(`${BACKEND}/api/accounts/${accountId}/snapshots`, {
      headers: this.headers(),
      data: { currency: "EUR", ...body },
    });
    expect(res.status(), await res.text()).toBe(201);
  }

  /** Close an account: it keeps its history and leaves the active list. */
  async closeAccount(accountId: number) {
    const res = await this.request.delete(`${BACKEND}/api/accounts/${accountId}`, { headers: this.headers() });
    expect(res.status(), await res.text()).toBe(204);
  }

  async accounts(includeInactive = false): Promise<{ id: number; name: string; is_active: boolean }[]> {
    const res = await this.request.get(`${BACKEND}/api/accounts?include_inactive=${includeInactive}`, { headers: this.headers() });
    return res.json();
  }

  async transactionCount(): Promise<number> {
    const res = await this.request.get(`${BACKEND}/api/transactions/count`, { headers: this.headers() });
    return (await res.json()).total;
  }

  async plannedExpenses(): Promise<{ month: string; amount_cents: number }[]> {
    const res = await this.request.get(`${BACKEND}/api/planned-expenses`, { headers: this.headers() });
    return res.json();
  }

  async setBaseCurrency(currency: string) {
    const res = await this.request.put(`${BACKEND}/api/settings/base_currency`, {
      headers: this.headers(),
      data: { value: currency },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
}

/** The app stores the active profile in localStorage; set it before the first paint. */
export async function useProfile(page: Page, profileId: number) {
  await page.addInitScript((id) => {
    window.localStorage.setItem(
      "finance-active-profile",
      JSON.stringify({ state: { activeProfileId: id }, version: 0 }),
    );
  }, profileId);
}

/**
 * The app shell is up and the backend answered. Gating on this rather than on a
 * fixed timeout is what makes the suite stable: `ConnectionBanner` renders
 * whenever /api/health fails, and asserting through it produced the flaky,
 * confusing failures the old specs were full of.
 */
export async function expectAppReady(page: Page) {
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText("Serveur inaccessible")).toHaveCount(0);
}

export const test = base.extend<{ api: Api }>({
  api: async ({ request }, use) => {
    const api = new Api(request);
    api.profileId = await api.defaultProfileId();
    await use(api);
  },
});

export { expect };
