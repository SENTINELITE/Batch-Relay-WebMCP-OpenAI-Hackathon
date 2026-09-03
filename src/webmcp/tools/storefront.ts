import { defineTool } from "@nekuda/webmcp-sdk";

import {
  requireIdentifierAlias,
  withResolvedIdentifierAliases,
} from "../../lib/storefront/tool-input";
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
  /** Alias for draftId, the name it is returned under. */
  draft_id?: string;
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
  draftId?: string;
  /** Alias for draftId, the name it is returned under. */
  draft_id?: string;
  quantity?: number;
};

type ResolveCartProposalInput = {
  proposalId?: string;
  /** Alias for proposalId, the name it is returned under. */
  proposal_id?: string;
  decision: "accept" | "reject" | "accept_all" | "reject_all";
  shopperConfirmation: string;
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
    "Use when a shopper wants to create or revise one visible print draft from photographs already in the tray. Selects a real product, applies the remembered or first compatible active template, exposes exact published image and text slots, patches assignments and non-destructive crops, and returns missing requirements. When a required slot is still missing, the response names it in words: ask the shopper which photograph should fill it rather than choosing for them. A slot patch label may also be one of the aliases published beside each image slot, such as team or individual. An empty image slot may start from the photograph the shopper already chose for that role on another print; every such default is reported as prefilled_from and is replaced by an explicit assignment. The response reports each slot's resulting crop in this same patch vocabulary, so a relative crop change can be computed from it. It never takes the screen away from a shopper who is customizing a print by hand: a new draft made while they are working on another one waits in the draft rail instead, and the response says which happened with placed on_screen or draft_rail and a matching visible flag. Narrate that honestly — when a draft was placed in the draft rail, do not tell the shopper they are looking at it; adding it will show them a proposal card carrying its own live preview. It never reorders or deletes tray files, adds anything to the demo cart, or places an order.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string", minLength: 1 },
      draft_id: { type: "string", minLength: 1 },
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
    return requestStorefrontWebMcpAction("configure_print", withResolvedIdentifierAliases(input, [["draftId", "draft_id"]]));
  },
});

export const addToCart = defineTool<AddToCartInput>({
  stableKey: "storefront.add_to_cart",
  name: "add_to_cart",
  title: "Add or propose a prepared print for the demo cart",
  description:
    "Use when a shopper wants a complete visible print draft added to this browser's demo cart. Takes the draft_id returned by configure_print or listed by ask_storefront — either draftId or draft_id is accepted, so the ID can be copied straight out of the response it came from — and works from whichever step the shopper is already looking at without navigating them anywhere. What happens next depends on what the shopper can see, and the returned status says which: when the named draft is the one whose live preview they already have on screen, the print is added outright, returning status added, because that preview was the pre-visualization, and the masthead cart chip flashes the new count. When it is any other draft, a print they have not seen, this only proposes, returning status awaiting_shopper_confirmation with a proposal_id and the resulting pending_proposal_count: a picture-in-picture card shows them the print and the call returns immediately without waiting, and that proposal awaits the SHOPPER's decision, made by clicking the card or saying so in their own words. Proposals stack, so you may propose several prints in a row without resolving each one first; every card in the stack waits on the shopper individually. Proposing a draft that already has a card waiting returns that same card rather than a duplicate. On a proposal, stop and tell the shopper the card is waiting; asking you to add something to the cart is a request for that proposal, never confirmation of it, so you must not resolve your own proposal. It never renders fulfillment artwork, charges a card, or creates an order.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string", minLength: 1 },
      draft_id: { type: "string", minLength: 1 },
      quantity: { type: "integer", minimum: 1, maximum: 99, default: 1 },
    },
    anyOf: [{ required: ["draftId"] }, { required: ["draft_id"] }],
    additionalProperties: false,
  },
  async execute(input) {
    // Draft readiness is checked by the visible workbench against the named
    // draft, which can name the exact missing slot. Refusing here on the
    // whole-storefront canAddToCart flag would only turn that into a vaguer
    // error, and would wrongly refuse the first draft of a session.
    //
    // Nothing here refuses a second proposal either: the cards stack, and the
    // shopper answers each one. Blocking on a card already waiting made a
    // perfectly reasonable "add both of these" impossible to carry out.
    const raw = input as unknown as Record<string, unknown>;
    // Checked here so a missing ID is refused in words naming both spellings,
    // rather than by the schema's opaque "Tool requires: draftId".
    requireIdentifierAlias(raw, "draftId", "draft_id", "add_to_cart needs the ID of the visible draft to add or propose.");
    return requestStorefrontWebMcpAction("add_to_cart", withResolvedIdentifierAliases(raw, [["draftId", "draft_id"]]));
  },
});

export const resolveCartProposal = defineTool<ResolveCartProposalInput>({
  stableKey: "storefront.resolve_cart_proposal",
  name: "resolve_cart_proposal",
  title: "Resolve a pending cart proposal",
  description:
    "Use exclusively to relay the shopper's own explicit decision about the picture-in-picture proposal cards stacked in the corner, spoken by them after those cards appeared. Only the shopper can accept or reject a proposal: calling this on your own initiative, or to confirm a proposal you yourself just made, is a protocol violation, not a shortcut. Asking for something to be added to the cart is a request for a proposal and is NOT confirmation of one, so after add_to_cart you stop and wait. Pass the shopper's confirming or declining words verbatim as shopperConfirmation; if you cannot quote them, they have not decided yet and you must ask. Use decision accept or reject with the proposalId of one card — either proposalId or proposal_id is accepted, so the ID can be copied straight out of the response it came from — and that card alone is resolved while the rest keep waiting. When the shopper answers the whole stack at once, in words like add them all or none of those, use decision accept_all or reject_all and leave proposalId out; their words still go in shopperConfirmation and apply to the batch. Acts exactly as the visible buttons would, and returns every proposal it resolved plus the resulting cart state.",
  inputSchema: {
    type: "object",
    properties: {
      proposalId: { type: "string", minLength: 1 },
      proposal_id: { type: "string", minLength: 1 },
      decision: { type: "string", enum: ["accept", "reject", "accept_all", "reject_all"] },
      shopperConfirmation: { type: "string", minLength: 1 },
    },
    required: ["decision", "shopperConfirmation"],
    additionalProperties: false,
  },
  async execute(input) {
    requireVisibleCapability(
      getStorefrontWebMcpState().pendingProposalCount > 0,
      "resolve a cart proposal while none is visible",
    );
    // The quote is the whole point of the parameter: an empty one means the
    // agent is answering its own proposal.
    if (typeof input.shopperConfirmation !== "string" || input.shopperConfirmation.trim().length === 0) {
      throw new Error(
        "shopperConfirmation must quote the shopper's own words accepting or declining the visible proposal. If they have not answered yet, ask them and wait.",
      );
    }
    const raw = input as unknown as Record<string, unknown>;
    // A single-card decision needs to say which card; accept_all and reject_all
    // are the shopper answering the whole stack, so they take no ID.
    if (input.decision === "accept" || input.decision === "reject") {
      requireIdentifierAlias(
        raw,
        "proposalId",
        "proposal_id",
        `resolve_cart_proposal with decision ${input.decision} needs the ID of the one card being answered; use accept_all or reject_all for the whole stack.`,
      );
    }
    return requestStorefrontWebMcpAction("resolve_cart_proposal", withResolvedIdentifierAliases(raw, [["proposalId", "proposal_id"]]));
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
