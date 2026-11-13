"""The 12-month income projection reports each holding's payments.

« Projection des revenus sur 12 mois » stacks them per holding
(web/lib/dividend-projection.ts): every item must carry its holding's ticker
and name, and the same ticker held in two accounts is two items of one holding.
"""
from datetime import date

from dateutil.relativedelta import relativedelta

from models import Account, AccountType, DividendCache, Holding


async def test_items_name_their_holding(client, seed_data, db_session):
    pid = seed_data["profile"].id
    pea = seed_data["account_inv"]
    cto = Account(profile_id=pid, name="CTO Test", bank_name="Broker Test",
                  account_type=AccountType.investissement, currency="EUR")
    db_session.add(cto)
    await db_session.flush()

    anchor = date.today().replace(day=1) + relativedelta(months=1, day=15)
    db_session.add_all([
        Holding(profile_id=pid, account_id=pea.id, ticker="MC.PA", name="LVMH", quantity=2,
                currency="EUR", asset_type="stock"),
        Holding(profile_id=pid, account_id=cto.id, ticker="MC.PA", name="LVMH", quantity=1,
                currency="EUR", asset_type="stock"),
        Holding(profile_id=pid, account_id=cto.id, ticker="TTE.PA", name="TotalEnergies", quantity=10,
                currency="EUR", asset_type="stock"),
        # A coin never pays: left out.
        Holding(profile_id=pid, account_id=cto.id, ticker="BTC", name="Bitcoin", quantity=1,
                currency="EUR", asset_type="crypto"),
        DividendCache(ticker="MC.PA", annual_rate=13.0, currency="EUR", frequency="annual",
                      last_dividend_date=anchor),
        DividendCache(ticker="TTE.PA", annual_rate=3.2, currency="EUR", frequency="quarterly",
                      last_dividend_date=anchor),
    ])
    await db_session.commit()

    res = await client.get("/api/investments/dividend-calendar?months=12", headers={"X-Profile-Id": str(pid)})
    assert res.status_code == 200
    monthly = res.json()["monthly"]
    assert len(monthly) == 12

    items = [it for m in monthly for it in m["items"]]
    assert {(it["ticker"], it["name"]) for it in items} == {("MC.PA", "LVMH"), ("TTE.PA", "TotalEnergies")}

    first = next(m for m in monthly if m["month"] == anchor.strftime("%Y-%m"))
    lvmh = sorted(it["amount_cents"] for it in first["items"] if it["ticker"] == "MC.PA")
    assert lvmh == [1300, 2600]  # one item per account, whole cents
    tte = [it["amount_cents"] for it in first["items"] if it["ticker"] == "TTE.PA"]
    assert tte == [800]  # 3,20 a year, paid quarterly, 10 shares
    assert first["total_cents"] == 1300 + 2600 + 800

    # Quarterly: TotalEnergies comes back three months later; LVMH does not.
    later = next(m for m in monthly if m["month"] == (anchor + relativedelta(months=3)).strftime("%Y-%m"))
    assert [it["ticker"] for it in later["items"]] == ["TTE.PA"]
