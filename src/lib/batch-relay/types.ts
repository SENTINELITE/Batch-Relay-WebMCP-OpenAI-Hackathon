/**
 * Public Batch Relay OpenAPI projections used by this storefront.
 *
 * Source: https://api.batchrelay.com/openapi.json. Fields not needed by this
 * application are deliberately omitted rather than guessed.
 */

export type BatchRelayError = {
  error: string;
  code: string;
  message: string;
  docs_url: string;
  request_id: string;
};

export type ProductFamilyReference = {
  id: string;
  name: string;
};

export type ProductOption = {
  id: string;
  name: string;
  values: string[];
  default_value: string;
  affects_price: boolean;
};

export type UnitCost = {
  option_values: Array<{ option_id: string; value: string }>;
  unit_cost_cents: number | null;
  pricing_status: "unverified" | "sandbox_quote" | "production_verified";
};

export type Product = {
  id: string;
  revision: number;
  name: string;
  description: string;
  family: ProductFamilyReference;
  variant_attributes: Record<string, string>;
  category: "prints" | "keepsakes" | "trader-products" | "composites" | "digital-downloads";
  fulfillment_type: "print" | "digital";
  tax_category: "physical_print" | "digital_download";
  physical_output?: { width: number; height: number; unit: "inches" };
  units_per_quantity: number;
  options: ProductOption[];
  unit_costs: UnitCost[];
  asset_requirements: Array<{
    role: string;
    aspect_ratio: { width: number; height: number };
    required: boolean;
    rotation_policy: "fixed" | "allowed";
  }>;
  template_requirement: "required" | "optional" | "unsupported";
  lifecycle: { status: "active" | "deprecated"; replacement_product_id?: string };
};

export type ProductList = {
  catalog_revision: string;
  checksum: string;
  families: Array<{
    id: string;
    name: string;
    variants: Array<{ product: { id: string; revision: number }; attributes: Record<string, string> }>;
  }>;
  products: Product[];
};

export type ProviderOffer = {
  id: string;
  product: { id: string; revision: number };
  configuration: Record<string, string>;
  provider_id: "whcc" | "rpl";
  availability: "available" | "unavailable" | "unknown";
  fulfillment_constraints: {
    fulfillment_group: string;
    shipping_services?: Array<"economy_untracked" | "economy" | "expedited" | "standard_one_day" | "priority_one_day">;
    requirements?: string[];
  };
  currency?: "USD";
  unit_cost_cents?: number;
  pricing_revision?: string;
};

export type ProviderOfferList = {
  product: { id: string; revision: number };
  offers: ProviderOffer[];
};

export type DiscoveredTemplate = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type TemplatePage = {
  items: DiscoveredTemplate[];
  next_cursor?: string | null;
  is_done: boolean;
};

export type TemplateOutput = {
  id: string;
  label?: string;
  ordinal: number;
  products: Array<{
    canonical_product_id: string;
    canonical_product_revision: number;
    family_id?: string;
    family_name?: string;
    variant_attributes?: Record<string, string>;
    category?: string;
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

export type TemplateRenderInput =
  | { asset_id: string; value?: never }
  | { value: string; asset_id?: never };

export type TemplateRenderCreateRequest = {
  revision_id?: string;
  output_id: string;
  inputs: Record<string, TemplateRenderInput>;
};

export type TemplateRender = {
  render_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  template: {
    id: string;
    revision_id: string;
    template_engine_version: string;
    document_hash?: string;
  };
  output_id: string;
  artifacts: Array<{
    surface_id: string;
    fulfillment_role: string;
    asset_id: string;
    pixel_width: number;
    pixel_height: number;
    dpi?: number;
    sha256?: string;
    resolved_orientation?: string;
  }>;
  created_at: string;
  updated_at: string;
};

export type TemplateOutputContract = {
  template: {
    id: string;
    revision_id: string;
    revision_number: number;
    document_hash: string;
    template_engine_version: string;
  };
  output: {
    id: string;
    label?: string;
    ordinal: number;
    surfaces: Array<{
      id: string;
      variant_id: string;
      label?: string;
      fulfillment_role: string;
      ordinal: number;
      canonical_product_id: string;
      canonical_product_revision: number;
      width_in: number;
      height_in: number;
      dpi: number;
    }>;
  };
  slots: Array<{
    key: string;
    kind: string;
    ordinal: number;
    required: boolean;
    suggested_label?: string;
    suggested_semantic_key?: string;
    expected_aspect_ratio?: { width: number; height: number };
    minimum_effective_ppi?: number;
    max_length?: number;
  }>;
};

export type ManagedAssetIngestRequest =
  | { url: string; asset_id?: never; original_filename?: string }
  | { asset_id: string; url?: never; original_filename?: string };

export type IngestedAsset = {
  asset_id: string;
  storage_scope: "studio" | "fulfillment";
  byte_size: number;
  content_type: "image/jpeg" | "image/png" | "image/tiff";
  format: "jpeg" | "png" | "tiff";
  pixel_width: number;
  pixel_height: number;
  sha256: string;
  original_filename: string;
  reused: boolean;
};

export type OrderAddress = {
  name: string;
  address_1: string;
  address_2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string;
};

export type OrderRequest = {
  schema_version: 1;
  external_order_id: string;
  customer?: ({ external_id?: string; name?: string; email: string; phone?: string } | { external_id?: string; name?: string; email?: string; phone: string });
  ship_to: OrderAddress;
  ship_from: OrderAddress;
  shipping_service: "economy_untracked" | "economy" | "expedited" | "standard_one_day" | "priority_one_day";
  items: Array<{
    product: { id: string; revision: number };
    quantity: number;
    options?: Array<{ option_id: string; value: string }>;
    assets: Array<({
      role: "artwork" | "background" | "individual" | "team" | "logo" | "front" | "back";
      url: string;
      asset_id?: never;
    } | {
      role: "artwork" | "background" | "individual" | "team" | "logo" | "front" | "back";
      asset_id: string;
      url?: never;
    }) & {
      template_render_id?: string;
      pixel_width?: number;
      pixel_height?: number;
      file_size_bytes?: number;
      format?: "jpeg" | "png" | "tiff";
      hash?: string;
      printed_file_name?: string;
      origin?: {
        kind?: "whcc-preset" | "batch-relay-design" | "studio-design" | "community-design" | "custom-upload";
        design_id?: string;
        design_version?: number;
      };
    }>;
    texts?: Array<{ slot: string; value: string }>;
  }>;
};

export type QuoteAPIOrderRequest = {
  routing:
    | { mode: "studio_default"; provider_id?: never; allow_split?: never }
    | { mode: "single_provider"; provider_id: "whcc" | "rpl"; allow_split?: never }
    | { mode: "best_available"; allow_split: true; provider_id?: never };
  acknowledgements?: string[];
  order: OrderRequest;
};

export type PriceBreakdown = {
  policy_id: string;
  currency: "USD";
  merchandise_cents: number;
  shipping_cents: number;
  platform_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  fee_base_cents: number;
  platform_fee_label: string;
  platform_fee_basis_points: number;
  minimum_fee_cents: number;
};

export type APIOrderQuote = {
  id: string;
  api_account_id: string;
  environment: "staging" | "production";
  expires_at: string;
  channel: "api";
  merchant_of_record: "batch_relay";
  price: PriceBreakdown;
  provider: {
    provider_id: "whcc" | "rpl";
    provider_selection_source: "explicit" | "event" | "account_default" | "legacy_default";
    provider_environment: "sandbox" | "production";
    provider_availability: "preview" | "sandbox_verified" | "production_verified" | "unavailable";
    provider_capability_revision: string;
    provider_recipe_revision: string;
  };
  provider_offer_lines: Array<{
    offer_id: string;
    provider_id: "whcc" | "rpl";
    product: { id: string; revision: number };
    configuration: Record<string, string>;
    currency: "USD";
    unit_cost_cents: number;
    quantity: number;
    line_subtotal_cents: number;
    availability: "available";
    pricing_revision: string;
  }>;
};

export type SubmitAPIOrderRequest = {
  quote_id: string;
  integration_source?: "direct_api" | "zapier" | "n8n" | "custom_code";
  order: OrderRequest;
};

export type APIOrder = Omit<APIOrderQuote, "id" | "expires_at"> & {
  id: string;
  order_code: string;
  external_order_id: string;
  quote_id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type AnonymousSessionView = {
  environment: "sandbox";
  expires_at: string;
  scopes: ["print_orders:read", "print_orders:write", "usage:read"];
};
