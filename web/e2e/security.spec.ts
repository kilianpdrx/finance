import { test, expect } from "./fixtures";

/**
 * Other websites stay out of the app (lib/request-guard.ts, backend/request_guard.py).
 *
 * The app has no login. Before this, a page merely open in the browser could
 * send it writes — an upload to /api/system/restore replaced the database — and,
 * through DNS rebinding, read all of it. These go through the interface, as a
 * browser would; the rest of the suite is the proof the app itself still works.
 */
test.describe("Sécurité", () => {
  test("une écriture venue d'un autre site est refusée", async ({ request }) => {
    const res = await request.post("/api/transactions/detect-transfers", {
      headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).detail).toMatch(/vient d'un autre site/);

    // The same request from the app itself goes through.
    const own = await request.post("/api/transactions/detect-transfers", {
      headers: { Origin: "http://127.0.0.1:3100", "Sec-Fetch-Site": "same-origin" },
    });
    expect(own.status()).toBe(200);
  });

  test("l'application ne répond pas sous un autre nom (DNS rebinding)", async ({ request }) => {
    for (const path of ["/api/settings", "/api/system/backup"]) {
      const res = await request.get(path, { headers: { Host: "evil.example:3100" } });
      expect(res.status(), path).toBe(403);
      expect((await res.json()).detail).toMatch(/ne répond qu'à localhost/);
    }
    expect((await request.get("/api/settings")).status()).toBe(200);
  });
});
