import logging
import re
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .enrichment import UnsupportedManifest, enrich_manifest
from .settings import Settings, load_settings, url_join
from .upstream import Upstream


def create_app(settings: Settings | None = None, transport=None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(timeout=settings.upstream_timeout_seconds, transport=transport,
                                     trust_env=False, headers={"Accept": "application/json"}) as client:
            api.state.upstream = Upstream(settings, client)
            yield

    api = FastAPI(title="ICGC IIIF viewer", docs_url=None, redoc_url=None, openapi_url=None)

    @api.get("/health/live")
    async def live():
        return {"status": "ok"}

    @api.get("/health/ready")
    async def ready():
        return {"status": "ready"}

    @api.get(settings.manifest_path_template)
    async def manifest(collection: str, id: str):
        if collection not in settings.allowed_collections:
            raise HTTPException(404, {"code": "unknown_collection"})
        if not re.fullmatch(r"[0-9]{1,12}", id):
            raise HTTPException(400, {"code": "invalid_record_id"})
        upstream_url = url_join(settings.upstream_base_url,
                                settings.upstream_manifest_template.format(collection=collection, id=id))
        original = await api.state.upstream.get(upstream_url)
        refs = [settings.annotation_url(collection, id, kind) for kind in ["detections", "transcriptions"]]
        aliases = {settings.annotation_url(collection, id, kind, base): ref
                   for kind, ref in zip(["detections", "transcriptions"], refs)
                   for base in settings.legacy_annotation_bases}
        public_id = url_join(settings.public_base_url,
                             settings.manifest_path_template.format(collection=collection, id=id))
        try:
            enriched = enrich_manifest(original, public_id, refs, aliases)
        except UnsupportedManifest as exc:
            logging.getLogger(__name__).warning("Unsupported manifest %s/%s: %s", collection, id, exc)
            raise HTTPException(422, {"code": "unsupported_manifest", "message": str(exc)}) from exc
        # The static annotation host is not queried here. Missing layers are handled independently by the viewer.
        return JSONResponse(enriched, headers={"Cache-Control": "no-cache"})

    @api.get("/config.json")
    async def config():
        return JSONResponse(settings.public_config(), headers={"Cache-Control": "no-store"})

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None,
                  root_path=settings.prefix if settings.prefix_mode == "strip" else "")
    app.mount(settings.prefix if settings.prefix_mode == "preserve" and settings.prefix else "/", api)

    @app.middleware("http")
    async def headers(request, call_next):
        if settings.prefix_mode == "strip" and settings.prefix:
            # Restore the external ASGI path after the proxy removes the public prefix.
            request.scope["path"] = settings.prefix + request.scope["path"]
            request.scope["raw_path"] = settings.prefix.encode() + request.scope["raw_path"]
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        if "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-cache"
        return response

    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET"],
                       allow_headers=["Accept"], allow_credentials=False)
    return app


def main():
    try:
        settings = load_settings()
    except (ValueError, OSError) as exc:
        raise SystemExit(f"Configuration error: {exc}") from exc
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port,
                proxy_headers=True, forwarded_allow_ips=settings.trusted_proxy_ips)


def health():
    import urllib.request

    settings = load_settings()
    prefix = settings.prefix if settings.prefix_mode == "preserve" else ""
    urllib.request.urlopen(f"http://127.0.0.1:{settings.port}{prefix}/health/live", timeout=3).close()
