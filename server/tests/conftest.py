import pytest

from pasak.db import apply_migrations, connect


@pytest.fixture
def db():
    conn = connect()
    apply_migrations(conn)
    with conn.cursor() as cur:
        cur.execute("TRUNCATE model_versions")
    conn.commit()
    yield conn
    conn.close()
