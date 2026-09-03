# Batch Relay WebMCP storefront

An open-source photo print storefront that uses the published Batch Relay API
and exposes the same visible shopping flow to people and WebMCP browser agents.

The current release supports the public canonical print catalog and Batch Relay
Test Mode. Studio-owned templates require a scoped Test Mode API key. Production
customer payment is intentionally disabled because the public API does not yet
publish a generic shopper checkout operation.

## Local setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

Without studio credentials, the site still loads the unauthenticated canonical
catalog. Photographs come only from the visible tray.
Template discovery, local-file uploads, and template rendering return an
explicit configuration error rather than sample data.

To use the Batch Relay team's active templates, set a dedicated studio Test Mode
key plus that studio's ID and an event ID in `.env.local`. Use the Template
previews key purpose with `templates:read`, `template_previews:write`,
`template_renders:write`, and the explicit `studio_assets:write` upload grant.
The key does not need print-order authority; public sandbox quote, submission,
and status routes always use the visitor's anonymous session. The selected template
must publish an output compatible with `print-5x7` or `print-8x10`. The UI reads
the returned output and stable slot contract before it accepts image or text
values, then uses the returned render artifact in the cart.

The public render response currently contains fulfillment artifact IDs and pixel
dimensions, but no browser-readable artifact URL. The site therefore shows the
verified render result rather than claiming it can display an output PNG.

## Public API operations

The implementation calls these published operations through same-origin server
routes:

- `GET /v1/catalog/products`
- `GET /v1/catalog/products/{product_id}/offers`
- `POST /v1/anonymous-sessions`
- `POST /v1/assets/ingest`
- `POST /v1/print-orders/quote`
- `POST /v1/print-orders`
- `GET /v1/print-orders/{order_id}`
- `GET /v1/studios/{studio_id}/templates`
- `GET /v1/studios/{studio_id}/templates/{template_id}/outputs`
- `GET /v1/templates/{template_id}/outputs/{output_id}/contract`
- `POST /v1/templates/{template_id}/renders`
- `GET /v1/renders/{render_id}`
- `POST /v1/studio-assets/sessions`
- `PUT /v1/studio-assets/sessions/{session_id}/assets/{asset_id}`

The OpenAPI document at `https://api.batchrelay.com/openapi.json` remains the
source of truth.

See [`docs/api-boundary.md`](docs/api-boundary.md) for the credential and
checkout boundaries enforced by this project.

## Security model

Batch Relay credentials stay on the server. Anonymous sandbox session tokens
use an HTTP-only cookie. WebMCP tools stop at a visible sandbox review and never
charge a card, create a production order, or claim a payment URL exists.

A server-held Test key is still a delegated studio capability. A public demo
should use a dedicated, least-privilege `br_test_` key, upstream quotas and edge
rate limiting, and should rotate the key after the event. This project rejects
live `br_` keys, but it does not treat a public visitor as a studio member.

## License

MIT
