from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import Transaction
from schemas import MLStatus, MLTrainResponse
from services import ml_trainer

router = APIRouter()


@router.get("/status", response_model=MLStatus)
async def status():
    return ml_trainer.get_status()


@router.get("/suggest-rules")
async def suggest_rules(top_n: int = 5):
    suggestions = ml_trainer.suggest_rules(top_n)
    if not suggestions:
        raise HTTPException(status_code=400, detail="Aucun modèle entraîné ou aucune suggestion disponible")
    return suggestions


@router.post("/train", response_model=MLTrainResponse)
async def train(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Transaction).where(Transaction.category_id.is_not(None))
    )
    transactions = result.scalars().all()

    if len(transactions) < 10:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough labeled transactions to train ({len(transactions)} found, need at least 10)",
        )

    accuracy, sample_count = ml_trainer.train(transactions)
    return MLTrainResponse(accuracy=accuracy, sample_count=sample_count)
