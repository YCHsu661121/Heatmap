"""
Stock Heatmap — FastAPI Backend Entry Point
===========================================
提供 VS Code Extension 所需的所有 REST API。

啟動方式（開發）:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

啟動方式（Docker）:
    CMD 由 Dockerfile/docker-compose 控制
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────
# Settings
# ─────────────────────────────────────────────

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    market_api_provider: str = "finmind"       # finmind | finnhub
    finmind_token: str = ""
    finnhub_api_key: str = ""

    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    ollama_host: str = "http://ollama:11434"
    ollama_model: str = "llama3"
    llm_provider: str = "openai"               # openai | ollama

    news_lookback_days: int = 7
    rsi_overbought: float = 70.0
    rsi_oversold: float = 30.0

settings = Settings()

# ─────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────

app = FastAPI(
    title="Stock Heatmap API",
    version="0.1.0",
    description="Stock Heatmap VS Code Extension — Backend Service",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # VS Code Webview 需要
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# Routers（模組化，各模組 router 掛載於此）
# ─────────────────────────────────────────────

from routers import watchlist, symbols, heatmap, analysis, health  # noqa: E402

app.include_router(health.router,    prefix="/api/v1")
app.include_router(watchlist.router, prefix="/api/v1")
app.include_router(symbols.router,   prefix="/api/v1")
app.include_router(heatmap.router,   prefix="/api/v1")
app.include_router(analysis.router,  prefix="/api/v1")
