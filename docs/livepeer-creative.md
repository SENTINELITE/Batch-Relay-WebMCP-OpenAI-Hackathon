# Livepeer Creative server integration

The `/api/creative` routes keep Livepeer access on the server. The browser receives a short-lived, signed httpOnly session after the configured passcode is accepted; it never receives the MCP endpoint or bearer credential.

Every estimate calls the Creative MCP with a one-step `submit_plan` proposal for `create_media`. The proposal binds the project ID, revision, prompt, palette, model, output ratio, and request ID. The estimate is visible to the user and expires after ten minutes. Generation requires the estimate ID, project ID, revision, and request ID; the server checks that binding, reserves the per-render budget, and then calls `submit_plan({ plan_id, confirm: true })` exactly once. Repeating the same request ID returns the existing job instead of dispatching another plan.

`GET /api/creative/jobs/:id` polls `get_plan`. If the plan exposes a media job without an image, the server recovers it with `get_create_media`. Unknown provider status is preserved as `unknown`; it is never converted into success and an output with `fallback_fired` is rejected. The journal retains the reservation when a dispatched job has no known cost so a timeout cannot silently reopen the budget.

The journal is an atomic JSON file guarded by an exclusive lock. Configure `LIVEPEER_JOURNAL_PATH` to a durable mounted volume in production; the routes fail closed when production has no absolute journal path. The default development journal lives under `.creative-data/` and is ignored by Git. The default application budget is $20 and each plan is capped at $0.10; `LIVEPEER_CREATIVE_BUDGET_USD` may lower the application budget.

Generated URLs are stored only after a successful provider result. The image route accepts no URL from the caller, validates the stored HTTPS host against the MCP host or `LIVEPEER_IMAGE_HOSTS` (for example `v3b.fal.media`), follows at most three manually validated HTTPS redirects, rejects private IP destinations, caps the streamed response at 20 MiB, and requires an image content type. Redirects are never followed outside the explicit operator-owned host allowlist.

The provider adapter speaks MCP JSON-RPC (`initialize`, `notifications/initialized`, `tools/call`) over `fetch`; it does not invent a vendor REST endpoint. The adapter accepts both JSON and server-sent event MCP responses and forwards the negotiated protocol version on subsequent calls.
