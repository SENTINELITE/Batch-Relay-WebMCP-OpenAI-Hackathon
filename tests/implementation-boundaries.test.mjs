import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("WebMCP exposes the approved storefront tools and no checkout tool", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  for (const stableKey of [
    "storefront.ask",
    "storefront.find_prints",
    "storefront.prepare_print_images",
    "storefront.render_template_preview",
    "storefront.add_to_cart",
    "storefront.manage_cart",
    "storefront.prepare_sandbox_order",
  ]) assert.match(source, new RegExp(`stableKey: \\"${stableKey.replaceAll(".", "\\.")}\\"`));
  assert.doesNotMatch(source, /stableKey:\s*["'][^"']*checkout/);
});

test("server credentials are Test Mode only and never enter browser code", async () => {
  const server = await read("src/lib/batch-relay/server.ts");
  const client = await read("src/lib/storefront/client.ts");
  assert.match(server, /startsWith\("br_test_"\)/);
  assert.doesNotMatch(client, /BATCH_RELAY_API_TOKEN|Authorization|br_test_/);
});

test("the visible checkout boundary stays sandbox-only", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(ui, /Place no-charge sandbox order/);
  assert.match(ui, /Production checkout is disabled/);
  assert.match(ui, /storefrontClient\.submitSandboxOrder/);
  assert.doesNotMatch(ui, /checkout[_ -]?intent/i);
});

test("same-origin adapters use only published v1 operations", async () => {
  const server = await read("src/lib/batch-relay/server.ts");
  assert.match(server, /api\.batchrelay\.com/);
  assert.match(server, /EDGE_SESSION_PATH = "\/v1\/anonymous-sessions"/);
  assert.doesNotMatch(server, /storefront-checkout-intents|stripe/i);
});
