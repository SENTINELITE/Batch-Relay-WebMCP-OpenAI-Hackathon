# Demo script — Batch Relay WebMCP storefront

Stage aid. Total runtime ~4 minutes: 30s pitch, ~3 min runbook, 20s close.

Before you start: dev server up on `http://localhost:3000`, agent connected to the
page, folder of demo photos ready on the desktop, cart empty, no proposal card open.

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
> in the loop:** `add_to_cart` proposes, it does not buy. A card appears and a
> person answers — and to accept by voice, the agent has to quote your words.
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

**Screen:** a *second* draft appears in the draft rail. The memory mate stays
intact and selected work is not lost.

**Fires:** `configure_print` with no `draftId` — a new draft, resolved to the
plain 8x10 product from the same sentence.

**Line for the room:** "It picked the product from context and kept the first
draft alive. Two configurations, one conversation."

---

### Beat 5 — Propose, don't purchase (~40s)

**Say:**
> "Add the memory mate to my cart."

**Screen:** a picture-in-picture card slides into the bottom-left corner with a
live preview and two buttons — **Add to cart** / **Don't add**. The step you were
already looking at stays put; nothing navigates.

**Fires:** `add_to_cart` — returns *immediately* with a pending proposal and a
`decided_by: "shopper"` instruction to stop and wait. Nothing entered the cart,
and the agent has no way to answer its own proposal.

**Say:**
> "Yes, buy it."

**Screen:** the card dismisses and the masthead **Local cart** chip ticks up with
a brief `+1` flash. Nothing opens over the step you were looking at — the count
is the receipt.

**Fires:** `resolve_cart_proposal` with `decision: "accept"` and
`shopperConfirmation: "Yes, buy it."` — the tool requires your words verbatim,
so the accept is traceable to something you actually said.

**Line for the room:** "Same action, two doors — the shopper can click the button
or say the word. The agent cannot skip the door: to accept, it has to quote you.
An agent that tries to confirm its own proposal is refused, and `add_to_cart`
refuses outright if a proposal is already waiting."

*(Optional, if time: repeat for the second draft and click **Add to cart** with the
mouse instead — same outcome, different door.)*

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
| "A cart proposal is already waiting" | A card is open behind something. Say **"Not this one"** (fires `resolve_cart_proposal` with `reject`) or click **Don't add**, then retry. |
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
