import json
import os
import re
import tomllib
from pathlib import Path
from string import Formatter
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator


def url_join(base: str, path: str) -> str:
    return base.rstrip("/") + "/" + path.lstrip("/")


def validate_base(value: str) -> None:
    parsed = urlsplit(value)
    # Accessing port also rejects malformed or out-of-range ports at startup.
    _ = parsed.port
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or any(c.isspace() or c in ";'\"<>" for c in value)):
        raise ValueError(f"Expected an HTTP(S) base URL without credentials/query/fragment: {value}")
    validate_path(parsed.path or "/")


def validate_path(value: str) -> None:
    if (not value.startswith("/") or "//" in value or "\\" in value or "%" in value
            or "?" in value or "#" in value or any(p in {".", ".."} for p in value.split("/"))
            or any(c.isspace() for c in value)):
        raise ValueError(f"Invalid absolute route path: {value}")


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    public_base_url: str = "http://localhost:8002"
    upstream_base_url: str = "https://cartotecadigital.icgc.cat"
    upstream_manifest_template: str = "/iiif/info/{collection}/{id}/manifest.json"
    manifest_path_template: str = "/iiif/info/{collection}/{id}/manifest.json"
    annotation_base_url: str = "http://localhost:8081"
    annotation_path_template: str = "/iiif/annotations/{collection}/{id}/{kind}.json"
    allowed_collections: list[str] = Field(default_factory=lambda: ["catalunya", "fonscec"])
    legacy_annotation_bases: list[str] = Field(default_factory=list)
    prefix_mode: Literal["preserve", "strip"] = "preserve"
    cors_origins: list[str] = Field(default_factory=list)
    host: str = "0.0.0.0"
    port: int = Field(default=8000, ge=1, le=65535)
    trusted_proxy_ips: str = "127.0.0.1"
    upstream_timeout_seconds: float = Field(default=10, gt=0, le=120)
    manifest_cache_ttl_seconds: int = Field(default=300, ge=0)
    cache_max_entries: int = Field(default=256, ge=1, le=10000)
    upstream_max_bytes: int = Field(default=5_000_000, ge=1024)
    upstream_max_redirects: int = Field(default=3, ge=0, le=5)
    annotation_dir: Path = Path("data/annotations")  # Publication command only; never used by API.

    @model_validator(mode="after")
    def validate_settings(self):
        for value in [self.public_base_url, self.upstream_base_url, self.annotation_base_url,
                      *self.legacy_annotation_bases]:
            validate_base(value)
        for name, required in [("upstream_manifest_template", {"collection", "id"}),
                               ("manifest_path_template", {"collection", "id"}),
                               ("annotation_path_template", {"collection", "id", "kind"})]:
            template = getattr(self, name)
            validate_path(template)
            parts = list(Formatter().parse(template))
            fields = [field for _, field, _, _ in parts if field is not None]
            if set(fields) != required or len(fields) != len(required):
                raise ValueError(f"{name} must contain exactly {sorted(required)}")
            if any(spec or conversion for _, _, spec, conversion in parts):
                raise ValueError(f"{name}: format specifiers are not supported")
        if self.manifest_path_template.startswith("/health/"):
            raise ValueError("manifest_path_template overlaps a health route")
        if not self.allowed_collections or any(not re.fullmatch(r"[A-Za-z0-9_-]+", c)
                                                for c in self.allowed_collections):
            raise ValueError("allowed_collections must contain simple collection aliases")
        for origin in self.cors_origins:
            validate_base(origin)
            if urlsplit(origin).path not in {"", "/"}:
                raise ValueError("cors_origins must be origins, without path prefixes")
        self.cors_origins = [origin.rstrip("/") for origin in self.cors_origins]
        return self

    @property
    def prefix(self) -> str:
        return urlsplit(self.public_base_url).path.rstrip("/")

    def annotation_url(self, collection: str, record_id: str, kind: str, base: str | None = None) -> str:
        return url_join(base or self.annotation_base_url,
                        self.annotation_path_template.format(collection=collection, id=record_id, kind=kind))

    def public_config(self) -> dict:
        return {
            "manifestTemplate": url_join(self.public_base_url, self.manifest_path_template),
            "annotationTemplate": url_join(self.annotation_base_url, self.annotation_path_template),
            "allowedCollections": self.allowed_collections,
            "requestTimeoutMs": int(self.upstream_timeout_seconds * 1000) + 5000,
        }


def load_settings() -> Settings:
    values = {}
    if config_path := os.environ.get("ICGC_CONFIG"):
        with open(config_path, "rb") as stream:
            values = tomllib.load(stream)
    for key in Settings.model_fields:
        if (raw := os.environ.get("ICGC_" + key.upper())) is not None:
            values[key] = json.loads(raw) if key in {
                "allowed_collections", "legacy_annotation_bases", "cors_origins"
            } else raw
    return Settings(**values)
