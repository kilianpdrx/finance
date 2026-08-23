from datetime import date
import pytest
from services.transfer_detector import detect_internal_transfers
from models import Transaction


@pytest.mark.asyncio
async def test_detect_internal_transfers(db_session, seed_data):
    pid = seed_data["profile"].id
    acc1 = seed_data["account_courant"].id
    acc2 = seed_data["account_inv"].id

    t_out = Transaction(
        profile_id=pid,
        account_id=acc1,
        date=date(2026, 7, 10),
        description="VIREMENT EPARGNE",
        amount_cents=50000,
        is_debit=True,
        import_hash="hash_out_123"
    )
    t_in = Transaction(
        profile_id=pid,
        account_id=acc2,
        date=date(2026, 7, 10),
        description="VIREMENT DE COMPTE COURANT",
        amount_cents=50000,
        is_debit=False,
        import_hash="hash_in_123"
    )

    db_session.add_all([t_out, t_in])
    await db_session.commit()

    matched_count = await detect_internal_transfers(db_session, profile_id=pid)

    assert matched_count >= 1

    await db_session.refresh(t_out)
    await db_session.refresh(t_in)
    assert t_out.is_internal_transfer is True
    assert t_in.is_internal_transfer is True


@pytest.mark.asyncio
async def test_unrelated_same_amount_txns_not_matched(db_session, seed_data):
    """Two unrelated same-amount opposite-sign transactions must NOT be paired
    when there's no description signal AND more than one candidate exists
    (regression for the old unconditional-fallback false positives)."""
    pid = seed_data["profile"].id
    acc1 = seed_data["account_courant"].id
    acc2 = seed_data["account_inv"].id

    # One debit, two same-amount credits on nearby dates, no transfer wording.
    debit = Transaction(profile_id=pid, account_id=acc1, date=date(2026, 7, 10),
                        description="ACHAT MAGASIN", amount_cents=5000, is_debit=True,
                        import_hash="u_d")
    credit1 = Transaction(profile_id=pid, account_id=acc2, date=date(2026, 7, 11),
                        description="REMBOURSEMENT X", amount_cents=5000, is_debit=False,
                        import_hash="u_c1")
    credit2 = Transaction(profile_id=pid, account_id=acc2, date=date(2026, 7, 12),
                        description="REMBOURSEMENT Y", amount_cents=5000, is_debit=False,
                        import_hash="u_c2")
    db_session.add_all([debit, credit1, credit2])
    await db_session.commit()

    matched = await detect_internal_transfers(db_session, profile_id=pid)
    assert matched == 0
    for t in (debit, credit1, credit2):
        await db_session.refresh(t)
        assert t.is_internal_transfer is False
        assert t.category_id is None  # not wiped either (they had none)
