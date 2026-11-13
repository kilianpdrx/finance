"""An optional PIN per profile, and the unlock tokens that prove it was typed.

What it protects: with a PIN, every profile-scoped request (`current_profile_id`)
and every change to the profile itself needs an unlock token, which only
`POST /profiles/{id}/unlock` with the right PIN hands out. Without a PIN nothing
changes. What it does not protect: the database file on disk, and the backup
download (Paramètres → Sauvegarde), which is the whole household's database.

- The PIN is 4 to 8 digits, stored as a salted scrypt hash; it is never stored,
  returned, logged or quoted in an error.
- Wrong PINs are counted in the database: from the 5th in a row, each one costs
  a wait (30 s, doubling, at most an hour), during which no PIN is even checked.
  The right PIN resets the count.
- Tokens live in this process's memory: restarting the server locks every
  profile again. A token is tied to the PIN it was issued under (a fingerprint of
  its hash), so changing or removing the PIN — or restoring a backup with
  another one — retires the old tokens by itself. One unused for
  `IDLE_SECONDS` expires.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import math
import os
import re
import secrets
import time
import weakref
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException

PIN_PATTERN = re.compile(r"^[0-9]{4,8}$")

# scrypt cost: 16 MB and a few tens of milliseconds per check — slow for a
# guesser, unnoticeable for a person. Stored with the hash so it can change.
_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_DKLEN = 32

FREE_ATTEMPTS = 5
BASE_WAIT_SECONDS = 30
MAX_WAIT_SECONDS = 3600
IDLE_SECONDS = 12 * 3600

LOCKED_HEADER = "X-Profile-Locked"
UNLOCK_HEADER = "X-Profile-Unlock"


# ── Hashing ────────────────────────────────────────────────────────────────────

def valid_pin(pin: object) -> bool:
    return isinstance(pin, str) and bool(PIN_PATTERN.match(pin))


def hash_pin(pin: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(pin.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=_DKLEN)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${dk.hex()}"


def verify_pin(pin: str, stored: Optional[str]) -> bool:
    """Constant-time comparison; a malformed stored value never matches."""
    if not stored or not isinstance(pin, str):
        return False
    try:
        scheme, n, r, p, salt_hex, dk_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = bytes.fromhex(dk_hex)
        # OpenSSL's default memory cap (32 MB) bounds what a stored cost can ask for.
        dk = hashlib.scrypt(
            pin.encode(), salt=bytes.fromhex(salt_hex), n=int(n), r=int(r), p=int(p),
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk, expected)


def _fingerprint(pin_hash: str) -> str:
    return hashlib.sha256(pin_hash.encode()).hexdigest()[:32]


# ── Wrong attempts ─────────────────────────────────────────────────────────────

def wait_seconds(failures: int) -> int:
    """The wait earned by `failures` wrong PINs in a row (0 below the free ones)."""
    if failures < FREE_ATTEMPTS:
        return 0
    return min(BASE_WAIT_SECONDS * 2 ** (failures - FREE_ATTEMPTS), MAX_WAIT_SECONDS)


def _french_delay(seconds: float) -> str:
    s = max(1, math.ceil(seconds))
    return f"{s} s" if s < 60 else f"{math.ceil(s / 60)} min"


def _too_many(seconds: float) -> HTTPException:
    return HTTPException(
        429,
        f"Trop d'essais : réessayez dans {_french_delay(seconds)}.",
        headers={"Retry-After": str(max(1, math.ceil(seconds)))},
    )


# One lock per event loop: PIN checks are serialised so parallel guesses cannot
# all read the same count before any of them writes it.
_check_locks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]" = weakref.WeakKeyDictionary()


def _check_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    lock = _check_locks.get(loop)
    if lock is None:
        lock = _check_locks[loop] = asyncio.Lock()
    return lock


async def check_pin(db, profile, pin: object) -> None:
    """Raise unless `pin` is the profile's PIN, counting the wrong ones.

    403 for a wrong PIN, 429 (with Retry-After) while a wait is running — then
    the PIN is not even looked at. The right PIN clears the count.
    """
    async with _check_lock():
        await db.refresh(profile)
        now = datetime.utcnow()
        if profile.pin_locked_until and profile.pin_locked_until > now:
            raise _too_many((profile.pin_locked_until - now).total_seconds())

        ok = valid_pin(pin) and await asyncio.to_thread(verify_pin, pin, profile.pin_hash)
        if ok:
            if profile.pin_failed_attempts or profile.pin_locked_until:
                profile.pin_failed_attempts = 0
                profile.pin_locked_until = None
                await db.commit()
            return

        failures = (profile.pin_failed_attempts or 0) + 1
        profile.pin_failed_attempts = failures
        wait = wait_seconds(failures)
        profile.pin_locked_until = now + timedelta(seconds=wait) if wait else None
        await db.commit()
        if wait:
            raise HTTPException(
                429,
                f"Code PIN incorrect. Trop d'essais : réessayez dans {_french_delay(wait)}.",
                headers={"Retry-After": str(wait)},
            )
        left = FREE_ATTEMPTS - failures
        if left <= 2:
            plural = "s" if left > 1 else ""
            raise HTTPException(403, f"Code PIN incorrect. Encore {left} essai{plural} avant une attente.")
        raise HTTPException(403, "Code PIN incorrect.")


def reset_attempts(profile) -> None:
    profile.pin_failed_attempts = 0
    profile.pin_locked_until = None


# ── Unlock tokens ──────────────────────────────────────────────────────────────

# sha256(token) → (profile id, PIN fingerprint, last use). Only digests are kept.
_tokens: dict[str, tuple[int, str, float]] = {}


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _prune(now: float) -> None:
    for key in [k for k, (_, _, used) in _tokens.items() if now - used > IDLE_SECONDS]:
        _tokens.pop(key, None)


def issue_token(profile) -> str:
    now = time.monotonic()
    _prune(now)
    token = secrets.token_urlsafe(32)
    _tokens[_digest(token)] = (profile.id, _fingerprint(profile.pin_hash or ""), now)
    return token


def token_valid(profile, token: Optional[str]) -> bool:
    """True when `token` unlocks this profile under its current PIN (and refreshes it)."""
    if not token or not profile.pin_hash:
        return False
    key = _digest(token)
    entry = _tokens.get(key)
    if entry is None:
        return False
    pid, fp, used = entry
    now = time.monotonic()
    if pid != profile.id or not hmac.compare_digest(fp, _fingerprint(profile.pin_hash)):
        return False
    if now - used > IDLE_SECONDS:
        _tokens.pop(key, None)
        return False
    _tokens[key] = (pid, fp, now)
    return True


def revoke_token(token: Optional[str]) -> None:
    if token:
        _tokens.pop(_digest(token), None)


def require_unlocked(profile, token: Optional[str]) -> None:
    """401 + `X-Profile-Locked: <id>` when the profile has a PIN and `token` does not unlock it."""
    if profile.pin_hash and not token_valid(profile, token):
        raise HTTPException(
            401, "Ce profil est protégé par un code PIN.",
            headers={LOCKED_HEADER: str(profile.id)},
        )
