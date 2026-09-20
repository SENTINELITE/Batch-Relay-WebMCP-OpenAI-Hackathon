# Livepeer Creative server integration

The `/api/creative` routes keep Livepeer access on the server. The browser receives a short-lived, signed httpOnly session after the configured passcode is accepted; it never receives the MCP endpoint or bearer credential.

Every estimate calls the Creative MCP with a one-step `submit_plan` proposal for `create_media`. Background proposals bind the project ID, revision, prompt, palette, model, output ratio, and request ID. Cutout proposals instead bind the source asset identity and content hash, as described below. The estimate is visible to the user and expires after ten minutes. Generation requires the estimate ID, project ID, revision, and request ID; the server checks that binding, reserves the per-render budget, and then calls `submit_plan({ plan_id, confirm: true })` exactly once. Repeating the same request ID returns the existing job instead of dispatching another plan.

`GET /api/creative/jobs/:id` polls `get_plan`. If the plan exposes a media job without an image, the server recovers it with `get_create_media`. Unknown provider status is preserved as `unknown`; it is never converted into success and an output with `fallback_fired` is rejected. The journal retains the reservation when a dispatched job has no known cost so a timeout cannot silently reopen the budget.

The journal is an atomic JSON file guarded by an exclusive lock. Configure `LIVEPEER_JOURNAL_PATH` to a durable mounted volume in production; the routes fail closed when production has no absolute journal path. The default development journal lives under `.creative-data/` and is ignored by Git. The default application budget is $20 and each plan is capped at $0.10; `LIVEPEER_CREATIVE_BUDGET_USD` may lower the application budget.

Generated URLs are stored only after a successful provider result. The image route accepts no URL from the caller, validates the stored HTTPS host against the MCP host or `LIVEPEER_IMAGE_HOSTS` (for example `v3b.fal.media`), follows at most three manually validated HTTPS redirects, rejects private IP destinations, caps the streamed response at 20 MiB, and requires an image content type. Redirects are never followed outside the explicit operator-owned host allowlist.

The provider adapter speaks MCP JSON-RPC (`initialize`, `notifications/initialized`, `tools/call`) over `fetch`; it does not invent a vendor REST endpoint. The adapter accepts both JSON and server-sent event MCP responses and forwards the negotiated protocol version on subsequent calls.

## Athlete cutouts

`POST /api/creative/cutouts/estimate` is the explicit “Upload photo & estimate” boundary. It accepts a bounded multipart request containing `projectId`, `revision`, `requestId`, `sourceAssetId`, and a client-resized raster `image` no larger than 900 KiB. The server reads and validates the actual bytes, rejects SVG and forged MIME declarations, then calls the MCP `upload_image` tool with base64 bytes. The resulting hosted URL is cached by source asset ID and content hash.

The estimate calls `submit_plan` with one `create_media` step using `action: generate`, `model_override: bg-remove`, the cached `source_url`, and the identity-preserving cutout prompt. It deliberately sends no aspect ratio or palette. The source asset ID and SHA-256 hash are part of the quote binding, so execution reuses the stored upload and cannot silently substitute a changed photo. Successful cutout results are proxied as the provider’s original alpha-capable raster bytes without flattening or re-encoding.

The browser verifies decoded transparent and opaque pixels before marking a candidate ready. Applying it changes only the athlete asset and its fit mode; the original photo and its full-resolution bytes remain available locally. Restoring, reapplying, undoing, and exporting reuse stored bytes without provider calls.

Local canary verified September 19, 2026: one `bg-remove` job completed after a $0.0011 quote and returned a 1280 × 1600 transparent PNG. Apply, reload, restoration of the 3301 × 4125 original, undo/redo, and both exact-size PNG exports passed. Actual provider cost was not returned, so the budget reservation remains held. This is local integration evidence, not hosted participant attribution or submission proof.
