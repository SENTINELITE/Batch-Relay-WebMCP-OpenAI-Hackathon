# Demo script — Batch Relay WebMCP storefront

Stage aid. Total runtime ~7 minutes: 30s pitch, ~6 min runbook, 20s close. Beat 6
is the money sequence — cut Beat 3 or Beat 8 before you cut any of it.

Before you start: dev server up on `http://localhost:3000`, agent connected to the
page, folder of demo photos ready on the desktop, cart empty, no proposal cards stacked in the corner.

Also worth knowing before you present: a short toast appears at the bottom of the
screen for **agent** actions only — never for anything you do with your own hands,
and never for the read-only tools. If you click something and no toast appears,
that is correct.

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
> That scales. Ask for a print of each of six photos and you get six cards in one
> call, each carrying a **geometry** verdict — effective PPI, crop depth, trim
> proximity, aspect — so the one worth a second look is the one wearing the
> warning. Fix that one with your mouse, say *"frame the others like this,"* and
> the agent reads your framing off the page and applies it to the rest. Then
> *"accept the ready ones"* takes the five and leaves the flagged one standing.
>
> And because the agent is working *your* screen, you get told what it did — a
> one-line note for every change it makes, with an undo on it.
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
> "Print name Marcus Betcher, jersey 12, team Spartans, year 2026."

**Screen:** all four printed lines fill in on the artwork at once, and the toast
reads *"Agent filled 4 text lines on the Memory Mate."*

**Fires:** one `configure_print` carrying four `set_text` patches
(`{ label: "print name" | "jersey" | "team" | "year", operation: "set_text", text }`).
The text slots publish their own aliases beside their labels, so the words the
shopper says reach them. Note what `team` does here: the same word names the
landscape *photograph* slot, and the operation is what decides which is meant —
`set_text` can only ever reach the printed team line, `assign` only the photo.
The response echoes every text slot's resulting value, so the agent confirms the
write without asking a second time.

**Shorter variant if you are tight on time:** *"Put SPARTANS 2026 on the team
line"* — one patch, matched case-insensitively against the published `Team`
label, aimed at whatever draft is on screen without naming a draft ID.

**Then say:**
> "Make it landscape."

**Screen:** the preview flips orientation, crops re-fit.

**Fires:** `configure_print` with `orientation: "landscape"`.

**Then say:**
> "Zoom in on her face in the individual, quite a lot."

**Screen:** the individual slot tightens onto the head — not the middle of the
photo, the *head*.

**Fires:** `configure_print` with one `slotPatch`
`{ label: "individual", operation: "set_crop", zoom: 3, focusOn: "faces" }`. The
agent names the magnification; the app owns where to point it, because the app
is the only side holding the face boxes. The response comes back with
`focus_applied: "faces"`, `faces_detected: 1` and the `subject_region` it used.

**Line for the room:** "It did not guess a focus point and it is not allowed to
claim one. `focusOn: faces` is an *intention* — the page turns it into
coordinates, and the response says which of `faces`, `no_faces_detected` or
`faces_not_ready` actually happened. If there is no face in the picture, the
crop stays put and the agent has to say so."

*(If the portrait you demo on has no detectable face, that is still the beat —
let it come back `no_faces_detected` and read the honest narration out loud. It
lands harder than the success case.)*

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

*(Leave that card's sibling behaviour for Beat 6, which stacks a whole deck at
once. If you are cutting Beat 6 for time, do the short version here instead: "add
image 4 and image 9 as 5 by 7s." Two cards stack, newest nearest the corner.
Answer them together — **"Add them all"** — and `resolve_cart_proposal` fires
once with `decision: "accept_all"` and your words in `shopperConfirmation`. Or
click **Add to cart** on just one with the mouse — same outcome, different door.)*

---

### Beat 6 — The batch, the exception, taking it back, and "do the rest like that" (~110s)

*The money sequence. If you cut anything, do not cut this.*

**Say:**
> "Make a 5 by 7 of each of photos 10 through 15."

**Screen:** the memory mate still does not move. Six cards deal into the
bottom-left corner as one deck — top card full size, two peeking behind it, a
`+3 more` badge on top. Every card carries its own live preview, a **Qty**, and
a status chip: most read **✓ Ready**, and one reads **⚠ Needs review** with a
line of plain English under it — *"At this crop the photo prints at about 210
PPI, below the 300 PPI this size expects — it may look soft."*

**Fires:** one `propose_prints` call — `productQuery: "5 by 7"`,
`photoRefs: [10,11,12,13,14,15]`, `trayRevision: <current>`. It returns an
ordered per-item result: each `photo_ref` with its `draft_id`, `proposal_id`,
`status`, and a `review` verdict, plus a `review_summary` of
`{ proposed: 6, ready: 5, needs_review: 1 }`. Every item reports
`placed: "draft_rail"`.

**Line for the room:** "Six prints, one call, and not one of them took my screen.
The batch is background by definition — the cards *are* the review."

**Then say:**
> "Anything wrong with those?"

**Screen:** nothing changes. The agent reads the verdicts it already has.

**Say to the room while it answers:** "It is not guessing and it is not looking
at pixels. That is geometry: the photo's pixels against the printed inches at
the crop I asked for — arithmetic I can argue with. The face model from Beat 3
only ever *aims* a crop; it never gets a vote on whether a print is good."

**Do:** click the flagged card's print in the rail, then **drag the framing with
the mouse** until it looks right — pull the zoom back, recentre the subject. The
chip on that card flips to **✓ Ready** as you release.

**Say:**
> "Frame the others like this."

**Screen:** every other 5x7 card in the deck repaints — same zoom, same focus —
*before* the agent finishes speaking. The deck re-chips itself.

**Fires:** `ask_storefront` to read the framing you just committed (every draft
publishes its crop in `set_crop` vocabulary, not just the selected one), then one
`revise_prints` call — `draftIds: [...]`, `crop: { zoom, focusX, focusY }`. It
returns per-draft `applied` / `skipped` results and repaints every affected
preview and proposal card before it resolves.

**Line for the room:** "I framed *one* print with my hands. The agent read that
framing off the page in the same vocabulary it writes crops in, and applied it to
five others. That round trip — my hands to its tools and back — is the whole
thesis of this thing."

**Then say:**
> "Actually — undo that."

**Screen:** every card in the deck snaps back to the framing it had a moment ago,
visibly, all at once. The toast says what went back: *"Undid: revise_prints
framing across 5 drafts."*

**Fires:** `undo_last_change` with no arguments. It returns `undone:
"revise_prints framing across 5 drafts"` — the description the agent narrates —
plus how many steps are left.

**Line for the room:** "That is the part people actually worry about. An agent
that can change five things at once needs to be an agent you can take five things
back from. The workbench snapshots itself before every change the agent makes,
and the undo comes back through the exact same restore path a page reload uses —
so the cards come back as cards, still waiting, not as debris. The toast on every
one of those changes carries the same button; you never have to know the tool
exists."

**Then say:**
> "No, you were right — do it again."

**Screen:** the deck repaints back to the shared framing. `revise_prints` fires a
second time, and the cards re-chip to ✓ Ready.

**Do:** point at one standing card and say:
> "Make that one two copies."

**Screen:** that card's **Qty** badge ticks from 1 to 2 in place. The card does
not move, does not fly away, and is still waiting for an answer. Nothing has
entered the cart.

**Fires:** `resolve_cart_proposal` with `decision: "update_quantity"`,
`proposalId: <that card>`, `quantity: 2` — and deliberately **no**
`shopperConfirmation`, because changing what a card is asking for is not
answering it.

**Line for the room:** "Every other decision on that tool has to quote me. This
one does not, and that is the point: it did not accept anything. It changed the
question. When I do accept it, two go in the cart, not one."

**Say:**
> "Accept the ready ones."

**Screen:** the ready cards affirm and fly toward the cart chip one after
another; the chip ticks up. Any card still flagged **stays standing** in the
corner.

**Fires:** `resolve_cart_proposal` with `decision: "accept_ready"` and your words
verbatim in `shopperConfirmation`. It accepts every pending proposal whose
verdict is `ready` and deliberately leaves each `needs_review` card waiting.

**Line for the room:** "'The ready ones' is a real instruction, not a rounding of
'all of them.' The flagged card is exactly the one I said I wanted to look at, so
it is the one thing the agent is not allowed to answer for me."

---

### Beat 7 — Cart and demo checkout (~20s)

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

### Beat 8 — Discovery, if you have room (~15s)

**Say:**
> "What other sizes do you print?"

**Screen:** nothing moves. The shopper stays exactly where they were — if they
are mid-crop on the workbench, they keep the workbench. Only the status banner
reports what the catalog returned.

**Fires:** `find_prints` — read-only, returns published product facts and template
requirements from the live catalog. It never changes the visible step, so the
agent can look up sizes while the shopper keeps working by hand.

---

## 3. If it breaks

| Symptom | What to say / do |
| --- | --- |
| "The photo tray changed (visible revision N)" | You touched the tray mid-call. Say **"Check the tray again, then retry."** The agent re-runs `ask_storefront` and repeats `configure_print` with the fresh `trayRevision`. This is the guardrail working — call it out. |
| The workbench moved when you expected it to stay | The draft only counts as *yours* once you have clicked it in the rail or edited it by hand. If the agent placed it and you only spoke, a new draft still takes the screen. Click the print you want to keep, then ask again — `configure_print` reports `placed: "draft_rail"` when it stays out of your way. |
| A card appeared for the print you *were* looking at | The draft only counts as yours once you have selected it or it has held the screen for a few seconds. Click it in the draft rail and ask again — your own click makes it yours immediately. Answering the card is never wrong, just one extra beat. |
| Cards piling up in the corner | Expected — proposals stack, and each one waits on you. Clear them in one go with **"Add them all"** or **"None of those"** (`resolve_cart_proposal` with `accept_all` / `reject_all`), take only the unflagged ones with **"Accept the ready ones"** (`accept_ready`), or answer one at a time. Past three, the rest are a `+N more` badge on the top card. |
| Every card in the batch reads ⚠ Needs review | Usually one cause hitting all of them — small source files against a large print, or an orientation that fights the slot. Ask **"Why is that flagged?"**; each card's finding names the reason in words. It is never a block: **"Add them all"** still works. |
| `accept_ready` errors with "no pending proposal comes back ready" | Every waiting card is flagged, so there is no subset to take. Read the findings out and answer the cards individually, or fix the framing first and ask again. |
| "Frame the others like this" reframed nothing | The named drafts were multi-slot templates with no slot named, so `revise_prints` skipped them rather than guessing which image to move. Say which — **"do the same to the individual photo on each"** — and it resolves by role. Each skipped result already says this. |
| The batch stole the screen | It should not — `propose_prints` never selects a draft. If the workbench moved, you had no draft of your own in front of you, which is the agent-driven case. Click a print in the rail to make it yours, then ask again. |
| "Tool requires: draftId" | Should no longer happen: every ID input takes both spellings, so an agent copying `draft_id` or `proposal_id` straight out of a response is accepted. If you see it, the agent invented a field name — ask it to re-read `ask_storefront`. |
| "The visible storefront is not ready to…" | The tool is there; the page is not ready yet — usually an empty tray or an incomplete draft. Drop photos in, or ask **"What's still missing on this draft?"** (`ask_storefront`) and fill the named slot. |
| Product query resolves to nothing | Two live products matched, or zero. Say the exact size: **"the 8 by 10 print"** or **"the memory mate."** Or run `find_prints` first: "What can you print?" |
| Photo reference ambiguous | Duplicate filenames fail closed by design. Use the ordinal: **"image 5,"** not the filename. |
| Agent drifts or hallucinates state | Say **"Ask the storefront what's on screen."** One `ask_storefront` call re-grounds it. |
| "Undo that" says there is nothing to undo | The history only holds changes made since the page was opened, and only the agent's own — it is not restored by a reload. If you have just reloaded, there is genuinely nothing to walk back; carry on. |
| The undo went back further than you meant | There is no redo. Ask for the change again in the same words you used the first time — every one of these actions is a tool call, so repeating it is cheap and lands identically. |
| An undo left a slot empty | The snapshot names photographs, never copies them, so a picture that has left the tray comes back unlinked. The response says how many, and the slot says what it needs. Drop the photo back in and assign it. |
| Everything is stuck | Reload the page. **Your work survives it.** Drafts, slot assignments, framing, the demo cart and any waiting cards are saved to this browser and come back re-linked once the remembered folder finishes re-importing — about a second. Keep talking through it. |
| After a reload it says *"…N photographs could not be re-linked"* | Those pictures came in through the file picker rather than the remembered folder, so the browser cannot find them again. The drafts survived; the affected slots are simply empty and say what they need. Re-choose the folder and the drafts re-link themselves, or drop the missing photo back in and assign it. |
| Everything is stuck **and the reload did not help** | Add `?reset=workbench` to the URL. It wipes the saved workbench for this browser and starts you on an empty storefront — the tray, the remembered folder permission and the API are untouched. Resume from Beat 2. |

---

## 4. Closing — the architecture (20 seconds)

- **Tools never fetch.** Every tool body is a request into the visible page. No
  tool holds a credential, hits the Batch Relay API, or renders fulfillment
  artwork on its own. Server routes own that boundary.
- **A CustomEvent bridge is the only wire.** Tools dispatch an action event and
  await a result event; the storefront component that the human is looking at is
  the thing that answers. Agent and human drive one identical state machine.
- **Review is geometry, and it is honest about it.** `print-review.ts` is a pure
  module with no model, no network call and no face detection: effective PPI from
  the photo's pixels over the slot's printed inches at the current zoom, a crop
  depth past 2.5x, a focus point inside the template's own important-content
  inset, an aspect more than 2x from the slot's. A `needs_review` verdict is a
  reason to look, never a refusal — both buttons stay live on every card.
- **One stable tool surface, readiness enforced in the handler.** All nine tools
  register once and stay registered, so the agent can plan a whole turn against
  a tool list that never shifts underneath it. Calling one before the page is
  ready does not fail silently or vanish — the visible workbench answers with a
  grounded error that names what is missing ("no photographs in the tray,"
  "slot `portrait` is unfilled"). The agent gets a next action instead of an
  absent affordance, and `ask_storefront` re-grounds it at any point.
