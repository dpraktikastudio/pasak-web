import logging
import os
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp

from pasak.db import apply_migrations, connect
from pasak.env import load_local_env
from pasak.sync import router as sync_router

load_local_env()
log = logging.getLogger("uvicorn.error")

FAMILIES = ("whisper", "interpreter")


def cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    web = os.environ.get("WEB_ORIGIN", "").strip()
    if web and web not in origins:
        origins.append(web)
    return origins


class PasakCORSMiddleware(CORSMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(
            app,
            allow_origins=(),
            allow_credentials=False,
            allow_methods=["GET", "HEAD", "OPTIONS", "POST", "DELETE"],
        )

    def is_allowed_origin(self, origin: str) -> bool:
        return origin in cors_origins()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    raw = os.environ.get("DATABASE_URL", "")
    parsed = urlparse(raw)
    log.warning(
        "startup migrate %s:%s%s",
        parsed.hostname,
        parsed.port,
        parsed.path,
    )
    conn = connect()
    try:
        apply_migrations(conn)
        conn.commit()
    finally:
        conn.close()
    yield


app = FastAPI(
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_middleware(PasakCORSMiddleware)
app.include_router(sync_router)


@app.get("/health")
def health():
    return JSONResponse({"status": "ok"})


@app.get("/v1/manifest")
def manifest():
    conn = connect()
    try:
        apply_migrations(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT family, version, files
                FROM model_versions
                WHERE status = 'promoted'
                """
            )
            promoted = {row[0]: (row[1], row[2]) for row in cur.fetchall()}
    finally:
        conn.close()

    base_url = os.environ.get("PUBLIC_MODEL_BASE_URL", "").removesuffix("/")
    body = {}
    for family in FAMILIES:
        row = promoted.get(family)
        if row is None:
            body[family] = None
        else:
            version, files = row
            body[family] = {
                "version": version,
                "baseUrl": base_url,
                "files": files,
            }
    return JSONResponse(body, headers={"Cache-Control": "no-store"})
