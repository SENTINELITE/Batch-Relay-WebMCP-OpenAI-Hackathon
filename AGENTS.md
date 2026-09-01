# Batch Relay WebMCP storefront

This repository is public. Keep it independent from Batch Relay's private Web,
Convex, renderer, provider, and billing source repositories.

## API boundary

- Use only operations published by `https://api.batchrelay.com/openapi.json`.
- Browser tools call the site's same-origin routes or client state. They never
  receive a Batch Relay API key.
- Server routes may read `BATCH_RELAY_API_TOKEN`; never return or log it.
- Do not add a payment or production-order claim until the public API exposes a
  shopper checkout contract and that contract passes a live canary.
- Unknown API response fields may be ignored, but never invent response fields
  or silently replace a failed API call with sample commerce data.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
Runtime verification against production is read-only unless the user explicitly
authorizes a sandbox order or live action.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
