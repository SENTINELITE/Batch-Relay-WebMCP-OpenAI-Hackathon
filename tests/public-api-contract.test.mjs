import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptURL = new URL("../scripts/verify-public-api-contract.mjs", import.meta.url);

test("the contract verifier checks real Batch Relay operations", async () => {
  const source = await readFile(scriptURL, "utf8");
  for (const operation of [
    "listCatalogProducts",
    "createAnonymousSession",
    "quoteAPIPrintOrder",
    "submitAPIPrintOrder",
    "createTemplateRender",
  ]) {
    assert.match(source, new RegExp(`\\"${operation}\\"`));
  }
  assert.match(source, /paidShopperCheckoutPublished/);
  assert.doesNotMatch(source, /paidShopperCheckoutPublished:\s*true/);
});
