import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("WebMCP exposes the approved tray-first storefront tools and no checkout tool", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  for (const stableKey of [
    "storefront.ask",
    "storefront.find_prints",
    "storefront.prepare_print_images",
    "storefront.revise_prints",
    "storefront.propose_prints",
    "storefront.add_to_cart",
    "storefront.resolve_cart_proposal",
    "storefront.manage_cart",
  ]) assert.match(source, new RegExp(`stableKey: \\"${stableKey.replaceAll(".", "\\.")}\\"`));
  assert.doesNotMatch(source, /stableKey:\s*["'][^"']*checkout/);
  assert.doesNotMatch(source, /storefront\.render_template_preview|storefront\.prepare_sandbox_order/);
});

test("WebMCP preserves stable keys while exposing the tray-first wire contract", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  for (const toolName of [
    "ask_storefront",
    "find_prints",
    "configure_print",
    "revise_prints",
    "propose_prints",
    "add_to_cart",
    "resolve_cart_proposal",
    "manage_cart",
  ]) assert.match(source, new RegExp(`name: \\"${toolName}\\"`));
  assert.doesNotMatch(source, /name:\s*["'](?:request_server_proof|prepare_sandbox_order)["']/);
  assert.doesNotMatch(source, /name:\s*["']prepare_print_images["']/);
  assert.match(source, /trayRevision/);
  assert.match(source, /photoRefs/);
  assert.match(source, /slotPatches/);
  assert.match(source, /directCrop/);
  assert.doesNotMatch(source, /\b(?:slotAssignments|textValues)\b/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /BATCH_RELAY_API_TOKEN|Authorization/);
});

test("server credentials are Test Mode only and never enter browser code", async () => {
  const server = await read("src/lib/batch-relay/server.ts");
  const client = await read("src/lib/storefront/client.ts");
  assert.match(server, /startsWith\("br_test_"\)/);
  assert.doesNotMatch(client, /BATCH_RELAY_API_TOKEN|Authorization|br_test_/);
});

test("public print-order adapters never spend the studio credential", async () => {
  const routes = await Promise.all([
    read("src/app/api/print-orders/route.ts"),
    read("src/app/api/print-orders/quote/route.ts"),
    read("src/app/api/quotes/route.ts"),
    read("src/app/api/print-orders/[orderId]/route.ts"),
  ]);
  for (const route of routes) {
    assert.match(route, /authorization:\s*"anonymous"/);
    assert.doesNotMatch(route, /authorization:\s*"studio"|orderAuthorization|hasStudioTokenConfiguration/);
  }
});

test("the visible cart and checkout are a local browser demo", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const cartBar = await read("src/components/storefront/cart-sheet.tsx");
  const proposal = await read("src/components/storefront/cart-proposal-card.tsx");
  assert.match(cartBar, /Demo checkout — no order is placed and nothing is charged\./);
  assert.match(cartBar, /Confirm demo checkout/);
  for (const source of [cartBar, proposal]) {
    assert.doesNotMatch(source, /\bfetch\s*\(|storefrontClient/);
  }
  assert.doesNotMatch(ui, /submitSandboxOrder|storefrontClient\.quote\(/);
  assert.doesNotMatch(ui, /checkout[_ -]?intent/i);
});

test("the demo cart proposal card is picture-in-picture and shopper-resolved", async () => {
  const [ui, proposal, stack] = await Promise.all([
    read("src/components/storefront/manual-storefront.tsx"),
    read("src/components/storefront/cart-proposal-card.tsx"),
    read("src/components/storefront/cart-proposal-stack.tsx"),
  ]);
  assert.match(stack, /fixed bottom-5 left-5 z-50 w-\[min\(92vw,264px\)\]/);
  // The cart no longer occupies the opposite corner; it is a sheet on demand.
  assert.doesNotMatch(ui, /fixed bottom-5 right-5/);
  assert.match(proposal, /Add to cart/);
  assert.match(proposal, /Skip/);
  assert.match(ui, /status: "awaiting_shopper_confirmation"/);
  assert.match(ui, /resolve_cart_proposal/);
});

test("same-origin adapters use only published v1 operations", async () => {
  const server = await read("src/lib/batch-relay/server.ts");
  assert.match(server, /api\.batchrelay\.com/);
  assert.match(server, /EDGE_SESSION_PATH = "\/v1\/anonymous-sessions"/);
  assert.doesNotMatch(server, /storefront-checkout-intents|stripe/i);
});
