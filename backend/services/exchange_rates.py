import httpx
import logging
from datetime import datetime, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from models import ExchangeRate

logger = logging.getLogger(__name__)

# Cache rates for 12 hours so we don't spam the API unnecessarily
_LAST_SYNC_TIME = None

async def sync_exchange_rates(db: AsyncSession, force: bool = False):
    global _LAST_SYNC_TIME
    
    if not force and _LAST_SYNC_TIME and (datetime.utcnow() - _LAST_SYNC_TIME) < timedelta(hours=12):
        return
        
    logger.info("Syncing exchange rates from API...")
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("https://api.frankfurter.app/latest?from=EUR")
            resp.raise_for_status()
            data = resp.json()
            
            r_rates = data.get("rates", {})
            
            # Frankfurter gives X foreign = 1 EUR
            # rate_ten_thousandths = (1 / X) * 10000
            
            for currency_code, x_rate in r_rates.items():
                if x_rate <= 0:
                    continue
                    
                eur_value = 1.0 / x_rate
                val_10k = int(eur_value * 10000)
                
                # Upsert
                existing = await db.execute(
                    select(ExchangeRate).where(ExchangeRate.currency_code == currency_code)
                )
                rate_obj = existing.scalar_one_or_none()
                
                if rate_obj:
                    rate_obj.rate_ten_thousandths = val_10k
                    rate_obj.updated_at = datetime.utcnow()
                else:
                    new_rate = ExchangeRate(
                        currency_code=currency_code,
                        rate_ten_thousandths=val_10k
                    )
                    db.add(new_rate)
                    
            await db.commit()
            _LAST_SYNC_TIME = datetime.utcnow()
            logger.info("Successfully updated exchange rates.")
            
    except Exception as e:
        logger.error(f"Failed to sync exchange rates: {e}")
