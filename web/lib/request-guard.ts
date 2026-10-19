/** Which requests the interface lets through to the API. The app has no login,
 *  so this is what keeps OTHER websites out of it — the same rule as the
 *  backend's (`backend/request_guard.py`, which explains both attacks):
 *
 *  - a host name other than this computer's is a DNS-rebinding page reading
 *    the app as if it were itself: refused, reads included;
 *  - a write the browser marks as coming from another site is refused.
 *
 *  It has to live here too: in Docker the browser only ever talks to this
 *  server, and the backend sees `backend:8000` as host, never the browser's. */

export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SAME_APP = new Set(["same-origin", "none"]); // `none`: the address bar, a bookmark

export const REFUSED_HOST = "Requête refusée : l'application ne répond qu'à localhost et 127.0.0.1.";
export const REFUSED_ORIGIN = "Requête refusée : elle vient d'un autre site que l'application.";

/** "127.0.0.1:3000" → "127.0.0.1", "[::1]:3000" → "::1", "LocalHost" → "localhost". */
export function hostname(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.includes("]") ? h.slice(1, h.indexOf("]")) : h;
  return h.split(":").length === 2 ? h.split(":")[0] : h;
}

function originHost(origin: string): string | null {
  try {
    return hostname(new URL(origin).host);
  } catch {
    return null;
  }
}

/** Why this request must be refused, or null when it may go through. */
export function refusal(method: string, headers: { get(name: string): string | null }): string | null {
  if (!LOCAL_HOSTS.has(hostname(headers.get("host") ?? ""))) return REFUSED_HOST;
  if (SAFE_METHODS.has(method.toUpperCase())) return null;
  const site = headers.get("sec-fetch-site");
  if (site != null && !SAME_APP.has(site.trim().toLowerCase())) return REFUSED_ORIGIN;
  const origin = headers.get("origin");
  if (origin != null) {
    const host = origin.trim().toLowerCase() === "null" ? null : originHost(origin.trim());
    if (host == null || !LOCAL_HOSTS.has(host)) return REFUSED_ORIGIN;
  }
  return null;
}
