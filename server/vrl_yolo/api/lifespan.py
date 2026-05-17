from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan hook.

    P0 has nothing to do on startup; the inference / training subsystems
    (added in P1+) will register their boot work here.
    """
    yield
