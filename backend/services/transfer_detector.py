import logging
from datetime import timedelta
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from models import Transaction, Account
from services.fx import RateCache

# A EUR->CHF transfer never matches on cents: the bank applies its own rate and
# spread. Convert one leg and accept a small gap. Kept deliberately tight, and
# cross-currency pairs additionally REQUIRE a description signal (see below),
# because fuzzy amounts alone would produce false pairs.
_FX_TOLERANCE = 0.02  # 2%

logger = logging.getLogger(__name__)

async def detect_internal_transfers(db: AsyncSession, profile_id: int | None = None, max_days: int = 3):
    """
    Find internal transfers by matching transaction pairs (within one profile):
    - Same amount_cents when both accounts share a currency; otherwise the debit
      is converted at the transaction's date and matched within _FX_TOLERANCE
    - One is debit, one is credit
    - Different accounts
    - Dates within `max_days`
    - A description signal: the other account's name appears, OR both carry a
      transfer keyword ("virement"/"transfert"/…). With no such signal, a
      same-currency pair is accepted only when it's the single unambiguous
      candidate in the window; a cross-currency pair is never accepted without
      one, since its amounts only match approximately.
    """
    logger.info("Running internal transfer detection...")

    # Fetch the profile's accounts
    acc_q = select(Account)
    if profile_id is not None:
        acc_q = acc_q.where(Account.profile_id == profile_id)
    acc_res = await db.execute(acc_q)
    accounts = {a.id: a for a in acc_res.scalars()}

    if len(accounts) < 2:
        return 0

    # Fetch unmatched transactions (scoped to the profile)
    txn_filters = [Transaction.is_internal_transfer == False]
    if profile_id is not None:
        txn_filters.append(Transaction.profile_id == profile_id)
    txn_res = await db.execute(
        select(Transaction)
        .where(*txn_filters)
        .order_by(Transaction.date)
    )
    unmatched = txn_res.scalars().all()

    debits = [t for t in unmatched if t.is_debit]
    credits = [t for t in unmatched if not t.is_debit]

    matched_count = 0
    rates = RateCache()  # one FX memo for the whole scan

    def _ccy(acc_id: int) -> str:
        acc = accounts.get(acc_id)
        return (acc.currency if acc else None) or "EUR"

    async def _amounts_match(debit, credit) -> bool:
        """Exact cents within a currency; converted within tolerance across."""
        dc, cc = _ccy(debit.account_id), _ccy(credit.account_id)
        if dc == cc:
            return debit.amount_cents == credit.amount_cents
        converted = await rates.convert(db, debit.amount_cents, dc, cc, debit.date)
        if not converted:
            return False
        return abs(converted - credit.amount_cents) <= credit.amount_cents * _FX_TOLERANCE

    for d in debits:
        if d.is_internal_transfer:
            continue
        
        # Find matching credits
        potential_matches = []
        for c in credits:
            if c.is_internal_transfer:
                continue
            if d.account_id == c.account_id:
                continue
            if abs((d.date - c.date).days) > max_days:
                continue
            if await _amounts_match(d, c):
                potential_matches.append(c)

        if not potential_matches:
            continue

        # Priority to those where description contains the other account name
        debit_acc_name = accounts[d.account_id].name.lower()
        keywords = ["virement", "transfert", "transfer", "cpt", "compte"]

        best_match = None
        for c in potential_matches:
            credit_acc_name = accounts[c.account_id].name.lower()
            desc_d = d.description.lower()
            desc_c = c.description.lower()

            # Signal 1: the counterpart account's name appears in a description.
            if credit_acc_name in desc_d or debit_acc_name in desc_c:
                best_match = c
                break
            # Signal 2: both descriptions carry a transfer keyword.
            if any(k in desc_d for k in keywords) and any(k in desc_c for k in keywords):
                best_match = c
                break

        # No description signal at all: only accept when there is exactly one
        # candidate in the window (unambiguous) — avoids marking two unrelated
        # same-amount transactions as a transfer. Never for a cross-currency
        # pair: those matched on an approximate amount, so "unambiguous" is a far
        # weaker guarantee and a false pair would silently erase real income.
        if best_match is None and len(potential_matches) == 1:
            only = potential_matches[0]
            if _ccy(d.account_id) == _ccy(only.account_id):
                best_match = only

        if best_match:
            # Mark both as internal transfer
            d.is_internal_transfer = True
            best_match.is_internal_transfer = True
            d.transfer_pair_id = best_match.id
            best_match.transfer_pair_id = d.id
            
            # Remove category if previously categorized to avoid messing up budgets
            d.category_id = None
            best_match.category_id = None
            
            matched_count += 1

    if matched_count > 0:
        await db.commit()
        logger.info(f"Matched {matched_count} pairs as internal transfers.")
    
    return matched_count
