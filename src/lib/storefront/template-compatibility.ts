import type { CatalogProduct, TemplateOutput } from "./client";

/**
 * A template output is eligible only when the API associates it with the exact
 * canonical catalog product revision selected by the shopper. Dimensions and
 * names are presentation metadata, never compatibility keys.
 */
export function compatibleTemplateOutputs(
  outputs: TemplateOutput[],
  product: Pick<CatalogProduct, "id" | "revision">,
): TemplateOutput[] {
  return outputs.filter((output) => output.products.some((candidate) =>
    candidate.canonical_product_id === product.id &&
    candidate.canonical_product_revision === product.revision));
}

export function compatibleOutputVariantSummary(
  output: TemplateOutput,
  product: Pick<CatalogProduct, "id" | "revision">,
): string {
  const variants = output.products.filter((candidate) =>
    candidate.canonical_product_id === product.id &&
    candidate.canonical_product_revision === product.revision);
  return variants.map((variant) => variant.orientation).filter(Boolean).join(", ");
}

const unconfirmedPlaqueCanonicalProductIDs = new Set([
  "contemporary-plaque-5x7",
  "contemporary-plaque-8x10",
]);

/**
 * Preserve every returned print product without inferring product families from
 * names, dimensions, or categories. The two known unconfirmed plaque IDs are
 * deliberately withheld until WHCC publishes a confirmed public contract.
 */
export function visibleStorefrontProducts(products: CatalogProduct[]): CatalogProduct[] {
  return products.filter((product) =>
    product.fulfillment_type === "print" &&
    !unconfirmedPlaqueCanonicalProductIDs.has(product.id));
}
