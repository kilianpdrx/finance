"""Other websites stay out of the API (request_guard.py).

The app has no login: a page the user merely opens could send writes to it (an
upload to /api/system/restore replaced the database), or — through DNS
rebinding — read it whole. Browsers say where a request comes from, and a
rebound page still sends its hostile name as Host: both are checked before any
route runs."""
from httpx import AsyncClient

import request_guard as rg


CROSS_SITE = {"origin": "https://evil.example", "sec-fetch-site": "cross-site"}


# ── The rule ────────────────────────────────────────────────────────────────

def test_only_local_names_are_answered():
    for host in ("127.0.0.1:3000", "localhost:3001", "LOCALHOST", "[::1]:8000", "backend:8000", "127.0.0.1"):
        assert rg.refusal("GET", {"host": host}) is None, host
    for host in ("evil.example:3000", "evil.example", "192.168.1.20:3000", "localhost.evil.example", "", "[::2]:3000"):
        assert rg.refusal("GET", {"host": host}) == rg.REFUSED_HOST, host
    # The Docker service name is the backend's business only, never the browser's.
    assert rg.refusal("GET", {"host": "backend:8000"}, rg.LOCAL_HOSTS) == rg.REFUSED_HOST


def test_a_write_must_come_from_the_app():
    host = {"host": "127.0.0.1:3000"}
    allowed = [
        {},                                                                  # scripts, curl, the launchers, the tests
        {"sec-fetch-site": "same-origin", "origin": "http://127.0.0.1:3000"},
        {"sec-fetch-site": "none"},
        {"origin": "http://localhost:3000"},                                 # through the interface, as the backend sees it
        {"origin": "http://[::1]:3000"},
    ]
    refused = [
        {"sec-fetch-site": "cross-site"},
        {"sec-fetch-site": "same-site", "origin": "http://localhost:5173"},  # another app on this computer
        {"origin": "https://evil.example"},                                   # an old browser without Sec-Fetch-Site
        {"origin": "null"},                                                   # sandboxed frame, file:// page
        {"sec-fetch-site": "same-origin", "origin": "https://evil.example"},
    ]
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for extra in allowed:
            assert rg.refusal(method, {**host, **extra}) is None, (method, extra)
        for extra in refused:
            assert rg.refusal(method, {**host, **extra}) == rg.REFUSED_ORIGIN, (method, extra)
    # Reading is not refused for its origin: the browser hides the answer from another site.
    for method in ("GET", "HEAD", "OPTIONS"):
        assert rg.refusal(method, {**host, **CROSS_SITE}) is None


# ── Through the API ─────────────────────────────────────────────────────────

async def test_a_cross_site_write_never_reaches_a_route(client: AsyncClient, seed_data: dict):
    profile = seed_data["profile"].id
    res = await client.post("/api/accounts", headers={**CROSS_SITE, "X-Profile-Id": str(profile)},
                            json={"name": "Piège", "bank_name": "Ailleurs"})
    assert res.status_code == 403 and res.json()["detail"] == rg.REFUSED_ORIGIN
    accounts = (await client.get("/api/accounts", headers={"X-Profile-Id": str(profile)})).json()
    assert "Piège" not in [a["name"] for a in accounts]

    # The same write, from the app itself, goes through.
    ok = await client.post("/api/accounts", headers={"origin": "http://localhost:3000", "sec-fetch-site": "same-origin",
                                                     "X-Profile-Id": str(profile)}, json={"name": "Vrai", "bank_name": "Ici"})
    assert ok.status_code == 201


async def test_a_cross_site_restore_leaves_the_database_alone(client: AsyncClient, seed_data: dict, monkeypatch, tmp_path):
    """The case that made this necessary: any page could upload a database."""
    import routers.system as system

    monkeypatch.setattr(system, "DB_PATH", tmp_path / "finance.db")
    res = await client.post("/api/system/restore", headers=CROSS_SITE,
                            files={"file": ("x.sqlite", b"SQLite format 3\x00" + b"\x00" * 100)})
    assert res.status_code == 403 and res.json()["detail"] == rg.REFUSED_ORIGIN
    assert list(tmp_path.iterdir()) == []          # nothing staged, nothing swapped, no pre-restore copy


async def test_a_foreign_host_name_reads_nothing(client: AsyncClient, seed_data: dict):
    """DNS rebinding: the page is "same-origin" with the app, but its requests
    still name the hostile host."""
    for path in ("/api/settings", "/api/system/backup", "/api/accounts"):
        res = await client.get(path, headers={"Host": "evil.example:3000"})
        assert res.status_code == 403 and res.json()["detail"] == rg.REFUSED_HOST, path
    assert (await client.get("/api/accounts", headers={"Host": "localhost:3000"})).status_code == 200
