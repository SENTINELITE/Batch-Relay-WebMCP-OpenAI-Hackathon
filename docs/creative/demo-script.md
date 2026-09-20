# Creative demo script

Use a fictional event and public-domain or permissioned sample assets. Mark
any previously generated image as a cached sample. A live generation should
show the estimate before the person approves it.

1. Open `/creative` and show the editable event, athlete, logo, and background
   layers in the card layout.
2. Ask the agent to propose a background direction. Show the returned estimate
   and the pending approval card. Do not describe the estimate as a charge.
3. Approve the quote in the visible UI, then use
   `check_creative_generation` until the job is complete.
4. Review the candidate and apply it in the visible UI or through
   `apply_creative_background` only after the person has chosen it. Point out
   that the supplied athlete and logo pixels remain separate.
5. Change the event date with `update_creative_event`. Explain that this is a
   local deterministic edit and incurs no generation request.
6. Switch to the banner with `switch_creative_layout`, then export both exact
   PNG formats with `export_creative_artwork`.
7. Demonstrate `undo_creative_change` and `redo_creative_change`; mention that
   undo does not reverse an already incurred provider cost.

The browser agent should never be left waiting through a provider render.
Use the job check tool for progress and show failures honestly. A live demo
requires a configured server environment and a fresh estimate for each render.

## Cutout demonstration

Before generating a background, show the original photograph, choose Upload
photo & estimate, explain that a processing copy goes to Livepeer, then display
the returned cost. Approve the quoted removal. Review the real transparent
result, apply it, and show the generated scene through the removed background.
Restore the original, then reapply the existing cutout without another render.
Reload and verify both assets survive. Do not describe generated smoke or
source-based refinement as available until those separate phases ship.

## Manual finishing

Select the athlete on the proof and drag it into position. Show the precise
position and proportional size controls, then select the event title and adjust
its size and alignment. Undo the drag with one action. Switch formats to show
that each layout retains its own placement, and export a clean PNG with no
selection outline. These finishing edits use the existing assets without
another provider request.
