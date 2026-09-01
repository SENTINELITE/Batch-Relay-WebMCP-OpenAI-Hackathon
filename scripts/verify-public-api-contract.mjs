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
  "listCatalogProducts",
  "getCatalogProduct",
  "listCatalogProductOffers",
  "createAnonymousSession",
  "ingestManagedAsset",
  "quoteAPIPrintOrder",
  "submitAPIPrintOrder",
  "getAPIPrintOrder",
  "listTemplates",
  "listTemplateOutputs",
  "getTemplateOutputContract",
  "createTemplateRender",
  "getTemplateRender",
  "reserveStudioAssetUploadSession",
  "uploadReservedStudioAsset",
];

const missing = required.filter((operation) => !operations.has(operation));
if (missing.length > 0) {
  throw new Error(`The Batch Relay public API is missing required operations: ${missing.join(", ")}`);
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
