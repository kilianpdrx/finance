import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date
from models import Transaction

pytestmark = pytest.mark.asyncio

@pytest_asyncio.fixture
async def transactions_data(db_session: AsyncSession, seed_data: dict):
    profile = seed_data["profile"]
    acc = seed_data["account_courant"]
    cat1 = seed_data["cat_courses"]
    cat2 = seed_data["cat_salaire"]
    
    t1 = Transaction(
        profile_id=profile.id,
        account_id=acc.id,
        date=date(2026, 7, 10),
        amount_cents=10000,
        is_debit=True,
        category_id=cat1.id,
        description="Supermarket A",
        import_hash="tx_hash_1"
    )
    t2 = Transaction(
        profile_id=profile.id,
        account_id=acc.id,
        date=date(2026, 7, 12),
        amount_cents=5000,
        is_debit=True,
        category_id=None,
        description="Unknown Store",
        import_hash="tx_hash_2"
    )
    t3 = Transaction(
        profile_id=profile.id,
        account_id=acc.id,
        date=date(2026, 7, 15),
        amount_cents=200000,
        is_debit=False,
        category_id=cat2.id,
        description="Salary July",
        import_hash="tx_hash_3"
    )
    db_session.add_all([t1, t2, t3])
    await db_session.commit()
    await db_session.refresh(t1)
    await db_session.refresh(t2)
    await db_session.refresh(t3)
    return {"t1": t1, "t2": t2, "t3": t3}

async def test_list_transactions_no_filters(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    res = await client.get("/api/transactions", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 3

async def test_list_transactions_filters(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    # Filter by category
    cat_id = seed_data["cat_courses"].id
    res = await client.get(f"/api/transactions?category_id={cat_id}", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    assert len(res.json()) == 1
    
    # Filter uncategorized
    res = await client.get("/api/transactions?uncategorized=true", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["description"] == "Unknown Store"
    
    # Filter search
    res = await client.get("/api/transactions?search=Supermarket", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    assert len(res.json()) == 1
    
    # Filter is_debit
    res = await client.get("/api/transactions?is_debit=false", headers={"X-Profile-Id": str(profile.id)})
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["amount_cents"] == 200000

async def test_transaction_stats(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    h = {"X-Profile-Id": str(profile.id)}
    # No filters: 3 total, 2 categorised (t1, t3), 1 uncategorised (t2), 0 transfers.
    res = await client.get("/api/transactions/stats", headers=h)
    assert res.status_code == 200
    d = res.json()
    assert d == {"total": 3, "categorized": 2, "uncategorized": 1, "transfers": 0}

    # Stats respect base filters (is_debit) but ignore the category toggles.
    res = await client.get("/api/transactions/stats", params={"is_debit": "true"}, headers=h)
    d = res.json()
    assert d["total"] == 2 and d["categorized"] == 1 and d["uncategorized"] == 1


async def test_transaction_ids_respects_filters(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    h = {"X-Profile-Id": str(profile.id)}
    res = await client.get("/api/transactions/ids", headers=h)
    assert res.status_code == 200
    ids = res.json()["ids"]
    assert set(ids) == {transactions_data[k].id for k in ("t1", "t2", "t3")}

    # Filtered ids (uncategorised) return just t2.
    res = await client.get("/api/transactions/ids", params={"uncategorized": "true"}, headers=h)
    assert res.json()["ids"] == [transactions_data["t2"].id]


async def test_bulk_delete_chunks_large_selection(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """A selection larger than SQLite's parameter cap must still delete (chunked)."""
    profile = seed_data["profile"]
    acc = seed_data["account_courant"]
    txns = [
        Transaction(profile_id=profile.id, account_id=acc.id, date=date(2026, 1, 1),
                    amount_cents=100, is_debit=True, description=f"bulk {i}", import_hash=f"bulk_{i}")
        for i in range(1500)
    ]
    db_session.add_all(txns)
    await db_session.commit()
    ids = [t.id for t in txns]

    res = await client.post("/api/transactions/bulk-delete", headers={"X-Profile-Id": str(profile.id)}, json={"ids": ids})
    assert res.status_code == 204
    remaining = (await client.get("/api/transactions/count", headers={"X-Profile-Id": str(profile.id)})).json()["total"]
    assert remaining == 0


async def test_bulk_delete_transactions(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    t_id = transactions_data["t1"].id
    
    res = await client.request(
        "POST", "/api/transactions/bulk-delete",
        headers={"X-Profile-Id": str(profile.id)},
        json={"ids": [t_id]}
    )
    assert res.status_code == 204
    
    res2 = await client.get("/api/transactions", headers={"X-Profile-Id": str(profile.id)})
    assert len(res2.json()) == 2

async def test_bulk_update_category(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    t2_id = transactions_data["t2"].id
    cat_salaire = seed_data["cat_salaire"]
    
    res = await client.post(
        "/api/transactions/bulk-update-category",
        headers={"X-Profile-Id": str(profile.id)},
        json={"ids": [t2_id], "category_id": cat_salaire.id}
    )
    assert res.status_code == 200
    
    res2 = await client.get(f"/api/transactions?category_id={cat_salaire.id}", headers={"X-Profile-Id": str(profile.id)})
    data = res2.json()
    assert len(data) == 2


async def test_editing_core_field_sets_manually_edited(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    t1_id = transactions_data["t1"].id
    h = {"X-Profile-Id": str(profile.id)}

    res = await client.put(f"/api/transactions/{t1_id}", headers=h, json={"description": "Supermarket A (corrected)"})
    assert res.status_code == 200
    assert res.json()["is_manually_edited"] is True


async def test_recategorizing_does_not_set_manually_edited(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    t1_id = transactions_data["t1"].id
    cat_salaire = seed_data["cat_salaire"]
    h = {"X-Profile-Id": str(profile.id)}

    # Changing only the category (the everyday inline action) must NOT flag it.
    res = await client.put(f"/api/transactions/{t1_id}", headers=h, json={"category_id": cat_salaire.id})
    assert res.status_code == 200
    assert res.json()["is_manually_edited"] is False


async def test_editing_date_amount_persists(client: AsyncClient, seed_data: dict, transactions_data: dict):
    profile = seed_data["profile"]
    t2_id = transactions_data["t2"].id
    h = {"X-Profile-Id": str(profile.id)}

    res = await client.put(f"/api/transactions/{t2_id}", headers=h,
                           json={"date": "2026-07-20", "amount_cents": 7777, "is_debit": False})
    assert res.status_code == 200
    body = res.json()
    assert body["date"] == "2026-07-20"
    assert body["amount_cents"] == 7777
    assert body["is_debit"] is False
    assert body["is_manually_edited"] is True


async def test_count_and_categorized_filter(client: AsyncClient, seed_data: dict, transactions_data: dict):
    pid = seed_data["profile"].id
    h = {"X-Profile-Id": str(pid)}
    # transactions_data seeds 3 txns: t1 (cat_courses), t2 (None), t3 (see fixture).
    total = (await client.get("/api/transactions/count", headers=h)).json()["total"]
    assert total >= 3

    uncat = (await client.get("/api/transactions/count?uncategorized=true", headers=h)).json()["total"]
    cat = (await client.get("/api/transactions/count?categorized=true", headers=h)).json()["total"]
    assert uncat >= 1 and cat >= 1
    assert uncat + cat == total

    # The categorized list excludes uncategorized rows.
    rows = (await client.get("/api/transactions?categorized=true", headers=h)).json()
    assert all(r["category_id"] is not None for r in rows)
    assert len(rows) == cat


async def test_list_transactions_sorting(client: AsyncClient, seed_data: dict, transactions_data: dict):
    """The fixture holds: 10/07 Supermarket A 100,00 (Alimentation), 12/07 Unknown
    Store 50,00 (no category), 15/07 Salary July 2000,00 (Salaire)."""
    h = {"X-Profile-Id": str(seed_data["profile"].id)}

    async def order(**params) -> list:
        res = await client.get("/api/transactions", headers=h, params=params)
        assert res.status_code == 200, res.text
        return [t["description"] for t in res.json()]

    # Default: most recent first.
    assert await order() == ["Salary July", "Unknown Store", "Supermarket A"]
    assert await order(sort_by="date", sort_dir="asc") == ["Supermarket A", "Unknown Store", "Salary July"]
    # Amount: biggest movement first, whatever its direction.
    assert await order(sort_by="amount") == ["Salary July", "Supermarket A", "Unknown Store"]
    assert await order(sort_by="amount", sort_dir="asc") == ["Unknown Store", "Supermarket A", "Salary July"]
    assert await order(sort_by="description", sort_dir="asc") == ["Salary July", "Supermarket A", "Unknown Store"]
    # Category: by name, uncategorised last in BOTH directions.
    assert await order(sort_by="category", sort_dir="asc") == ["Supermarket A", "Salary July", "Unknown Store"]
    assert await order(sort_by="category", sort_dir="desc") == ["Salary July", "Supermarket A", "Unknown Store"]


async def test_list_transactions_rejects_an_unknown_sort(client: AsyncClient, seed_data: dict, transactions_data: dict):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    assert (await client.get("/api/transactions", headers=h, params={"sort_by": "import_hash"})).status_code == 422
    assert (await client.get("/api/transactions", headers=h, params={"sort_dir": "sideways"})).status_code == 422


# ── Classify by label ───────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def labelled(db_session: AsyncSession, seed_data: dict):
    """Three BIOCOOP card payments (a reference in the middle of the label), one
    of them already classified, plus a refund, a transfer and an unrelated row."""
    pid, acc = seed_data["profile"].id, seed_data["account_courant"]
    rows = {}

    def add(key: str, description: str, cents: int, day: int, **kw):
        t = Transaction(profile_id=pid, account_id=acc.id, date=date(2026, 9, day), amount_cents=cents,
                        currency="EUR", description=description, import_hash=f"lbl_{key}",
                        **{"is_debit": True, **kw})
        rows[key] = t
        db_session.add(t)

    add("bio1", "CARTE X1234 03/09 BIOCOOP 2231 LYON 03", 4200, 3)
    add("bio2", "CARTE X1234 12/09 BIOCOOP 2231 LYON 03", 3850, 12)
    add("bio3", "CARTE X1234 20/09 BIOCOOP 2231 LYON 03", 4520, 20)
    add("bio_done", "CARTE X1234 27/09 BIOCOOP 2231 LYON 03", 1000, 27, category_id=seed_data["cat_courses"].id)
    add("bio_refund", "CARTE X1234 28/09 BIOCOOP 2231 LYON 03", 500, 28, is_debit=False)
    add("transfer", "VIREMENT VERS LIVRET", 20000, 5, is_internal_transfer=True)
    add("other", "PHARMACIE DU PARC", 1290, 8)
    await db_session.commit()
    for t in rows.values():
        await db_session.refresh(t)
    return rows


async def test_uncategorized_groups_put_frequent_labels_first(client: AsyncClient, seed_data: dict, labelled: dict):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    groups = (await client.get("/api/transactions/uncategorized-groups", headers=h)).json()

    top = groups[0]
    assert (top["description"], top["occurrences"], top["is_debit"]) == ("BIOCOOP LYON", 3, True)
    assert top["total_cents"] == 4200 + 3850 + 4520 and top["currency"] == "EUR"
    assert sorted(top["transaction_ids"]) == sorted(labelled[k].id for k in ("bio1", "bio2", "bio3"))
    # The rule fragment is one that really appears in the labels.
    assert top["rule_pattern"] == "BIOCOOP"
    assert top["account_ids"] == [seed_data["account_courant"].id]

    all_ids = {i for g in groups for i in g["transaction_ids"]}
    assert labelled["bio_done"].id not in all_ids, "already classified"
    assert labelled["transfer"].id not in all_ids, "internal transfers have no category on purpose"
    # The refund has the same label but the other direction: its own group.
    refund = next(g for g in groups if labelled["bio_refund"].id in g["transaction_ids"])
    assert refund["is_debit"] is False and refund["occurrences"] == 1
    assert any(g["description"] == "PHARMACIE PARC" for g in groups)


async def test_uncategorized_groups_are_profile_scoped(client: AsyncClient, seed_data: dict, labelled: dict, extra_profile):
    groups = (await client.get("/api/transactions/uncategorized-groups",
                               headers={"X-Profile-Id": str(extra_profile.id)})).json()
    assert groups == []


async def test_similar_uncategorized_lists_the_other_rows_with_that_label(client: AsyncClient, seed_data: dict, labelled: dict):
    h = {"X-Profile-Id": str(seed_data["profile"].id)}
    res = await client.get(f"/api/transactions/{labelled['bio1'].id}/similar-uncategorized", headers=h,
                           params={"category_id": seed_data["cat_courses"].id})
    assert res.status_code == 200, res.text
    body = res.json()
    # Not itself, not the classified one, not the refund, not another label.
    assert sorted(body["transaction_ids"]) == sorted([labelled["bio2"].id, labelled["bio3"].id])
    assert body["count"] == 2 and body["description"] == "BIOCOOP LYON" and body["rule_pattern"] == "BIOCOOP"

    lonely = (await client.get(f"/api/transactions/{labelled['other'].id}/similar-uncategorized", headers=h)).json()
    assert lonely["count"] == 0 and lonely["transaction_ids"] == []


async def test_similar_uncategorized_respects_an_account_bound_category(
        client: AsyncClient, seed_data: dict, labelled: dict, db_session: AsyncSession):
    """A category that belongs to one account can only be given to that account's rows."""
    from models import Category
    pid = seed_data["profile"].id
    elsewhere = Category(profile_id=pid, name="Courses PEA", color="#000", account_id=seed_data["account_inv"].id)
    db_session.add(elsewhere)
    await db_session.commit()
    await db_session.refresh(elsewhere)

    body = (await client.get(f"/api/transactions/{labelled['bio1'].id}/similar-uncategorized",
                             headers={"X-Profile-Id": str(pid)}, params={"category_id": elsewhere.id})).json()
    assert body["count"] == 0


async def test_similar_uncategorized_is_profile_scoped(client: AsyncClient, seed_data: dict, labelled: dict, extra_profile):
    res = await client.get(f"/api/transactions/{labelled['bio1'].id}/similar-uncategorized",
                           headers={"X-Profile-Id": str(extra_profile.id)})
    assert res.status_code == 404


async def test_bulk_category_can_fill_only_uncategorised_rows(
        client: AsyncClient, seed_data: dict, labelled: dict, db_session: AsyncSession):
    """"Classer les autres" must never overwrite a category: the list the user saw
    may be stale by the time they click."""
    from models import Category
    pid = seed_data["profile"].id
    other_cat = Category(profile_id=pid, name="Bio", color="#0a0")
    db_session.add(other_cat)
    await db_session.commit()
    await db_session.refresh(other_cat)

    ids = [labelled[k].id for k in ("bio1", "bio2", "bio_done")]
    res = await client.post("/api/transactions/bulk-update-category", headers={"X-Profile-Id": str(pid)},
                            json={"ids": ids, "category_id": other_cat.id, "only_uncategorized": True})
    assert res.status_code == 200 and res.json() == {"updated": 2}

    for key in ("bio1", "bio2", "bio_done"):
        await db_session.refresh(labelled[key])
    assert labelled["bio1"].category_id == other_cat.id and labelled["bio2"].category_id == other_cat.id
    assert labelled["bio_done"].category_id == seed_data["cat_courses"].id, "an existing category is kept"


async def test_uncategorised_does_not_count_internal_transfers(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    """An internal transfer has no category on purpose: it is not "sans
    catégorie", neither in the counter nor in the filter."""
    pid, acc = seed_data["profile"].id, seed_data["account_courant"]
    rows = [("TO CLASSIFY", {}), ("VIREMENT INTERNE", {"is_internal_transfer": True}),
            ("CLASSIFIED", {"category_id": seed_data["cat_courses"].id})]
    for i, (label, extra) in enumerate(rows):
        db_session.add(Transaction(profile_id=pid, account_id=acc.id, date=date(2026, 7, 1 + i), amount_cents=1000,
                                   is_debit=True, description=label, import_hash=f"uncat_{i}", **extra))
    await db_session.commit()
    h = {"X-Profile-Id": str(pid)}

    stats = (await client.get("/api/transactions/stats", headers=h)).json()
    assert stats == {"total": 3, "categorized": 1, "uncategorized": 1, "transfers": 1}

    listed = (await client.get("/api/transactions", headers=h, params={"uncategorized": "true"})).json()
    assert [t["description"] for t in listed] == ["TO CLASSIFY"]
    assert (await client.get("/api/transactions/count", headers=h, params={"uncategorized": "true"})).json()["total"] == 1


async def test_list_transactions_sorts_by_account(client: AsyncClient, seed_data: dict, db_session: AsyncSession):
    pid = seed_data["profile"].id
    for i, acc in enumerate([seed_data["account_inv"], seed_data["account_courant"]]):   # "PEA Test", "Compte Courant Test"
        db_session.add(Transaction(profile_id=pid, account_id=acc.id, date=date(2026, 7, 1 + i), amount_cents=1000,
                                   is_debit=True, description=f"ROW {acc.name}", import_hash=f"acct_{i}"))
    await db_session.commit()
    h = {"X-Profile-Id": str(pid)}

    async def accounts(direction: str) -> list:
        res = await client.get("/api/transactions", headers=h, params={"sort_by": "account", "sort_dir": direction})
        assert res.status_code == 200, res.text
        return [t["account_name"] for t in res.json()]

    assert await accounts("asc") == ["Compte Courant Test", "PEA Test"]
    assert await accounts("desc") == ["PEA Test", "Compte Courant Test"]

