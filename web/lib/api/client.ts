import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { getActiveProfileId, getUnlockToken, useProfileUnlockStore } from "../stores";

// Inject the active profile header on every /api/* request (covers the typed
// openapi-fetch client and the handful of raw fetch() calls), with the profile's
// unlock token when it has a PIN. A 401 carrying `X-Profile-Locked` for the
// active profile means its token is no longer good: the app asks for the PIN.
// Patched once, client-side only.
if (typeof window !== "undefined") {
  const w = window as typeof window & { __apiFetchPatched?: boolean };
  if (!w.__apiFetchPatched) {
    w.__apiFetchPatched = true;
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      let isApi = false;
      let pid: number | null = null;
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
        isApi = !!url && (url.startsWith("/api/") || url.includes("/api/"));
        if (isApi) {
          pid = getActiveProfileId();
          if (pid != null) {
            const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
            headers.set("X-Profile-Id", String(pid));
            const token = getUnlockToken(pid);
            if (token) headers.set("X-Profile-Unlock", token);
            init = { ...init, headers };
          }
        }
      } catch {
        /* never block a request on header injection */
      }
      const pending = orig(input, init);
      if (!isApi) return pending;
      return pending.then((res) => {
        if (res.status === 401) {
          const locked = Number(res.headers.get("X-Profile-Locked"));
          // Another profile's lock (editing it from « Gérer les profils ») is only an error.
          if (locked && (pid == null || locked === pid)) useProfileUnlockStore.getState().markLocked(locked);
        }
        return res;
      });
    };
  }
}

/** Typed fetch client generated from the FastAPI OpenAPI schema.
 *  baseUrl "" keeps requests relative so the Next.js rewrite proxies
 *  /api/* → the FastAPI backend (see next.config.ts). */
export const api = createClient<paths>({ baseUrl: "" });

/** Throw on error, return data — convenience for React Query queryFns. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}
