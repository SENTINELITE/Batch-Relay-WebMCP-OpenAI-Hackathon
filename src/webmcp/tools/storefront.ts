import { defineTool } from "@nekuda/webmcp-sdk";

import {
  getStorefrontWebMcpState,
  requestStorefrontWebMcpAction,
} from "../storefront-bridge";

type AskStorefrontInput = {
  question: string;
};

type FindPrintsInput = {
  query?: string;
  productType?: string;
  maxResults?: number;
};

type PreparePrintImagesInput = {
  imageIds: string[];
  productId?: string;
};

type RenderTemplatePreviewInput = {
  templateId: string;
  revisionId?: string;
  outputId?: string;
  inputs?: Record<string, { asset_id: string } | { value: string }>;
};

type AddToCartInput = {
  productId: string;
  offerId?: string;
  quantity?: number;
};

type ManageCartInput = {
  action: "view" | "update_quantity" | "remove" | "clear";
  itemId?: string;
  quantity?: number;
};

type PrepareSandboxOrderInput = {
  shippingPostalCode?: string;
};

function requireVisibleCapability(capability: boolean, action: string): void {
  if (!capability) {
    throw new Error(`The visible storefront is not ready to ${action}.`);
  }
}

export const askStorefront = defineTool<AskStorefrontInput>({
  stableKey: "storefront.ask",
  name: "ask_storefront",
  title: "Ask the storefront",
  description:
    "Use when a shopper asks about the storefront's currently visible catalog, print flow, or sandbox limitations. Returns the storefront's grounded answer and any visible navigation or next-step guidance.",
  inputSchema: {
    type: "object",
    properties: { question: { type: "string", minLength: 1 } },
    required: ["question"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute(input) {
    return requestStorefrontWebMcpAction("ask_storefront", input);
  },
});

export const findPrints = defineTool<FindPrintsInput>({
  stableKey: "storefront.find_prints",
  name: "find_prints",
  title: "Find print products",
  description:
    "Use when a shopper wants to browse or narrow the currently available print catalog. Returns matching visible print products and offers, or an explicit no-matches result.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
      productType: { type: "string", minLength: 1 },
      maxResults: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute(input) {
    return requestStorefrontWebMcpAction("find_prints", input);
  },
});

export const preparePrintImages = defineTool<PreparePrintImagesInput>({
  stableKey: "storefront.prepare_print_images",
  name: "prepare_print_images",
  title: "Prepare print images",
  description:
    "Use after the shopper has selected visible images and needs them prepared for a print choice. Returns the visible preparation result, including any image-specific requirements or errors; it does not upload arbitrary files or call third parties.",
  inputSchema: {
    type: "object",
    properties: {
      imageIds: {
        type: "array",
        minItems: 1,
        items: { type: "string", minLength: 1 },
      },
      productId: { type: "string", minLength: 1 },
    },
    required: ["imageIds"],
    additionalProperties: false,
  },
  annotations: { untrustedContentHint: true },
  async execute(input) {
    requireVisibleCapability(getStorefrontWebMcpState().canPreparePrintImages, "prepare print images");
    return requestStorefrontWebMcpAction("prepare_print_images", input);
  },
});

export const renderTemplatePreview = defineTool<RenderTemplatePreviewInput>({
  stableKey: "storefront.render_template_preview",
  name: "render_template_preview",
  title: "Render a template preview",
  description:
    "Use when a shopper has a visible studio template and wants a preview before adding a print, including text-node or image-slot customization. Returns the visible preview or render status and any template-input requirements; it never invents template data.",
  inputSchema: {
    type: "object",
    properties: {
      templateId: { type: "string", minLength: 1 },
      revisionId: { type: "string", minLength: 1 },
      outputId: { type: "string", minLength: 1 },
      inputs: {
        type: "object",
        additionalProperties: {
          oneOf: [
            {
              type: "object",
              properties: { asset_id: { type: "string", minLength: 1 } },
              required: ["asset_id"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ["templateId"],
    additionalProperties: false,
  },
  annotations: { untrustedContentHint: true },
  async execute(input) {
    requireVisibleCapability(
      getStorefrontWebMcpState().canRenderTemplatePreview,
      "render a template preview",
    );
    return requestStorefrontWebMcpAction("render_template_preview", input);
  },
});

export const addToCart = defineTool<AddToCartInput>({
  stableKey: "storefront.add_to_cart",
  name: "add_to_cart",
  title: "Add a prepared print to cart",
  description:
    "Use when the visible storefront has a configured print that the shopper wants to add to the cart. Returns the updated visible cart state; it does not start checkout, charge a card, or create an order.",
  inputSchema: {
    type: "object",
    properties: {
      productId: { type: "string", minLength: 1 },
      offerId: { type: "string", minLength: 1 },
      quantity: { type: "integer", minimum: 1, maximum: 99, default: 1 },
    },
    required: ["productId"],
    additionalProperties: false,
  },
  async execute(input) {
    requireVisibleCapability(getStorefrontWebMcpState().canAddToCart, "add this print to the cart");
    return requestStorefrontWebMcpAction("add_to_cart", input);
  },
});

export const manageCart = defineTool<ManageCartInput>({
  stableKey: "storefront.manage_cart",
  name: "manage_cart",
  title: "Manage cart",
  description:
    "Use when the shopper wants to view, update, remove, or clear items already in the visible cart. Returns the resulting visible cart state and does not initiate checkout, payment, or an order.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["view", "update_quantity", "remove", "clear"] },
      itemId: { type: "string", minLength: 1 },
      quantity: { type: "integer", minimum: 1, maximum: 99 },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async execute(input) {
    if (getStorefrontWebMcpState().cartItemCount === 0) {
      throw new Error("The visible cart is empty.");
    }
    if ((input.action === "update_quantity" || input.action === "remove") && !input.itemId) {
      throw new Error(`${input.action} requires a visible cart item ID.`);
    }
    if (input.action === "update_quantity" && !input.quantity) {
      throw new Error("update_quantity requires a quantity.");
    }
    return requestStorefrontWebMcpAction("manage_cart", input);
  },
});

export const prepareSandboxOrder = defineTool<PrepareSandboxOrderInput>({
  stableKey: "storefront.prepare_sandbox_order",
  name: "prepare_sandbox_order",
  title: "Prepare sandbox order review",
  description:
    "Use when the visible cart is ready for a Batch Relay Test Mode review or quote. Returns only the visible sandbox review or quote state. It cannot charge a card or create a production order.",
  inputSchema: {
    type: "object",
    properties: {
      shippingPostalCode: { type: "string", minLength: 1, maxLength: 32 },
    },
    additionalProperties: false,
  },
  async execute(input) {
    if (getStorefrontWebMcpState().cartItemCount === 0) {
      throw new Error("Add a visible cart item before preparing a sandbox review or quote.");
    }

    const result = await requestStorefrontWebMcpAction("prepare_sandbox_order", input);
    return {
      sandboxOnly: true,
      productionOrderCreated: false,
      paymentCharged: false,
      result,
    };
  },
});
