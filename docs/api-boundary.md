# Batch Relay API boundary

This storefront treats the hosted OpenAPI document as its contract. The site
does not import Batch Relay's private Web, Convex, renderer, billing, or provider
code.

## Anonymous access

The browser can discover the canonical catalog through same-origin read routes.
The server can create an anonymous Batch Relay Test Mode session and retain the
one-time token in an HTTP-only cookie. Anonymous sessions support managed image
ingest, sandbox quotes, sandbox order submission, order status, and usage within
the limits published by Batch Relay.

Anonymous sessions cannot discover studio templates, render templates, read a
studio retail catalog, or create guest checkout links.

## Studio Test Mode access

Template and studio-asset operations require a studio-owned `br_test_` key. The
key stays in `BATCH_RELAY_API_TOKEN` on the server. This repository rejects live
`br_` keys because the direct production order API can charge its API account's
saved payment method.

The configured Test key, studio, and event must belong to the same Batch Relay
studio. The site never accepts a studio ID or credential from a WebMCP tool.

The dedicated key needs only `templates:read`, `template_previews:write`,
`template_renders:write`, and—because browser-local files must become durable
managed assets—`studio_assets:write`. The same-origin print-order routes are
hard-wired to the visitor's anonymous sandbox session and never fall back to
the studio key.

The team's active production-authored templates can be read with a scoped Test
Mode API account for that same studio. A public server route using that key is a
delegated capability, not visitor authentication. Deploy it only with a
dedicated least-privilege key, upstream quotas, edge rate limiting, and a planned
post-hackathon rotation. Never place the primary studio key or any live key in
this demo.

## Checkout status

As of the contract verified by `npm run check:public-api`, Batch Relay does not
publish a generic shopper checkout-intent operation. The existing checkout-link
management operation requires an event, guardian, athlete event entry, and one
studio sellable. It is not used by this project.

The WebMCP order tool therefore stops at a sandbox review. It cannot charge,
create a production order, or return a payment URL. When Batch Relay publishes a
shopper checkout contract, add it to the hosted-contract checker before adding
any live checkout UI or tool.
