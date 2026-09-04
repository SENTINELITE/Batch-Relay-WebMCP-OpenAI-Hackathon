import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toolDefinition(source, exportName) {
  const match = source.match(new RegExp(
    String.raw`export const ${exportName}\s*=\s*defineTool[\s\S]*?^\}\);`,
    "m",
  ));
  assert.ok(match, `expected ${exportName} to be declared as a WebMCP tool`);
  return match[0];
}

function objectAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing ${marker}`);
  const start = source.indexOf("{", markerIndex + marker.length);
  assert.notEqual(start, -1, `missing object after ${marker}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated object after ${marker}`);
}

function shallowKeys(objectSource) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < objectSource.length; index += 1) {
    const character = objectSource[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      continue;
    }
    if (depth !== 1 || !/[A-Za-z_$]/.test(character)) continue;

    const match = objectSource.slice(index).match(/^([A-Za-z_$][\w$]*)\s*:/);
    if (!match) continue;
    keys.push(match[1]);
    index += match[0].length - 1;
  }
  return keys;
}

function inputSchema(definition) {
  return objectAfter(definition, "inputSchema:");
}

function propertyKeys(definition) {
  return shallowKeys(objectAfter(inputSchema(definition), "properties:"));
}

const approvedTools = [
  {
    exportName: "askStorefront",
    stableKey: "storefront.ask",
    name: "ask_storefront",
    description: "Inspect visible storefront state, or request a bounded compatibility summary for one template and product, without changing the workbench.",
    fields: ["question", "templateId", "templateQuery", "productId", "productQuery", "orientation", "maxTemplateResults"],
  },
  {
    exportName: "findPrints",
    stableKey: "storefront.find_prints",
    name: "find_prints",
    description: "Use when a shopper wants to browse, compare, or identify canonical print products before creating a draft. Returns published product facts and template requirements from the live catalog without inventing products or compatibility, and without changing what the shopper is looking at: it never moves them to another step, so it is safe to call while they are working by hand on a print.",
    fields: ["query", "productType", "maxResults"],
  },
  {
    exportName: "configurePrint",
    stableKey: "storefront.prepare_print_images",
    name: "configure_print",
    description: "Use when a shopper wants to create or revise one visible print draft from photographs already in the tray. Selects a real product, applies the remembered or first compatible active template, exposes exact published image and text slots, patches image assignments, per-slot text (set_text) and non-destructive crops, and returns missing requirements. When a required slot is still missing, the response names it in words: ask the shopper which photograph should fill it rather than choosing for them. A slot patch label may also be a published label in any case, or one of the aliases published beside each image slot, such as team or individual, and beside each text slot, such as jersey or year; the operation decides which kind is meant, so set_text with team writes the printed team line while assign with team fills the team photograph. An empty image slot may start from the photograph the shopper already chose for that role on another print; every such default is reported as prefilled_from and is replaced by an explicit assignment. The response reports each slot's resulting crop in this same patch vocabulary, so a relative crop change can be computed from it. A set_crop patch or directCrop may carry focusOn faces with either zoom or subjectWidthPercent, such as 50 to make the detected subject fill half the crop width; do not send both. Every response reports faces_detected, subject_region, the requested and achieved subject width, and a focus_applied of faces, no_faces_detected, faces_not_ready, detection_unavailable or explicit, so never tell the shopper a crop is centered on a face unless focus_applied came back faces. It never takes the screen away from a shopper who is customizing a print by hand: a new draft made while they are working on another one waits in the draft rail instead, and the response says which happened with placed on_screen or draft_rail and a matching visible flag. Narrate that honestly — when a draft was placed in the draft rail, do not tell the shopper they are looking at it; adding it will show them a proposal card carrying its own live preview. It never reorders or deletes tray files, adds anything to the demo cart, or places an order.",
    fields: ["draftId", "draft_id", "trayRevision", "photoRefs", "productId", "productQuery", "templateId", "templateQuery", "outputId", "orientation", "slotPatches", "directCrop"],
  },
  {
    exportName: "addToCart",
    stableKey: "storefront.add_to_cart",
    name: "add_to_cart",
    description: "Use when a shopper wants a complete visible print draft added to this browser's demo cart. Takes the draft_id returned by configure_print or listed by ask_storefront — either draftId or draft_id is accepted, so the ID can be copied straight out of the response it came from — and works from whichever step the shopper is already looking at without navigating them anywhere. What happens next depends on what the shopper can see, and the returned status says which: when the named draft is the one whose live preview they already have on screen, the print is added outright, returning status added, because that preview was the pre-visualization, and the masthead cart chip flashes the new count. When it is any other draft, a print they have not seen, this only proposes, returning status awaiting_shopper_confirmation with a proposal_id and the resulting pending_proposal_count: a picture-in-picture card shows them the print and the call returns immediately without waiting, and that proposal awaits the SHOPPER's decision, made by clicking the card or saying so in their own words. Proposals stack, so you may propose several prints in a row without resolving each one first; every card in the stack waits on the shopper individually. Proposing a draft that already has a card waiting returns that same card rather than a duplicate. On a proposal, stop and tell the shopper the card is waiting; asking you to add something to the cart is a request for that proposal, never confirmation of it, so you must not resolve your own proposal. It never renders fulfillment artwork, charges a card, or creates an order.",
    fields: ["draftId", "draft_id", "quantity"],
  },
  {
    exportName: "resolveCartProposal",
    stableKey: "storefront.resolve_cart_proposal",
    name: "resolve_cart_proposal",
    description: "Use exclusively to relay the shopper's own explicit decision about the picture-in-picture proposal cards stacked in the corner, spoken by them after those cards appeared. Only the shopper can accept or reject a proposal: calling this on your own initiative, or to confirm a proposal you yourself just made, is a protocol violation, not a shortcut. Asking for something to be added to the cart is a request for a proposal and is NOT confirmation of one, so after add_to_cart you stop and wait. Pass the shopper's confirming or declining words verbatim as shopperConfirmation; if you cannot quote them, they have not decided yet and you must ask. Use decision accept or reject with the proposalId of one card — either proposalId or proposal_id is accepted, so the ID can be copied straight out of the response it came from — and that card alone is resolved while the rest keep waiting. When the shopper answers the whole stack at once, in words like add them all or none of those, use decision accept_all or reject_all and leave proposalId out; their words still go in shopperConfirmation and apply to the batch. When they answer only the unflagged ones, in words like accept the ready ones, use decision accept_ready, which accepts every pending card whose review verdict is ready and deliberately leaves each needs_review card standing for them to look at. Separately, decision update_quantity changes how many copies one standing card is asking for, for a request like make that one two copies: it needs proposalId and quantity, it takes no shopperConfirmation because changing a question is not answering it, the card's quantity badge updates in place, the card keeps waiting, and nothing enters the cart until the shopper accepts it — at which point the new quantity is what is added. Acts exactly as the visible buttons would, and returns every proposal it resolved plus the resulting cart state.",
    fields: ["proposalId", "proposal_id", "decision", "shopperConfirmation", "quantity"],
  },
  {
    exportName: "revisePrints",
    stableKey: "storefront.revise_prints",
    name: "revise_prints",
    description: "Propagate a framing the shopper has already approved onto other prints, for a request like frame the others like this. Applies one crop patch — the same zoom, focus and offset vocabulary configure_print's set_crop takes and ask_storefront reports per draft — to every draft named in draftIds, aiming at each draft's only image slot unless slotSelector names a role such as individual or team, a published slotKey, or a label; every affected preview and proposal card repaints before this returns. The crop may carry focusOn faces with either zoom or subjectWidthPercent, such as 50 to make each detected subject fill half its crop width; do not send both. Each result reports focus_applied plus the requested and achieved subject width, so face-centering is only ever narrated when the response confirms it. Returns a per-draft result saying applied or skipped with the reason, and never adds anything to the demo cart, answers a proposal, or moves the shopper to another print.",
    fields: ["draftIds", "draft_ids", "crop", "slotSelector"],
  },
  {
    exportName: "proposePrints",
    stableKey: "storefront.propose_prints",
    name: "propose_prints",
    description: "Stage one print per photograph in a single call, for a request like make a 5x7 of each of photos 10 through 15. Creates a draft for every reference in photoRefs against one product, prefilling any template roles the shopper has already chosen, and stacks a picture-in-picture proposal card for each — always in the background, so a shopper customizing a print by hand keeps the screen and never has it taken from them. Returns an ordered per-item result carrying photo_ref, draft_id, proposal_id, status and a geometry review verdict, reporting a photograph that could not be staged in place rather than abandoning the rest of the batch. Nothing enters the demo cart until the SHOPPER answers each card, so stop afterwards and tell them the deck is waiting.",
    fields: ["trayRevision", "productId", "productQuery", "photoRefs", "photo_refs", "quantity", "orientation", "templateId", "templateQuery", "outputId"],
  },
  {
    exportName: "manageCart",
    stableKey: "storefront.manage_cart",
    name: "manage_cart",
    description: "Manage the visible demo cart: inspect it, change a quantity, remove a line, or clear it. When a shopper says the most recent cart item, pass target most_recent with update_quantity or remove so their request completes in one call. For a request to reverse the last change, use undo_last_change. Returns the resulting cart state and never charges a card or creates an order.",
    fields: ["action", "itemId", "target", "quantity"],
  },
  {
    exportName: "undoLastChange",
    stableKey: "storefront.undo_last_change",
    name: "undo_last_change",
    description: "Use when a shopper wants the last change taken back, for a request like actually, undo that — including reversing a just-removed cart line. Restores the visible workbench — drafts, framing, slot assignments, the proposal cards waiting in the corner, and the demo cart — to how it stood before the most recent change, through the same restore path a page reload uses, and re-links every photograph against the tray as it stands now. Optionally pass steps, a whole number from 1 through 5, to walk further back; it walks back as far as the history reaches and reports how far it got. Returns undone, a plain description of the change that was taken back, such as revise_prints framing across 5 drafts, plus how many steps remain: narrate what came back using that description rather than guessing. Only changes the workbench holds are remembered, up to the last ten, and they are forgotten when the page is reloaded. A successful undo can be reapplied with redo_last_change; any new workbench change clears that redo path. When nothing has changed yet it says so rather than pretending to act. It never restores a photograph to the tray, un-orders anything, or changes the live catalog.",
    fields: ["steps"],
  },
  {
    exportName: "redoLastChange",
    stableKey: "storefront.redo_last_change",
    name: "redo_last_change",
    description: "Use only when the shopper wants a successful undo reapplied, for a request like redo the undo or put that undone change back. Restores the exact drafts, proposal cards, and cart lines that undo_last_change just removed through the same relinked workbench restore path; it never stages a fresh proposal or guesses a replacement print. Optionally pass steps, a whole number from 1 through 5, to reapply further consecutive undos. Redo exists only until a new workbench change or a page reload. If the shopper asks to restore a cart line that was directly removed with manage_cart rather than undone, use undo_last_change to reverse that removal instead.",
    fields: ["steps"],
  },
];

test("WebMCP preserves stable keys while publishing the approved ten-tool agentic flow", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  assert.equal(approvedTools.length, 10, "the published tool surface is ten tools");
  assert.equal(source.match(/^export const \w+ = defineTool/gm)?.length, 10, "no tool is published outside the approved list");
  for (const expected of approvedTools) {
    const definition = toolDefinition(source, expected.exportName);
    assert.match(definition, new RegExp(String.raw`stableKey:\s*"${escapeRegExp(expected.stableKey)}"`));
    assert.match(definition, new RegExp(String.raw`name:\s*"${expected.name}"`));
    assert.match(definition, /description:\s*"[^"]+"/, `${expected.name} has an agent-facing description`);
    assert.deepEqual(propertyKeys(definition), expected.fields, `${expected.name} input fields`);
    assert.match(inputSchema(definition), /additionalProperties:\s*false/);
    assert.match(definition, new RegExp(String.raw`requestStorefrontWebMcpAction\("${expected.name}"`));
  }
});

test("imperative tools use concise, verb-first descriptions and explain agent-relevant inputs", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  for (const expected of approvedTools) {
    const definition = toolDefinition(source, expected.exportName);
    const description = definition.match(/description:\s*"([^"]+)"/)?.[1] ?? "";
    assert.ok(description.length > 20 && description.length <= 360, `${expected.name} description stays focused`);
    assert.match(description, /^(Inspect|Find|Create|Add|Apply|Stage|Manage|Restore|Reapply)/, `${expected.name} starts with an action`);
  }

  const configure = inputSchema(toolDefinition(source, "configurePrint"));
  const propose = inputSchema(toolDefinition(source, "proposePrints"));
  const manage = inputSchema(toolDefinition(source, "manageCart"));
  assert.match(configure, /trayRevision:[\s\S]*?description: "Current visible tray revision/);
  assert.match(propose, /trayRevision:[\s\S]*?description: "Current visible tray revision/);
  assert.match(configure, /photoRefs:[\s\S]*?description: "Tray photo ordinals/);
  assert.match(propose, /photoRefs:[\s\S]*?description: "Tray photo ordinals/);
  assert.match(configure, /focusOn:[\s\S]*?description: "Crop intent/);
  assert.match(manage, /target:[\s\S]*?description: "Use most_recent/);
});

test("tool-layer validation returns an inspectable error envelope instead of an SDK throw", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  assert.match(source, /function validateToolInput\([\s\S]*?code: "invalid_input"/);
  assert.match(source, /scope: "input"/);
  assert.match(source, /commitStatus: "not_committed"/);
  for (const exportName of ["askStorefront", "configurePrint", "addToCart", "resolveCartProposal", "revisePrints", "proposePrints", "manageCart"]) {
    assert.match(toolDefinition(source, exportName), /validateToolInput\(/, `${exportName} wraps pre-dispatch validation`);
  }
});

test("configure_print is a closed draft schema and rejects stale or ambiguous tray input by contract", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  const definition = toolDefinition(source, "configurePrint");
  const schema = inputSchema(definition);
  assert.match(schema, /required:\s*\["trayRevision"\]/);
  assert.match(schema, /trayRevision:\s*\{\s*type:\s*"integer",\s*minimum:\s*0(?:,\s*description:\s*"[^"]+")?\s*\}/);
  assert.match(schema, /photoRefs:\s*\{[\s\S]*?type:\s*"array"[\s\S]*?oneOf:[\s\S]*?type:\s*"string"[\s\S]*?type:\s*"integer"/);
  assert.match(schema, /orientation:\s*\{\s*type:\s*"string",\s*enum:\s*\["portrait",\s*"landscape"\]\s*\}/);
  assert.match(schema, /slotPatches:\s*\{[\s\S]*?type:\s*"array"[\s\S]*?items:\s*\{\s*type:\s*"object"/);
  assert.match(schema, /directCrop:\s*\{\s*type:\s*"object"/);
  assert.match(definition, /requireCurrentTrayRevision\(input\.trayRevision\)/);

  const slotPatches = objectAfter(objectAfter(objectAfter(schema, "properties:"), "slotPatches:"), "items:");
  assert.deepEqual(shallowKeys(objectAfter(slotPatches, "properties:")), [
    "slotKey", "label", "operation", "photoRef", "text", "zoom", "focusX", "focusY", "offsetX", "offsetY",
    // focusOn is the one crop value that names an intention rather than a
    // coordinate; both spellings are accepted, as everywhere else.
    "focusOn", "focus_on", "subjectWidthPercent", "subject_width_percent",
  ]);
  assert.match(slotPatches, /required:\s*\["operation"\]/);
  assert.match(slotPatches, /oneOf:\s*\[\{\s*required:\s*\["slotKey"\]\s*\},\s*\{\s*required:\s*\["label"\]\s*\}\]/);
  assert.match(slotPatches, /additionalProperties:\s*false/);

  const directCrop = objectAfter(objectAfter(schema, "properties:"), "directCrop:");
  assert.deepEqual(shallowKeys(objectAfter(directCrop, "properties:")), [
    "zoom", "focusX", "focusY", "offsetX", "offsetY", "focusOn", "focus_on", "subjectWidthPercent", "subject_width_percent",
  ]);
  assert.ok((schema.match(/subjectWidthPercent:\s*\{\s*type:\s*"number",\s*exclusiveMinimum:\s*0,\s*maximum:\s*100\s*\}/g) ?? []).length >= 2);
  assert.match(directCrop, /minProperties:\s*1/);
  assert.match(directCrop, /additionalProperties:\s*false/);

  const revise = inputSchema(toolDefinition(source, "revisePrints"));
  const reviseCrop = objectAfter(objectAfter(revise, "properties:"), "crop:");
  assert.deepEqual(shallowKeys(objectAfter(reviseCrop, "properties:")), [
    "zoom", "focusX", "focusY", "offsetX", "offsetY", "focusOn", "focus_on", "subjectWidthPercent", "subject_width_percent",
  ]);
});

test("template selection stays unambiguous across configuration, batch staging, and compatibility lookup", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  const ask = toolDefinition(source, "askStorefront");
  const configure = toolDefinition(source, "configurePrint");
  const propose = toolDefinition(source, "proposePrints");

  assert.match(inputSchema(ask), /maxTemplateResults:\s*\{\s*type:\s*"integer",\s*minimum:\s*1,\s*maximum:\s*20\s*\}/);
  assert.match(inputSchema(ask), /required:\s*\["question"\]/);
  for (const definition of [ask, configure, propose]) {
    const schema = inputSchema(definition);
    assert.match(schema, /templateId:\s*\{\s*type:\s*"string"/);
    assert.match(schema, /templateQuery:\s*\{\s*type:\s*"string"/);
  }
  for (const definition of [configure, propose]) {
    assert.match(inputSchema(definition), /outputId:\s*\{\s*type:\s*"string"/);
  }
  assert.match(source, /templateId !== undefined && input\.templateQuery !== undefined/);
  assert.match(source, /input\.outputId !== undefined && input\.templateId === undefined && input\.templateQuery === undefined/);
  for (const [definition, action] of [[ask, "ask_storefront"], [configure, "configure_print"], [propose, "propose_prints"]]) {
    assert.match(definition, new RegExp(String.raw`validateTemplateSelection\(input, "${action}"\)`));
  }
});

test("the bridge exposes expected storefront failures as structured tool errors and preserves timeout uncertainty", async () => {
  const bridge = await read("src/webmcp/storefront-bridge.ts");
  assert.match(bridge, /export type StorefrontWebMcpExpectedError/);
  for (const code of [
    "template_not_found", "template_ambiguous", "template_output_incompatible",
    "template_no_compatible_output", "template_contract_unavailable",
    "template_preview_unavailable", "template_required_unavailable",
    "batch_preflight_failed", "storefront_timeout", "transient_upstream",
  ]) assert.match(bridge, new RegExp(String.raw`"${code}"`));
  assert.match(bridge, /isError: true/);
  assert.match(bridge, /structuredContent: \{ error: normalized \}/);
  assert.match(bridge, /commitStatus: "unknown"/);
  assert.match(bridge, /resolve\(expectedErrorResult\(response\.error\)\)/);
  assert.match(bridge, /resolve\(expectedErrorResult\(\{[\s\S]*?code: "storefront_timeout"/);
});

test("cart proposals use completed visible draft IDs, not product or offer identifiers", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  const cart = toolDefinition(source, "addToCart");
  const resolve = toolDefinition(source, "resolveCartProposal");
  // Either spelling satisfies the schema, so an ID copied out of a response
  // that reports draft_id is not rejected for saying draft_id.
  assert.match(inputSchema(cart), /anyOf:\s*\[\{\s*required:\s*\["draftId"\]\s*\},\s*\{\s*required:\s*\["draft_id"\]\s*\}\]/);
  assert.doesNotMatch(inputSchema(cart), /\b(?:productId|offerId)\b/);
  assert.match(inputSchema(cart), /quantity:\s*\{\s*type:\s*"integer",\s*minimum:\s*1,\s*maximum:\s*99,\s*default:\s*1(?:,\s*description:\s*"[^"]+")?\s*\}/);
  // proposalId is required only for a single-card decision; accept_all and
  // reject_all answer the whole stack and name no card. The handler enforces
  // that, so it can say which of the two mistakes was made.
  // shopperConfirmation left the schema's required list for one reason only:
  // update_quantity changes the question a card asks rather than answering it,
  // and demanding a quote of the shopper accepting a proposal they have not
  // accepted would invite the agent to invent one. Every decision that IS an
  // answer still refuses without their words — enforced in the execute body,
  // which can say why, and in the visible handler as well.
  assert.match(inputSchema(resolve), /required:\s*\["decision"\]/);
  assert.match(resolve, /if \(input\.decision === "update_quantity"\)/);
  assert.match(resolve, /shopperConfirmation must quote the shopper's own words/);
  // update_quantity names its one card and carries a bounded quantity.
  assert.match(inputSchema(resolve), /quantity:\s*\{\s*type:\s*"integer",\s*minimum:\s*1,\s*maximum:\s*99(?:,\s*description:\s*"[^"]+")?\s*\}/);
  assert.match(inputSchema(resolve), /decision:\s*\{\s*type:\s*"string",\s*enum:\s*\["accept",\s*"reject",\s*"accept_all",\s*"reject_all",\s*"accept_ready",\s*"update_quantity"\](?:,\s*description:\s*"[^"]+")?\s*\}/);
  assert.match(resolve, /requireIdentifierAlias\(\s*raw,\s*"proposalId",\s*"proposal_id"/);
  assert.doesNotMatch(source, /name:\s*"render_template_preview"/);
});

test("add_to_cart returns without blocking and stacks a second proposal instead of refusing it", async () => {
  // Refusing while a card was already waiting made "add both of these" a
  // request the agent could not carry out: the first proposal blocked the
  // second, and only the shopper could unblock it. The cards stack instead,
  // and each one waits on the shopper individually.
  const source = await read("src/webmcp/tools/storefront.ts");
  const cart = toolDefinition(source, "addToCart");
  assert.doesNotMatch(cart, /pendingProposal/);
  assert.doesNotMatch(cart, /resolve_cart_proposal first/);
  assert.match(cart, /Proposals stack/);
  // Resolving still needs at least one visible card to answer.
  assert.match(toolDefinition(source, "resolveCartProposal"), /getStorefrontWebMcpState\(\)\.pendingProposalCount > 0/);

  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const handler = ui.slice(ui.indexOf('request.action === "add_to_cart"'), ui.indexOf('request.action === "resolve_cart_proposal"'));
  assert.doesNotMatch(handler, /is still waiting on the shopper/);
  // A second card for a draft that already has one asks nothing new, so the
  // standing proposal is returned rather than a twin.
  assert.match(ui, /pendingCartProposalForDraft\(proposalStackRef\.current, draft\.id\)/);
  assert.match(handler, /duplicate_of_pending_proposal: duplicate/);
  assert.match(handler, /pending_proposal_count: stackCount/);
});

test("either casing of an ID is accepted, because that is the casing the responses use", async () => {
  // A real failure: the responses report draft_id and proposal_id, the schemas
  // wanted draftId and proposalId, and an agent copying an ID out of the
  // response it had just read was rejected with only "Tool requires: draftId".
  const [tools, ui, aliases] = await Promise.all([
    read("src/webmcp/tools/storefront.ts"),
    read("src/components/storefront/manual-storefront.tsx"),
    read("src/lib/storefront/tool-input.ts"),
  ]);
  for (const [exportName, camelCase, snakeCase] of [
    ["configurePrint", "draftId", "draft_id"],
    ["addToCart", "draftId", "draft_id"],
    ["resolveCartProposal", "proposalId", "proposal_id"],
  ]) {
    const schema = inputSchema(toolDefinition(tools, exportName));
    assert.match(schema, new RegExp(String.raw`${camelCase}:\s*\{\s*type:\s*"string"`));
    assert.match(schema, new RegExp(String.raw`${snakeCase}:\s*\{\s*type:\s*"string"`));
    // Exactly one spelling reaches the workbench.
    assert.match(toolDefinition(tools, exportName), new RegExp(String.raw`withResolvedIdentifierAliases\([\s\S]*?\["${camelCase}", "${snakeCase}"\]`));
  }
  // Two different values under the two names is a real mistake, not a casing
  // accident, and is named as one.
  assert.match(aliases, /provide exactly one/);
  // The workbench reads both spellings too, so neither entry point is stricter.
  assert.match(ui, /requireIdentifierAlias\(\s*request\.input,\s*"draftId",\s*"draft_id"/);
  assert.match(ui, /readIdentifierAlias\(request\.input, "proposalId", "proposal_id"\)/);
});

test("the shopper can answer the whole stack in one sentence", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const handler = ui.slice(ui.indexOf('request.action === "resolve_cart_proposal"'), ui.indexOf("const action = request.input.action;"));
  // accept_all and reject_all are the shopper's own "add them all", so they
  // still demand their words; the quote applies to the batch.
  assert.match(handler, /const bulk = requestedDecision === "accept_all" \|\| requestedDecision === "reject_all"/);
  assert.match(handler, /shopperConfirmation/);
  assert.match(handler, /targets = standing;/);
  // A single decision must name the card it answers.
  assert.match(handler, /standing\.find\(\(candidate\) => candidate\.id === proposalId\)/);
  // The response says what it resolved and what is left waiting.
  assert.match(handler, /resolved: targets\.map\(/);
  assert.match(handler, /pending_proposal_count: remaining/);
});

test("only the shopper resolves a proposal, and their own words must be quoted", async () => {
  // An agent proposed a print, said "since you asked for it, I'll accept it",
  // and resolved its own proposal. Nothing can prove who spoke, so the tool
  // makes auto-acceptance an unambiguous protocol violation and demands the
  // shopper's verbatim words before the proposal can be answered at all.
  const source = await read("src/webmcp/tools/storefront.ts");
  const resolve = toolDefinition(source, "resolveCartProposal");
  assert.match(resolve, /shopperConfirmation:\s*\{\s*type:\s*"string",\s*minLength:\s*1(?:,\s*description:\s*"[^"]+")?\s*\}/);
  assert.match(resolve, /input\.shopperConfirmation !== "string" \|\| input\.shopperConfirmation\.trim\(\)\.length === 0/);
  assert.match(resolve, /description:[\s\S]*?Only the shopper can accept or reject a proposal/);
  assert.match(resolve, /description:[\s\S]*?is NOT confirmation of one/);

  const addToCart = toolDefinition(source, "addToCart");
  assert.match(addToCart, /description:[\s\S]*?await the SHOPPER's decision/);
  assert.match(addToCart, /description:[\s\S]*?must not resolve (?:your|its) own proposal/);

  // The workbench refuses the same way, so the guarantee does not depend on
  // the tool layer being the only caller.
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const handler = ui.slice(ui.indexOf('request.action === "resolve_cart_proposal"'));
  assert.match(handler, /request\.input\.shopperConfirmation/);
  assert.match(handler, /shopper_confirmation: shopperConfirmation/);
  assert.match(handler, /decided_by: "shopper"/);
});

test("add_to_cart adds outright only for the draft the shopper is already watching", async () => {
  // "Add the memory mate" while looking at the memory mate is answered by the
  // preview on screen, so a card asking about it is ceremony. "Also add a 5x7 of
  // image 13" names a print the shopper has never seen, so that one still has to
  // be shown to them before it can enter the cart.
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const addToCart = ui.slice(ui.indexOf('request.action === "add_to_cart"'), ui.indexOf('request.action === "resolve_cart_proposal"'));
  assert.match(addToCart, /isShopperVisibleDraft\(shopperViewRef\.current, draft\.id, Date\.now\(\)\)/);
  assert.match(addToCart, /status: "added"/);
  assert.match(addToCart, /decided_by: "shopper_visible_context"/);
  assert.match(addToCart, /addDraftToCart\(draft, requestedQuantity\)/);
  // The unseen print keeps the whole proposal protocol.
  assert.match(addToCart, /proposeDraft\(draft, requestedQuantity\)/);
  assert.match(addToCart, /status: "awaiting_shopper_confirmation"/);

  // A draft only counts as watched after the shopper interacts with the
  // current push/pop workbench. Agent configuration never creates that proof,
  // and there is deliberately no visible-draft rail to switch between drafts.
  const configure = ui.slice(ui.indexOf('request.action === "configure_print"'), ui.indexOf('request.action === "add_to_cart"'));
  assert.match(configure, /noteVisibleDraft\(draft\.id, "agent"\)/);
  assert.match(ui, /function noteShopperLookingAtSelectedDraft\(\) \{[\s\S]*?noteVisibleDraft\(selectedDraftId, "shopper"\)/);
  assert.doesNotMatch(ui, /DraftRail|function selectDraft\(/);
});

test("the shopper's own Add to cart button adds without a proposal card", async () => {
  const [ui, prepare] = await Promise.all([
    read("src/components/storefront/manual-storefront.tsx"),
    read("src/components/storefront/prepare-step.tsx"),
  ]);
  assert.match(prepare, /onClick=\{onAddPreparedLine\}[\s\S]*?>\s*Add to cart\s*</);
  assert.doesNotMatch(prepare, /Propose this print/);
  const handler = ui.slice(ui.indexOf("onAddPreparedLine="), ui.indexOf("onAssignTemplatePhoto="));
  assert.match(handler, /addDraftToCart\(selectedDraft, 1\)/);
  assert.doesNotMatch(handler, /proposeDraft\(/);
  // The chip pulse is the acknowledgment, and no sheet steals the step.
  const add = ui.slice(ui.indexOf("function addDraftToCart("), ui.indexOf("function proposeDraft("));
  assert.match(add, /setCartAcknowledgement\(/);
  assert.doesNotMatch(add, /setCartOpen\(|setPendingProposal\(/);
});

test("a proposal returns as a question for the shopper, not a step the agent may finish", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const addToCart = ui.slice(ui.indexOf('request.action === "add_to_cart"'), ui.indexOf('request.action === "resolve_cart_proposal"'));
  assert.match(addToCart, /status: "awaiting_shopper_confirmation"/);
  assert.match(addToCart, /nextStep: "await_shopper_decision"/);
  assert.match(addToCart, /waiting on the shopper/);
  assert.match(addToCart, /Do not call resolve_cart_proposal unless the shopper has since said what they want/);
});

test("an incomplete draft is refused in words that name the missing slot and ask the shopper", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const addToCart = ui.slice(ui.indexOf('request.action === "add_to_cart"'), ui.indexOf('request.action === "resolve_cart_proposal"'));
  assert.match(addToCart, /missingTemplateDraftRequirements\(draft\)/);
  assert.match(addToCart, /describeMissingRequirements\(/);
  assert.match(addToCart, /missingRequirementsGuidance\(detail\)/);

  const configure = ui.slice(ui.indexOf('request.action === "configure_print"'), ui.indexOf('request.action === "add_to_cart"'));
  assert.match(configure, /missing: missingDetail/);
  assert.match(configure, /guidance: missingRequirementsGuidance\(missingDetail\)/);
  assert.match(configure, /"ask_shopper_for_missing_slots"/);
});

test("manage_cart view works on an empty demo cart while mutations still refuse", async () => {
  const definition = toolDefinition(await read("src/webmcp/tools/storefront.ts"), "manageCart");
  assert.match(definition, /input\.action !== "view" && getStorefrontWebMcpState\(\)\.cartItemCount === 0/);
  assert.match(definition, /target: \{ type: "string", enum: \["most_recent"\](?:, description: "[^"]+")? \}/);
  assert.match(definition, /input\.target !== "most_recent"/);
});

test("registrar publishes one stable tool surface so a whole agent turn stays plannable", async () => {
  const registrar = await read("src/components/webmcp/WebMcpRegistrar.tsx");
  // An agent lists tools once and plans the rest of its turn from that list.
  // Registering configure_print, add_to_cart or resolve_cart_proposal only
  // once their precondition already holds made "add an 8x10 to cart" from a
  // cold session unplannable, because add_to_cart appeared only after the
  // draft it needs already existed.
  const list = registrar.match(/const storefrontTools = \[([\s\S]*?)\];/);
  assert.ok(list, "expected a constant storefrontTools array");
  assert.deepEqual(
    list[1].split(",").map((entry) => entry.trim()).filter(Boolean),
    ["askStorefront", "findPrints", "configurePrint", "revisePrints", "proposePrints", "addToCart", "resolveCartProposal", "manageCart", "undoLastChange", "redoLastChange"],
  );
  assert.doesNotMatch(registrar, /canConfigurePrint|canAddToCart|state\.pendingProposal/);
  assert.match(registrar, /useEffect\([\s\S]*?\}, \[\]\)/);
  assert.doesNotMatch(registrar, /requestServerProof|prepareSandboxOrder/);
  assert.match(registrar, /return \(\) => registration\.unregister\(\)/);
});

test("readiness is enforced by the tool and the workbench, never by the tool being missing", async () => {
  const tools = await read("src/webmcp/tools/storefront.ts");
  const addToCart = toolDefinition(tools, "addToCart");
  // add_to_cart validates the named draft in the workbench, which can say
  // which slot is missing; the storefront-wide flag would wrongly refuse the
  // first draft of a session.
  assert.doesNotMatch(addToCart, /requireVisibleCapability\(/);
  // Nor by a card already waiting: proposals stack.
  assert.doesNotMatch(addToCart, /pendingProposal/);
  assert.match(toolDefinition(tools, "configurePrint"), /state\.canConfigurePrint\s*&&\s*state\.photoCount\s*>\s*0/);
});

test("tool-driven configure and add never navigate the shopper to another step", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  // selectProduct's third argument is the navigate flag; the WebMCP handler
  // passes false so the draft loads behind the visible step.
  assert.match(ui, /function selectProduct\(product: CatalogProduct, createVisibleDraft = true, navigate = true\)/);
  assert.match(ui, /if \(navigate\) setStep\("prepare"\)/);
  assert.match(ui, /selectProduct\(product, false, false\)/);

  const addToCart = ui.slice(ui.indexOf('request.action === "add_to_cart"'), ui.indexOf('request.action === "resolve_cart_proposal"'));
  assert.ok(addToCart.length > 0, "expected an add_to_cart handler branch");
  assert.doesNotMatch(addToCart, /selectDraft\(|setStep\(/);
  assert.match(addToCart, /proposeDraft\(draft, requestedQuantity\)/);
});

test("the masthead cart chip is the only opener of the cart sheet", async () => {
  const [masthead, cartSheet, ui] = await Promise.all([
    read("src/components/storefront/storefront-masthead.tsx"),
    read("src/components/storefront/cart-sheet.tsx"),
    read("src/components/storefront/manual-storefront.tsx"),
  ]);
  assert.doesNotMatch(masthead, /href="#review"/);
  assert.match(masthead, /aria-controls="cart-sheet"/);
  assert.match(masthead, /aria-haspopup="dialog"/);
  assert.match(masthead, /onClick=\{onOpenCart\}/);

  // The sheet is an overlay dialog that is mounted only while it is open.
  assert.match(cartSheet, /open: boolean;/);
  assert.match(cartSheet, /if \(!open\) return null;/);
  assert.match(cartSheet, /role="dialog"/);
  assert.match(cartSheet, /aria-modal="true"/);
  assert.match(cartSheet, /aria-labelledby="cart-sheet-title"/);
  assert.match(cartSheet, /event\.key !== "Escape"/);
  assert.match(cartSheet, /aria-label="Close demo cart"/);
  assert.match(cartSheet, /onClick=\{close\}/);
  assert.match(cartSheet, /onOpenChange\(false\);/);
  assert.match(cartSheet, /onUpdateQuantity: \(itemId: string, quantity: number\) => void;/);
  assert.match(cartSheet, /Decrease \$\{item\.productName\} quantity/);
  assert.match(cartSheet, /Increase \$\{item\.productName\} quantity/);
  assert.match(cartSheet, /disabled=\{item\.quantity <= 1\}/);
  assert.match(cartSheet, /disabled=\{item\.quantity >= 99\}/);

  assert.match(ui, /onOpenCart=\{\(\) => setCartOpen\(true\)\}/);
  assert.match(ui, /open=\{cartOpen\}/);
  assert.match(ui, /onUpdateQuantity=\{\(itemId, quantity\) => setCart\(/);
  // No persistent cart lives in a page corner any more.
  assert.doesNotMatch(ui, /FloatingCartBar|fixed bottom-5 right-5/);
});

test("accepting a proposal acknowledges on the chip without opening the cart", async () => {
  const [masthead, ui] = await Promise.all([
    read("src/components/storefront/storefront-masthead.tsx"),
    read("src/components/storefront/manual-storefront.tsx"),
  ]);
  const resolve = ui.slice(ui.indexOf("function resolveProposals("), ui.indexOf("publishStorefrontWebMcpState({"));
  assert.ok(resolve.length > 0, "expected a resolveProposals body");
  assert.match(resolve, /setCartAcknowledgement\(/);
  assert.doesNotMatch(resolve, /setCartOpen\(/);
  assert.match(masthead, /animate-cart-ack/);
});

test("the telemetry key comes from the environment, never a literal", async () => {
  const registrar = await read("src/components/webmcp/WebMcpRegistrar.tsx");
  assert.match(registrar, /process\.env\.NEXT_PUBLIC_WEBMCP_TRACKING_KEY/);
  assert.doesNotMatch(registrar, /wmk_[A-Za-z0-9_-]{8}/);
  assert.match(registrar, /trackingKey \?[\s\S]*?: undefined/);
});

test("WebMCP does not expose photo reorder or deletion operations", async () => {
  const [tools, bridge, registrar] = await Promise.all([
    read("src/webmcp/tools/storefront.ts"),
    read("src/webmcp/storefront-bridge.ts"),
    read("src/components/webmcp/WebMcpRegistrar.tsx"),
  ]);
  const browserContract = `${tools}\n${bridge}\n${registrar}`;
  assert.doesNotMatch(browserContract, /["'](?:reorder|delete|remove|move)_(?:photo|photos|tray)["']/);
  assert.doesNotMatch(browserContract, /stableKey:\s*["']storefront\.(?:reorder|delete|remove|move)[_.](?:photo|photos|tray)["']/);
});

test("an agent-created draft never takes the screen from a shopper customizing one by hand", async () => {
  const source = await read("src/components/storefront/manual-storefront.tsx");
  // The placement decision is the pure rule, asked before anything moves.
  assert.match(source, /const placement: DraftPlacement = agentDraftPlacement\(shopperViewRef\.current, selectedDraftId, draft\.id\)/);
  assert.match(source, /const onScreen = placement === "on_screen"/);
  // Selecting the draft, loading the product into the workbench and moving the
  // tray selection are all gated on that decision.
  const configureBlock = source.slice(source.indexOf("const placement: DraftPlacement"));
  const gated = configureBlock.slice(0, configureBlock.indexOf("const directCrop"));
  assert.match(gated, /if \(onScreen\) \{[\s\S]*setSelectedDraftId\(draft\.id\)/);
  assert.match(gated, /if \(onScreen\) \{[\s\S]*selectProduct\(product, false, false\)/);
  assert.match(gated, /if \(onScreen\) \{[\s\S]*dispatchPhotoLibrary\(\{ type: "select"/);
  // A background draft resolves its template as a pure read, so no workbench
  // state is disturbed while the shopper works.
  assert.match(source, /offScreenTemplate = await resolveTemplateOffScreen\(product, draft, \{/);
  // And the tool says which happened, so the agent can narrate honestly.
  assert.match(source, /placed: placement/);
  assert.match(source, /visible: onScreen/);
});

test("a background draft leaves the shopper-view context alone so add_to_cart still proposes", async () => {
  const source = await read("src/components/storefront/manual-storefront.tsx");
  const configureBlock = source.slice(source.indexOf("const placement: DraftPlacement"));
  const gated = configureBlock.slice(0, configureBlock.indexOf("const directCrop"));
  // noteVisibleDraft is reached only on the on-screen path. Leaving the context
  // pointing at the shopper's own draft is what makes the new one off-screen for
  // add_to_cart: its dwell never starts, so it lands on the proposal card.
  assert.match(gated, /if \(onScreen\) \{[\s\S]*noteVisibleDraft\(draft\.id, "agent"\)/);
  assert.doesNotMatch(gated.replace(/if \(onScreen\) \{[\s\S]*?\n {10}\}/, ""), /noteVisibleDraft/);
});

test("the proposal card paints the proposed draft itself, not whatever is selected", async () => {
  const [source, stack] = await Promise.all([
    read("src/components/storefront/manual-storefront.tsx"),
    read("src/components/storefront/cart-proposal-stack.tsx"),
  ]);
  const binding = source.slice(
    source.indexOf("function proposalPreviewBinding("),
    source.indexOf("// Safety net for proposed template drafts"),
  );
  assert.ok(binding.length > 0, "expected a per-proposal preview binding");
  // The old binding showed a preview only when the proposed draft happened to
  // be the selected one, which is never true for the print worth proposing.
  assert.doesNotMatch(binding, /selectedDraftId/);
  assert.doesNotMatch(binding, /browserPreviewDocument/);
  // It binds its own document, its own assets, and the draft's own snapshot of
  // slot assignments, framing and text.
  assert.match(binding, /document=\{proposalPreviewDocument\}/);
  assert.match(binding, /assetURLs=\{proposalPreviewAssetURLs\}/);
  assert.match(binding, /localImageSlots=\{proposalPreviewImageSlots\}/);
  assert.match(binding, /textValues=\{proposal\.draft\.textValues\}/);
  assert.match(binding, /previewImageSlots\(\s*proposal\.draft\.slotAssignments,\s*proposal\.draft\.slotTransforms,\s*photoLibrary\.photos,?\s*\)/);
  // Every card is bound the same way, one per proposal.
  assert.match(source, /previewFor=\{proposalPreviewBinding\}/);
  assert.match(stack, /const \{ aspect, templatePreview, review \} = previewFor\(proposal\)/);
  assert.doesNotMatch(stack, /selectedDraftId|browserPreviewDocument/);
});

test("proposals stack as an overlapping deck that promotes the next card when one is answered", async () => {
  const [stack, card, ui, cartModel, css] = await Promise.all([
    read("src/components/storefront/cart-proposal-stack.tsx"),
    read("src/components/storefront/cart-proposal-card.tsx"),
    read("src/components/storefront/manual-storefront.tsx"),
    read("src/lib/storefront/local-cart.ts"),
    read("src/app/globals.css"),
  ]);
  // The deck has a dependable bottom-left home. The cards behind the active
  // one fan toward the corner opposite the cursor, the active card leans a
  // touch toward it, and the cursor never triggers a React render.
  assert.match(stack, /fixed bottom-5 left-5 z-50 w-\[min\(92vw,264px\)\]/);
  assert.doesNotMatch(stack, /pointerAnchor|deckPlacement/);
  assert.match(stack, /window\.addEventListener\("pointermove"/);
  assert.doesNotMatch(stack, /setPointer\(/);
  assert.match(stack, /root\.style\.setProperty\("--deck-nx"/);
  assert.match(stack, /deckLayerGeometry\(depth, side\)/);
  assert.doesNotMatch(stack, /flex-col/);
  assert.match(stack, /absolute bottom-0 left-0 w-full origin-center/);
  assert.match(ui, /commitProposalStack\(\(entries\) => \[\.\.\.entries, \{ proposal, exit: null \}\]\)/);
  assert.match(stack, /mountedIds\.map\(\(id\) =>/);

  // Selection is stable by proposal id. Only the active preview and a bounded
  // window around it mount, even when a batch contains dozens of cards.
  assert.match(cartModel, /CART_PROPOSAL_VISIBLE_DEPTH = 3/);
  assert.match(stack, /const \[activeProposalId, setActiveProposalId\]/);
  assert.match(stack, /restoreActiveProposalId\(activeProposalId, previous, pendingIds\)/);
  assert.match(stack, /proposalPreviewWindow\(pendingIds, activeId\)/);
  assert.match(stack, /PROPOSAL_DECK_MAX_PREVIEWS/);
  assert.match(stack, /const scale = 1 - SCALE_STEP \* depth/);
  assert.match(stack, /opacity: 1 - 0\.18 \* depth/);
  assert.match(stack, /moreCount = Math\.max\(0, pendingIds\.length - mountedPendingCount\)/);
  assert.match(card, /\+\{moreCount\} more/);
  // Only the active card can be clicked or tabbed into.
  assert.match(stack, /onTop && !exit \? "pointer-events-auto" : "pointer-events-none"/);
  assert.match(stack, /inert=\{!onTop \|\| Boolean\(exit\)\}/);
  assert.match(card, /disabled=\{Boolean\(exit\) \|\| !onTop\}/);
  // A direct proposal must project the committed crop through the same
  // source-relative transform as WebMCP, not object-position then scale.
  assert.match(card, /function DirectProposalThumbnail/);
  assert.match(card, /slotTransformFromCropPatch/);
  assert.match(card, /coveredWidth \* transform\.zoom/);
  assert.doesNotMatch(card, /objectPosition: `\$\{focus\.focusX\}/);

  // An answered card keeps its place while it animates away, so "waiting" is
  // the pending list and not the rendered one.
  assert.match(cartModel, /export function pendingCartProposals\(/);
  assert.match(ui, /const pendingProposals = useMemo\(\(\) => pendingCartProposals\(proposalStack\)/);
  assert.match(ui, /entry\.exit \? \{ \.\.\.entry, exit: decision \} : entry/);
  assert.match(ui, /CART_PROPOSAL_EXIT_MS\[decision\]/);
  assert.match(ui, /pendingProposalCount: pendingProposals\.length/);

  // Arrival and decisions remain brief, with reduced motion disabling travel.
  for (const keyframe of ["proposal-in", "proposal-accept", "proposal-reject"]) {
    assert.match(css, new RegExp(String.raw`@keyframes ${keyframe} \{`));
    assert.match(css, new RegExp(String.raw`--animate-${keyframe}:[^;]*var\(--ease-out-expo\)`));
  }
  assert.match(card, /animate-proposal-in motion-reduce:animate-none/);
  assert.match(card, /animate-proposal-accept/);
  assert.match(card, /animate-proposal-reject/);
  assert.match(stack, /const DECK_SETTLE_MS = 420/);
  assert.match(stack, /var\(--ease-spring\)/);
  assert.match(stack, /motion-reduce:transition-none/);
  assert.match(css, /--ease-spring: cubic-bezier/);
  assert.match(cartModel, /accept: 400/);
  assert.match(cartModel, /reject: 300/);

  // The cards behind the active one move opposite the cursor while the deck
  // itself stays parked. Horizontal wheel movement keeps the active card tied
  // to its ID and never consumes ordinary vertical scroll.
  assert.match(stack, /var\(--deck-nx, 0\) \* var\(--deck-kx, 0\)/);
  assert.match(stack, /var\(--deck-ny, 0\) \* var\(--deck-ky, 0\)/);
  assert.match(css, /@property --deck-kx/);
  assert.match(stack, /Math\.abs\(event\.deltaX\) > Math\.abs\(event\.deltaY\)/);
  assert.match(stack, /event\.preventDefault\(\)/);
  assert.match(stack, /ArrowLeft/);
  assert.match(stack, /ArrowRight/);
});

test("a proposal preview resolves live artwork, then the bundled copy, then a synthesized layout", async () => {
  const source = await read("src/components/storefront/manual-storefront.tsx");
  const resolver = source.slice(
    source.indexOf("async function resolvePreviewDocument"),
    source.indexOf("/** Records the draft now occupying the prepare step"),
  );
  // Reuses anything already resolved rather than refetching the same artwork.
  assert.match(resolver, /previewDocumentsRef\.current\[key\]/);
  // A failed live fetch degrades to the bundled published copy and then to a
  // layout built from the contract — never to an empty card.
  assert.match(resolver, /storefrontClient\.browserPreviewDocument\([\s\S]*\.catch\(\(\) => \{/);
  assert.match(resolver, /bundledTemplateSpec\(templateID\)/);
  assert.match(resolver, /specBrowserPreviewDocument\(\{ spec, contract, output \}\)/);
  assert.match(resolver, /fallbackBrowserPreviewDocument\(\{ templateID, contract, output \}\)/);
});

test("a background draft derives its slot aliases from its own artwork", async () => {
  const source = await read("src/components/storefront/manual-storefront.tsx");
  // The workbench document belongs to the print the shopper is holding, so the
  // background draft's response must read its own document instead.
  assert.match(source, /const responseDocument: BrowserPreviewDocument \| null = onScreen\s*\?\s*browserPreviewDocumentRef\.current\s*:\s*offScreenTemplate\?\.document \?\? null/);
  assert.match(source, /imageSlotAliasesForContract\(responseContract, responseDocument\)/);
  assert.match(source, /imageSlotAliasesForContract\(contract, responseDocument\)/);
  // The slot boxes are read once into patchBoxes and reused for roles and for
  // the target aspect a face-centred crop needs; both still come from this
  // draft's own document.
  assert.match(source, /const patchBoxes = contractSlotBoxes\(contract, responseDocument\)/);
  assert.match(source, /imageSlotRoles\(contract\.slots, patchBoxes\)/);
});

test("find_prints looks the catalog up without moving the shopper off their work", async () => {
  const source = await read("src/components/storefront/manual-storefront.tsx");
  const start = source.indexOf('request.action === "find_prints"');
  const end = source.indexOf('request.action === "configure_print"');
  assert.ok(start !== -1 && end > start, "expected configure_print to follow find_prints");
  const find = source.slice(start, end);

  // A shopper mid-crop on the workbench asked what other sizes exist. That is a
  // question, not a request to be taken somewhere: an earlier iteration called
  // setStep("catalog") here and yanked them off the print they were holding
  // every time the agent checked a size.
  for (const steal of [
    /setStep\(/,
    /selectProduct\(/,
    /setSelectedDraftId/,
    /noteVisibleDraft/,
    /noteShopperLookingAtSelectedDraft/,
    /dispatchPhotoLibrary/,
    /setBrowserPreviewDocument/,
    /setCustomization/,
    /setSelectedProductKey/,
  ]) assert.doesNotMatch(find, steal, `find_prints must not call ${steal}`);

  // It still answers with the live catalog, and says so in the banner.
  assert.match(find, /naturalProductMatches\(catalog, query\)/);
  assert.match(find, /respondToStorefrontWebMcpAction\(\{ requestId: request\.requestId, result: \{ matches, note \} \}\)/);
});

test("the find_prints tool promises a read-only lookup and never a navigation", async () => {
  const tools = await read("src/webmcp/tools/storefront.ts");
  const start = tools.indexOf('stableKey: "storefront.find_prints"');
  const find = tools.slice(start, tools.indexOf("});", start));
  assert.match(find, /readOnlyHint: true/);
  assert.match(find, /without changing what the shopper is looking at/);
  // The description used to advertise the navigation as a feature.
  assert.doesNotMatch(find, /opens the format chooser/);
});

test("a text patch can only ever reach a text slot, and says what it wrote", async () => {
  // "Print name Marcus Betcher, jersey 12, team Spartans" used to fail on the
  // word team: it resolved to the image slot that earned "team" as a derived
  // alias, and set_text then refused an image slot. The operation now decides
  // which kind of slot the word can possibly mean, before anything is matched.
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(ui, /function slotPatchRequiredKind\(operation: unknown\): SlotKind \| null/);
  assert.match(ui, /if \(operation === "set_text"\) return "text";/);
  assert.match(ui, /const requiredKind = slotPatchRequiredKind\(patch\.operation\);/);
  assert.match(ui, /resolveSlotPatchTarget\(contract\.slots, patch, patchAliases, requiredKind\)/);
  // Text slots publish the same kind of derived vocabulary image slots do.
  assert.match(ui, /const patchAliases = \{ \.\.\.imageSlotAliasesForContract\(contract, responseDocument\), \.\.\.textSlotAliases\(contract\.slots\) \}/);
  assert.match(ui, /aliases: responseTextAliases\[slot\.key\] \?\? \[\]/);

  // The write is confirmed by the response that made it.
  assert.match(ui, /text_slots: responseContract\?\.slots\.filter\(\(slot\) => slot\.kind === "text"\)/);
  assert.match(ui, /value: finalDraft\.textValues\[slot\.key\] \?\? ""/);
  assert.match(ui, /max_length: slot\.max_length \?\? null/);

  // A limit is always enforced, published or not.
  assert.match(ui, /const \{ limit, published \} = textSlotLengthLimit\(slot\);/);
  assert.match(ui, /if \(patch\.text\.length > limit\)/);

  // A patch that names no draft and no photograph revises the print on screen
  // rather than demanding a photograph for a draft it is not creating.
  assert.match(ui, /const impliedDraft = !namedDraft && patchesOnly && selectedDraftId/);
  assert.match(ui, /const existingDraft = namedDraft \?\? impliedDraft;/);

  // The tool says text is patchable, so an agent does not have to discover it.
  const tools = await read("src/webmcp/tools/storefront.ts");
  assert.match(toolDefinition(tools, "configurePrint"), /description:[\s\S]*?per-slot text \(set_text\)/);
});
