# Batch Relay WebMCP Storefront

An agent-native photo-print workbench. A shopper loads their own JPEG or PNG
photographs locally, selects a print, frames it, fills a studio template when
appropriate, and adds the finished configuration to a browser-local demo cart.

People and agents use the same visible workbench. Instead of asking an agent to
guess at buttons and pixels, the page exposes typed WebMCP tools for the
photograph tray, print drafts, framing, templates, proposal cards, and cart.

## What the demo proves

- **Natural photo references.** A shopper can say “image 3” after loading a
  folder; the agent receives the matching visible tray ordinal.
- **Real template contracts.** A template print exposes its published image and
  text slots. The agent can assign the team and individual photographs, edit
  printed text, and frame each slot without guessing its layout.
- **Human approval where it matters.** A print already on screen can be added
  directly. A background print becomes a preview card that the shopper must
  accept or reject.
- **Safe, inspectable local state.** The cart, proposals, and framing persist
  in the browser only. There is no checkout, charge, or fulfillment order. An
  optional Test Mode template-proof action can upload only the crop a shopper
  explicitly prepares.
- **Shared visible feedback.** Agent actions update the page before returning
  and briefly report what changed, with undo/redo for the recent workbench
  history.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), select JPEG or PNG files,
then choose a print. No account, payment method, or local image upload is
required for the direct-print path.

To reset the browser-local demo state while developing, open
`?reset=workbench` once, for example:

```text
http://localhost:3000/?reset=workbench
```

The reset clears this storefront's saved drafts, proposal cards, and cart. It
does not delete the original files or a browser-granted folder permission.

## WebMCP

The storefront registers these imperative tools:

- `ask_storefront` — inspect the visible tray, drafts, proposals, and cart.
- `find_prints` — search visible catalog formats without navigating away.
- `configure_print` — create or revise a print, template assignments, text, or
  framing.
- `revise_prints` — apply a framing change across named drafts.
- `propose_prints` — stage a batch of prints as shopper-reviewable cards.
- `add_to_cart` — add the visible draft or show a proposal for a background
  draft.
- `resolve_cart_proposal` — accept, reject, or change the quantity of a
  shopper-facing proposal.
- `manage_cart` — inspect, update, remove, or clear local cart lines.
- `undo_last_change` and `redo_last_change` — restore recent visible workbench
  changes.

The format chooser also exposes the declarative `search-print-formats` tool.
It remains an ordinary search form for a person; an agent invocation returns
the matching visible products through the browser's form-tool API.

For the smoothest judge/demo path, open the deployed app in ChatGPT's in-app
browser. Google Chrome can also be used with WebMCP enabled.

## Optional studio-template configuration

The direct-print demo works without server credentials. To demonstrate
studio-owned published templates, configure a dedicated, least-privilege
**Test Mode** key on the server only:

```bash
BATCH_RELAY_API_TOKEN=br_test_...
BATCH_RELAY_STUDIO_ID=stu_...
BATCH_RELAY_EVENT_ID=evt_...
```

Use a key limited to template preview/render work. Never place that key in a
`NEXT_PUBLIC_*` variable, in client code, or in this repository. The default
API origin is `https://api.batchrelay.com`; override
`BATCH_RELAY_API_BASE_URL` only when testing a compatible local API.

`NEXT_PUBLIC_WEBMCP_TRACKING_KEY` is optional telemetry. Tools work without
it.

## Deploy on Vercel

1. Push this repository to a public GitHub, GitLab, or Bitbucket repository.
2. Import it into Vercel as a Next.js project.
3. Add any optional studio-template variables above as **server-side** Vercel
   environment variables. Do not add a deployment password or login wall for
   the demo.
4. Attach the public custom domain, for example `webmcp.batchrelay.com`.
5. Open the deployed URL in ChatGPT's in-app browser and verify tool discovery,
   one direct print, one template print, a proposal acceptance, cart quantity,
   and undo/redo.

Before making the repository public, confirm that `.env.local` is ignored and
that no real API credential appears in the Git history.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run check:public-api
```

The last command fetches the public Batch Relay OpenAPI document and confirms
the operations this demo relies on. It needs network access.

## Demo materials

Use photographs, template artwork, names, logos, and music that you own or are
licensed to show. The app is intentionally useful with only a few images:
one portrait, one team/group photo, and one additional direct-print photo are
enough to demonstrate the core collaboration flow. Shoppers can always load
their own JPEG or PNG files locally.

## License

[MIT](LICENSE)
