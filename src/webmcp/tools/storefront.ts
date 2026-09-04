import { defineTool } from "@nekuda/webmcp-sdk";

import {
  requireIdentifierAlias,
  requireIdentifierListAlias,
  withResolvedIdentifierAliases,
  withResolvedIdentifierListAliases,
} from "../../lib/storefront/tool-input";
import {
  getStorefrontWebMcpState,
  requestStorefrontWebMcpAction,
  type StorefrontWebMcpErrorResult,
} from "../storefront-bridge";

type AskStorefrontInput = {
  question: string;
  templateId?: string;
  templateQuery?: string;
  productId?: string;
  productQuery?: string;
  orientation?: "portrait" | "landscape";
  maxTemplateResults?: number;
};

type FindPrintsInput = {
  query?: string;
  productType?: string;
  maxResults?: number;
};

type PhotoRef = string | number;

/** What a crop should aim at, when the caller knows the intent but not the
 *  coordinates. Both spellings are accepted, as everywhere else. */
type FocusOn = "faces" | "center";

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
  focusOn?: FocusOn;
  focus_on?: FocusOn;
  subjectWidthPercent?: number;
  subject_width_percent?: number;
};

type DirectCrop = {
  zoom?: number;
  focusX?: number;
  focusY?: number;
  offsetX?: number;
  offsetY?: number;
  focusOn?: FocusOn;
  focus_on?: FocusOn;
  subjectWidthPercent?: number;
  subject_width_percent?: number;
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
  templateQuery?: string;
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
  decision: "accept" | "reject" | "accept_all" | "reject_all" | "accept_ready" | "update_quantity";
  /** Required for every decision except update_quantity, which is not an accept. */
  shopperConfirmation?: string;
  /** How many copies a standing card should ask for. update_quantity only. */
  quantity?: number;
};

type UndoLastChangeInput = {
  steps?: number;
};

type RedoLastChangeInput = {
  steps?: number;
};

type RevisePrintsInput = {
  draftIds?: string[];
  /** Alias for draftIds, the name the IDs are returned under. */
  draft_ids?: string[];
  crop: DirectCrop;
  slotSelector?: { role?: "individual" | "team"; slotKey?: string; label?: string };
};

type ProposePrintsInput = {
  trayRevision: number;
  productId?: string;
  productQuery?: string;
  photoRefs?: PhotoRef[];
  /** Alias for photoRefs, the name the references are returned under. */
  photo_refs?: PhotoRef[];
  quantity?: number;
  orientation?: "portrait" | "landscape";
  templateId?: string;
  templateQuery?: string;
  outputId?: string;
};

type ManageCartInput = {
  action: "view" | "update_quantity" | "remove" | "clear";
  itemId?: string;
  /** Lets a shopper refer to the latest cart line without first asking for IDs. */
  target?: "most_recent";
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

/** Keep template/output selection unambiguous even when a caller bypasses JSON Schema. */
function validateTemplateSelection(
  input: { templateId?: string; templateQuery?: string; outputId?: string },
  action: string,
): void {
  if (input.templateId !== undefined && input.templateQuery !== undefined) {
    throw new Error(`${action} accepts either templateId or templateQuery, not both.`);
  }
  if (input.outputId !== undefined && input.templateId === undefined && input.templateQuery === undefined) {
    throw new Error(`${action} needs templateId or templateQuery when outputId is supplied.`);
  }
}

/**
 * JSON Schema is advisory in WebMCP clients. Convert the validation we perform
 * before dispatch into the same inspectable error envelope the bridge returns
 * for expected UI failures, rather than throwing an opaque SDK exception.
 */
function validateToolInput(
  action: string,
  validate: () => void,
): StorefrontWebMcpErrorResult | null {
  try {
    validate();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : `Invalid input for ${action}.`;
    return {
      content: [{ type: "text", text: `${message} Commit status: not_committed.` }],
      isError: true,
      structuredContent: {
        error: {
          code: "invalid_input",
          message,
          scope: "input",
          retryable: false,
          details: { action },
          commitStatus: "not_committed",
        },
      },
    };
  }
}

export const askStorefront = defineTool<AskStorefrontInput>({
  stableKey: "storefront.ask",
  name: "ask_storefront",
  title: "Ask the storefront",
  description:
    "Inspect the visible storefront or check one template and product for compatibility. Does not change the workbench.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", minLength: 1, description: "The shopper question about the visible tray, draft, catalog, template, or cart." },
      templateId: { type: "string", minLength: 1 },
      templateQuery: { type: "string", minLength: 1 },
      productId: { type: "string", minLength: 1 },
      productQuery: { type: "string", minLength: 1 },
      orientation: { type: "string", enum: ["portrait", "landscape"] },
      maxTemplateResults: { type: "integer", minimum: 1, maximum: 20 },
    },
    required: ["question"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute(input) {
    const invalid = validateToolInput("ask_storefront", () => validateTemplateSelection(input, "ask_storefront"));
    if (invalid) return invalid;
    return requestStorefrontWebMcpAction("ask_storefront", input);
  },
});

export const findPrints = defineTool<FindPrintsInput>({
  stableKey: "storefront.find_prints",
  name: "find_prints",
  title: "Find print products",
  description:
    "Find published print products by name, size, or type. Returns catalog facts and template requirements without changing what the shopper is looking at.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, description: "A shopper phrase such as 8x10, memory mate, or wallet." },
      productType: { type: "string", minLength: 1, description: "An optional published product type to narrow the catalog." },
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
    "Create or revise one print draft from visible tray photos. Assign published slots, apply per-slot text (set_text) or framing, and return the resulting draft, crop, and missing requirements. Use photo ordinals or returned photo IDs; face framing is applied only when focusOn is faces.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string", minLength: 1, description: "The existing draft ID returned by a prior storefront call." },
      draft_id: { type: "string", minLength: 1, description: "Alias for draftId, matching returned response fields." },
      trayRevision: { type: "integer", minimum: 0, description: "Current visible tray revision from the latest storefront result; prevents applying photos after the tray changed." },
      photoRefs: {
        type: "array",
        description: "Tray photo ordinals (for example 3) or returned photo IDs. Use these to create or update a direct print.",
        items: {
          oneOf: [
            { type: "string", minLength: 1 },
            { type: "integer", minimum: 1 },
          ],
        },
      },
      productId: { type: "string", minLength: 1, description: "Canonical published product ID returned by find_prints or ask_storefront." },
      productQuery: { type: "string", minLength: 1, description: "Shopper wording for the product when no canonical product ID is available." },
      templateId: { type: "string", minLength: 1, description: "Canonical published template ID." },
      templateQuery: { type: "string", minLength: 1, description: "Template name or shopper wording; use instead of templateId." },
      outputId: { type: "string", minLength: 1 },
      orientation: { type: "string", enum: ["portrait", "landscape"] },
      slotPatches: {
        type: "array",
        description: "Slot changes. Name a published slot key or its returned label, then choose an operation.",
        items: {
          type: "object",
          properties: {
            slotKey: { type: "string", minLength: 1 },
            label: { type: "string", minLength: 1 },
            operation: { type: "string", enum: ["assign", "unassign", "set_text", "set_crop"] },
            photoRef: {
              description: "Tray photo ordinal or returned photo ID to assign to an image slot.",
              oneOf: [
                { type: "string", minLength: 1 },
                { type: "integer", minimum: 1 },
              ],
            },
            text: { type: "string" },
            zoom: { type: "number", minimum: 1, maximum: 4, description: "Crop scale. 1 keeps the default frame; higher values zoom in." },
            focusX: { type: "number", minimum: 0, maximum: 100 },
            focusY: { type: "number", minimum: 0, maximum: 100 },
            offsetX: { type: "number", minimum: -100, maximum: 100 },
            offsetY: { type: "number", minimum: -100, maximum: 100 },
            focusOn: { type: "string", enum: ["faces", "center"], description: "Crop intent. Use faces only when the shopper asks for face framing; center keeps default centered framing." },
            focus_on: { type: "string", enum: ["faces", "center"], description: "Alias for focusOn." },
            subjectWidthPercent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
            subject_width_percent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
          },
          required: ["operation"],
          oneOf: [{ required: ["slotKey"] }, { required: ["label"] }],
          additionalProperties: false,
        },
      },
      directCrop: {
        type: "object",
        description: "Framing for a direct print. Omit it to keep the default 1.0x centered frame.",
        properties: {
          zoom: { type: "number", minimum: 1, maximum: 4, description: "Crop scale. 1 keeps the default frame; higher values zoom in." },
          focusX: { type: "number", minimum: 0, maximum: 100 },
          focusY: { type: "number", minimum: 0, maximum: 100 },
          offsetX: { type: "number", minimum: -100, maximum: 100 },
          offsetY: { type: "number", minimum: -100, maximum: 100 },
          focusOn: { type: "string", enum: ["faces", "center"], description: "Crop intent. Use faces only when the shopper asks for face framing; center keeps default centered framing." },
          focus_on: { type: "string", enum: ["faces", "center"], description: "Alias for focusOn." },
          subjectWidthPercent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
          subject_width_percent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
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
    const invalid = validateToolInput("configure_print", () => {
      const state = getStorefrontWebMcpState();
      requireVisibleCapability(
        state.canConfigurePrint && state.photoCount > 0,
        "configure a print from the visible photo tray",
      );
      requireCurrentTrayRevision(input.trayRevision);
      validateTemplateSelection(input, "configure_print");
    });
    if (invalid) return invalid;
    return requestStorefrontWebMcpAction("configure_print", withResolvedIdentifierAliases(input, [["draftId", "draft_id"]]));
  },
});

export const addToCart = defineTool<AddToCartInput>({
  stableKey: "storefront.add_to_cart",
  name: "add_to_cart",
  title: "Add or propose a prepared print for the demo cart",
  description:
    "Add a prepared visible draft to the demo cart, or show its proposal card when the shopper has not previewed it. Proposals stack and await the SHOPPER's decision; the agent must not resolve its own proposal. Accept draftId or draft_id from a previous result and return the cart or proposal status.",
  inputSchema: {
    type: "object",
    properties: {
      draftId: { type: "string", minLength: 1, description: "Prepared draft ID returned by configure_print or ask_storefront." },
      draft_id: { type: "string", minLength: 1, description: "Alias for draftId, matching returned response fields." },
      quantity: { type: "integer", minimum: 1, maximum: 99, default: 1, description: "Number of identical copies to add or propose." },
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
    const invalid = validateToolInput("add_to_cart", () => {
      requireIdentifierAlias(raw, "draftId", "draft_id", "add_to_cart needs the ID of the visible draft to add or propose.");
    });
    if (invalid) return invalid;
    return requestStorefrontWebMcpAction("add_to_cart", withResolvedIdentifierAliases(raw, [["draftId", "draft_id"]]));
  },
});

export const resolveCartProposal = defineTool<ResolveCartProposalInput>({
  stableKey: "storefront.resolve_cart_proposal",
  name: "resolve_cart_proposal",
  title: "Resolve a pending cart proposal",
  description:
    "Apply the shopper's stated decision to pending proposal cards. Only the shopper can accept or reject a proposal; asking to add a print is NOT confirmation of one. Accept or reject one card or a stack, accept ready cards, or update one card's quantity before its decision. Quote the shopper in shopperConfirmation for acceptance or rejection.",
  inputSchema: {
    type: "object",
    properties: {
      proposalId: { type: "string", minLength: 1, description: "Pending proposal ID returned by add_to_cart or propose_prints." },
      proposal_id: { type: "string", minLength: 1, description: "Alias for proposalId, matching returned response fields." },
      decision: { type: "string", enum: ["accept", "reject", "accept_all", "reject_all", "accept_ready", "update_quantity"], description: "The shopper decision to apply to one proposal or the proposal stack." },
      shopperConfirmation: { type: "string", minLength: 1, description: "The shopper's actual words accepting or declining a proposal." },
      quantity: { type: "integer", minimum: 1, maximum: 99, description: "New quantity for decision update_quantity only." },
    },
    required: ["decision"],
    additionalProperties: false,
  },
  async execute(input) {
    const raw = input as unknown as Record<string, unknown>;
    // Changing how many copies a card asks for is not accepting it: nothing
    // enters the cart, the card keeps waiting, and demanding the shopper's
    // confirming words for a question they have not been asked yet would make
    // "make that one two copies" impossible to carry out honestly.
    if (input.decision === "update_quantity") {
      const invalid = validateToolInput("resolve_cart_proposal", () => {
        requireVisibleCapability(
          getStorefrontWebMcpState().pendingProposalCount > 0,
          "resolve a cart proposal while none is visible",
        );
        requireIdentifierAlias(
          raw,
          "proposalId",
          "proposal_id",
          "resolve_cart_proposal with decision update_quantity needs the ID of the one card whose quantity is changing.",
        );
        if (!Number.isInteger(input.quantity) || (input.quantity as number) < 1 || (input.quantity as number) > 99) {
          throw new Error("update_quantity requires quantity as a whole number from 1 through 99.");
        }
      });
      if (invalid) return invalid;
      return requestStorefrontWebMcpAction("resolve_cart_proposal", withResolvedIdentifierAliases(raw, [["proposalId", "proposal_id"]]));
    }
    // The quote is the whole point of the parameter: an empty one means the
    // agent is answering its own proposal.
    const invalid = validateToolInput("resolve_cart_proposal", () => {
      requireVisibleCapability(
        getStorefrontWebMcpState().pendingProposalCount > 0,
        "resolve a cart proposal while none is visible",
      );
      if (typeof input.shopperConfirmation !== "string" || input.shopperConfirmation.trim().length === 0) {
        throw new Error(
          "shopperConfirmation must quote the shopper's own words accepting or declining the visible proposal. If they have not answered yet, ask them and wait.",
        );
      }
      if (input.decision === "accept" || input.decision === "reject") {
        requireIdentifierAlias(
          raw,
          "proposalId",
          "proposal_id",
          `resolve_cart_proposal with decision ${input.decision} needs the ID of the one card being answered; use accept_all or reject_all for the whole stack, or accept_ready for every card the review already calls ready.`,
        );
      }
    });
    if (invalid) return invalid;
    return requestStorefrontWebMcpAction("resolve_cart_proposal", withResolvedIdentifierAliases(raw, [["proposalId", "proposal_id"]]));
  },
});

export const revisePrints = defineTool<RevisePrintsInput>({
  stableKey: "storefront.revise_prints",
  name: "revise_prints",
  title: "Apply one approved framing to other prints",
  description:
    "Apply one approved crop to several existing drafts. Target their default image slot or identify an individual or team slot, then return the per-draft framing result.",
  inputSchema: {
    type: "object",
    properties: {
      draftIds: { type: "array", minItems: 1, description: "Draft IDs to reframe, returned by previous storefront calls.", items: { type: "string", minLength: 1 } },
      draft_ids: { type: "array", minItems: 1, description: "Alias for draftIds, matching returned response fields.", items: { type: "string", minLength: 1 } },
      crop: {
        type: "object",
        description: "Framing to copy. Use focusOn faces only for an explicit face-framing request.",
        properties: {
          zoom: { type: "number", minimum: 1, maximum: 4 },
          focusX: { type: "number", minimum: 0, maximum: 100 },
          focusY: { type: "number", minimum: 0, maximum: 100 },
          offsetX: { type: "number", minimum: -100, maximum: 100 },
          offsetY: { type: "number", minimum: -100, maximum: 100 },
          focusOn: { type: "string", enum: ["faces", "center"], description: "Crop intent. faces explicitly asks for face framing; center uses centered framing." },
          focus_on: { type: "string", enum: ["faces", "center"], description: "Alias for focusOn." },
          subjectWidthPercent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
          subject_width_percent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
        },
        minProperties: 1,
        additionalProperties: false,
      },
      slotSelector: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["individual", "team"] },
          slotKey: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
        },
        minProperties: 1,
        additionalProperties: false,
      },
    },
    required: ["crop"],
    anyOf: [{ required: ["draftIds"] }, { required: ["draft_ids"] }],
    additionalProperties: false,
  },
  annotations: { untrustedContentHint: true },
  async execute(input) {
    const raw = input as unknown as Record<string, unknown>;
    // Named here rather than left to the schema, so a missing list is refused
    // in words that give both spellings instead of "Tool requires: draftIds".
    const invalid = validateToolInput("revise_prints", () => {
      requireIdentifierListAlias(
        raw,
        "draftIds",
        "draft_ids",
        "revise_prints needs the IDs of the visible drafts to reframe.",
      );
      if (!input.crop || typeof input.crop !== "object" || Object.keys(input.crop).length === 0) {
        throw new Error("revise_prints needs at least one crop value to propagate: zoom, focusX, focusY, offsetX, or offsetY.");
      }
    });
    if (invalid) return invalid;
    return requestStorefrontWebMcpAction("revise_prints", withResolvedIdentifierListAliases(raw, [["draftIds", "draft_ids"]]));
  },
});

export const proposePrints = defineTool<ProposePrintsInput>({
  stableKey: "storefront.propose_prints",
  name: "propose_prints",
  title: "Stage one print per photograph",
  description:
    "Stage one draft and proposal card for each tray photo against one product. Use tray ordinals or returned photo IDs; omitted framing keeps the default 1.0x centered crop. Returns one result per photo and leaves each proposal awaiting the shopper's decision.",
  inputSchema: {
    type: "object",
    properties: {
      trayRevision: { type: "integer", minimum: 0, description: "Current visible tray revision from the latest storefront result; prevents staging against an outdated tray." },
      productId: { type: "string", minLength: 1, description: "Canonical published product ID to use for every staged print." },
      productQuery: { type: "string", minLength: 1, description: "Shopper wording for the product when no canonical product ID is available." },
      photoRefs: {
        type: "array",
        minItems: 1,
        description: "Tray photo ordinals or returned photo IDs. One proposal is staged for each reference.",
        items: {
          oneOf: [
            { type: "string", minLength: 1 },
            { type: "integer", minimum: 1 },
          ],
        },
      },
      photo_refs: {
        type: "array",
        minItems: 1,
        description: "Alias for photoRefs, matching returned response fields.",
        items: {
          oneOf: [
            { type: "string", minLength: 1 },
            { type: "integer", minimum: 1 },
          ],
        },
      },
      quantity: { type: "integer", minimum: 1, maximum: 99, default: 1, description: "Number of identical copies requested for every staged print." },
      orientation: { type: "string", enum: ["portrait", "landscape"] },
      templateId: { type: "string", minLength: 1 },
      templateQuery: { type: "string", minLength: 1 },
      outputId: { type: "string", minLength: 1 },
    },
    required: ["trayRevision"],
    anyOf: [{ required: ["photoRefs"] }, { required: ["photo_refs"] }],
    additionalProperties: false,
  },
  annotations: { untrustedContentHint: true },
  async execute(input) {
    const raw = input as unknown as Record<string, unknown>;
    const invalid = validateToolInput("propose_prints", () => {
      const state = getStorefrontWebMcpState();
      requireVisibleCapability(
        state.canConfigurePrint && state.photoCount > 0,
        "stage prints from the visible photo tray",
      );
      requireCurrentTrayRevision(input.trayRevision);
      validateTemplateSelection(input, "propose_prints");
      requireIdentifierListAlias(
        raw,
        "photoRefs",
        "photo_refs",
        "propose_prints needs the tray photographs to make one print from each.",
      );
      if (!input.productId && !input.productQuery) {
        throw new Error("propose_prints needs one product for the whole batch: pass productId, or productQuery to name it the way the shopper did.");
      }
    });
    if (invalid) return invalid;
    return requestStorefrontWebMcpAction("propose_prints", withResolvedIdentifierListAliases(raw, [["photoRefs", "photo_refs"]]));
  },
});

export const manageCart = defineTool<ManageCartInput>({
  stableKey: "storefront.manage_cart",
  name: "manage_cart",
  title: "Manage cart",
  description:
    "Inspect or update the visible demo cart. Change a line quantity, remove a line, or clear the cart; use target most_recent when the shopper refers to the latest cart line.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["view", "update_quantity", "remove", "clear"], description: "Cart operation to perform." },
      itemId: { type: "string", minLength: 1, description: "Exact cart line ID returned by a prior cart result." },
      target: { type: "string", enum: ["most_recent"], description: "Use most_recent for the latest cart line instead of inspecting the cart first." },
      quantity: { type: "integer", minimum: 1, maximum: 99, description: "New line quantity for action update_quantity." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async execute(input) {
    const invalid = validateToolInput("manage_cart", () => {
      if (input.action !== "view" && getStorefrontWebMcpState().cartItemCount === 0) {
        throw new Error("The visible demo cart is empty, so there is nothing to change.");
      }
      if ((input.action === "update_quantity" || input.action === "remove") && !input.itemId && input.target !== "most_recent") {
        throw new Error(`${input.action} requires a visible cart item ID or target most_recent.`);
      }
      if (input.action === "update_quantity" && !input.quantity) {
        throw new Error("update_quantity requires a quantity.");
      }
    });
    if (invalid) return invalid;
    return requestStorefrontWebMcpAction("manage_cart", input);
  },
});

export const undoLastChange = defineTool<UndoLastChangeInput>({
  stableKey: "storefront.undo_last_change",
  name: "undo_last_change",
  title: "Undo the last change to the workbench",
  description:
    "Restore the workbench to before its latest change, including drafts, framing, proposals, and cart lines. Use steps to undo up to five changes and return the restored change description.",
  inputSchema: {
    type: "object",
    properties: {
      steps: { type: "integer", minimum: 1, maximum: 5, default: 1, description: "Number of recent workbench changes to undo, from 1 through 5." },
    },
    additionalProperties: false,
  },
  annotations: { untrustedContentHint: true },
  async execute(input) {
    // Deliberately no readiness gate on visible state: whether there is
    // anything to undo is a fact about the workbench's own history, which the
    // published capability state does not carry, and the handler can say
    // exactly what it found instead of refusing vaguely here.
    return requestStorefrontWebMcpAction("undo_last_change", input as unknown as Record<string, unknown>);
  },
});

export const redoLastChange = defineTool<RedoLastChangeInput>({
  stableKey: "storefront.redo_last_change",
  name: "redo_last_change",
  title: "Redo the last undone workbench change",
  description:
    "Reapply one or more workbench changes previously restored by undo_last_change. Use steps to redo up to five consecutive undos and return the exact restored state.",
  inputSchema: {
    type: "object",
    properties: {
      steps: { type: "integer", minimum: 1, maximum: 5, default: 1, description: "Number of consecutive undone changes to reapply, from 1 through 5." },
    },
    additionalProperties: false,
  },
  annotations: { untrustedContentHint: true },
  async execute(input) {
    return requestStorefrontWebMcpAction("redo_last_change", input as unknown as Record<string, unknown>);
  },
});
