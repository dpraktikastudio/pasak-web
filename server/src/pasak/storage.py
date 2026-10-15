from __future__ import annotations

import os
from pathlib import Path


class Storage:
    def __init__(self, public_base: str):
        self.public_base = public_base

    def url_for(self, path: str) -> str:
        base = self.public_base.removesuffix("/")
        return base + "/" + path

    def put(self, key: str, data: bytes) -> None:
        raise NotImplementedError

    def list(self, prefix: str) -> list[str]:
        raise NotImplementedError


class LocalStorage(Storage):
    def __init__(self, root: str, public_base: str):
        super().__init__(public_base)
        self.root = Path(root).resolve()

    def _resolved(self, key: str) -> Path:
        if os.path.isabs(key) or Path(key).is_absolute() or ".." in Path(key).parts:
            raise ValueError(f"key outside storage root: {key}")
        dest = (self.root / key).resolve()
        if not dest.is_relative_to(self.root):
            raise ValueError(f"key outside storage root: {key}")
        return dest

    def put(self, key: str, data: bytes) -> None:
        dest = self._resolved(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

    def list(self, prefix: str) -> list[str]:
        base = self._resolved(prefix) if prefix else self.root
        if not base.exists():
            return []
        return [
            path.relative_to(self.root).as_posix()
            for path in base.rglob("*")
            if path.is_file()
        ]


class R2Storage(Storage):
    def __init__(self, bucket, client, public_base: str):
        super().__init__(public_base)
        self.bucket = bucket
        self.client = client

    def put(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data)

    def list(self, prefix: str) -> list[str]:
        resp = self.client.list_objects_v2(Bucket=self.bucket, Prefix=prefix)
        return [obj["Key"] for obj in resp.get("Contents", [])]


def storage_from_env() -> Storage:
    kind = os.environ.get("MODEL_STORAGE")
    public_base = os.environ["PUBLIC_MODEL_BASE_URL"]
    if kind == "local":
        return LocalStorage(os.environ["MODEL_LOCAL_DIR"], public_base)
    if kind == "r2":
        import boto3
        from botocore.config import Config

        client = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT"],
            region_name="auto",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            config=Config(s3={"addressing_style": "path"}),
        )
        return R2Storage(os.environ["R2_BUCKET_MODELS"], client, public_base)
    raise ValueError(f"unknown MODEL_STORAGE: {kind!r}")
