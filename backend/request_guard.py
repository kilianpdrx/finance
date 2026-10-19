"""Which requests the API accepts at all — the app has no login (invariant 5),
so this is what keeps OTHER websites out of it.

Two attacks reach a server bound to 127.0.0.1 from a page the user merely opens:

- **Cross-site writes.** Any page can send a "simple" request (a form, a
  multipart upload, a POST without a body) to http://localhost:3000. The
  browser hides the answer, but the write happens: an upload to
  /api/system/restore replaced the whole database. Browsers say where a request
  comes from (`Sec-Fetch-Site`, `Origin`): a write from anywhere but the app
  itself is refused.
- **DNS rebinding.** A hostile name made to resolve to 127.0.0.1 turns the page
  into a same-origin client of the app, able to READ everything
  (/api/system/backup is the whole database). Its requests still carry the
  hostile name in `Host`: only local names are answered.

The interface applies the same rule (`web/lib/request-guard.ts`), because in
Docker it is the only server the browser talks to and the backend only ever
sees `backend:8000` as host. Requests without those headers — scripts, curl,
the launchers, the tests — are not browsers' cross-site requests and pass.
"""
import logging
from typing import Mapping, Optional
from urllib.parse import urlsplit

from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# Names a browser uses for this computer; `backend` is the Docker service name
# the interface reaches the API by (docker-compose.yml, release/docker-compose.yml).
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
BACKEND_HOSTS = LOCAL_HOSTS | {"backend"}

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
SAME_APP = frozenset({"same-origin", "none"})      # `none`: typed in the address bar, a bookmark

REFUSED_HOST = "Requête refusée : l'application ne répond qu'à localhost et 127.0.0.1."
REFUSED_ORIGIN = "Requête refusée : elle vient d'un autre site que l'application."


def hostname(host_header: str) -> str:
    """'127.0.0.1:3000' → '127.0.0.1', '[::1]:8000' → '::1', 'LocalHost' → 'localhost'."""
    host = host_header.strip().lower()
    if host.startswith("["):
        return host[1:host.find("]")] if "]" in host else host
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


def refusal(method: str, headers: Mapping[str, str], allowed_hosts: frozenset = BACKEND_HOSTS) -> Optional[str]:
    """Why this request must be refused, or None when it may go through.
    `headers` is looked up with lower-case names."""
    if hostname(headers.get("host", "")) not in allowed_hosts:
        return REFUSED_HOST
    if method.upper() in SAFE_METHODS:
        return None
    site = headers.get("sec-fetch-site")
    if site is not None and site.strip().lower() not in SAME_APP:
        return REFUSED_ORIGIN
    origin = headers.get("origin")
    if origin is not None:
        origin = origin.strip()
        if origin.lower() == "null" or hostname(urlsplit(origin).netloc) not in LOCAL_HOSTS:
            return REFUSED_ORIGIN
    return None


class RequestGuardMiddleware:
    """Applies `refusal` to every HTTP request, before any route runs.
    Plain ASGI: nothing to buffer, nothing that depends on a framework helper."""

    def __init__(self, app, allowed_hosts: frozenset = BACKEND_HOSTS):
        self.app = app
        self.allowed_hosts = allowed_hosts

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
            reason = refusal(scope["method"], headers, self.allowed_hosts)
            if reason is not None:
                logger.warning("Refused %s %s (host %r, origin %r, site %r)", scope["method"], scope["path"],
                               headers.get("host"), headers.get("origin"), headers.get("sec-fetch-site"))
                await JSONResponse({"detail": reason}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)
