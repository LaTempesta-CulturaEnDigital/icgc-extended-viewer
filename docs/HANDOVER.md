# Client handover

This is a read-only IIIF enrichment application and embeddable viewer. The client owns production web serving, routing, TLS, embedding policy, Kubernetes, and static annotation hosting. Start with the [README](../README.md); use the [maintenance guide](MAINTENANCE.md) for later edits.

## Review snapshot — 28 September 2026

The reviewed working copy is suitable for technical handover and internal validation. Verification completed on Windows with Docker Linux containers and Chromium:

| Check | Result |
| --- | --- |
| Backend tests / Ruff | 36 passed / clean. Two upstream test-library deprecation warnings remain. |
| Clean `npm ci`, frontend tests and production build | Passed; 6 frontend tests. |
| Browser regression suite | 15 passed, including prefixes, category filters, keyboard interactions, errors and four iframe sizes. |
| Both Docker builds / Compose startup | Passed; all demo services healthy. |
| Static viewer export / sample annotation publication | Passed; exported assets, JSON configuration and third-party notice present; 8 sample lists published. |
| Live CONTENTdm smoke check | Passed for `fonscec/1021`: 17 image tile responses, 3 eligible object boxes and 1 text region. |
| Dependency advisory scans | `npm audit`: zero known vulnerabilities; `pip-audit` of locked Python runtime dependencies: none found. |

The review upgraded the test runner to Vitest 4.1.11 to address [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9), tightened configuration/publication errors, and preserved the viewer during cached browser navigation. The existing source default of detections on / paragraphs off is reflected in documentation and tests.

This is a dated result, not a certification: the full annotation corpus, client production infrastructure, non-Chromium browsers and container OS vulnerability scans were not covered. At review time the repository had no commits; establish a release identity before sending. No client deployment or source publication was performed. Repeat the acceptance checks below on the delivered release.

## What to deliver

| Deliverable | Contents |
| --- | --- |
| Source | `backend`, `frontend`, `fixtures`, `tests`, `docs`, `README.md`, `compose.yaml`, `config.example.toml`, `.env.example`, `.gitignore`; retain both Dockerfiles, both `.dockerignore` files and both dependency lockfiles. |
| Static viewer | Contents of `frontend/dist` after `npm ci` and `npm run build`, with deployment-specific `config.json` beside `index.html`. Retain the included `THIRD_PARTY_NOTICES.txt`. |
| API | Backend Dockerfile/build context or the built image, plus agreed runtime settings. |
| Annotation data | The full prepared static release, delivered separately. Four sample records in this repository are not the full collection. |
| Release identity | A source commit/tag or a dated source archive and checksums, matching the delivered build. |

Do not send a raw archive of the working directory: exclude `node_modules`, `.venv`, caches, test screenshots, `.env`, local `config.toml`, and `data`. Deliver a prepared dataset and viewer build separately. Never omit dotfiles simply because they are hidden. The repository does not declare a software license; distribution and ownership follow the parties' agreed terms. Third-party dependency notices and the map attribution remain applicable.

## Client configuration to record

Record these alongside the release so another engineer can reproduce it:

- Public viewer URL, public API URL and static annotation base URL (including any path prefix).
- Viewer `apiConfigUrl` and query parameter names; API settings or the mounted TOML location. All shipped localhost values are demo defaults.
- The viewer origin allowed by API and annotation CORS; parent frontend origins allowed to embed the viewer by the client's HTTP configuration.
- Original manifest host, collection aliases, annotation path layout and release identifier.
- Previous viewer/API/data release and configuration to restore if rollback is needed.

Changing configuration does not require a code rebuild. Restart the API for its settings and reload the viewer for JSON changes. Publish updated annotation IDs when the static host changes. Keep HTML/config revalidation consistent with releases; hashed assets may be cached for longer. This repository provides the application contract, not server or Kubernetes templates.

## API reference

All routes below are relative to `public_base_url`. Responses are JSON and unauthenticated. The enrichment endpoint is read-only; there are no write endpoints or automatic API documentation pages.

| GET route | Successful response |
| --- | --- |
| `/iiif/info/{collection}/{id}/manifest.json` (default configurable template) | Enriched Presentation 2 manifest, including static detection/transcription list references. |
| `/config.json` | `manifestTemplate`, `annotationTemplate`, `allowedCollections`, `requestTimeoutMs`; browser-safe configuration only. |
| `/health/live` | `{"status":"ok"}` |
| `/health/ready` | `{"status":"ready"}` |

Health endpoints confirm that the application responds; they do not check upstream connectivity, images or annotation availability. Run an actual record request for an end-to-end check. The backend does not honour `HTTP_PROXY`/`HTTPS_PROXY` environment settings (`httpx` uses `trust_env=False`); it requires direct upstream access unless explicitly adapted for the client's network.

Errors have a `detail` object, for example `{"detail":{"code":"record_not_found"}}`. Unsupported manifests also include a diagnostic `message`. An unmatched route can return FastAPI's ordinary string detail.

| HTTP status | Application codes / meaning |
| --- | --- |
| 400 | `invalid_record_id`: requires 1–12 ASCII digits. |
| 404 | `unknown_collection` or `record_not_found`. |
| 422 | `unsupported_manifest`: structure outside the supported subset. |
| 502 | `upstream_error`, `upstream_too_large`, or `upstream_redirect_rejected`. |
| 504 | `upstream_timeout`. |

The original manifest cache is bounded, in memory and per process. Restarting clears it. Only successful JSON-object fetches are cached; enrichment validation happens afterwards, so an unsupported manifest may remain cached until TTL expiry. There is no database or persistent server state.

## Acceptance checks

1. Build from the delivered lockfiles and run the backend, frontend and browser checks in the README. Run container builds in the client's target environment too.
2. Fetch the public API `/config.json` and one enriched manifest. Confirm all generated URLs use the client's domains and path prefixes, and that the browser can read them with CORS.
3. Fetch that record's two static annotation URLs directly. Confirm JSON responses, expected list IDs and original canvas targets. A missing annotation file does not make the API manifest request fail.
4. Open the viewer in the real parent frontend iframe. Confirm detections start on and paragraphs off, categories filter boxes and labels together, hover and drag work, and text/metadata dialogs work with keyboard and touch. Verify attribution remains accessible.
5. Test populated data (`fonscec/1021`), multiple text versions (`catalunya/1037`), no transcriptions (`fonscec/308`), empty lists (`fonscec/1019`) and an unavailable annotation file. Those records are the included samples; also check representative full-dataset records.
6. Check a narrow iframe and a short desktop iframe in the client's supported browsers. The parent supplies the title, branding, accessible iframe title and dimensions. There is no automatic parent resizing.
7. Run the live smoke test against the deployed viewer URL. Confirm image tiles load and overlays match the expected map features, then record release identity and results.

## Troubleshooting by symptom

| Symptom | First checks |
| --- | --- |
| Image loads but no detections/text | Turn layers on; check category filters, static URLs, CORS and whether the record was published. The demo includes only four records. `Altres objectes` is intentionally hidden. |
| Viewer fails before loading a map | Check viewer `config.json`, public API `/config.json`, query parameters, API logs and browser network responses. |
| Metadata loads but image fails | Check the original image service `/info.json` and tile URLs, HTTPS compatibility and image-service CORS. |
| Boxes are missing despite valid JSON | Inspect original canvas ID, `xywh` bounds, annotation type and `resource.chars`; invalid regions are omitted with a warning. |
| Prefix deployment returns 404 | Compare the public base, `prefix_mode`, proxy path and configured manifest template. See the README prefix table. |
| Embed blocked or blank only in parent page | Check the client's embedding headers/policies and the iframe dimensions. |
| Settings appear ignored | Check which process reads the file: Compose `.env`, API `ICGC_CONFIG`, or browser JSON. Environment overrides beat TOML. Restart/reload the relevant component. |
| Source edit is not visible | Rebuild/redeploy the viewer or API image; refresh cached HTML. Compose preview serves a built bundle, not live source. |
