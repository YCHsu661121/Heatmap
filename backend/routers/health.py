"""模組：健康檢查"""
from fastapi import APIRouter

router = APIRouter(tags=["Health"])

@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "services": {
            "marketData": "ok",
            "news": "ok",
            "llm": "ok"
        }
    }
