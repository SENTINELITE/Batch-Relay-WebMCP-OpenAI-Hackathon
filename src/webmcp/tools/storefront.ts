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

type AddToCartInput = {
  draftId: string;
  quantity?: number;
};

type ResolveCartProposalInput = {
  proposalId: string;
  decision: "accept" | "reject";
};

type ManageCartInput = {
  action: "view" | "update_quantity" | "remove" | "clear";
  itemId?: string;
  quantity?: number;
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
    "Use when a shopper asks what photographs, print drafts, template choices, slot requirements, pending cart proposals, or demo cart items are currently visible. Returns grounded structured state and the next available action without changing the workbench. Each image slot reports its current crop in the same zoom, focus, and offset vocabulary configure_print accepts, so a relative request such as zooming in further can be computed from the visible framing rather than guessed.",
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
    "Use when a shopper wants to browse, compare, or identify canonical print products before creating a draft. Returns matching published product facts and template requirements, and visibly opens the format chooser without inventing products or compatibility.",
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
    "Use when a shopper wants to create or revise one visible print draft from photographs already in the tray. Selects a real product, applies the remembered or first compatible active template, exposes exact published image and text slots, patches assignments and non-destructive crops, and returns missing requirements. A slot patch label may also be one of the aliases published beside each image slot, such as team or individual. An empty image slot may start from the photograph the shopper already chose for that role on another print; every such default is reported as prefilled_from and is replaced by an explicit assignment. The response reports each slot's resulting crop in this same patch vocabulary, so a relative crop change can be computed from it. It never reorders or deletes tray files, adds anything to the demo cart, or places an order.",
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

export const addToCart = defineTool<AddToCartInput>({
  stableKey: "storefront.add_to_cart",
  name: "add_to_cart",
  title: "Propose a prepared print for the demo cart",
  description:
    "Use when a shopper wants a complete visible print draft added to this browser's demo cart. Takes the draft_id returned by configure_print or listed by ask_storefront, and works from whichever step the shopper is already looking at without navigating them anywhere. Shows a picture-in-picture proposal card with a live preview the shopper accepts or rejects, and returns immediately without waiting; it never renders fulfillment artwork, charges a card, or creates an order.",
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
    // Draft readiness is checked by the visible workbench against the named
    // draft, which can name the exact missing slot. Refusing here on the
    // whole-storefront canAddToCart flag would only turn that into a vaguer
    // error, and would wrongly refuse the first draft of a session.
    const state = getStorefrontWebMcpState();
    if (state.pendingProposal) {
      throw new Error("A cart proposal is already waiting on the shopper; resolve it with resolve_cart_proposal first.");
    }
    return requestStorefrontWebMcpAction("add_to_cart", input);
  },
});

export const resolveCartProposal = defineTool<ResolveCartProposalInput>({
  stableKey: "storefront.resolve_cart_proposal",
  name: "resolve_cart_proposal",
  title: "Resolve a pending cart proposal",
  description:
    "Use when a shopper answers the visible picture-in-picture proposal card in words instead of clicking it. Accepts the proposal into the demo cart or rejects and dismisses it, exactly as the two visible buttons would, and returns the resulting cart state.",
  inputSchema: {
    type: "object",
    properties: {
      proposalId: { type: "string", minLength: 1 },
      decision: { type: "string", enum: ["accept", "reject"] },
    },
    required: ["proposalId", "decision"],
    additionalProperties: false,
  },
  async execute(input) {
    requireVisibleCapability(
      getStorefrontWebMcpState().pendingProposal,
      "resolve a cart proposal while none is visible",
    );
    return requestStorefrontWebMcpAction("resolve_cart_proposal", input);
  },
});

export const manageCart = defineTool<ManageCartInput>({
  stableKey: "storefront.manage_cart",
  name: "manage_cart",
  title: "Manage cart",
  description:
    "Use when a shopper wants to inspect, change quantity, remove, or clear items in the visible demo cart. Returns the resulting cart state and never changes source photographs, charges a card, or creates an order.",
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
    if (input.action !== "view" && getStorefrontWebMcpState().cartItemCount === 0) {
      throw new Error("The visible demo cart is empty, so there is nothing to change.");
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
