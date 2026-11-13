"""Optional profile PIN: hashing, unlocking, wrong attempts, change and removal.

The PIN is enforced by the API (`current_profile_id`), not only by the
interface: a profile with a PIN answers 401 to any profile-scoped request that
does not carry a token from `POST /profiles/{id}/unlock`.
"""
import logging
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from models import Profile
from services import profile_pin

PIN = "4821"
OTHER = "9073"


def _h(pid, token=None):
    headers = {"X-Profile-Id": str(pid)}
    if token:
        headers["X-Profile-Unlock"] = token
    return headers


async def _set_pin(client, pid, pin=PIN, current=None):
    body = {"pin": pin}
    if current is not None:
        body["current_pin"] = current
    return await client.put(f"/api/profiles/{pid}/pin", json=body)


async def _fresh(db_session, pid) -> Profile:
    return (await db_session.execute(
        select(Profile).where(Profile.id == pid).execution_options(populate_existing=True)
    )).scalar_one()


# ── Hashing ────────────────────────────────────────────────────────────────────

def test_hash_is_salted_slow_and_verifies():
    a, b = profile_pin.hash_pin(PIN), profile_pin.hash_pin(PIN)
    assert a != b  # salted
    assert a.startswith("scrypt$")
    assert PIN not in a and PIN not in b
    assert profile_pin.verify_pin(PIN, a)
    assert profile_pin.verify_pin(PIN, b)
    assert not profile_pin.verify_pin(OTHER, a)
    assert not profile_pin.verify_pin(PIN, None)
    assert not profile_pin.verify_pin(PIN, "")
    assert not profile_pin.verify_pin(PIN, "scrypt$garbage")
    assert not profile_pin.verify_pin(PIN, "md5$1$2$3$aa$bb")


def test_only_4_to_8_digits_are_a_pin():
    for ok in ("0000", "1234", "12345678"):
        assert profile_pin.valid_pin(ok)
    for bad in ("123", "123456789", "12a4", " 1234", "", None, 1234, "１２３４"):
        assert not profile_pin.valid_pin(bad)


def test_waits_start_after_five_and_double_up_to_an_hour():
    assert [profile_pin.wait_seconds(n) for n in range(5)] == [0, 0, 0, 0, 0]
    assert profile_pin.wait_seconds(5) == 30
    assert profile_pin.wait_seconds(6) == 60
    assert profile_pin.wait_seconds(7) == 120
    assert profile_pin.wait_seconds(30) == 3600


# ── Setting a PIN ──────────────────────────────────────────────────────────────

async def test_set_pin_stores_a_hash_and_never_returns_it(client, seed_data, db_session):
    pid = seed_data["profile"].id
    res = await _set_pin(client, pid)
    assert res.status_code == 200
    body = res.json()
    assert body["has_pin"] is True and body["token"]
    assert PIN not in res.text

    stored = (await _fresh(db_session, pid)).pin_hash
    assert stored and PIN not in stored and profile_pin.verify_pin(PIN, stored)

    profiles = await client.get("/api/profiles")
    assert profiles.status_code == 200  # the list stays open: the switcher needs it
    row = next(p for p in profiles.json() if p["id"] == pid)
    assert row["has_pin"] is True
    assert "pin_hash" not in row and stored not in profiles.text


async def test_a_bad_pin_is_refused_without_quoting_it(client, seed_data):
    pid = seed_data["profile"].id
    for bad in ("12", "abcd", "123456789", "12 34"):
        res = await _set_pin(client, pid, pin=bad)
        assert res.status_code == 400
        assert res.json()["detail"] == "Le code PIN doit compter de 4 à 8 chiffres."
        assert bad not in res.text
    profiles = (await client.get("/api/profiles")).json()
    assert not next(p for p in profiles if p["id"] == pid)["has_pin"]


async def test_a_number_is_read_as_the_digits_it_has(client, seed_data):
    pid = seed_data["profile"].id
    res = await client.put(f"/api/profiles/{pid}/pin", json={"pin": 482193})
    assert res.status_code == 200
    unlock = await client.post(f"/api/profiles/{pid}/unlock", json={"pin": "482193"})
    assert unlock.status_code == 200


# ── What the PIN locks ─────────────────────────────────────────────────────────

async def test_a_profile_with_a_pin_needs_a_token(client, seed_data):
    pid = seed_data["profile"].id
    token = (await _set_pin(client, pid)).json()["token"]

    locked = await client.get("/api/accounts", headers=_h(pid))
    assert locked.status_code == 401
    assert locked.headers["X-Profile-Locked"] == str(pid)
    assert locked.json()["detail"] == "Ce profil est protégé par un code PIN."

    # The default-profile fallback (no X-Profile-Id) is locked too.
    fallback = await client.get("/api/accounts")
    assert fallback.status_code == 401

    assert (await client.get("/api/accounts", headers=_h(pid, "not-a-token"))).status_code == 401
    ok = await client.get("/api/accounts", headers=_h(pid, token))
    assert ok.status_code == 200 and len(ok.json()) == 2


async def test_a_profile_without_pin_is_untouched(client, seed_data, extra_profile):
    await _set_pin(client, seed_data["profile"].id)
    res = await client.get("/api/accounts", headers=_h(extra_profile.id))
    assert res.status_code == 200


async def test_a_token_opens_only_its_own_profile(client, seed_data, extra_profile):
    a, b = seed_data["profile"].id, extra_profile.id
    token_a = (await _set_pin(client, a)).json()["token"]
    await _set_pin(client, b, pin=OTHER)
    assert (await client.get("/api/accounts", headers=_h(b, token_a))).status_code == 401


async def test_editing_or_deleting_a_locked_profile_needs_its_token(client, seed_data, extra_profile):
    pid = extra_profile.id
    token = (await _set_pin(client, pid)).json()["token"]
    assert (await client.put(f"/api/profiles/{pid}", json={"name": "X"})).status_code == 401
    assert (await client.delete(f"/api/profiles/{pid}")).status_code == 401
    renamed = await client.put(f"/api/profiles/{pid}", json={"name": "X"}, headers={"X-Profile-Unlock": token})
    assert renamed.status_code == 200 and renamed.json()["name"] == "X"
    deleted = await client.delete(f"/api/profiles/{pid}", headers={"X-Profile-Unlock": token})
    assert deleted.status_code == 204


# ── Unlocking ──────────────────────────────────────────────────────────────────

async def test_unlock_with_the_right_pin(client, seed_data):
    pid = seed_data["profile"].id
    await _set_pin(client, pid)
    wrong = await client.post(f"/api/profiles/{pid}/unlock", json={"pin": OTHER})
    assert wrong.status_code == 403
    assert wrong.json()["detail"] == "Code PIN incorrect."
    assert OTHER not in wrong.text

    res = await client.post(f"/api/profiles/{pid}/unlock", json={"pin": PIN})
    assert res.status_code == 200
    token = res.json()["token"]
    assert (await client.get("/api/accounts", headers=_h(pid, token))).status_code == 200


async def test_unlock_a_profile_without_pin_or_unknown(client, seed_data):
    pid = seed_data["profile"].id
    res = await client.post(f"/api/profiles/{pid}/unlock", json={"pin": PIN})
    assert res.status_code == 400
    assert (await client.post("/api/profiles/999/unlock", json={"pin": PIN})).status_code == 404


async def test_lock_retires_the_token(client, seed_data):
    pid = seed_data["profile"].id
    token = (await _set_pin(client, pid)).json()["token"]
    assert (await client.post(f"/api/profiles/{pid}/lock", headers={"X-Profile-Unlock": token})).status_code == 204
    assert (await client.get("/api/accounts", headers=_h(pid, token))).status_code == 401


async def test_an_idle_token_expires(client, seed_data, monkeypatch):
    pid = seed_data["profile"].id
    token = (await _set_pin(client, pid)).json()["token"]
    later = profile_pin.time.monotonic() + profile_pin.IDLE_SECONDS + 1
    monkeypatch.setattr(profile_pin.time, "monotonic", lambda: later)
    assert (await client.get("/api/accounts", headers=_h(pid, token))).status_code == 401


# ── Wrong attempts ─────────────────────────────────────────────────────────────

async def test_wrong_attempts_earn_a_wait_kept_in_the_database(client, seed_data, db_session):
    pid = seed_data["profile"].id
    await _set_pin(client, pid)
    url = f"/api/profiles/{pid}/unlock"

    details = []
    for _ in range(4):
        res = await client.post(url, json={"pin": OTHER})
        assert res.status_code == 403
        details.append(res.json()["detail"])
    assert details[0] == "Code PIN incorrect."
    assert details[2] == "Code PIN incorrect. Encore 2 essais avant une attente."
    assert details[3] == "Code PIN incorrect. Encore 1 essai avant une attente."

    fifth = await client.post(url, json={"pin": OTHER})
    assert fifth.status_code == 429
    assert fifth.headers["Retry-After"] == "30"
    assert "réessayez dans 30 s" in fifth.json()["detail"]

    # During the wait even the right PIN is not looked at.
    blocked = await client.post(url, json={"pin": PIN})
    assert blocked.status_code == 429
    assert "réessayez dans" in blocked.json()["detail"]

    stored = await _fresh(db_session, pid)
    assert stored.pin_failed_attempts == 5
    assert stored.pin_locked_until > datetime.utcnow()

    # Once the wait is over, a wrong PIN doubles it…
    stored.pin_locked_until = datetime.utcnow() - timedelta(seconds=1)
    await db_session.commit()
    sixth = await client.post(url, json={"pin": OTHER})
    assert sixth.status_code == 429 and sixth.headers["Retry-After"] == "60"

    # …and the right one clears the count.
    stored = await _fresh(db_session, pid)
    stored.pin_locked_until = datetime.utcnow() - timedelta(seconds=1)
    await db_session.commit()
    assert (await client.post(url, json={"pin": PIN})).status_code == 200
    stored = await _fresh(db_session, pid)
    assert stored.pin_failed_attempts == 0 and stored.pin_locked_until is None


async def test_nothing_logs_the_pin(client, seed_data, caplog):
    pid = seed_data["profile"].id
    with caplog.at_level(logging.DEBUG):
        await _set_pin(client, pid)
        await client.post(f"/api/profiles/{pid}/unlock", json={"pin": OTHER})
        await client.post(f"/api/profiles/{pid}/unlock", json={"pin": PIN})
        await _set_pin(client, pid, pin=OTHER, current=PIN)
    assert PIN not in caplog.text and OTHER not in caplog.text


# ── Changing and removing ──────────────────────────────────────────────────────

async def test_change_needs_the_current_pin_and_retires_old_tokens(client, seed_data):
    pid = seed_data["profile"].id
    old_token = (await _set_pin(client, pid)).json()["token"]

    missing = await _set_pin(client, pid, pin=OTHER)
    assert missing.status_code == 400
    wrong = await _set_pin(client, pid, pin=OTHER, current="0000")
    assert wrong.status_code == 403

    res = await _set_pin(client, pid, pin=OTHER, current=PIN)
    assert res.status_code == 200
    new_token = res.json()["token"]
    assert (await client.get("/api/accounts", headers=_h(pid, old_token))).status_code == 401
    assert (await client.get("/api/accounts", headers=_h(pid, new_token))).status_code == 200
    assert (await client.post(f"/api/profiles/{pid}/unlock", json={"pin": PIN})).status_code == 403
    assert (await client.post(f"/api/profiles/{pid}/unlock", json={"pin": OTHER})).status_code == 200


async def test_removal_needs_the_current_pin_and_opens_the_profile(client, seed_data, db_session):
    pid = seed_data["profile"].id
    await _set_pin(client, pid)

    refused = await client.put(f"/api/profiles/{pid}/pin", json={"pin": None, "current_pin": OTHER})
    assert refused.status_code == 403
    res = await client.put(f"/api/profiles/{pid}/pin", json={"pin": None, "current_pin": PIN})
    assert res.status_code == 200
    assert res.json() == {"has_pin": False, "token": None}

    stored = await _fresh(db_session, pid)
    assert stored.pin_hash is None and stored.pin_failed_attempts == 0
    assert (await client.get("/api/accounts", headers=_h(pid))).status_code == 200
    profiles = (await client.get("/api/profiles")).json()
    assert next(p for p in profiles if p["id"] == pid)["has_pin"] is False


async def test_removing_when_there_is_none_is_a_no_op(client, seed_data):
    pid = seed_data["profile"].id
    res = await client.put(f"/api/profiles/{pid}/pin", json={"pin": None})
    assert res.status_code == 200 and res.json() == {"has_pin": False, "token": None}


@pytest.mark.parametrize("pin", ["0000", "12345678"])
async def test_edge_lengths_round_trip(client, seed_data, pin):
    pid = seed_data["profile"].id
    assert (await _set_pin(client, pid, pin=pin)).status_code == 200
    assert (await client.post(f"/api/profiles/{pid}/unlock", json={"pin": pin})).status_code == 200
