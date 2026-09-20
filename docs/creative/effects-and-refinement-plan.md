# Next creative capabilities: effects and source-based refinement

Prepared September 19, 2026 by Codex. Scope: plan only for these two capabilities. Athlete background removal is being implemented separately first.

## Outcome

A photographer creates an athlete cutout, chooses a generated scene, adds a separate smoke or light effect, then refines one chosen layer without regenerating the photograph, typography, or approved composition. Livepeer performs the substantive image work. The local renderer preserves exact event text and produces the coordinated card/banner.

## 1. Generated effects layer

### Prove the output contract first

Use the registered Livepeer integration to test one smoke asset before building a broad effects interface. The current Creative MCP create_media schema does not expose an explicit transparent-background parameter. Its capability registry lists gpt-image, whose upstream API supports transparency, but that does not prove parameter forwarding through the Creative MCP. Resolve this through a supported Livepeer workflow or organizer documentation; do not silently route directly to another provider.

Inspect actual decoded pixels: transparent pixels, intermediate alpha values, no baked checkerboard, and no solid surrounding rectangle. Preview the same effect on black, white, and a real scene. Ordinary background removal may erase faint smoke and is not assumed to preserve semi-transparency. Preserve the original returned file and record the requested/served model, estimate, available actual cost, and warnings.

If native alpha cannot be demonstrated within a 60–90 minute spike, use the bounded fallback: generate bright smoke/light against black, store that source honestly, and composite it with Screen blending. Label this a blend-mode effect rather than claiming the file has native transparency. It must work identically in preview and both exports. Producing a standalone transparent asset remains a separate acceptance gate.

### Small product scope

- Start with smoke and light streaks; one active effects asset, positioned in front of or behind the athlete.
- Controls: generate, review alternatives, apply, visibility, position, scale, opacity, and supported blend mode. Repositioning and opacity changes never call the provider.
- Keep event text and logos above effects. Default placement avoids the face and text; do not promise automatic subject-aware masking in this first version.
- Both layouts reference the same effect asset but retain their own transforms.
- Add an effects candidate strip with a checkerboard preview for alpha files and a real composition preview for Screen assets.

### Implementation

Extend the creative document with optional effect references/candidates, original alpha/blend metadata, placement order, and format-specific transforms. Retain backward compatibility with existing IndexedDB documents. Add one operation to the existing quote/job journal, rather than a separate unchecked generation route. Bind quotes to layer role, prompt, source if any, model, palette, revision, and render settings. Persist candidate bytes locally; keep the original approved layer until replacement is explicitly applied.

Use an operation-specific model/cost policy. The present $0.10 per-render ceiling may reject premium transparency models; select the model and review a real quote before changing that policy. Preserve the overall application cap and reservation protections.

### Acceptance

1. Generate and review a smoke effect through Livepeer with a pre-run estimate.
2. Apply it in front of and behind the athlete; change its opacity without another job.
3. Background, athlete identity, logo, and exact text remain unchanged.
4. Reload restores the source image, blend mode, order, transforms, and candidates.
5. Both exact-size PNG exports match the preview, including soft edges.
6. A failed or opaque result remains reviewable as an error and never silently replaces the approved effect.

Estimated implementation after a successful spike: one focused half-day. This is a planning estimate, not a delivery commitment.

## 2. Refine the selected image

### Product behavior

Offer two distinct actions: Generate a new direction and Refine this background. Refinement selects an existing approved background or effect and sends that source plus a targeted instruction to a Livepeer image-edit capability. Start with background refinement; effect refinement follows only after the effect representation is proven.

Example: Keep this arena and camera angle; warm the sideline lights and reduce the haze. Show the source and proposed result side by side. Apply replaces only the selected layer. Names, date, photograph, logo, and layout remain local and unchanged.

### Integration spike

The live registry lists kontext-edit and other image-edit models, but its capability card advertises edit/restyle while the Creative MCP create_media schema currently omits those action values. Validate the exact supported invocation through a nonexecuting proposal and current documentation before implementing execution. Prefer the organizer-supported Creative MCP path; fail clearly on a schema mismatch.

A browser Blob URL cannot be used as a provider source. Resolve a known stored provider asset on the server or explicitly upload the selected local asset through Livepeer. Never accept an arbitrary client-provided fetch URL. Tell the user when a local asset must be sent externally.

### Implementation

- Add a refine operation to the existing quote/job flow, with source asset ID and content digest included in the binding.
- Retain parent candidate ID, instruction, model, job ID, and source/result references as lightweight lineage.
- Reject stale sources or project revisions before execution. Retries reuse the same execution key.
- Preserve the old layer while processing. Save the new result as a candidate, not an automatic replacement.
- Resume pending work after reload. An uncertain provider result keeps its budget reservation and does not trigger a fresh job.
- Add a WebMCP proposal tool only after ordinary UI works. The tool can propose and inspect; paid execution remains a visible approval action.

### Acceptance

1. Refinement demonstrably includes the chosen source image in the provider request.
2. A requested lighting change retains enough scene structure to be useful; a text-only reroll does not count.
3. Side-by-side review, apply, undo, and reload preserve lineage and all unrelated layers.
4. Source changes invalidate an outstanding estimate; repeated execution does not duplicate a charge.
5. Failure leaves the existing composition and exports usable.

Estimated implementation after invocation is verified: one focused half-day.

## Suggested sequence and stopping rule

1. Finish and verify athlete cutout, including real alpha, original restoration, and cost approval.
2. Run the bounded effects transparency spike.
3. Implement the single-effects-layer experience using the proven representation.
4. Implement source-based background refinement.
5. Record one coherent demonstration: cutout → scene → effect → targeted refinement → date correction → two exports.

Stop adding media types after this path works. Video, arbitrary layer authoring, multiple simultaneous effects, automatic retouching, and a general-purpose design agent remain outside this entry.

## Sources and proof limits

- Official event direction: https://atumera.com/hackathon
- Underlying transparency model schema: https://fal.ai/models/fal-ai/gpt-image-1/text-to-image/api
- Underlying background-removal schema: https://fal.ai/models/fal-ai/birefnet/api
- Livepeer capability discovery and describe_capability responses inspected September 19, 2026. Registry availability does not prove a successful render or parameter forwarding.

All future generation remains routed through Livepeer. Hosting, registered participant attribution, organizer clarification, and the submission receipt remain separate release gates.
