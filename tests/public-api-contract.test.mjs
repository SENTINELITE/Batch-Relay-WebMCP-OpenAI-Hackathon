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
    "listTemplates",
    "listTemplateOutputs",
    "getTemplateOutputContract",
    "createTemplateRender",
    "getBrowserTemplatePreview",
    "createBrowserTemplatePreview",
    "getBrowserTemplatePreviewAssetContent",
    "getBrowserTemplatePreviewRender",
    "getBrowserTemplatePreviewArtifactContent",
  ]) {
    assert.match(source, new RegExp(`\\"${operation}\\"`));
  }
  assert.match(source, /paidShopperCheckoutPublished/);
  assert.doesNotMatch(source, /paidShopperCheckoutPublished:\s*true/);
  assert.match(source, /\/v1\/studios\/\{studio_id\}\/templates/);
  assert.match(source, /\/v1\/studios\/\{studio_id\}\/templates\/\{template_id\}\/outputs/);
  assert.match(source, /\/v1\/templates\/\{template_id\}\/outputs\/\{output_id\}\/contract/);
  assert.match(source, /\/v1\/templates\/\{template_id\}\/outputs\/\{output_id\}\/browser-preview/);
  assert.match(source, /\/v1\/templates\/\{template_id\}\/outputs\/\{output_id\}\/browser-preview\/assets\/\{asset_ref\}\/content/);
  assert.match(source, /\/v1\/browser-previews\/\{render_id\}/);
  assert.match(source, /query: \["cursor", "limit", "status"\]/);
  assert.match(source, /query: \["revision_id"\]/);
});
