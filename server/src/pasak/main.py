import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from pasak.db import apply_migrations, connect

FAMILIES = ("whisper", "interpreter")


def cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    conn = connect()
    try:
        apply_migrations(conn)
    finally:
        conn.close()
    yield


app = FastAPI(
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
)


@app.get("/health")
def health():
    return JSONResponse({"status": "ok"})


@app.get("/v1/manifest")
def manifest():
    conn = connect()
    try:
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
