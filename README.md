# ICGC IIIF manifest service and viewer

This repository contains the application and local development tools. The client's technical team manages production web serving, routing, HTTPS, headers and Kubernetes.

- **Viewer:** plain TypeScript, HTML, CSS and OpenSeadragon, delivered as static files.
- **API:** Python/FastAPI with uv, delivered as a separate container.
- **Annotations:** existing detection/transcription JSON, served statically by the client.

CONTENTdm remains authoritative for catalog metadata, original manifests and image services. There is no AI generation, database, editing, authentication or collection search. The AI-processing repository is not a runtime dependency.

## Where to start

| Task | Read |
| --- | --- |
| Run the four-record local demo | [Local startup](#local-startup-with-compose) |
| Set domains, ports, collections or annotation locations | [Runtime configuration](#runtime-configuration) and [configuration examples](docs/MAINTENANCE.md#configuration-examples) |
| Change the interface or application code | [Maintenance guide](docs/MAINTENANCE.md) |
| Prepare and accept the client delivery | [Handover guide](docs/HANDOVER.md) |

The application has two separate build outputs: static viewer files and an API container. The full annotation dataset is a separate delivery; this repository contains only four small sample records.

## How it works

```text
Browser ── page, assets, config.json ──► Client's viewer web server
        ── API config + manifest ─────► FastAPI ──► CONTENTdm manifest
        ── annotation lists ─────────► Client's static annotation host
        ── image info + tiles ───────► CONTENTdm IIIF image service
```

The viewer and API can be hosted independently. The viewer uses a public API URL from its own `config.json`; the API supplies the annotation URL settings so the annotation host is configured in one place.

Example URLs:

```text
https://viewer.example.org/viewer/?collection=fonscec&id=1021
https://api.example.org/iiif/info/fonscec/1021/manifest.json
https://static.example.org/iiif/annotations/fonscec/1021/detections.json
https://static.example.org/iiif/annotations/fonscec/1021/transcriptions.json
```

The manifest-style endpoint returns enriched JSON directly. It accepts collection and numeric ID in its path, not arbitrary URLs. It preserves original metadata, image services, canvas/sequence/range IDs and unrelated content. Only the top-level manifest `@id` and managed canvas `otherContent` references change. Repeated enrichment does not duplicate managed references.

The API always adds both annotation references without fetching the lists. The viewer loads and validates them independently, so missing annotations do not prevent the map from loading. Supported manifests are Presentation 2 with one sequence, one canvas and one full-canvas image. Unsupported structures are rejected explicitly.

## Local startup with Compose

Compose is retained for development and demonstrations, not as a production deployment prescription. It runs the API plus Vite's local preview server. Its optional `demo` profile also uses Vite to serve sample annotation JSON with CORS. No nginx configuration is included.

From the repository root:

Prerequisites: Docker Engine/Desktop with Compose v2, uv, and Python 3.12 or 3.13 (uv can install Python). Native frontend development additionally needs Node.js 22.12+ within Node 22, or Node 24+. Dependency installation and the live demo require internet access.

```sh
# Once only: output must be new or empty.
uv run --project backend --locked icgc-publish-annotations --source fixtures/annotations --output data/static
docker compose --profile demo up --build -d --wait
```

If `data/static` was already prepared, skip the first command. Published copies under `data/static` are ignored by Git and are not baked into images; the original samples in `fixtures` are included in the source delivery. The commands work in both PowerShell and a POSIX shell.

| Local service | URL |
| --- | --- |
| Viewer | `http://localhost:8000/viewer/?collection=fonscec&id=1021` |
| API configuration | `http://localhost:8002/config.json` |
| Enriched manifest | `http://localhost:8002/iiif/info/fonscec/1021/manifest.json` |
| Sample annotations | `http://localhost:8081/iiif/annotations/fonscec/1021/detections.json` |

The four samples are `fonscec/1021`, `fonscec/308`, `fonscec/1019` and `catalunya/1037`. Other records can load their maps while unpublished local annotations return 404. The demo uses live CONTENTdm manifests/images, so internet access is required.

```sh
docker compose ps
docker compose logs viewer api annotations
docker compose --profile demo down
```

To use the client's annotation host instead, omit `--profile demo` and set `ANNOTATION_BASE_URL` in a local, ignored `.env` file:

```dotenv
VIEWER_PORT=8000
API_PORT=8002
API_PUBLIC_BASE_URL=http://localhost:8002
API_PREFIX_MODE=preserve
API_CORS_ORIGINS=["http://localhost:8000"]
ANNOTATION_BASE_URL=https://static.example.org
```

Copy [.env.example](.env.example) for these Compose settings. Compose does **not** load `config.example.toml`, and `.env` is **not** automatically read by the Python CLI or the annotation publication command. See the [configuration examples](docs/MAINTENANCE.md#configuration-examples) before changing the annotation host.

Compose exposes ports on localhost only. Internally the preview server listens on 8080 and the API on 8000. If public ports/origins change, update the viewer's `apiConfigUrl` and API CORS accordingly. Public configuration uses browser-visible addresses, not Docker service names.

## Build the client deliverables

### Static viewer

With Node.js 22.12+ within Node 22, or Node 24+:

```sh
cd frontend
npm ci
npm run build
```

Deliver the contents of `frontend/dist/`. Alternatively, use the build container from the repository root:

```sh
docker build -t icgc-viewer-build:local frontend
docker run --rm -v /absolute/path/to/empty-output:/output icgc-viewer-build:local
```

Use an empty output directory. In PowerShell, an example absolute mount is `-v "${PWD}/data/viewer-dist:/output"`. The Dockerfile builds the viewer and its default command copies the static output to `/output`; it does not start a production web server. Compose overrides that command for local preview only.

Vite bundles the plain TypeScript and OpenSeadragon and emits relative asset paths. The client can serve the same files at a domain root or under a directory, without rebuilding. Keep `config.json` beside `index.html` and use a trailing slash for directory URLs.

### API container

```sh
docker build -t icgc-api:local backend
```

The backend Dockerfile uses the included `uv.lock`, installs production dependencies and runs `uv run --no-sync icgc-viewer`. Startup requires no package downloads. It contains no frontend or AI/notebook dependencies. The client can tag/publish this image through its own registry and deployment pipeline.

## Deployment contract

The client receives static viewer files, the API Dockerfile/image, lockfiles, tests, small fixtures and configuration examples. Production nginx, proxy, CI and Kubernetes definitions are intentionally left to their technical team.

Required configuration:

1. Serve the viewer's static files and set its `config.json` to the public API config URL.
2. Set the API's public base URL, upstream URL and annotation base URL. Allow the viewer origin in API CORS, either at the API or the client-managed HTTP layer.
3. Serve annotation JSON with the correct MIME type and browser CORS permissions. CONTENTdm image info/tiles must also permit browser access.
4. For HTTPS viewer pages, use HTTPS API, annotation and image endpoints. The client's server controls iframe CSP/embedding permissions, caching and routing.

The API listens on port 8000 by default. Its `/health/live` and `/health/ready` return JSON and do not depend on viewer files or CONTENTdm availability. The viewer has no production runtime process to probe in this repository.

API prefix contract:

| Public API base | Proxy sends | `prefix_mode` |
| --- | --- | --- |
| `https://api.example.org` | `/iiif/info/...` | `preserve` |
| `https://api.example.org/maps` | `/maps/iiif/info/...` | `preserve` |
| `https://api.example.org/maps` | `/iiif/info/...` | `strip` |

`/config.json` and health routes follow the same prefix contract. Do not also set Uvicorn `--root-path`; the application derives its ASGI routing from configuration. Viewer hosting paths are independent of API prefixes. These are application requirements; the client chooses how to implement its routing.

Sample iframe, once the client's parent/viewer policies permit embedding:

```html
<iframe
  src="https://viewer.example.org/viewer/?collection=fonscec&id=1021"
  title="Visor de mapes històrics"
  style="width:100%;height:75vh;border:0"
  loading="lazy">
</iframe>
```

## Runtime configuration

The viewer loads `./config.json` from its own directory:

```json
{
  "apiConfigUrl": "https://api.example.org/config.json",
  "collectionParameter": "collection",
  "idParameter": "id"
}
```

It then reads the API's public configuration for the manifest/annotation templates, allowed collections and timeout. The browser does not read container environment variables. Compose mounts `frontend/public/config.json` into the local build output; the client replaces the delivered JSON for production.

For the API, copy `config.example.toml` to a local file and set `ICGC_CONFIG` to its absolute path. A container can mount it read-only. Each key also accepts an environment override named `ICGC_` plus its uppercase name; list values are JSON arrays. Precedence is environment variables, then TOML, then built-in defaults. Invalid settings and unknown TOML keys produce startup errors. The example file is never loaded automatically. Unknown environment variable names are ignored, so check spelling carefully.

| API key | Default | Meaning |
| --- | --- | --- |
| `public_base_url` | `http://localhost:8002` | Public API origin including optional prefix |
| `upstream_base_url` | `https://cartotecadigital.icgc.cat` | Fixed CONTENTdm base |
| `upstream_manifest_template` | `/iiif/info/{collection}/{id}/manifest.json` | Upstream path |
| `manifest_path_template` | `/iiif/info/{collection}/{id}/manifest.json` | Public enrichment endpoint path |
| `annotation_base_url` | `http://localhost:8081` | Static annotation host/base path |
| `annotation_path_template` | `/iiif/annotations/{collection}/{id}/{kind}.json` | List path; kind is detections or transcriptions |
| `allowed_collections` | `["catalunya", "fonscec"]` | Collection allowlist |
| `legacy_annotation_bases` | `[]` | Exact former bases of managed references already present upstream |
| `prefix_mode` | `preserve` | Whether the public API prefix reaches the application |
| `cors_origins` | `[]` | Viewer origins allowed to read the API; Compose supplies localhost:8000 |
| `host`, `port` | `0.0.0.0`, `8000` | Internal API listener |
| `trusted_proxy_ips` | `127.0.0.1` | Trusted forwarded-header sources |
| `upstream_timeout_seconds` | `10` | Overall upstream deadline |
| `manifest_cache_ttl_seconds` | `300` | Original-manifest cache TTL; zero disables it |
| `cache_max_entries` | `256` | Per-process LRU cache bound |
| `upstream_max_bytes` | `5000000` | Decoded response size limit |
| `upstream_max_redirects` | `3` | Bounded same-origin redirects |
| `annotation_dir` | `data/annotations` | Publication command input only; API never accesses it |

Only successful JSON-object fetches are cached; HTTP, timeout and JSON parsing errors are not cached and expired content is not served stale. Manifest compatibility is checked after fetching, so an unsupported structure can remain cached until its TTL expires. The timeout includes redirects. CONTENTdm's manifest route may redirect on the same origin; redirects to a different scheme/host/port or with credentials are rejected.

Configuration changes need no source edits or frontend rebuilds. Restart the API after changing its settings, and reload the browser after changes to either configuration. Changes to viewer code require new static files; changes to API code/dependencies require a new API image. The client controls static-file cache revalidation.

Common changes:

- **Public domain:** change API `public_base_url`, viewer `apiConfigUrl` and API CORS for the viewer's origin.
- **Path prefix:** include the API prefix once in `public_base_url`, set the matching `prefix_mode`, and update viewer `apiConfigUrl`. Serve viewer files at any chosen directory.
- **Upstream URL:** change `upstream_base_url` and `upstream_manifest_template`; verify that returned canvas IDs still match the annotation targets.
- **Annotation location:** change `annotation_base_url`/template and prepare matching static IDs. Use `annotation_dir` or publication `--source` for another disk location. The viewer learns annotation URLs from the API.

## Prepare static annotations

Existing input is Presentation 2: `sc:AnnotationList`, `resources`, `oa:Annotation`, text in `resource.chars` and original canvas targets with `#xywh=x,y,width,height`. Files use `annotations/{collection}/{id}/detections.json` and `transcriptions.json`.

The optional publication command prepares IDs for the configured static host:

```sh
uv run --project backend --locked icgc-publish-annotations \
  --source /path/to/annotations --output /path/to/new-static-release
```

Set `ICGC_CONFIG` or `ICGC_ANNOTATION_BASE_URL` for this command to match the API's annotation settings. A Compose `.env` setting alone does not configure publication. See [host-change examples](docs/MAINTENANCE.md#publish-annotations-for-a-different-host).

It requires a separate, new/empty output, validates before writing, and changes only list IDs and child annotation ID bases. It preserves fragments, original canvas targets, text and provenance. It never changes the source files or performs broad URL replacement. Serve the output directory at `annotation_base_url`; default output paths begin `iiif/annotations/`.

When a host changes, prepare IDs for that host as well as changing API configuration. Correctly prepared lists can be hosted directly without this command. `legacy_annotation_bases` handles exact old bases of managed references already in upstream manifests; different historical path templates must be migrated at their source.

The client manages static releases and rollback. Retain previous annotation files and configuration when publishing updates. No dataset belongs in normal application builds or Git.

## Viewer behavior

The viewer is a compact, read-only iframe interface shared by internal reviewers and public visitors. The parent page supplies the visible map title and institutional branding, sets the iframe width/height and provides its accessible `title`. There is no parent-page messaging or automatic iframe resizing.

The toolbar and status area surround a map that fills the remaining height without outer page scrolling. Transcriptions open in a 320px right panel; below 800px wide, they occupy the lower half of the workspace. Long panel content scrolls internally. The **Informació** dialog contains the map title, collection/ID, attribution, metadata and manifest link; closing it restores focus to its button.

Detections are enabled on each new load; paragraphs start off. Both layer controls remain usable:

| Control | Behavior |
| --- | --- |
| Deteccions | Object boxes and labels together, with hover highlighting |
| Paràgrafs i text | Selectable text regions and transcription panel |

Paragraph detections are excluded from object controls. Transcription rectangles define the text layer when available; otherwise paragraph detections show a no-transcription fallback. Multiple texts at the same rectangle share one outline and retain all versions. Click/tap, keyboard or the region list selects text; Escape closes the layer. Text preserves line breaks and is rendered without executing markup.

The `other_objects` / **Altres objectes** category is excluded from detection overlays, counts and filters. With detections enabled, **Categories** opens a compact checkbox filter containing only categories present in that map, with counts and **Totes**, **Cap** and per-category **Només** actions. Changes apply immediately to boxes and labels without refetching data. The toolbar shows selected/total categories and matching/total detections when filtered. Selections survive toggling the detection layer off and on; a new page load selects all eligible categories, enables detections and leaves paragraphs off. Category keys come from `source_label`, falling back to the displayed label. The static source files are unchanged.

Model, date and paragraph identifiers are available in collapsed **Detalls de l’anotació** sections. The interface distinguishes loading, empty lists and failed annotation requests. Annotation retry reloads the lists while retaining the map position and selected layers; image failures provide their own retry. There are no approval controls or saved review decisions.

Annotation coordinates are already in canvas space. The viewer scales x/width by image-width/canvas-width and y/height by image-height/canvas-height, then uses OpenSeadragon's image-to-viewport conversion for overlays. Zoom, pan and resize retain alignment. Invalid/out-of-bounds or foreign-canvas regions are omitted with a warning.

## Local development and checks

Use Python 3.12/3.13, uv and Node.js 22.12+ within Node 22, or Node 24+:

```sh
# Terminal 1, repository root. Example config permits the Vite origin.
ICGC_CONFIG=/absolute/path/config.example.toml ICGC_PORT=8002 \
  uv run --project backend --locked icgc-viewer
# Terminal 2
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/?collection=fonscec&id=1021`. Its local JSON points to API port 8002. Use the Compose demo annotation service or a real static host. Stop the Compose API before starting a native API on the same port: `docker compose stop api`. A complete [PowerShell example](docs/MAINTENANCE.md#run-the-api-and-viewer-for-editing) is provided in the maintenance guide.

```sh
cd backend
uv sync --locked
uv run --locked pytest -q
uv run --locked ruff check src tests
cd ../frontend
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Browser tests use separate local viewer/API origins, real annotation fixtures and a geometric image with different dimensions. They cover visibility, controls, readable text versions, keyboard selection, alignment, missing/empty lists, errors, prefixes and iframe sizing. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an existing Chromium installation.

With Compose running, `npm run test:live` verifies actual CONTENTdm image loading and saves `frontend/test-results/live-map.png`. Set `SMOKE_VIEWER_URL` to check another deployment. This check requires external connectivity.

For troubleshooting: API `404` means an unknown collection/record, `400` an invalid ID, `422` an unsupported manifest, and `502`/`504` an upstream failure. If the map loads without layers, check static URLs, file availability and CORS. If configuration fails, check viewer JSON, the API config URL and API CORS. Check image-service requests for image failures. Production routing, caching and embedding issues belong to the client's HTTP configuration.
