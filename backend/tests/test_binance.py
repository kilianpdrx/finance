"""Binance sync (services/binance.py): a READ-ONLY key, every wallet read
before anything is written, one position per coin priced from Binance, and a
cost the user types once (PRU) that the sync keeps.

Binance is played by an httpx MockTransport answering with the documented
response shapes and invented balances; it checks every signature."""
import logging
import time
from datetime import date, datetime, timezone
from urllib.parse import parse_qsl

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

import services.market_data as md
from models import AccountBalanceSnapshot, Holding
from services import binance

KEY = "test-binance-api-key-3141"
SECRET = "test-binance-secret-2718"

# Euro per unit, through the routes the fake market offers (see FakeBinance).
BTC_EUR, ETH_EUR = 60_000.0, 2_000.0


def _candle(day: str, close: float) -> list:
    ms = int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp() * 1000)
    return [ms, "0", "0", "0", str(close), "0", ms + 86_399_999, "0", 0, "0", "0", "0"]


class FakeBinance:
    """Binance's API, as far as the sync uses it."""

    def __init__(self):
        self.permissions = {"ipRestrict": False, "enableReading": True, "enableWithdrawals": False,
                            "enableInternalTransfer": False, "enableMargin": False, "enableFutures": False,
                            "permitsUniversalTransfer": False, "enableVanillaOptions": False,
                            "enableFixApiTrade": False, "enableFixReadOnly": False,
                            "enableSpotAndMarginTrading": False, "enablePortfolioMarginTrading": False}
        self.spot = [
            {"asset": "BTC", "free": "0.05", "locked": "0", "freeze": "0", "withdrawing": "0"},
            {"asset": "LDETH", "free": "0.5", "locked": "0", "freeze": "0", "withdrawing": "0"},  # Earn receipt
            {"asset": "LDO", "free": "100", "locked": "0", "freeze": "0", "withdrawing": "0"},    # Lido: a coin
            {"asset": "EUR", "free": "250", "locked": "0", "freeze": "0", "withdrawing": "0"},
            {"asset": "SHIB", "free": "1000000", "locked": "0", "freeze": "0", "withdrawing": "0"},
            {"asset": "XYZ", "free": "2", "locked": "0", "freeze": "0", "withdrawing": "0"},
            {"asset": "DUST", "free": "0.5", "locked": "0", "freeze": "0", "withdrawing": "0"},
            {"asset": "NOPAIR", "free": "10", "locked": "0", "freeze": "0", "withdrawing": "0"},
        ]
        self.funding = [{"asset": "USDC", "free": "100", "locked": "10", "freeze": "0", "withdrawing": "0",
                         "btcValuation": "0"}]
        self.flexible = [{"asset": "ETH", "totalAmount": "0.5", "productId": "ETH001"}]
        self.locked = [{"asset": "SOL", "amount": "3", "positionId": 1}]
        self.wallets = [
            {"activate": True, "balance": "0.12", "walletName": "Spot"},
            {"activate": True, "balance": "0.002", "walletName": "Funding"},
            {"activate": True, "balance": "0.03", "walletName": "Earn"},
            {"activate": True, "balance": "0.01", "walletName": "USDⓈ-M Futures"},
            {"activate": True, "balance": "0", "walletName": "Cross Margin"},
        ]
        self.trading = {"BTCEUR", "ETHEUR", "EURUSDT", "EURUSDC", "SOLUSDT", "LDOUSDT", "SHIBUSDT",
                        "DUSTUSDT", "XYZBTC"}
        self.prices = {"BTCEUR": BTC_EUR, "ETHEUR": ETH_EUR, "EURUSDT": 1.10, "EURUSDC": 1.10,
                       "SOLUSDT": 165.0, "LDOUSDT": 0.44, "SHIBUSDT": 0.000011, "DUSTUSDT": 0.0001,
                       "XYZBTC": 0.0001, "LDOBUSD": 9.99, "NOPAIRBUSD": 3.0}  # the last two: dead pairs
        self.klines = {"BTCEUR": [_candle("2026-07-30", 50_000), _candle("2026-07-31", 55_000),
                                  _candle("2026-08-01", 58_000), _candle("2026-08-02", 60_000)]}
        self.fail: set[str] = set()
        self.server_offset_ms = 0
        self.calls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append(path)
        if path in self.fail:
            return httpx.Response(503)
        if path.startswith("/sapi/"):
            query = request.url.query.decode()
            payload, _, signature = query.rpartition("&signature=")
            if request.headers.get("X-MBX-APIKEY") != KEY:
                return httpx.Response(401, json={"code": -2015, "msg": "Invalid API-key, IP, or permissions for action."})
            if signature != binance.sign(payload, SECRET):
                return httpx.Response(400, json={"code": -1022, "msg": "Signature for this request is not valid."})
            params = dict(parse_qsl(payload))
            now = time.time() * 1000 + self.server_offset_ms
            if now - int(params["timestamp"]) > int(params["recvWindow"]):
                return httpx.Response(400, json={"code": -1021, "msg": "Timestamp outside of the recvWindow."})
            return httpx.Response(200, json=self._signed(path))
        if path == "/api/v3/time":
            return httpx.Response(200, json={"serverTime": int(time.time() * 1000 + self.server_offset_ms)})
        if path == "/api/v3/exchangeInfo":
            return httpx.Response(200, json={"symbols": [{"symbol": s, "status": "TRADING"} for s in self.trading]})
        if path == "/api/v3/ticker/price":
            return httpx.Response(200, json=[{"symbol": s, "price": f"{p:.10f}"} for s, p in self.prices.items()])
        if path == "/api/v3/klines":
            return httpx.Response(200, json=self.klines.get(request.url.params["symbol"], []))
        return httpx.Response(404)

    def _signed(self, path: str):
        return {
            "/sapi/v1/account/apiRestrictions": self.permissions,
            "/sapi/v3/asset/getUserAsset": self.spot,
            "/sapi/v1/asset/get-funding-asset": self.funding,
            "/sapi/v1/simple-earn/flexible/position": {"rows": self.flexible, "total": len(self.flexible)},
            "/sapi/v1/simple-earn/locked/position": {"rows": self.locked, "total": len(self.locked)},
            "/sapi/v1/asset/wallet/balance": self.wallets,
            "/sapi/v1/capital/config/getall": [{"coin": "BTC", "name": "Bitcoin"}, {"coin": "ETH", "name": "Ethereum"},
                                               {"coin": "SOL", "name": "Solana"}],
        }[path]


@pytest.fixture
def fake(monkeypatch):
    fake = FakeBinance()
    real = httpx.AsyncClient
    monkeypatch.setattr(binance, "_client",
                        lambda: real(base_url="https://api.binance.com", transport=httpx.MockTransport(fake)))
    binance._pairs_cache.clear()
    binance._history_cache.clear()
    monkeypatch.setattr(md, "_backoff", md._Backoff())
    return fake


@pytest.fixture
def h(seed_data):
    return {"X-Profile-Id": str(seed_data["profile"].id)}


async def _configure(client: AsyncClient, h: dict, account_id: int):
    for key, value in ((binance.KEY, KEY), (binance.SECRET, SECRET), (binance.ACCOUNT, str(account_id))):
        res = await client.put(f"/api/settings/{key}", headers=h, json={"value": value})
        assert res.status_code == 200


async def _positions(db_session, account_id: int) -> dict[str, Holding]:
    # The API shares this session: re-read the rows as the API left them.
    rows = (await db_session.execute(
        select(Holding).where(Holding.account_id == account_id).execution_options(populate_existing=True)
    )).scalars().all()
    return {r.ticker: r for r in rows}


# ── Requests ────────────────────────────────────────────────────────────────

def test_the_signature_is_binances_documented_example():
    query = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559"
    assert binance.sign(query, "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j") == \
        "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71"


async def test_a_clock_that_is_off_is_corrected_once(fake):
    fake.server_offset_ms = 3_600_000          # this computer is an hour late
    async with binance._client() as client:
        call = binance.Signed(client, KEY, SECRET)
        assert (await call("GET", "/sapi/v1/account/apiRestrictions"))["enableReading"] is True
        assert fake.calls.count("/api/v3/time") == 1
        await call("GET", "/sapi/v1/account/apiRestrictions")
    assert fake.calls.count("/api/v3/time") == 1   # the offset is kept


# ── Read-only, enforced ─────────────────────────────────────────────────────

async def test_a_key_that_can_trade_or_withdraw_is_refused_before_anything_is_read(
        client: AsyncClient, seed_data, h, fake, db_session):
    acc = seed_data["account_inv"]
    await _configure(client, h, acc.id)
    fake.permissions.update(enableWithdrawals=True, enableSpotAndMarginTrading=True)

    tested = await client.post("/api/investments/binance/test", headers=h)
    assert tested.status_code == 400
    assert "retirer des fonds et trader" in tested.json()["detail"] and "lecture seule" in tested.json()["detail"]

    synced = await client.post("/api/investments/binance/sync", headers=h)
    assert synced.status_code == 400
    assert "/sapi/v3/asset/getUserAsset" not in fake.calls
    assert await _positions(db_session, acc.id) == {}
    status = (await client.get("/api/investments/binance/status", headers=h)).json()
    assert status["last_status"].startswith("erreur: Cette clé peut aussi")

    fake.permissions.update(enableWithdrawals=False, enableSpotAndMarginTrading=False, enableReading=False)
    assert (await client.post("/api/investments/binance/test", headers=h)).status_code == 400
    fake.permissions["enableReading"] = True
    assert (await client.post("/api/investments/binance/test", headers=h)).json() == {"read_only": True}


async def test_status_needs_the_key_the_secret_and_an_investment_account(
        client: AsyncClient, seed_data, h, fake, extra_profile):
    status = (await client.get("/api/investments/binance/status", headers=h)).json()
    assert status["configured"] is False and status["account_id"] is None

    # Another profile's account, or a current account, never receives positions.
    await _configure(client, h, seed_data["account_courant"].id)
    assert (await client.get("/api/investments/binance/status", headers=h)).json()["configured"] is True
    res = await client.post("/api/investments/binance/sync-preview", headers=h)
    assert res.status_code == 400 and "compte d'investissement" in res.json()["detail"]


# ── Reading every wallet ────────────────────────────────────────────────────

async def test_the_preview_reads_every_wallet_and_writes_nothing(
        client: AsyncClient, seed_data, h, fake, db_session):
    acc = seed_data["account_inv"]
    await _configure(client, h, acc.id)

    res = await client.post("/api/investments/binance/sync-preview", headers=h)
    assert res.status_code == 200, res.text
    preview = res.json()
    lines = {ln["asset"]: ln for ln in preview["lines"]}

    # Spot + Funding + Earn, summed per coin. LDETH is the Earn receipt of the
    # ETH already counted; LDO is a coin of its own.
    assert set(lines) == {"BTC", "ETH", "LDO", "EUR", "SHIB", "XYZ", "USDC", "SOL"}
    assert {a: ln["status"] for a, ln in lines.items()} == dict.fromkeys(lines, "new")
    assert lines["BTC"]["value_cents"] == 300_000 and lines["BTC"]["name"] == "Bitcoin"
    assert lines["ETH"]["value_cents"] == 100_000                       # 0.5 in flexible Earn
    assert lines["SOL"]["value_cents"] == 45_000                        # locked Earn, via USDT
    assert lines["USDC"]["value_cents"] == 10_000                       # free + locked, 1 / EURUSDC
    assert lines["LDO"]["value_cents"] == 4_000
    assert lines["XYZ"]["value_cents"] == 1_200                         # via BTC
    assert lines["EUR"] == {**lines["EUR"], "is_cash": True, "value_cents": 25_000, "name": "Liquidités"}
    # A coin worth less than a cent keeps its price: 1 000 000 × 0,00001 € = 10 €.
    assert lines["SHIB"]["value_cents"] == 1_000
    assert lines["SHIB"]["price_cents"] == pytest.approx(0.001)
    assert preview["small_count"] == 1                                  # DUST
    assert preview["unpriced"] == ["NOPAIR"]                            # only a dead pair
    assert preview["unread_wallets"] == [{"name": "USDⓈ-M Futures", "value_cents": 60_000}]
    assert preview["total_cents"] == sum(ln["value_cents"] for ln in preview["lines"])

    assert await _positions(db_session, acc.id) == {}


async def test_one_wallet_that_cannot_be_read_writes_nothing(client: AsyncClient, seed_data, h, fake, db_session):
    acc = seed_data["account_inv"]
    await _configure(client, h, acc.id)
    assert (await client.post("/api/investments/binance/sync", headers=h)).status_code == 200
    before = {t: p.quantity for t, p in (await _positions(db_session, acc.id)).items()}

    # Without the locked Earn read, SOL would look sold and be removed.
    fake.fail = {"/sapi/v1/simple-earn/locked/position"}
    res = await client.post("/api/investments/binance/sync", headers=h)
    assert res.status_code == 502 and res.json()["detail"] == "Binance a répondu 503."
    assert {t: p.quantity for t, p in (await _positions(db_session, acc.id)).items()} == before
    status = (await client.get("/api/investments/binance/status", headers=h)).json()
    assert status["last_status"] == "erreur: Binance a répondu 503."


# ── Positions ───────────────────────────────────────────────────────────────

async def test_a_sync_creates_positions_whose_cost_is_unknown(client: AsyncClient, seed_data, h, fake, db_session):
    acc = seed_data["account_inv"]
    await _configure(client, h, acc.id)

    res = await client.post("/api/investments/binance/sync", headers=h)
    assert res.status_code == 200, res.text
    assert (res.json()["created"], res.json()["updated"], res.json()["removed"]) == (8, 0, 0)

    positions = await _positions(db_session, acc.id)
    assert set(positions) == {"BTC", "ETH", "LDO", "CASH.EUR", "SHIB", "XYZ", "USDC", "SOL"}
    btc = positions["BTC"]
    assert (btc.sync_source, btc.asset_type, btc.currency, btc.cost_basis_cents) == ("binance", "crypto", "EUR", None)
    assert positions["CASH.EUR"].cost_basis_cents == 25_000            # cash: worth what it is

    account = next(a for a in (await client.get("/api/investments/accounts", headers=h)).json() if a["id"] == acc.id)
    by_ticker = {x["ticker"]: x for x in account["holdings"]}
    # The interface needs to know: the code is read-only, the chart asks Binance.
    assert by_ticker["BTC"]["sync_source"] == "binance"
    assert by_ticker["BTC"]["current_value_cents"] == 300_000 and by_ticker["BTC"]["price_status"] == "ok"
    assert by_ticker["BTC"]["gain_cents"] is None and by_ticker["BTC"]["gain_pct"] is None
    assert by_ticker["SHIB"]["current_value_cents"] == 1_000
    assert account["holdings_value_cents"] == 300_000 + 100_000 + 45_000 + 10_000 + 4_000 + 1_200 + 1_000 + 25_000
    # Nothing but the cash has a cost: no gain is stated — not a gain of 0.
    assert (account["holdings_gain_cents"], account["holdings_gain_pct"], account["holdings_without_cost"]) == (None, None, 7)
    status = (await client.get("/api/investments/binance/status", headers=h)).json()
    assert status["last_status"] == "ok: 8 nouvelle(s), 0 mise(s) à jour"


async def test_the_pru_is_kept_as_quantities_change_and_a_coin_that_left_is_removed(
        client: AsyncClient, seed_data, h, fake, db_session):
    acc = seed_data["account_inv"]
    await _configure(client, h, acc.id)
    await client.post("/api/investments/binance/sync", headers=h)
    positions = await _positions(db_session, acc.id)
    # The user types a PRU: 48 000 € for BTC (0,05 → 2 400 €), 1 500 € for ETH (0,5 → 750 €).
    for ticker, cost in (("BTC", 240_000), ("ETH", 75_000)):
        assert (await client.put(f"/api/investments/holdings/{positions[ticker].id}", headers=h,
                                 json={"cost_basis_cents": cost})).status_code == 200
    account = next(a for a in (await client.get("/api/investments/accounts", headers=h)).json() if a["id"] == acc.id)
    assert account["holdings_gain_cents"] == (300_000 - 240_000) + (100_000 - 75_000)
    # Over what is known: those two costs, and the cash (worth what it cost).
    assert account["holdings_gain_pct"] == round(85_000 / (240_000 + 75_000 + 25_000) * 100, 2)

    # A fifth of the BTC sold, more ETH bought, the SOL gone.
    fake.spot[0]["free"] = "0.04"
    fake.flexible[0]["totalAmount"] = "0.6"
    fake.locked = []
    preview = (await client.post("/api/investments/binance/sync-preview", headers=h)).json()
    lines = {ln["asset"]: ln for ln in preview["lines"]}
    assert (lines["BTC"]["status"], lines["BTC"]["previous_quantity"], lines["BTC"]["review_cost"]) == ("updated", 0.05, False)
    assert (lines["ETH"]["status"], lines["ETH"]["review_cost"]) == ("updated", True)   # bought: PRU to review
    assert (lines["SOL"]["status"], lines["SOL"]["quantity"], lines["SOL"]["value_cents"]) == ("removed", 0, 45_000)
    assert lines["LDO"]["status"] == "unchanged"

    res = (await client.post("/api/investments/binance/sync", headers=h)).json()
    assert (res["created"], res["updated"], res["removed"]) == (0, 2, 1)
    positions = await _positions(db_session, acc.id)
    assert "SOL" not in positions
    assert (positions["BTC"].quantity, positions["BTC"].cost_basis_cents) == (0.04, 192_000)    # PRU 48 000 €
    assert (positions["ETH"].quantity, positions["ETH"].cost_basis_cents) == (0.6, 90_000)      # PRU 1 500 €


async def test_a_hand_made_line_with_the_same_code_is_adopted(client: AsyncClient, seed_data, h, fake, db_session):
    acc = seed_data["account_inv"]
    pid = seed_data["profile"].id
    db_session.add_all([
        Holding(profile_id=pid, account_id=acc.id, ticker="BTC", name="Mon bitcoin", quantity=0.05,
                cost_basis_cents=100_000, currency="EUR", asset_type="crypto"),
        Holding(profile_id=pid, account_id=acc.id, ticker="SOL", name="Solana", quantity=3,
                cost_basis_cents=30_000, currency="USD", asset_type="crypto"),
        Holding(profile_id=pid, account_id=acc.id, ticker="CW8.PA", name="MSCI World", quantity=2,
                cost_basis_cents=90_000, currency="EUR", asset_type="etf"),
    ])
    await db_session.commit()
    await _configure(client, h, acc.id)

    res = await client.post("/api/investments/binance/sync", headers=h)
    assert res.status_code == 200, res.text
    positions = await _positions(db_session, acc.id)
    btc, sol = positions["BTC"], positions["SOL"]
    assert (btc.sync_source, btc.name, btc.cost_basis_cents) == ("binance", "Mon bitcoin", 100_000)
    # Its cost was in dollars: not converted on a guess.
    assert (sol.sync_source, sol.currency, sol.cost_basis_cents) == ("binance", "EUR", None)
    # A line Binance knows nothing about is not Binance's to remove.
    assert positions["CW8.PA"].sync_source is None

    fake.spot = []
    fake.flexible, fake.locked, fake.funding = [], [], []
    await client.post("/api/investments/binance/sync", headers=h)
    assert set(await _positions(db_session, acc.id)) == {"CW8.PA"}


async def test_a_binance_code_is_not_edited(client: AsyncClient, seed_data, h, fake, db_session):
    acc = seed_data["account_inv"]
    await _configure(client, h, acc.id)
    await client.post("/api/investments/binance/sync", headers=h)
    btc = (await _positions(db_session, acc.id))["BTC"]
    res = await client.put(f"/api/investments/holdings/{btc.id}", headers=h, json={"ticker": "bitcoin"})
    assert res.status_code == 400
    assert (await client.put(f"/api/investments/holdings/{btc.id}", headers=h,
                             json={"ticker": "BTC", "name": "Bitcoin (Ledger)"})).status_code == 200


# ── Prices and history ──────────────────────────────────────────────────────

def test_the_route_to_a_euro_price():
    trading = {"BTCEUR", "EURUSDT", "SOLUSDT", "XYZBTC", "LDOBUSD"}
    assert binance.eur_route("BTC", trading) == [("BTCEUR", 1)]
    assert binance.eur_route("USDT", trading) == [("EURUSDT", -1)]
    assert binance.eur_route("SOL", trading) == [("SOLUSDT", 1), ("EURUSDT", -1)]
    assert binance.eur_route("XYZ", trading) == [("XYZBTC", 1), ("BTCEUR", 1)]
    assert binance.eur_route("LDO", trading) is None        # its only pair is not trading
    assert binance.eur_route("EUR", trading) == []


async def test_binance_btc_and_yahoo_btc_keep_their_own_prices(db_session, seed_data, fake, monkeypatch):
    """Yahoo's "BTC" is a NYSE-listed ETF: it must never borrow bitcoin's price."""
    from routers.investments import enrich_holdings_batch

    pid, acc = seed_data["profile"].id, seed_data["account_inv"]
    coin = Holding(profile_id=pid, account_id=acc.id, ticker="BTC", name="Bitcoin", quantity=0.05,
                   cost_basis_cents=None, currency="EUR", asset_type="crypto", sync_source="binance")
    etf = Holding(profile_id=pid, account_id=seed_data["account_courant"].id, ticker="BTC",
                  name="Grayscale Bitcoin Mini Trust", quantity=10, cost_basis_cents=40_000,
                  currency="USD", asset_type="etf")
    db_session.add_all([coin, etf])
    await db_session.commit()

    async def yahoo(tickers):
        return {"BTC": (45.0, "USD")} if "BTC" in tickers else {}

    monkeypatch.setattr(md, "_fetch_stock_prices", yahoo)
    monkeypatch.setattr(md, "_fetch_dividend_details", lambda tickers: _none())
    await md.refresh_all_prices(db_session, force=True)

    rows = dict((await db_session.execute(text("SELECT ticker, price_cents FROM price_cache"))).all())
    assert rows == {"BTC": 4_500, "BINANCE:BTC": BTC_EUR * 100}
    coin_out, = await enrich_holdings_batch(db_session, [coin], "EUR")
    etf_out, = await enrich_holdings_batch(db_session, [etf], "USD")
    assert coin_out["current_value_cents"] == 300_000
    assert etf_out["current_value_cents"] == 45_000


async def _none():
    return {}


async def test_history_comes_from_binance_candles(client: AsyncClient, db_session, seed_data, h, fake, monkeypatch):
    import routers.investments as inv

    pid, acc = seed_data["profile"].id, seed_data["account_inv"]
    db_session.add(Holding(profile_id=pid, account_id=acc.id, ticker="BTC", name="Bitcoin", quantity=0.1,
                           cost_basis_cents=None, currency="EUR", asset_type="crypto", sync_source="binance"))
    await db_session.commit()

    async def yahoo(ticker, period="1y"):
        raise AssertionError(f"Yahoo asked for {ticker}")

    monkeypatch.setattr(md, "fetch_historical_prices", yahoo)
    series = await inv._holdings_monthly_values(db_session, acc.id, "EUR")
    assert {s["month"]: s["amount_cents"] for s in series} == {"2026-07": 550_000, "2026-08": 600_000}

    res = (await client.get("/api/investments/history/BTC?period=1mo&source=binance", headers=h)).json()
    assert [p["close"] for p in res["data"]] == [50_000, 55_000, 58_000, 60_000]


# ── Secrets ─────────────────────────────────────────────────────────────────

async def test_the_key_and_the_secret_never_leave(client: AsyncClient, seed_data, h, fake, caplog):
    acc = seed_data["account_inv"]
    for key, value in ((binance.KEY, KEY), (binance.SECRET, SECRET)):
        echoed = await client.put(f"/api/settings/{key}", headers=h, json={"value": value})
        assert echoed.json() == {"key": key, "value": None}
        assert (await client.get(f"/api/settings/{key}", headers=h)).json() == {"key": key, "value": None}
    await client.put(f"/api/settings/{binance.ACCOUNT}", headers=h, json={"value": str(acc.id)})
    everything = str((await client.get("/api/settings", headers=h)).json())
    status = str((await client.get("/api/investments/binance/status", headers=h)).json())
    assert KEY not in everything + status and SECRET not in everything + status

    # A wrong secret: Binance refuses the signature; the answer names neither.
    await client.put(f"/api/settings/{binance.SECRET}", headers=h, json={"value": "not-the-secret"})
    caplog.set_level(logging.DEBUG)          # after the writes: the SQL driver logs what it stores
    res = await client.post("/api/investments/binance/sync", headers=h)
    assert res.status_code == 400 and res.json()["detail"] == "Binance refuse la signature : vérifiez la clé secrète."
    stored = str((await client.get("/api/investments/binance/status", headers=h)).json())
    for secret in (KEY, SECRET, "not-the-secret", "signature="):
        assert secret not in res.text + stored + caplog.text


async def test_network_errors_do_not_quote_the_signed_url(fake):
    fake.fail = {"/sapi/v1/account/apiRestrictions"}

    def boom(request):
        raise httpx.ConnectError(f"cannot reach {request.url}")

    real = httpx.AsyncClient
    binance_client = lambda: real(base_url="https://api.binance.com", transport=httpx.MockTransport(boom))  # noqa: E731
    async with binance_client() as client:
        with pytest.raises(binance.BinanceError) as caught:
            await binance.Signed(client, KEY, SECRET)("GET", "/sapi/v1/account/apiRestrictions")
    assert str(caught.value) == "Binance ne répond pas : réessayez plus tard."
    assert caught.value.__suppress_context__


def test_diagnostics_mask_a_signature():
    from services.ibkr_flex import redact_secrets

    line = "GET https://api.binance.com/sapi/v1/account?recvWindow=10000&timestamp=1&signature=9f86d081884c7d65"
    assert redact_secrets(line).endswith("&signature=•••")


# ── Unknown cost, and accounts valued by their positions ────────────────────

async def test_a_position_typed_without_a_cost_has_no_gain(client: AsyncClient, seed_data, h, db_session):
    acc = seed_data["account_inv"]
    res = await client.post(f"/api/investments/accounts/{acc.id}/holdings", headers=h, json={
        "ticker": "AI.PA", "name": "Air Liquide", "quantity": 2, "currency": "EUR", "asset_type": "stock"})
    assert res.status_code == 200, res.text
    hid = res.json()["id"]
    await db_session.execute(text(
        "INSERT INTO price_cache (ticker, price_cents, currency, fetched_at, source) VALUES ('AI.PA', 18000, 'EUR', :t, 'live')"
    ), {"t": datetime.utcnow()})
    await db_session.commit()
    account = next(a for a in (await client.get("/api/investments/accounts", headers=h)).json() if a["id"] == acc.id)
    holding = account["holdings"][0]
    assert (holding["id"], holding["cost_basis_cents"], holding["current_value_cents"]) == (hid, None, 36_000)
    assert (holding["gain_cents"], account["holdings_gain_cents"], account["holdings_gain_pct"]) == (None, None, None)
    assert account["holdings_without_cost"] == 1


async def test_an_account_with_positions_follows_them_not_an_older_statement(
        client: AsyncClient, seed_data, h, db_session, monkeypatch):
    """Before its first sync, a crypto account is followed by statements. Once
    it holds positions, its line in the evolution chart follows them, like its
    value and the dashboard already did."""
    acc, pid = seed_data["account_inv"], seed_data["profile"].id
    db_session.add_all([
        AccountBalanceSnapshot(account_id=acc.id, date=date(2026, 5, 31), amount_cents=123_400, currency="EUR"),
        Holding(profile_id=pid, account_id=acc.id, ticker="AI.PA", name="Air Liquide", quantity=2,
                cost_basis_cents=30_000, currency="EUR", asset_type="stock"),
    ])
    await db_session.commit()

    async def history(ticker, period="1y"):
        return [{"date": "2026-07-31", "close": 100.0}, {"date": "2026-08-18", "close": 150.0}]

    monkeypatch.setattr(md, "fetch_historical_prices", history)
    series = (await client.get("/api/investments/total-series", headers=h)).json()
    assert [(p["month"], p["PEA Test"]) for p in series] == [("2026-07", 20_000), ("2026-08", 30_000)]
