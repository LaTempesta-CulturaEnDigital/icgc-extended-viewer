"""Test-only servers: static viewer on 8099, independent API on 8100."""
import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from icgc_viewer.app import create_app
from icgc_viewer.settings import Settings

ROOT = Path(__file__).resolve().parents[1]


def upstream(request):
    parts = request.url.path.split("/")
    path = ROOT / "fixtures/manifests" / f"{parts[-3]}_{parts[-2]}.json"
    return httpx.Response(200, json=json.loads(path.read_text(encoding="utf-8"))) if path.is_file() else httpx.Response(404)


api_settings = {"annotation_base_url": "http://127.0.0.1:8099/static", "cors_origins": ["http://127.0.0.1:8099"]}
root_api = create_app(Settings(public_base_url="http://127.0.0.1:8100", **api_settings), httpx.MockTransport(upstream))
prefix_api = create_app(Settings(public_base_url="http://127.0.0.1:8100/maps", **api_settings), httpx.MockTransport(upstream))


@asynccontextmanager
async def lifespan(_):
    async with root_api.router.lifespan_context(root_api), prefix_api.router.lifespan_context(prefix_api):
        yield


api_lifespan = FastAPI(lifespan=lifespan)


class ApiDispatch:
    async def __call__(self, scope, receive, send):
        target = api_lifespan if scope["type"] == "lifespan" else (
            prefix_api if scope["path"].startswith("/maps/") else root_api)
        await target(scope, receive, send)


viewer = FastAPI()
viewer.mount("/static/iiif/annotations", StaticFiles(directory=ROOT / "fixtures/annotations"))


@viewer.get("/health/ready")
def ready():
    return {"status": "ready"}


@viewer.get("/viewer/config.json")
def root_config():
    return {"apiConfigUrl": "http://127.0.0.1:8100/config.json"}


@viewer.get("/maps/viewer/config.json")
def prefix_config():
    return {"apiConfigUrl": "http://127.0.0.1:8100/maps/config.json"}


@viewer.get("/embed")
def embed():
    return HTMLResponse('<!doctype html><iframe title="Mapa" src="/maps/viewer/?collection=catalunya&id=1037" '
                        'style="width:95vw;height:90vh;border:0"></iframe>')


viewer.mount("/viewer", StaticFiles(directory=ROOT / "frontend/dist", html=True))
viewer.mount("/maps/viewer", StaticFiles(directory=ROOT / "frontend/dist", html=True))


async def main():
    await asyncio.gather(
        uvicorn.Server(uvicorn.Config(viewer, host="127.0.0.1", port=8099)).serve(),
        uvicorn.Server(uvicorn.Config(ApiDispatch(), host="127.0.0.1", port=8100)).serve(),
    )


if __name__ == "__main__":
    asyncio.run(main())
