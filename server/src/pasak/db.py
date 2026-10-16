import os
from importlib import resources

import psycopg

_DEFAULT_URL = "postgresql://pasak:pasak@localhost:5432/pasak"


def connect():
    conn = psycopg.connect(os.environ.get("DATABASE_URL", _DEFAULT_URL))
    conn.execute("SET search_path TO public")
    return conn


def _sql_statements(sql: str) -> list[str]:
    return [part.strip() for part in sql.split(";") if part.strip()]


def _table_exists(conn, name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass(%s)", (f"public.{name}",))
        return cur.fetchone()[0] is not None


def apply_migrations(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              filename text PRIMARY KEY
            )
            """
        )
    conn.commit()

    migrations = resources.files("pasak").joinpath("migrations")
    names = sorted(p.name for p in migrations.iterdir() if p.name.endswith(".sql"))
    if not names:
        raise RuntimeError(
            "no pasak/migrations/*.sql on this install; "
            "pip install -e . from server/ in this venv (not backend/)"
        )
    for name in names:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM schema_migrations WHERE filename = %s",
                (name,),
            )
            recorded = cur.fetchone() is not None
        if recorded and name == "001_model_versions.sql" and not _table_exists(
            conn, "model_versions"
        ):
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM schema_migrations WHERE filename = %s",
                    (name,),
                )
            conn.commit()
            recorded = False
        if recorded:
            continue
        sql = migrations.joinpath(name).read_text(encoding="utf-8")
        with conn.transaction(), conn.cursor() as cur:
            for statement in _sql_statements(sql):
                cur.execute(statement)
            cur.execute(
                "INSERT INTO schema_migrations (filename) VALUES (%s)",
                (name,),
            )
    if not _table_exists(conn, "model_versions"):
        raise RuntimeError("migration 001 ran but public.model_versions is missing")
