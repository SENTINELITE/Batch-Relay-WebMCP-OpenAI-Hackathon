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
    description: "Use when a shopper asks what photographs, print drafts, template choices, slot requirements, pending cart proposals, or demo cart items are currently visible. Returns grounded structured state and the next available action without changing the workbench. Each image slot reports its current crop in the same zoom, focus, and offset vocabulary configure_print accepts, so a relative request such as zooming in further can be computed from the visible framing rather than guessed.",
    fields: ["question"],
  },
  {
    exportName: "findPrints",
    stableKey: "storefront.find_prints",
    name: "find_prints",
    description: "Use when a shopper wants to browse, compare, or identify canonical print products before creating a draft. Returns matching published product facts and template requirements, and visibly opens the format chooser without inventing products or compatibility.",
    fields: ["query", "productType", "maxResults"],
  },
  {
    exportName: "configurePrint",
    stableKey: "storefront.prepare_print_images",
    name: "configure_print",
    description: "Use when a shopper wants to create or revise one visible print draft from photographs already in the tray. Selects a real product, applies the remembered or first compatible active template, exposes exact published image and text slots, patches assignments and non-destructive crops, and returns missing requirements. A slot patch label may also be one of the aliases published beside each image slot, such as team or individual. An empty image slot may start from the photograph the shopper already chose for that role on another print; every such default is reported as prefilled_from and is replaced by an explicit assignment. The response reports each slot's resulting crop in this same patch vocabulary, so a relative crop change can be computed from it. It never reorders or deletes tray files, adds anything to the demo cart, or places an order.",
    fields: ["draftId", "trayRevision", "photoRefs", "productId", "productQuery", "templateId", "outputId", "orientation", "slotPatches", "directCrop"],
  },
  {
    exportName: "addToCart",
    stableKey: "storefront.add_to_cart",
    name: "add_to_cart",
    description: "Use when a shopper wants a complete visible print draft added to this browser's demo cart. Takes the draft_id returned by configure_print or listed by ask_storefront, and works from whichever step the shopper is already looking at without navigating them anywhere. Shows a picture-in-picture proposal card with a live preview the shopper accepts or rejects, and returns immediately without waiting; it never renders fulfillment artwork, charges a card, or creates an order.",
    fields: ["draftId", "quantity"],
  },
  {
    exportName: "resolveCartProposal",
    stableKey: "storefront.resolve_cart_proposal",
    name: "resolve_cart_proposal",
    description: "Use when a shopper answers the visible picture-in-picture proposal card in words instead of clicking it. Accepts the proposal into the demo cart or rejects and dismisses it, exactly as the two visible buttons would, and returns the resulting cart state.",
    fields: ["proposalId", "decision"],
  },
  {
    exportName: "manageCart",
    stableKey: "storefront.manage_cart",
    name: "manage_cart",
    description: "Use when a shopper wants to inspect, change quantity, remove, or clear items in the visible demo cart. Returns the resulting cart state and never changes source photographs, charges a card, or creates an order.",
    fields: ["action", "itemId", "quantity"],
  },
];

test("WebMCP preserves stable keys while publishing the approved six-tool agentic flow", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  for (const expected of approvedTools) {
    const definition = toolDefinition(source, expected.exportName);
    assert.match(definition, new RegExp(String.raw`stableKey:\s*"${escapeRegExp(expected.stableKey)}"`));
    assert.match(definition, new RegExp(String.raw`name:\s*"${expected.name}"`));
    assert.match(definition, new RegExp(String.raw`description:\s*"${escapeRegExp(expected.description)}"`));
    assert.deepEqual(propertyKeys(definition), expected.fields, `${expected.name} input fields`);
    assert.match(inputSchema(definition), /additionalProperties:\s*false/);
    assert.match(definition, new RegExp(String.raw`requestStorefrontWebMcpAction\("${expected.name}"`));
  }
});

test("configure_print is a closed draft schema and rejects stale or ambiguous tray input by contract", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  const definition = toolDefinition(source, "configurePrint");
  const schema = inputSchema(definition);
  assert.match(schema, /required:\s*\["trayRevision"\]/);
  assert.match(schema, /trayRevision:\s*\{\s*type:\s*"integer",\s*minimum:\s*0\s*\}/);
  assert.match(schema, /photoRefs:\s*\{[\s\S]*?type:\s*"array"[\s\S]*?oneOf:[\s\S]*?type:\s*"string"[\s\S]*?type:\s*"integer"/);
  assert.match(schema, /orientation:\s*\{\s*type:\s*"string",\s*enum:\s*\["portrait",\s*"landscape"\]\s*\}/);
  assert.match(schema, /slotPatches:\s*\{[\s\S]*?type:\s*"array"[\s\S]*?items:\s*\{\s*type:\s*"object"/);
  assert.match(schema, /directCrop:\s*\{\s*type:\s*"object"/);
  assert.match(definition, /requireCurrentTrayRevision\(input\.trayRevision\)/);

  const slotPatches = objectAfter(objectAfter(objectAfter(schema, "properties:"), "slotPatches:"), "items:");
  assert.deepEqual(shallowKeys(objectAfter(slotPatches, "properties:")), [
    "slotKey", "label", "operation", "photoRef", "text", "zoom", "focusX", "focusY", "offsetX", "offsetY",
  ]);
  assert.match(slotPatches, /required:\s*\["operation"\]/);
  assert.match(slotPatches, /oneOf:\s*\[\{\s*required:\s*\["slotKey"\]\s*\},\s*\{\s*required:\s*\["label"\]\s*\}\]/);
  assert.match(slotPatches, /additionalProperties:\s*false/);

  const directCrop = objectAfter(objectAfter(schema, "properties:"), "directCrop:");
  assert.deepEqual(shallowKeys(objectAfter(directCrop, "properties:")), [
    "zoom", "focusX", "focusY", "offsetX", "offsetY",
  ]);
  assert.match(directCrop, /minProperties:\s*1/);
  assert.match(directCrop, /additionalProperties:\s*false/);
});

test("cart proposals use completed visible draft IDs, not product or offer identifiers", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  const cart = toolDefinition(source, "addToCart");
  const resolve = toolDefinition(source, "resolveCartProposal");
  assert.match(inputSchema(cart), /required:\s*\["draftId"\]/);
  assert.doesNotMatch(inputSchema(cart), /\b(?:productId|offerId)\b/);
  assert.match(inputSchema(cart), /quantity:\s*\{\s*type:\s*"integer",\s*minimum:\s*1,\s*maximum:\s*99,\s*default:\s*1\s*\}/);
  assert.match(inputSchema(resolve), /required:\s*\["proposalId",\s*"decision"\]/);
  assert.match(inputSchema(resolve), /decision:\s*\{\s*type:\s*"string",\s*enum:\s*\["accept",\s*"reject"\]\s*\}/);
  assert.doesNotMatch(source, /name:\s*"render_template_preview"/);
});

test("add_to_cart returns without blocking and refuses to stack proposals", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  const cart = toolDefinition(source, "addToCart");
  assert.match(cart, /state\.pendingProposal/);
  assert.match(cart, /resolve_cart_proposal first/);
  assert.match(toolDefinition(source, "resolveCartProposal"), /getStorefrontWebMcpState\(\)\.pendingProposal/);
});

test("manage_cart view works on an empty demo cart while mutations still refuse", async () => {
  const definition = toolDefinition(await read("src/webmcp/tools/storefront.ts"), "manageCart");
  assert.match(definition, /input\.action !== "view" && getStorefrontWebMcpState\(\)\.cartItemCount === 0/);
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
    ["askStorefront", "findPrints", "configurePrint", "addToCart", "resolveCartProposal", "manageCart"],
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
  assert.match(addToCart, /state\.pendingProposal/);
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

  assert.match(ui, /onOpenCart=\{\(\) => setCartOpen\(true\)\}/);
  assert.match(ui, /open=\{cartOpen\}/);
  // No persistent cart lives in a page corner any more.
  assert.doesNotMatch(ui, /FloatingCartBar|fixed bottom-5 right-5/);
});

test("accepting a proposal acknowledges on the chip without opening the cart", async () => {
  const [masthead, ui] = await Promise.all([
    read("src/components/storefront/storefront-masthead.tsx"),
    read("src/components/storefront/manual-storefront.tsx"),
  ]);
  const resolve = ui.slice(ui.indexOf("function resolveProposal("), ui.indexOf("publishStorefrontWebMcpState({"));
  assert.ok(resolve.length > 0, "expected a resolveProposal body");
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
