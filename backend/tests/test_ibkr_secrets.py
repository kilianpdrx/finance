"""The IBKR Flex token never leaves the database: not to the browser, not into
an error message, a recorded status or the log — and so not into the
diagnostics export, which is meant to be sent to someone."""
import logging

import httpx
import pytest
from httpx import AsyncClient

from services import ibkr_flex

TOKEN = "987654321098765432109876"


@pytest.fixture
def ibkr_down(monkeypatch):
    """IBKR answers 503 to everything. The Flex service takes the token in the
    URL, so httpx's own error message would quote it."""
    real = httpx.AsyncClient
    monkeypatch.setattr(ibkr_flex.httpx, "AsyncClient",
                        lambda *a, **kw: real(*a, transport=httpx.MockTransport(lambda request: httpx.Response(503)), **kw))


async def _configure(client: AsyncClient, h: dict):
    for key, value in (("ibkr_flex_token", TOKEN), ("ibkr_query_id", "123456"), ("ibkr_account_id", "2")):
        res = await client.put(f"/api/settings/{key}", headers=h, json={"value": value})
        assert res.status_code == 200


async def test_the_token_is_never_sent_back(client: AsyncClient, seed_data: dict):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    saved = await client.put("/api/settings/ibkr_flex_token", headers=h, json={"value": TOKEN})
    assert saved.json() == {"key": "ibkr_flex_token", "value": None}

    everything = (await client.get("/api/settings", headers=h)).json()
    assert "ibkr_flex_token" not in everything and TOKEN not in str(everything)
    assert (await client.get("/api/settings/ibkr_flex_token", headers=h)).json() == {"key": "ibkr_flex_token", "value": None}

    # Other settings read as before, and the IBKR tab still learns it is configured.
    await client.put("/api/settings/ibkr_query_id", headers=h, json={"value": "123456"})
    await client.put("/api/settings/ibkr_account_id", headers=h, json={"value": "2"})
    assert (await client.get("/api/settings/ibkr_query_id", headers=h)).json()["value"] == "123456"
    assert (await client.get("/api/investments/ibkr/status", headers=h)).json()["configured"] is True


async def test_a_network_error_does_not_quote_the_token(ibkr_down):
    with pytest.raises(ibkr_flex.FlexError) as caught:
        await ibkr_flex.fetch_flex_statement(TOKEN, "123456")
    assert str(caught.value) == "IBKR a répondu 503" and caught.value.kind == "transient"
    assert TOKEN not in str(caught.value)
    assert caught.value.__suppress_context__        # the httpx error (and its URL) is out of the traceback


async def test_a_failed_sync_records_and_logs_no_token(client: AsyncClient, seed_data: dict, ibkr_down, caplog):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    await _configure(client, h)
    caplog.set_level(logging.DEBUG)

    # The silent sync (also run at startup) used to let the httpx error escape: a 500, logged with its URL.
    synced = await client.post("/api/investments/ibkr/sync", headers=h)
    assert synced.status_code == 502 and synced.json()["detail"] == "IBKR a répondu 503"
    preview = await client.post("/api/investments/ibkr/sync-preview", headers=h)
    assert preview.status_code == 502

    status = (await client.get("/api/investments/ibkr/status", headers=h)).json()
    assert status["last_status"] == "erreur: IBKR a répondu 503"
    assert TOKEN not in caplog.text


async def test_diagnostics_mask_a_token_already_in_the_log(client: AsyncClient, monkeypatch, tmp_path):
    import routers.system as system

    monkeypatch.setattr(system, "DB_PATH", tmp_path / "finance.db")
    (tmp_path / "logs").mkdir()
    (tmp_path / "logs" / "finance.log").write_text(
        "INFO ok\nWARNING IBKR startup sync failed (profile 1): Server error '503' for url "
        f"'https://ndcdyn.interactivebrokers.com/FlexWebService/SendRequest?t={TOKEN}&q=123456&v=3'\n",
        encoding="utf-8",
    )
    logs = (await client.get("/api/system/diagnostics")).json()["recent_logs"]
    assert len(logs) == 2 and TOKEN not in "\n".join(logs)
    assert "SendRequest?t=•••&q=123456" in logs[1]
