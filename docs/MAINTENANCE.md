# Maintaining the viewer and API

Start with the [README](../README.md) for architecture, local startup and the complete settings table. Paths below are relative to the repository root. Make edits in the source files, not in generated `dist` files or running containers.

## Where to make changes

| Change | Source | How to apply it |
| --- | --- | --- |
| Public API address and viewer query parameter names | `frontend/public/config.json` | Replace deployed `config.json`; reload the page. Compose mounts this file directly. |
| API/annotation domains, URL templates, allowed collections, timeouts, cache and CORS | `config.toml` or `ICGC_*` environment variables | Restart the API; reload the viewer. In Compose, use the mapped settings in `.env` or explicitly add additional API environment settings to `compose.yaml`. |
| Local ports | `.env`, copied from `.env.example` | Recreate Compose services. Keep browser-visible URLs and CORS in sync. |
| Toolbar labels, dialog structure and static Catalan text | `frontend/index.html` | Rebuild the viewer. |
| Colours, spacing, map controls, panel width and responsive layout | `frontend/src/styles.css` | Rebuild the viewer. The panel is 320px; the mobile breakpoint is 799px. |
| Category selection, overlay interaction, text panel and dynamic messages | `frontend/src/main.ts` | Rebuild the viewer; run browser tests. |
| Initial layer visibility | The two `controls.*.checked` assignments near the top of `frontend/src/main.ts` | Currently detections on, paragraphs off. Update browser/live test expectations and README behaviour together; rebuild the viewer. |
| Annotation parsing, category exclusions, paragraph grouping and coordinate conversion | `frontend/src/annotations.ts` | Run annotation and browser tests; rebuild the viewer. |
| Viewer manifest compatibility checks | `frontend/src/manifest.ts` | Keep consistent with backend checks; test both. |
| Runtime configuration fetching and network errors | `frontend/src/config.ts` | Rebuild the viewer; test startup and failure states. |
| API endpoints and response headers | `backend/src/icgc_viewer/app.py` | Run backend tests; rebuild the API image. |
| Settings validation, defaults and public configuration | `backend/src/icgc_viewer/settings.py` | Update the example TOML and README table too; rebuild the API image. |
| Enrichment and supported manifest structures | `backend/src/icgc_viewer/enrichment.py` | Run preservation/idempotence tests; rebuild the API image. |
| Upstream requests, redirects and caching | `backend/src/icgc_viewer/upstream.py` | Run backend tests; rebuild the API image. |
| Preparing static annotation IDs | `backend/src/icgc_viewer/publish_annotations.py` | Run publication tests; publish into a new directory. |

There is no UI framework or translation service. Visible text is Catalan in the HTML and TypeScript; changing language currently requires editing those strings. Detection names come from annotation `resource.label`. The `source_label` is the stable category key. New categories appear automatically if present in the data; no enum needs extending. `detectionObjects()` controls the exclusion of `other_objects` / `Altres objectes`.

## Configuration examples

Three different files have different consumers:

| File | Consumer | Loaded automatically? |
| --- | --- | --- |
| `.env` | Docker Compose variable substitution | Yes, when running Compose from the project root. Only variables referenced in `compose.yaml` take effect. |
| `config.toml` | API and publication CLI | Only when `ICGC_CONFIG` points to it. |
| `config.json` beside the viewer's `index.html` | Browser | Yes, on each page load. `frontend/public/config.json` is the source copy. |

Do not put secrets in viewer JSON or the API's public `/config.json`. Browser URLs must resolve from the user's browser; container service names such as `api:8000` will not work there.

### Change local ports

For a viewer on 9000 and API on 9002, copy `.env.example` to `.env` and change:

```dotenv
VIEWER_PORT=9000
API_PORT=9002
API_PUBLIC_BASE_URL=http://localhost:9002
API_CORS_ORIGINS=["http://localhost:9000"]
```

Change `frontend/public/config.json` to use `"apiConfigUrl": "http://localhost:9002/config.json"`. From the root run `docker compose --profile demo up -d --wait`, then open `http://localhost:9000/viewer/?collection=fonscec&id=1021`. The demo annotation port remains 8081. Use the same hostname throughout: `localhost` and `127.0.0.1` are distinct CORS origins.

### Set client domains

Keep the rest of the example TOML defaults and set these values in the client's API configuration:

```toml
public_base_url = "https://api.example.org"
annotation_base_url = "https://static.example.org/maps"
cors_origins = ["https://viewer.example.org"]
```

The API's `ICGC_CONFIG` must point to the mounted TOML file **inside its container**, or supply equivalent `ICGC_PUBLIC_BASE_URL`, `ICGC_ANNOTATION_BASE_URL` and `ICGC_CORS_ORIGINS` environment variables. For the latter list, the value is `["https://viewer.example.org"]` as a JSON string.

Set the deployed viewer's `config.json` to `"apiConfigUrl": "https://api.example.org/config.json"`. Annotation URLs will then begin `https://static.example.org/maps/iiif/annotations/`. CORS must allow the **iframe viewer origin**, which can differ from the parent frontend origin. The client's team manages HTTP hosting and embedding headers.

### Publish annotations for a different host

Use the same annotation base and path template for the API and publisher. The source must have `{collection}/{id}/detections.json` and/or `transcriptions.json`. Do not point the publisher at a directory of manifests.

PowerShell, from the repository root:

```powershell
$env:ICGC_ANNOTATION_BASE_URL = 'https://static.example.org/maps'
uv run --project backend --locked icgc-publish-annotations --source fixtures/annotations --output data/client-release
Remove-Item Env:ICGC_ANNOTATION_BASE_URL
```

POSIX shell:

```sh
ICGC_ANNOTATION_BASE_URL=https://static.example.org/maps uv run --project backend --locked icgc-publish-annotations --source fixtures/annotations --output data/client-release
```

Replace `fixtures/annotations` with the full dataset location for a real delivery. `data/client-release` must be new or empty. Serve its **contents at `/maps/`**: `iiif/annotations/...` is already in the output, so do not add it twice. The command rewrites list and annotation IDs; it preserves original canvas targets and text. It checks the expected list/ID/target structure, not whether every record has both files or whether every region is geometrically correct. The viewer performs canvas and rectangle checks. Publication validates all lists before writing and holds the prepared release in memory; an I/O failure during writing can leave a partial output, which must not be published.

Set `ICGC_CONFIG` instead when custom templates or collection aliases are needed. `.env` alone does not configure the publisher. When switching from an earlier host, publish from the source lists into a new output; keep the previous release available for rollback.

### Add a collection or change viewer parameters

Add the alias to API `allowed_collections` (or JSON array `ICGC_ALLOWED_COLLECTIONS`), restart it and publish the matching static files with the same setting. The upstream collection must exist and return a supported manifest; adding an alias does not create data. IDs are 1–12 ASCII digits.

To use `?collectionName=fonscec&recordId=1021`, change the viewer JSON's `collectionParameter` to `collectionName` and `idParameter` to `recordId`. Names must be distinct, start with a letter, and contain only letters, digits, `_` or `-`. Update parent iframe URLs at the same time. API path parameters are unaffected.

## Run the API and viewer for editing

First prepare/start the Compose demo as described in the README. It provides static annotations. Stop only its API with `docker compose stop api` before starting the native API on 8002.

PowerShell terminal 1, repository root:

```powershell
$env:ICGC_CONFIG = (Resolve-Path ./config.example.toml).Path
$env:ICGC_PORT = '8002'
uv run --project backend --locked icgc-viewer
```

Terminal 2:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/?collection=fonscec&id=1021`. Vite refreshes frontend changes automatically. Restart the native API after Python or TOML edits. After stopping the native API, `docker compose up -d api` restores the demo API. Environment variables set in PowerShell last for that terminal session; remove them or open a new terminal before testing other configurations.

To update the Compose viewer after source edits, run `docker compose up --build -d --wait --no-deps viewer` from the root. For backend source edits, use the same command with `api`. Production updates are a new static viewer bundle or API image, not a Compose requirement.

## Data and compatibility rules

- Presentation 2 only: one sequence, one canvas, one full-canvas image with an HTTP(S) IIIF image service. Presentation 3, multiple pages and cropped/composite paintings require coordinated backend and viewer work.
- The API preserves metadata and image services, changes the manifest ID, and adds exactly the two managed annotation-list links. It never fetches annotation lists.
- The viewer follows the two configured links in `otherContent`, not every unrelated annotation list. Each annotation targets the exact original canvas ID plus numeric `#xywh=x,y,width,height`; dimensions must be positive and the rectangle inside the canvas.
- Text uses `resource.chars`. Transcriptions sharing an exact rectangle are shown as versions. Detection and transcription files are not joined by `paragraph_id`. If any transcriptions exist, their rectangles define the paragraph layer; paragraph detections are used only when there are no transcriptions.
- An empty list (`resources: []`) means no annotations. A missing file or failed request means unavailable data. Preserve this distinction when editing messages or publication workflows.
- Confidence metadata, if supplied for transcription, may describe the source detection. It must not be presented as a transcription accuracy score.
- The browser needs JavaScript and native dialog, Popover API, fetch/AbortSignal timeout and dynamic viewport units. Automated browser coverage is Chromium; run acceptance checks in the client's chosen Firefox/Safari versions before public rollout. There are no compatibility polyfills.

## Verify an edit

Use the [README check commands](../README.md#local-development-and-checks). Backend tests use fixtures and mocked upstream responses; browser tests serve the built viewer from `frontend/dist`, so build **before** running Playwright. The test servers use ports 8099 and 8100. A stale server on those ports can be reused locally; stop it before a fresh acceptance run.

For frontend edits, run `npm test`, `npm run build` and `npm run test:browser` in `frontend`. For API/publication changes run `uv run --locked pytest -q` and `uv run --locked ruff check src tests` in `backend`. For image-service or deployment changes, also run `npm run test:live` against the actual deployment. Use the four sample records to cover populated, empty and multiple-version cases.

Keep `package-lock.json` and `uv.lock` with the source. Use `npm ci` and `uv sync --locked` for reproducible installs. For intentional dependency changes, update the relevant manifest and lockfile together and rerun the checks, including a container build. Do not edit lockfiles manually. When updating OpenSeadragon, refresh `frontend/public/THIRD_PARTY_NOTICES.txt` from the installed package's license. `npm audit` checks frontend dependencies; a Python runtime audit can use `uv export --locked --no-dev --no-emit-project --output-file <temporary-requirements-file>` followed by `uvx pip-audit -r <temporary-requirements-file> --no-deps --disable-pip` from `backend`.
