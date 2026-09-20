# Batch Relay Creative

Batch Relay Creative is a local-first sports event workbench at `/creative`.
It keeps the supplied athlete photo, logo, event text, and background as
independent layers, then uses one deterministic renderer for the visible
preview and PNG export:

- social card: 1080 × 1350 PNG
- digital banner: 1920 × 1080 PNG

Changing event text, switching layouts, applying a reviewed candidate, and
undoing or redoing edits are local composition operations. Switching formats
reuses the approved background and does not request another generated image.

## Manual layer editing

Select a layer on the proof or use the layer selector to reach overlapping
content. The selection outline belongs to the editor and is excluded from PNG
exports. Drag the selected layer to reposition it, or enter precise X/Y values
in its inspector. Image sizing keeps proportions locked; text controls adjust
font size and alignment. Event wording remains editable in the event fields.

Arrow keys nudge a layer while the proof has focus. Dragging creates one undo
step when released. Layout changes apply to the active format, so portrait and
banner placement can be tuned independently. These edits remain local and do
not call Livepeer.

## Athlete cutout layer

Use **Upload photo & estimate** to send a reduced processing copy of the
original athlete photograph to Livepeer. The original stays in the local
project. Review the quote, approve background removal, and review the
checkerboard cutout before applying it. Restoring the original or undoing the
layer change does not request another render. A cutout belongs to its source
photo; it cannot be applied to a different uploaded photograph.

Both original and processed image bytes are retained in IndexedDB for local
recovery. Background generation does not upload the athlete; only the explicit
background-removal action sends that copy externally. Event text and the logo
remain independent.

Generated effects and source-based refinement are described in
[the next-capabilities plan](effects-and-refinement-plan.md); they are not
implemented by the cutout feature.

## WebMCP contract

The `/creative` page mounts `CreativeWebMcpRegistrar` from
`src/webmcp/creative/CreativeWebMcpRegistrar.tsx`. Tool definitions are
module-scoped in `src/webmcp/creative/tools.ts`; the registrar is the only
module that calls `registerTools`. `src/webmcp/creative/bridge.ts` is the
browser-only boundary between those tools and the visible editor.

The editor subscribes to `subscribeToCreativeWebMcpActions`, performs the
same action used by the human controls, and answers with
`respondToCreativeWebMcpAction`. It publishes its current capabilities
with `publishCreativeWebMcpState` whenever the project revision, layout,
candidate list, job list, or history changes. The bridge intentionally carries
plain JSON-like values so it does not duplicate the composition model.

The nine tools are:

- `inspect_creative_project`
- `update_creative_event`
- `propose_creative_background`
- `check_creative_generation`
- `apply_creative_background`
- `switch_creative_layout`
- `export_creative_artwork`
- `undo_creative_change`
- `redo_creative_change`

`propose_creative_background` is a reversible handoff. It may create a
server-owned estimate or pending job reference, but it never confirms spend or
applies a result. The visible editor must show the quote and the human must
approve it. `check_creative_generation` polls a job after that approval, while
`apply_creative_background` only applies a candidate the person has reviewed.
The WebMCP call returns the handoff quickly; generation polling is a separate
call.

## Local setup

From the repository root:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000/creative`. The ordinary editor controls remain the
fallback when a browser does not expose WebMCP. Provider credentials and
participant access details belong in the server environment only. Do not add
them to `.env` files tracked by this repository or to a browser bundle.

For live generation, copy `.env.creative.example` to the ignored `.env.local`
and fill in your private Creative MCP endpoint, a strong access passcode, and
a random session secret. The registered-participant connection comes from the
organizer packet; it is deliberately not published here. For local development,
remove the example `LIVEPEER_JOURNAL_PATH=/data/creative/journal.json` line to
use the ignored `.creative-data` directory, or supply an absolute writable path.
Set `LIVEPEER_CREATIVE_BUDGET_USD=5` for the initial integration check. Restart
the dev server after changing environment variables, open the editor, and use
the passcode to unlock generation. Review the returned estimate before approving.

The app calls the MCP from its own server; an IDE connection alone does not
configure application runtime access. See [the provider integration](../livepeer-creative.md)
for the request flow and [deployment](deployment.md) for durable hosted storage.

Focused checks for the WebMCP surface are:

```bash
node --test tests/creative-webmcp.test.mjs
npm run typecheck
```

The repository checks remain the source of truth for release readiness:
`npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.

## Provenance and submission state

This creative work was added on top of baseline commit `84ce0052474c011dcf8533a325cb17b3dc106a4d`
(`84ce005`, the existing storefront). The baseline storefront remains
independent and its public API boundary is unchanged.

The plan targets Track 1, Livepeer Agent Builder. The [public event page](https://atumera.com/hackathon)
and [submission form](https://atumera.com/hackathon/submit) are the official
references used during planning. Current implementation evidence does not
establish eligibility: reuse rules, minimum new-work requirements, repository
visibility or licensing requirements, the detailed judging rubric, and any
additional prize-administration steps still need organizer confirmation. A
successful local build or installed MCP is not a submission receipt.

Keep the participant endpoint, access code, and submission receipt in the private
evidence record. Never put restricted connection details in public documentation
or browser recordings. Publish only the repository and demo links intended for judges.
