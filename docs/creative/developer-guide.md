# Creative developer guide

The editor and WebMCP surface share one state path. The editor is authoritative
for project persistence, composition, provider requests, candidate review,
history, and download. The WebMCP layer only translates agent requests into
the same visible actions.

## Mounting

Mount `CreativeWebMcpRegistrar` next to the creative editor in the `/creative`
page. Do not mount it in the root layout or the existing storefront page. The
registrar uses a client effect and unregisters on unmount, so navigation away
from `/creative` removes the creative tools.

## Editor adapter

On mount, subscribe to `subscribeToCreativeWebMcpActions`. Each request has a
stable action name and an input object validated by the tool schema. Run the
same command used by the corresponding human control, then respond with the
request ID:

```ts
const stop = subscribeToCreativeWebMcpActions(async (request) => {
  try {
    const result = await runCreativeAction(request.action, request.input);
    respondToCreativeWebMcpAction({ requestId: request.requestId, result });
  } catch (error) {
    respondToCreativeWebMcpAction({
      requestId: request.requestId,
      error: { code: "creative_error", message: String(error), retryable: false, commitStatus: "unknown" },
    });
  }
});
```

Publish a `CreativeWebMcpState` snapshot after every visible state change.
Include the project revision in responses and reject stale revisions rather
than applying an agent request to a project that the person has changed.

`propose_background` must stop at the quote or pending-job handoff. It should
not call a provider synchronously from the browser and should not treat a
missing provider configuration as a generated result. The approval control is
human-visible and server-authorized. `check_generation` is the only progress
path; `apply_background_candidate` must verify the candidate belongs to the
same project and revision before replacing the background layer.
