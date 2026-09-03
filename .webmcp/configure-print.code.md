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

type PhotoRef = string | number;

type SlotPatch = {
  slotKey?: string;
  label?: string;
  operation: "assign" | "unassign" | "set_text" | "set_crop";
  photoRef?: PhotoRef;
  text?: string;
  zoom?: number;
  focusX?: number;
  focusY?: number;
  offsetX?: number;
  offsetY?: number;
};

type DirectCrop = {
  zoom?: number;
  focusX?: number;
  focusY?: number;
  offsetX?: number;
  offsetY?: number;
};

type ConfigurePrintInput = {
  draftId?: string;
  trayRevision: number;
  productId?: string;
  productQuery?: string;
  photoRefs?: PhotoRef[];
  templateId?: string;
  outputId?: string;
  orientation?: "portrait" | "landscape";
  slotPatches?: SlotPatch[];
  directCrop?: DirectCrop;
};

type RequestServerProofInput = {
  draftId: string;
};

type AddToCartInput = {
  draftId: string;
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

function requireCurrentTrayRevision(trayRevision: number | undefined): void {
  if (trayRevision === undefined) return;

  const visibleTrayRevision = getStorefrontWebMcpState().trayRevision;
  if (trayRevision !== visibleTrayRevision) {
    throw new Error(
      `The photo tray changed (visible revision ${visibleTrayRevision}); refresh the visible tray before continuing.`,
    );
  }
}

export const askStorefront = defineTool<AskStorefrontInput>({
  stableKey: "storefront.ask",
  name: "ask_storefront",
  title: "Ask the storefront",
  description:
    "Use when a shopper asks what photographs, print drafts, template choices, slot requirements, proof states, cart items, or sandbox limitations are currently visible. Returns grounded structured state and the next available action without changing the workbench.",
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
    "Use when a shopper wants to browse, compare, or identify canonical print products before creating a draft. Returns matching published product facts and template requirements, and visibly opens the format chooser without inventing offers or compatibility.",
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

export const configurePrint = defineTool<ConfigurePrintInput>({
  stableKey: "storefront.prepare_print_images",
  name: "configure_print",
  title: "Configure a print from the photo tray",
  description:
    "Use when a shopper wants to create or revise one visible print draft from photographs already in the tray. Selects a real product, applies the remembered or first compatible active template, exposes exact published image and text slots, patches assignments and non-destructive crops, and returns missing requirements; it never reorders or deletes tray files, uploads artwork, renders a proof, charges a card, or creates an order.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string", minLength: 1 },
      trayRevision: { type: "integer", minimum: 0 },
      photoRefs: {
        type: "array",
        items: {
          oneOf: [
            { type: "string", minLength: 1 },
            { type: "integer", minimum: 1 },
          ],
        },
      },
      productId: { type: "string", minLength: 1 },
      productQuery: { type: "string", minLength: 1 },
      templateId: { type: "string", minLength: 1 },
      outputId: { type: "string", minLength: 1 },
      orientation: { type: "string", enum: ["portrait", "landscape"] },
      slotPatches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slotKey: { type: "string", minLength: 1 },
            label: { type: "string", minLength: 1 },
            operation: { type: "string", enum: ["assign", "unassign", "set_text", "set_crop"] },
            photoRef: {
              oneOf: [
                { type: "string", minLength: 1 },
                { type: "integer", minimum: 1 },
              ],
            },
            text: { type: "string" },
            zoom: { type: "number", minimum: 1, maximum: 4 },
            focusX: { type: "number", minimum: 0, maximum: 100 },
            focusY: { type: "number", minimum: 0, maximum: 100 },
            offsetX: { type: "number", minimum: -100, maximum: 100 },
            offsetY: { type: "number", minimum: -100, maximum: 100 },
          },
          required: ["operation"],
          oneOf: [{ required: ["slotKey"] }, { required: ["label"] }],
          additionalProperties: false,
        },
      },
      directCrop: {
        type: "object",
        properties: {
          zoom: { type: "number", minimum: 1, maximum: 4 },
          focusX: { type: "number", minimum: 0, maximum: 100 },
          focusY: { type: "number", minimum: 0, maximum: 100 },
          offsetX: { type: "number", minimum: -100, maximum: 100 },
          offsetY: { type: "number", minimum: -100, maximum: 100 },
        },
        minProperties: 1,
        additionalProperties: false,
      },
    },
    required: ["trayRevision"],
    additionalProperties: false,
  },
  annotations: { untrustedContentHint: true },
  async execute(input) {
    const state = getStorefrontWebMcpState();
    requireVisibleCapability(
      state.canConfigurePrint && state.photoCount > 0,
      "configure a print from the visible photo tray",
    );
    requireCurrentTrayRevision(input.trayRevision);
    return requestStorefrontWebMcpAction("configure_print", input);
  },
});

export const requestServerProof = defineTool<RequestServerProofInput>({
  stableKey: "storefront.render_template_preview",
  name: "request_server_proof",
  title: "Request server proof",
  description:
    "Use when a shopper explicitly wants a server-generated JPEG proof for a complete visible template draft. Starts the published browser-preview job asynchronously, shows progress in that draft, and returns the proof job ID and framing-parity status; it does not create fulfillment artwork, add to cart, charge a card, or create an order.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string", minLength: 1 },
    },
    required: ["draftId"],
    additionalProperties: false,
  },
  annotations: { untrustedContentHint: true },
  async execute(input) {
    requireVisibleCapability(
      getStorefrontWebMcpState().canRequestServerProof,
      "request a server proof for a complete visible template draft",
    );
    return requestStorefrontWebMcpAction("request_server_proof", input);
  },
});

export const addToCart = defineTool<AddToCartInput>({
  stableKey: "storefront.add_to_cart",
  name: "add_to_cart",
  title: "Add a prepared print to cart",
  description:
    "Use when a shopper explicitly wants a complete visible print draft added to the local cart. Starts any required managed-artwork or fulfillment-render preparation asynchronously, keeps visible progress on the draft, and moves it into the cart only after preparation succeeds; it never starts checkout, charges a card, or creates a production order.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string", minLength: 1 },
      quantity: { type: "integer", minimum: 1, maximum: 99, default: 1 },
    },
    required: ["draftId"],
    additionalProperties: false,
  },
  async execute(input) {
    requireVisibleCapability(getStorefrontWebMcpState().canAddToCart, "add a complete visible draft to the cart");
    return requestStorefrontWebMcpAction("add_to_cart", input);
  },
});

export const manageCart = defineTool<ManageCartInput>({
  stableKey: "storefront.manage_cart",
  name: "manage_cart",
  title: "Manage cart",
  description:
    "Use when a shopper wants to inspect, change quantity, remove, or clear items already in the visible local cart. Returns the resulting cart state and never changes source photographs, initiates checkout, charges a card, or creates an order.",
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
    "Use when a shopper wants the visible cart prepared for Batch Relay Test Mode review and quoting. Moves the workbench to the shipping review, applies only supplied non-sensitive fields, and returns the sandbox review or quote state; it cannot charge a card or create a production order.",
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
