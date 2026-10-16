from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from pasak.db import connect

router = APIRouter()


class ConsentGrantBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    install_id: str = Field(alias="installId")
    consent_version: str = Field(alias="consentVersion")


def _parse_install_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid install id")


def _consent_json(
    install_id: uuid.UUID,
    granted_at: datetime,
    revoked_at: datetime | None,
) -> dict:
    return {
        "installId": str(install_id),
        "grantedAt": granted_at,
        "revokedAt": revoked_at,
    }


@router.post("/v1/consent")
def grant_consent(body: ConsentGrantBody):
    if body.consent_version != "1":
        raise HTTPException(status_code=400, detail="unsupported consent version")
    install_id = _parse_install_id(body.install_id)

    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT granted_at, revoked_at
                FROM consents
                WHERE install_id = %s
                """,
                (install_id,),
            )
            row = cur.fetchone()
            if row is None:
                cur.execute(
                    """
                    INSERT INTO consents (install_id, consent_version)
                    VALUES (%s, %s)
                    RETURNING granted_at, revoked_at
                    """,
                    (install_id, "1"),
                )
                granted_at, revoked_at = cur.fetchone()
            elif row[1] is None:
                granted_at, revoked_at = row[0], row[1]
            else:
                cur.execute(
                    """
                    UPDATE consents
                    SET revoked_at = NULL,
                        granted_at = now(),
                        consent_version = %s
                    WHERE install_id = %s
                    RETURNING granted_at, revoked_at
                    """,
                    ("1", install_id),
                )
                granted_at, revoked_at = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    return _consent_json(install_id, granted_at, revoked_at)


@router.delete("/v1/consent/{install_id}")
def revoke_consent(install_id: str):
    parsed = _parse_install_id(install_id)

    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT revoked_at
                FROM consents
                WHERE install_id = %s
                """,
                (parsed,),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="unknown install")
            revoked_at = row[0]
            if revoked_at is None:
                cur.execute(
                    """
                    UPDATE consents
                    SET revoked_at = now()
                    WHERE install_id = %s
                    RETURNING revoked_at
                    """,
                    (parsed,),
                )
                revoked_at = cur.fetchone()[0]
            cur.execute(
                "DELETE FROM training_examples WHERE install_id = %s",
                (parsed,),
            )
        conn.commit()
    finally:
        conn.close()

    return {"installId": str(parsed), "revokedAt": revoked_at}
