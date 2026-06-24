import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { getActiveProfileId } from "../stores";

// Inject the active profile header on every /api/* request (covers the typed
// openapi-fetch client and the handful of raw fetch() calls). Patched once,
// client-side only.
if (typeof window !== "undefined") {
  const w = window as typeof window & { __apiFetchPatched?: boolean };
  if (!w.__apiFetchPatched) {
    w.__apiFetchPatched = true;
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
        if (url && (url.startsWith("/api/") || url.includes("/api/"))) {
          const pid = getActiveProfileId();
          if (pid != null) {
            const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
            headers.set("X-Profile-Id", String(pid));
            init = { ...init, headers };
          }
        }
      } catch {
        /* never block a request on header injection */
      }
      return orig(input, init);
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
