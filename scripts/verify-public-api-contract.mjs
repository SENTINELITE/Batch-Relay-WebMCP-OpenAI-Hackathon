const baseURL = (process.env.BATCH_RELAY_API_BASE_URL || "https://api.batchrelay.com").replace(/\/$/, "");
const response = await fetch(`${baseURL}/openapi.json`, {
  headers: { accept: "application/json" },
});

if (!response.ok) {
  throw new Error(`Could not fetch the Batch Relay OpenAPI document: HTTP ${response.status}`);
}

const document = await response.json();
if (document.openapi !== "3.1.0") {
  throw new Error(`Expected OpenAPI 3.1.0, received ${String(document.openapi)}`);
}

const operations = new Set();
for (const pathItem of Object.values(document.paths || {})) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operationId = pathItem?.[method]?.operationId;
    if (typeof operationId === "string") operations.add(operationId);
  }
}

const required = [
  { operationId: "listCatalogProducts", method: "get", path: "/v1/catalog/products" },
  { operationId: "getCatalogProduct", method: "get", path: "/v1/catalog/products/{product_id}" },
  { operationId: "listCatalogProductOffers", method: "get", path: "/v1/catalog/products/{product_id}/offers" },
  { operationId: "createAnonymousSession", method: "post", path: "/v1/anonymous-sessions" },
  { operationId: "ingestManagedAsset", method: "post", path: "/v1/assets/ingest" },
  { operationId: "quoteAPIPrintOrder", method: "post", path: "/v1/print-orders/quote" },
  { operationId: "submitAPIPrintOrder", method: "post", path: "/v1/print-orders" },
  { operationId: "getAPIPrintOrder", method: "get", path: "/v1/print-orders/{order_id}" },
  { operationId: "listTemplates", method: "get", path: "/v1/studios/{studio_id}/templates", query: ["cursor", "limit", "status"] },
  { operationId: "listTemplateOutputs", method: "get", path: "/v1/studios/{studio_id}/templates/{template_id}/outputs", query: ["revision_id"] },
  { operationId: "getTemplateOutputContract", method: "get", path: "/v1/templates/{template_id}/outputs/{output_id}/contract", query: ["revision_id"] },
  { operationId: "createTemplateRender", method: "post", path: "/v1/templates/{template_id}/renders" },
  { operationId: "getTemplateRender", method: "get", path: "/v1/renders/{render_id}" },
  { operationId: "getBrowserTemplatePreview", method: "get", path: "/v1/templates/{template_id}/outputs/{output_id}/browser-preview", query: ["revision_id"] },
  { operationId: "createBrowserTemplatePreview", method: "post", path: "/v1/templates/{template_id}/outputs/{output_id}/browser-preview", query: ["revision_id"] },
  { operationId: "getBrowserTemplatePreviewAssetContent", method: "get", path: "/v1/templates/{template_id}/outputs/{output_id}/browser-preview/assets/{asset_ref}/content", query: ["revision_id"] },
  { operationId: "getBrowserTemplatePreviewRender", method: "get", path: "/v1/browser-previews/{render_id}" },
  { operationId: "getBrowserTemplatePreviewArtifactContent", method: "get", path: "/v1/browser-previews/{render_id}/artifacts/{artifact_id}/content" },
  { operationId: "reserveStudioAssetUploadSession", method: "post", path: "/v1/studio-assets/sessions" },
  { operationId: "uploadReservedStudioAsset", method: "put", path: "/v1/studio-assets/sessions/{session_id}/assets/{asset_id}" },
];

function resolvedParameters(pathItem, operation) {
  return [...(pathItem.parameters || []), ...(operation.parameters || [])]
    .map((parameter) => parameter.$ref ? document.components?.parameters?.[parameter.$ref.split("/").at(-1)] : parameter)
    .filter((parameter) => parameter && typeof parameter.name === "string");
}

const contractFailures = [];
for (const expected of required) {
  const pathItem = document.paths?.[expected.path];
  const operation = pathItem?.[expected.method];
  if (operation?.operationId !== expected.operationId) {
    contractFailures.push(`${expected.operationId} must be ${expected.method.toUpperCase()} ${expected.path}`);
    continue;
  }
  const actualQuery = resolvedParameters(pathItem, operation)
    .filter((parameter) => parameter.in === "query")
    .map((parameter) => parameter.name)
    .sort();
  const expectedQuery = [...(expected.query || [])].sort();
  if (actualQuery.join(",") !== expectedQuery.join(",")) {
    contractFailures.push(`${expected.operationId} query parameters must be ${expectedQuery.join(",") || "none"}`);
  }
}
if (contractFailures.length > 0) {
  throw new Error(`The Batch Relay public API contract changed: ${contractFailures.join("; ")}`);
}

const paidShopperOperations = [
  "createStorefrontCheckoutIntent",
  "createShopperCheckoutIntent",
  "createPublicCheckoutSession",
].filter((operation) => operations.has(operation));

console.log(JSON.stringify({
  api: baseURL,
  openapi: document.openapi,
  requiredOperations: required.length,
  paidShopperCheckoutPublished: paidShopperOperations.length > 0,
  paidShopperOperations,
}, null, 2));
