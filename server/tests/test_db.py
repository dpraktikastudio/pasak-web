import importlib.resources

import pytest
from psycopg.errors import UniqueViolation

from pasak.db import apply_migrations


def test_sql_readable_from_package_data():
    sql = (
        importlib.resources.files("pasak")
        .joinpath("migrations/001_model_versions.sql")
        .read_text(encoding="utf-8")
    )
    assert "CREATE TABLE model_versions" in sql
    assert "IF NOT EXISTS" not in sql
    assert "model_versions_one_promoted" in sql


def test_apply_migrations_twice_is_noop(db):
    apply_migrations(db)


def test_two_promoted_whisper_rows_fail(db):
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO model_versions (family, version, status, files)
            VALUES ('whisper', '1.0.0', 'promoted', '[]'::jsonb)
            """
        )
        with pytest.raises(UniqueViolation):
            cur.execute(
                """
                INSERT INTO model_versions (family, version, status, files)
                VALUES ('whisper', '1.0.1', 'promoted', '[]'::jsonb)
                """
            )


def test_promoted_whisper_and_interpreter_succeed(db):
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO model_versions (family, version, status, files)
            VALUES
              ('whisper', '1.0.0', 'promoted', '[]'::jsonb),
              ('interpreter', '0.3.0', 'promoted', '[]'::jsonb)
            """
        )
    db.commit()
    with db.cursor() as cur:
        cur.execute("SELECT family FROM model_versions WHERE status = 'promoted'")
        families = {row[0] for row in cur.fetchall()}
    assert families == {"whisper", "interpreter"}
