from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from pasak.db import connect
from pasak.scrub import ScrubRejected, scrub_request

router = APIRouter()

REQUIRED_EXAMPLE_KEYS = frozenset(
    {
        "installId",
        "consentVersion",
        "transcript",
        "prediction",
        "correction",
        "modelVersions",
    }
)
TOP_LEVEL_KEYS = REQUIRED_EXAMPLE_KEYS | frozenset({"expenseId"})
EXPENSE_FIELD_KEYS = frozenset(
    {"amount", "currency", "category", "item", "merchant", "date"}
)
CATEGORIES = frozenset(
    {"food", "transport", "bills", "shopping", "health", "other"}
)
MODEL_VERSION_KEYS = frozenset({"stt", "interpreter"})
STT_RE = re.compile(r"^whisper@\S+$")
INTERPRETER_RE = re.compile(r"^interpreter@\S+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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


def _bad_shape() -> HTTPException:
    return HTTPException(status_code=400, detail="invalid example body")


def _validate_expense_fields(raw: Any) -> dict:
    if not isinstance(raw, dict) or set(raw.keys()) != EXPENSE_FIELD_KEYS:
        raise _bad_shape()
    amount = raw["amount"]
    if amount is not None and (not isinstance(amount, int) or isinstance(amount, bool)):
        raise _bad_shape()
    currency = raw["currency"]
    if currency is not None and not isinstance(currency, str):
        raise _bad_shape()
    category = raw["category"]
    if category is not None and category not in CATEGORIES:
        raise _bad_shape()
    item = raw["item"]
    if item is not None and not isinstance(item, str):
        raise _bad_shape()
    merchant = raw["merchant"]
    if merchant is not None and not isinstance(merchant, str):
        raise _bad_shape()
    date = raw["date"]
    if date is not None and (not isinstance(date, str) or not DATE_RE.fullmatch(date)):
        raise _bad_shape()
    return raw


def _validate_model_versions(raw: Any) -> dict:
    if not isinstance(raw, dict) or set(raw.keys()) != MODEL_VERSION_KEYS:
        raise _bad_shape()
    stt = raw["stt"]
    if not isinstance(stt, str) or not STT_RE.fullmatch(stt):
        raise _bad_shape()
    interpreter = raw["interpreter"]
    if interpreter is not None and (
        not isinstance(interpreter, str) or not INTERPRETER_RE.fullmatch(interpreter)
    ):
        raise _bad_shape()
    return raw


def _reject_extra_top_level_keys(raw: dict) -> None:
    if set(raw.keys()) - TOP_LEVEL_KEYS:
        raise _bad_shape()


def _parse_example_fields(
    raw: Any,
) -> tuple[uuid.UUID, uuid.UUID | None, str, str, dict, dict, dict]:
    if not isinstance(raw, dict) or not REQUIRED_EXAMPLE_KEYS.issubset(raw.keys()):
        raise _bad_shape()
    install_id = _parse_install_id(raw["installId"])
    source_expense_id: uuid.UUID | None = None
    if "expenseId" in raw:
        expense_raw = raw["expenseId"]
        if expense_raw is not None:
            if not isinstance(expense_raw, str):
                raise _bad_shape()
            source_expense_id = _parse_install_id(expense_raw)
    consent_version = raw["consentVersion"]
    if not isinstance(consent_version, str):
        raise _bad_shape()
    transcript = raw["transcript"]
    if not isinstance(transcript, str) or not transcript.strip():
        raise _bad_shape()
    prediction = _validate_expense_fields(raw["prediction"])
    correction = _validate_expense_fields(raw["correction"])
    model_versions = _validate_model_versions(raw["modelVersions"])
    return (
        install_id,
        source_expense_id,
        consent_version,
        transcript,
        prediction,
        correction,
        model_versions,
    )


def _require_active_consent(install_id: uuid.UUID, consent_version: str) -> None:
    if consent_version != "1":
        raise HTTPException(status_code=403, detail="consent required")
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT consent_version, revoked_at
                FROM consents
                WHERE install_id = %s
                """,
                (install_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if row is None or row[1] is not None or row[0] != "1":
        raise HTTPException(status_code=403, detail="consent required")


@router.post("/v1/examples")
def post_example(body: dict):
    (
        install_id,
        source_expense_id,
        consent_version,
        transcript,
        prediction,
        correction,
        model_versions,
    ) = _parse_example_fields(body)
    _require_active_consent(install_id, consent_version)
    _reject_extra_top_level_keys(body)

    scrub_input = {
        "transcript": transcript,
        "prediction": prediction,
        "correction": correction,
    }
    try:
        scrubbed = scrub_request({**scrub_input, **body})
    except ScrubRejected:
        raise HTTPException(status_code=400, detail="rejected by scrubber")

    example_id = uuid.uuid4()
    conn = connect()
    try:
        with conn.cursor() as cur:
            if source_expense_id is not None:
                cur.execute(
                    """
                    INSERT INTO training_examples (
                      id, install_id, source_expense_id, transcript,
                      prediction, correction, model_versions
                    )
                    VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)
                    ON CONFLICT (install_id, source_expense_id)
                    WHERE source_expense_id IS NOT NULL
                    DO UPDATE SET
                      transcript = EXCLUDED.transcript,
                      prediction = EXCLUDED.prediction,
                      correction = EXCLUDED.correction,
                      model_versions = EXCLUDED.model_versions,
                      updated_at = now()
                    RETURNING id
                    """,
                    (
                        example_id,
                        install_id,
                        source_expense_id,
                        scrubbed["transcript"],
                        json.dumps(scrubbed["prediction"]),
                        json.dumps(scrubbed["correction"]),
                        json.dumps(model_versions),
                    ),
                )
                example_id = cur.fetchone()[0]
            else:
                cur.execute(
                    """
                    INSERT INTO training_examples (
                      id, install_id, transcript, prediction, correction, model_versions
                    )
                    VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)
                    RETURNING id
                    """,
                    (
                        example_id,
                        install_id,
                        scrubbed["transcript"],
                        json.dumps(scrubbed["prediction"]),
                        json.dumps(scrubbed["correction"]),
                        json.dumps(model_versions),
                    ),
                )
                example_id = cur.fetchone()[0]
        conn.commit()
    finally:
        conn.close()

    return {"id": str(example_id)}
