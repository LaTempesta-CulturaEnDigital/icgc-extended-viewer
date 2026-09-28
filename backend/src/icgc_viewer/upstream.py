import asyncio
import json
import time
from collections import OrderedDict
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import HTTPException

from .settings import Settings


class Upstream:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings, self.client = settings, client
        self.cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()

    async def get(self, url: str) -> dict:
        if url in self.cache:
            expiry, value = self.cache[url]
            if expiry > time.monotonic():
                self.cache.move_to_end(url)
                return value
            del self.cache[url]
        try:
            async with asyncio.timeout(self.settings.upstream_timeout_seconds):
                current_url = url
                origin = urlsplit(self.settings.upstream_base_url)
                for step in range(self.settings.upstream_max_redirects + 1):
                    async with self.client.stream("GET", current_url, follow_redirects=False) as response:
                        if response.status_code in {301, 302, 303, 307, 308}:
                            location = response.headers.get("location")
                            target = urljoin(current_url, location or "")
                            parsed = urlsplit(target)
                            if (not location or step == self.settings.upstream_max_redirects
                                    or (parsed.scheme, parsed.hostname, parsed.port) !=
                                    (origin.scheme, origin.hostname, origin.port)
                                    or parsed.username or parsed.password):
                                raise HTTPException(502, {"code": "upstream_redirect_rejected"})
                            current_url = target
                            continue
                        if response.status_code == 404:
                            raise HTTPException(404, {"code": "record_not_found"})
                        if response.status_code != 200:
                            raise HTTPException(502, {"code": "upstream_error"})
                        content = bytearray()
                        async for chunk in response.aiter_bytes():
                            content.extend(chunk)
                            if len(content) > self.settings.upstream_max_bytes:
                                raise HTTPException(502, {"code": "upstream_too_large"})
                        data = json.loads(content)
                        if not isinstance(data, dict):
                            raise TypeError("Manifest is not an object")
                        break
        except (TimeoutError, httpx.TimeoutException) as exc:
            raise HTTPException(504, {"code": "upstream_timeout"}) from exc
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise HTTPException(502, {"code": "upstream_error"}) from exc
        if self.settings.manifest_cache_ttl_seconds:
            self.cache[url] = (time.monotonic() + self.settings.manifest_cache_ttl_seconds, data)
            while len(self.cache) > self.settings.cache_max_entries:
                self.cache.popitem(last=False)
        return data
