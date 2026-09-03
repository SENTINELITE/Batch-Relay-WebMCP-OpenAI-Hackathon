import type { BrowserPreviewDocument, BrowserPreviewRender } from "./browser-preview";

export type ApiError = {
  code?: string;
  message?: string;
  error?: string;
  request_id?: string;
};

const browserPreviewAssetContentPath = /^\/v1\/templates\/[^/?#]+\/outputs\/[^/?#]+\/browser-preview\/assets\/[^/?#]+\/content$/;

/**
 * Browser-preview assets are API-issued opaque handles. Only turn the
 * published relative content path into its same-origin storefront proxy; raw
 * asset_ref values are deliberately never used to reconstruct this URL.
 */
export function browserPreviewAssetProxyURL(contentURL: string): string | null {
  if (!contentURL.startsWith("/") || contentURL.startsWith("//")) return null;
  const parsed = new URL(contentURL, "https://browser-preview.invalid");
  if (parsed.origin !== "https://browser-preview.invalid" || parsed.hash || !browserPreviewAssetContentPath.test(parsed.pathname)) return null;
  const revisionIDs = parsed.searchParams.getAll("revision_id");
  if (revisionIDs.length !== 1 || !revisionIDs[0] || [...parsed.searchParams.keys()].some((key) => key !== "revision_id")) return null;
  return `/api${parsed.pathname.slice(3)}?revision_id=${encodeURIComponent(revisionIDs[0])}`;
}

export type CatalogProduct = {
  id: string;
  revision: number;
  name: string;
  description: string;
  category: string;
  fulfillment_type: string;
  template_requirement: "required" | "optional" | "unsupported";
  physical_output?: {
    width: number;
    height: number;
    unit: "inches";
  };
  variant_attributes?: Record<string, unknown>;
  options: Array<{
    id: string;
    name: string;
    values: string[];
    default_value: string;
    affects_price: boolean;
  }>;
  asset_requirements: Array<{
    role: "artwork" | "background" | "individual" | "team" | "logo" | "front" | "back";
    aspect_ratio: { width: number; height: number };
    required: boolean;
    rotation_policy: "fixed" | "allowed";
  }>;
};

export type CatalogResponse = {
  catalog_revision: string;
  checksum: string;
  products: CatalogProduct[];
};

export type IngestedAsset = {
  asset_id: string;
  pixel_width: number;
  pixel_height: number;
  format: string;
  original_filename: string;
  reused: boolean;
};

export type SandboxSession = {
  environment: "sandbox";
  expires_at: string;
  scopes: string[];
};

export type SandboxQuote = {
  id: string;
  expires_at: string;
  environment: string;
  price?: {
    currency?: string;
    total_cents?: number;
    merchandise_cents?: number;
    shipping_cents?: number;
    tax_cents?: number;
  };
};

export type SandboxOrder = {
  id: string;
  order_code: string;
  external_order_id: string;
  quote_id: string;
  environment: "staging";
  status: string;
  created_at: string;
  updated_at: string;
};

export type ProviderOffer = {
  id: string;
  provider_id: "whcc" | "rpl";
  availability: "available" | "unavailable" | "unknown";
  configuration: Record<string, string>;
  fulfillment_constraints: {
    fulfillment_group: string;
    shipping_services?: string[];
  };
  currency?: "USD";
  unit_cost_cents?: number;
  pricing_revision?: string;
};

export type PublishedTemplate = {
  id: string;
  name?: string;
  status?: string;
};

export type TemplateOutput = {
  id: string;
  label?: string;
  ordinal: number;
  products: Array<{
    canonical_product_id: string;
    canonical_product_revision: number;
    width_in: number;
    height_in: number;
    orientation: string;
  }>;
};

export type TemplateOutputs = {
  template_id: string;
  revision_id: string;
  revision_number: number;
  outputs: TemplateOutput[];
};

export type TemplateContract = {
  template: { id: string; revision_id: string; revision_number: number };
  output: {
    id: string;
    label?: string;
    ordinal: number;
    /** The API's own surface/variant pairing for this output id. */
    surfaces?: Array<{
      id: string;
      variant_id: string;
      label?: string;
      fulfillment_role?: "artwork" | "front" | "back";
      ordinal?: number;
      width_in?: number;
      height_in?: number;
    }>;
  };
  slots: Array<{
    key: string;
    kind: "image" | "text";
    ordinal: number;
    required: boolean;
    suggested_label?: string;
    suggested_semantic_key?: string;
    max_length?: number;
    expected_aspect_ratio?: { width: number; height: number };
  }>;
};

export type TemplateRender = {
  render_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  output_id: string;
  template: { id: string; revision_id: string };
  artifacts: Array<{
    surface_id: string;
    fulfillment_role: "artwork" | "front" | "back";
    asset_id: string;
    pixel_width: number;
    pixel_height: number;
  }>;
  created_at: string;
  updated_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) {
    const detail = payload.message ?? payload.error ?? `Request failed with ${response.status}.`;
    throw new Error(payload.code ? `${payload.code}: ${detail}` : detail);
  }
  return payload;
}

// These are same-origin façades. Server routes own credentials and translate only
// published OpenAPI operations; browser code never receives a Batch Relay token.
export const storefrontClient = {
  catalog: () => request<CatalogResponse>("/api/catalog/products"),
  offers: (productId: string) => request<{ offers: ProviderOffer[] }>(`/api/catalog/products/${encodeURIComponent(productId)}/offers`),
  createSandboxSession: () => request<SandboxSession>("/api/anonymous-session", { method: "POST" }),
  ingestAsset: (url: string) =>
    request<IngestedAsset>("/api/assets/ingest", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  uploadStudioAsset: (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return request<{ asset_id: string }>("/api/studio-assets/upload", { method: "POST", body });
  },
  quote: (body: unknown) => request<SandboxQuote>("/api/quotes", { method: "POST", body: JSON.stringify(body) }),
  submitSandboxOrder: (body: unknown) =>
    request<SandboxOrder>("/api/print-orders", { method: "POST", body: JSON.stringify(body) }),
  templates: () => request<{ items: PublishedTemplate[] }>("/api/templates?status=active"),
  templateOutputs: (templateId: string) =>
    request<TemplateOutputs>(`/api/templates/${encodeURIComponent(templateId)}/outputs`),
  templateContract: (templateId: string, outputId: string, revisionId: string) =>
    request<TemplateContract>(`/api/templates/${encodeURIComponent(templateId)}/outputs/${encodeURIComponent(outputId)}/contract?revision_id=${encodeURIComponent(revisionId)}`),
  createTemplateRender: (
    templateId: string,
    body: { revision_id: string; output_id: string; inputs: Record<string, { asset_id: string } | { value: string }> },
  ) => request<TemplateRender>(`/api/templates/${encodeURIComponent(templateId)}/renders`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  }),
  templateRender: (renderId: string) =>
    request<TemplateRender>(`/api/renders/${encodeURIComponent(renderId)}`),
  browserPreviewDocument: (templateId: string, outputId: string, revisionId: string) =>
    request<BrowserPreviewDocument>(`/api/templates/${encodeURIComponent(templateId)}/outputs/${encodeURIComponent(outputId)}/browser-preview?revision_id=${encodeURIComponent(revisionId)}`),
  createBrowserPreview: (
    templateId: string,
    outputId: string,
    body: { revision_id: string; output_id: string; inputs: Record<string, { asset_id: string } | { value: string }> },
  ) => request<BrowserPreviewRender>(`/api/templates/${encodeURIComponent(templateId)}/outputs/${encodeURIComponent(outputId)}/browser-preview?revision_id=${encodeURIComponent(body.revision_id)}`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  }),
  browserPreview: (renderId: string) =>
    request<BrowserPreviewRender>(`/api/browser-previews/${encodeURIComponent(renderId)}`),
  browserPreviewArtifactURL: (renderId: string, artifactId: string) =>
    `/api/browser-previews/${encodeURIComponent(renderId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
  browserPreviewAssetProxyURL,
};
