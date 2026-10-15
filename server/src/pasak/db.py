import os
from importlib import resources

import psycopg

_DEFAULT_URL = "postgresql://pasak:pasak@localhost:5432/pasak"


def connect():
    return psycopg.connect(os.environ.get("DATABASE_URL", _DEFAULT_URL))


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
    for name in names:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM schema_migrations WHERE filename = %s",
                (name,),
            )
            if cur.fetchone():
                continue
        sql = migrations.joinpath(name).read_text(encoding="utf-8")
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations (filename) VALUES (%s)",
                (name,),
            )
