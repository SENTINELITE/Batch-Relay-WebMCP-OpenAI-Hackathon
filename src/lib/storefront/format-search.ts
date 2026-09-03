/**
 * Pure text matching for the catalog chooser's search box.
 *
 * This backs the *declarative* WebMCP tool on the format picker form
 * (`toolname="search-print-formats"`): the same function filters the visible
 * grid when a shopper types and produces the text an agent gets back, so the
 * two paths can never disagree. Kept free of React so it can be unit tested.
 */

export type SearchableFormat = {
  id: string;
  name: string;
  revision?: number;
  physical_output?: { width: number; height: number; unit?: string };
};

/**
 * Shoppers and agents say sizes many ways: "8 by 10", "8 x 10", "8×10".
 * Fold all of them onto "8x10", then reduce everything else to
 * space-separated alphanumerics so substring matching is predictable.
 */
export function normalizeFormatText(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d)\s*(?:by|x|×|\*)\s*(\d)/g, "$1x$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function formatSizeLabel(product: SearchableFormat): string {
  const output = product.physical_output;
  return output ? `${output.width} × ${output.height}` : "Print";
}

/** The text a query is matched against: name, id, and printed size. */
export function formatHaystack(product: SearchableFormat): string {
  return normalizeFormatText(`${product.name} ${product.id} ${formatSizeLabel(product)}`);
}

export function matchesFormatQuery(product: SearchableFormat, query: string): boolean {
  const tokens = normalizeFormatText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = formatHaystack(product);
  return tokens.every((token) => haystack.includes(token));
}

/** An empty or whitespace-only query returns the full list unchanged. */
export function filterFormats<T extends SearchableFormat>(products: T[], query: string): T[] {
  if (normalizeFormatText(query).length === 0) return products;
  return products.filter((product) => matchesFormatQuery(product, query));
}

/** The text result handed back to an agent that invoked the declarative form. */
export function describeFormatMatches(products: SearchableFormat[], query: string): string {
  const trimmed = query.trim();
  const matches = filterFormats(products, query);
  if (products.length === 0) {
    return "The catalog chooser has no print formats loaded yet.";
  }
  if (matches.length === 0) {
    return `No print format in the visible chooser matches "${trimmed}". Visible formats: ${products
      .map((product) => product.name)
      .join(", ")}.`;
  }
  const lines = matches.map(
    (product) => `- ${product.name} (${product.id}, ${formatSizeLabel(product)})`,
  );
  const heading = trimmed
    ? `${matches.length} of ${products.length} visible print formats match "${trimmed}":`
    : `All ${matches.length} visible print formats:`;
  return `${heading}\n${lines.join("\n")}`;
}
