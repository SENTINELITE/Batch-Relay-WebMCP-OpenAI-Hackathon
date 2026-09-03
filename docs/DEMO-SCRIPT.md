# Demo script — Batch Relay WebMCP storefront

Stage aid. Total runtime ~4.5 minutes: 30s pitch, ~3.5 min runbook, 20s close.

Before you start: dev server up on `http://localhost:3000`, agent connected to the
page, folder of demo photos ready on the desktop, cart empty, no proposal cards stacked in the corner.

---

## 1. Elevator pitch (30 seconds)

> Agents shop badly today because they shop by screen-scraping — guess the DOM,
> click, hope. This storefront hands the agent real tools instead.
>
> Four things change. **Typed tools:** `configure_print` takes a product, a
> template output, slot patches, crop values — the agent fills a schema, it does
> not aim a cursor. **Grounded state:** `ask_storefront` returns what is actually
> on screen, so the agent never narrates a cart that does not exist. **Grounded
> errors:** every tool is always on the table, and when the page is not ready it
> says exactly what is missing — no guessing, no vanishing affordances. **Human
> in the loop, where it earns its keep:** `add_to_cart` adds the print you are
> already looking at, and *proposes* the one you are not — a card with a live
> preview, answered by a person. To accept that by voice, the agent has to quote
> your words back. And it never takes the screen off you: ask for a second print
> while you are customizing one by hand and that print gets built in the
> background, with the card as its whole first appearance.
>
> Same page, same pixels, for a human or an agent.

---

## 2. Runbook

### Beat 1 — Load the tray (~20s)

**Do:** drag the photo folder onto the photo tray.

**Screen:** thumbnails fill the tray, each numbered 1..N. Tray revision increments.

**Say to the agent:**
> "What am I looking at?"

**Fires:** `ask_storefront` — read-only, returns photo count, ordinals, empty
draft list, empty cart, and the next available action.

**Line for the room:** "That is not a screenshot description. That is the app's own
state, typed, straight out of the page."

---

### Beat 2 — First print by ordinal (~30s)

**Say:**
> "Put image 5 on an 8 by 10 print."

**Screen:** format chooser resolves to the 8x10 product, a draft appears in the
draft rail, live template preview renders photo 5.

**Fires:** `configure_print` with `productQuery: "8 by 10 print"`,
`photoRefs: [5]`, `trayRevision: <current>`.

**Note for the room:** `naturalProductMatches` parses "8 by 10" into a real
dimension filter and only resolves when exactly one live product matches. No
invented SKUs. `photoRefs` accepts ordinals, ordinal words ("the fifth"), and
filenames — duplicate filenames fail closed rather than guessing.

---

### Beat 3 — Multi-slot template (~40s)

**Say:**
> "Make a memory mate, use image 3 on slot nine and image 4 on slot two."

**Screen:** product switches to Memory Mate 8x10, the slot grid appears, slots 9
and 2 fill in.

**Fires:** `configure_print` with `productQuery: "memory mate"` and two
`slotPatches`, each `{ label, operation: "assign", photoRef }`.

**Then say:**
> "Swap the team image for image 16."

**Screen:** the team slot re-renders with photo 16.

**Fires:** `configure_print` with one `slotPatch` matched by `label: "team"` —
the agent addresses slots by their published contract labels, not grid position
math.

**Then say:**
> "Make it landscape."

**Screen:** the preview flips orientation, crops re-fit.

**Fires:** `configure_print` with `orientation: "landscape"`.

**Line for the room:** "Every one of those was one tool call against the published
template contract. The tool returns what is still missing — it never pretends a
draft is finished."

---

### Beat 4 — Stacked drafts (~25s)

**Say:**
> "Also add image 3 as a standalone 8x10."

**Screen:** a *second* draft appears in the draft rail, and the workbench does
swing to it — everything so far has been agent-driven, and you have not put a
hand on the memory mate yet, so following along is the point. The memory mate
keeps every slot you assigned and is one click away in the rail.

**Fires:** `configure_print` with no `draftId` — a new draft, resolved to the
plain 8x10 product from the same sentence. Returns `placed: "on_screen"`,
`visible: true`.

**Line for the room:** "It picked the product from context and kept the first
draft whole. Two configurations, one conversation — and the tool told the agent
which one you are actually looking at, so it can say so."

---

### Beat 5 — The print you can see, and the one you can't (~50s)

**Do:** click the memory mate in the draft rail, so its preview fills the step
again — then nudge one slot's framing with the mouse. That click and that drag
are the whole difference in this beat: from here the memory mate is *yours*, not
something the agent parked on screen.

**Say:**
> "Add the memory mate to my cart."

**Screen:** no card. The masthead **Local cart** chip ticks up with a brief `+1`
flash and the step you were looking at stays exactly where it was.

**Fires:** `add_to_cart` — returns `status: "added"`,
`decided_by: "shopper_visible_context"`.

**Line for the room:** "You were looking at it when you asked. The preview *was*
the confirmation — a card asking 'is this the print?' would only have shown you
the same picture a second time."

**Then say:**
> "Also add image 13 as a 5 by 7."

**Screen:** **the memory mate does not move.** It stays exactly where it is, with
your framing untouched. The 5x7 appears in the draft rail, and a
picture-in-picture card slides into the bottom-left corner carrying a live
preview *of the 5x7* and two buttons — **Add to cart** / **Don't add**. Nothing
has entered the cart.

**Fires:** `configure_print` for a draft the shopper never asked to look at,
which returns `placed: "draft_rail"`, `visible: false` — you are hand-customizing
another print, so this one is built behind you rather than taking your screen.
Then `add_to_cart`, which returns *immediately* with
`status: "awaiting_shopper_confirmation"`, `decided_by: "shopper"`, a
`proposal_id`, the resulting `pending_proposal_count`, and an instruction to stop
and wait.

**Say:**
> "Yes, buy it."

**Screen:** the card affirms for a beat, slides away toward the cart chip, and
the chip ticks up again. Nothing opens over the step you were on — the count is
the receipt.

**Fires:** `resolve_cart_proposal` with `decision: "accept"` and
`shopperConfirmation: "Yes, buy it."` — the tool requires your words verbatim,
so the accept is traceable to something you actually said.

**Line for the room:** "Watch what did *not* happen. I was working on the memory
mate, and asking for a 5x7 did not rip me out of it — the agent built that print
behind me and the card is the entire experience for it. That card is the first
look I ever get at the 5x7, which is exactly why answering it is worth something.
Two adds, two behaviours, one rule: you get asked about the print you have not
seen, and you never get moved off the one you have. And the agent cannot skip the
door: to accept by voice it has to quote you. One that tries to confirm its own
proposal is refused. What it *can* do is keep asking: propose a second print and
a second card stacks above the first, each waiting on me separately."

*(Optional, if time: ask for two more off-screen prints in one breath — "add
image 4 and image 9 as 5 by 7s." Two cards stack in the corner, newest nearest
the corner, older ones collapsing to a compact row once the column gets deep.
Answer them together — **"Add them all"** — and `resolve_cart_proposal` fires
once with `decision: "accept_all"` and your words in `shopperConfirmation`; each
card affirms and flies toward the cart chip while the rest settle. Or click
**Add to cart** on just one with the mouse — same outcome, different door.)*

---

### Beat 6 — Cart and demo checkout (~20s)

**Say:**
> "What's in my cart?"

**Fires:** `manage_cart` with `action: "view"`.

**Do:** click the masthead **Local cart** chip. A sheet slides in from the right
over the current step with the item list and thumbnails — no navigation, no
scroll jump. Then click the clearly-labeled **Demo checkout** and confirm.

**Screen:** cart clears and the sheet shows "Demo checkout complete." No order,
no charge, no card. Close the sheet (button, Escape, or click outside) and you
are exactly where you were.

**Line for the room:** "Labeled demo the whole way down. The tools stop at a
local demo cart — they never create a production order or claim a payment
URL that does not exist."

---

### Beat 7 — Discovery, if you have room (~15s)

**Say:**
> "What other sizes do you print?"

**Screen:** format chooser opens.

**Fires:** `find_prints` — read-only, returns published product facts and template
requirements from the live catalog.

---

## 3. If it breaks

| Symptom | What to say / do |
| --- | --- |
| "The photo tray changed (visible revision N)" | You touched the tray mid-call. Say **"Check the tray again, then retry."** The agent re-runs `ask_storefront` and repeats `configure_print` with the fresh `trayRevision`. This is the guardrail working — call it out. |
| The workbench moved when you expected it to stay | The draft only counts as *yours* once you have clicked it in the rail or edited it by hand. If the agent placed it and you only spoke, a new draft still takes the screen. Click the print you want to keep, then ask again — `configure_print` reports `placed: "draft_rail"` when it stays out of your way. |
| A card appeared for the print you *were* looking at | The draft only counts as yours once you have selected it or it has held the screen for a few seconds. Click it in the draft rail and ask again — your own click makes it yours immediately. Answering the card is never wrong, just one extra beat. |
| Cards piling up in the corner | Expected — proposals stack, and each one waits on you. Clear them in one go with **"Add them all"** or **"None of those"** (`resolve_cart_proposal` with `accept_all` / `reject_all`), or answer one at a time. Older cards collapse to a compact row; click one to open it back up. |
| "Tool requires: draftId" | Should no longer happen: every ID input takes both spellings, so an agent copying `draft_id` or `proposal_id` straight out of a response is accepted. If you see it, the agent invented a field name — ask it to re-read `ask_storefront`. |
| "The visible storefront is not ready to…" | The tool is there; the page is not ready yet — usually an empty tray or an incomplete draft. Drop photos in, or ask **"What's still missing on this draft?"** (`ask_storefront`) and fill the named slot. |
| Product query resolves to nothing | Two live products matched, or zero. Say the exact size: **"the 8 by 10 print"** or **"the memory mate."** Or run `find_prints` first: "What can you print?" |
| Photo reference ambiguous | Duplicate filenames fail closed by design. Use the ordinal: **"image 5,"** not the filename. |
| Agent drifts or hallucinates state | Say **"Ask the storefront what's on screen."** One `ask_storefront` call re-grounds it. |
| Everything is stuck | Reload the page. Photos and drafts are browser-local; re-drop the folder and resume from Beat 2. |

---

## 4. Closing — the architecture (20 seconds)

- **Tools never fetch.** Every tool body is a request into the visible page. No
  tool holds a credential, hits the Batch Relay API, or renders fulfillment
  artwork on its own. Server routes own that boundary.
- **A CustomEvent bridge is the only wire.** Tools dispatch an action event and
  await a result event; the storefront component that the human is looking at is
  the thing that answers. Agent and human drive one identical state machine.
- **One stable tool surface, readiness enforced in the handler.** All six tools
  register once and stay registered, so the agent can plan a whole turn against
  a tool list that never shifts underneath it. Calling one before the page is
  ready does not fail silently or vanish — the visible workbench answers with a
  grounded error that names what is missing ("no photographs in the tray,"
  "slot `portrait` is unfilled"). The agent gets a next action instead of an
  absent affordance, and `ask_storefront` re-grounds it at any point.
