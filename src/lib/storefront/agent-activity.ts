/**
 * What the shopper is told when the agent changes something.
 *
 * The storefront's whole premise is that an agent works the same visible
 * workbench the shopper does. That is only trustworthy if the shopper can see
 * it happen, and a preview repainting on its own is easy to miss. So every
 * bridge action that mutates visible state produces one short line — "Agent
 * staged 6 × 5×7 prints" — that appears, is readable, and goes away.
 *
 * Three rules shape the whole module:
 *
 * 1. **Agent actions only.** A shopper who just clicked Add does not need to be
 *    told they clicked Add. Only the WebMCP bridge routes through here.
 * 2. **Read-only tools stay silent.** `ask_storefront` and `find_prints` change
 *    nothing, so a toast for them would be noise that trains the shopper to
 *    ignore the real ones.
 * 3. **Never claim more than the result does.** Every number in a message is
 *    read out of the handler's own response payload, which is the same payload
 *    the agent is given. If the result cannot support a specific line, the
 *    generic one is used rather than a flattering guess.
 *
 * Pure and free of React, so the catalogue is testable without a browser.
 */

/** The bridge actions that change something the shopper can see. */
export const MUTATING_AGENT_ACTIONS = [
  "configure_print",
  "revise_prints",
  "propose_prints",
  "add_to_cart",
  "resolve_cart_proposal",
  "manage_cart",
  "undo_last_change",
  "redo_last_change",
] as const;

export type MutatingAgentAction = (typeof MUTATING_AGENT_ACTIONS)[number];

export function isMutatingAgentAction(action: string): action is MutatingAgentAction {
  return (MUTATING_AGENT_ACTIONS as readonly string[]).includes(action);
}

/**
 * Which visible surface this action changed, for the highlight pulse.
 *
 * Only surfaces without their own motion are named. The proposal deck already
 * animates each card in, and the cart chip already flashes its new count, so
 * pulsing them again would be two animations arguing.
 */
export type AgentActivityPulse = "workbench" | null;

export type AgentActivity = {
  /** The headline. One clause, no trailing period. */
  message: string;
  /** The optional second line, when a count needs qualifying. */
  detail?: string;
  pulse: AgentActivityPulse;
  /**
   * Whether this toast may carry an Undo button. An action that changed nothing
   * has nothing to offer, and undoing an undo is a redo, which this is not.
   */
  undoable: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** "5×7 Print" out of `{ product: { name } }`, or a neutral fallback. */
function productName(result: Record<string, unknown>): string {
  const product = isRecord(result.product) ? result.product : null;
  return text(product?.name) ?? text(result.product_name) ?? "print";
}

/**
 * The crop clause, when one crop value was set and it is worth naming.
 *
 * A shopper watching "Agent set the zoom to 3.0×" understands what moved far
 * better than "Agent reframed 1 print". Only single-value patches are named:
 * spelling out four numbers at once is a diff, not a notification.
 */
function cropClause(crop: unknown, role: string | null): string | null {
  if (!isRecord(crop)) return null;
  const named = role ? `the ${role} ` : "the ";
  const zoom = count(crop.zoom);
  const focusOn = text(crop.focusOn) ?? text(crop.focus_on);
  const subjectWidth = count(crop.subjectWidthPercent) ?? count(crop.subject_width_percent);
  const keys = Object.keys(crop).length;

  if (focusOn === "faces") {
    return subjectWidth !== null
      ? `centred ${named}crop on the faces at ${subjectWidth}% width`
      : `centred ${named}crop on the faces`;
  }
  if (keys === 1 && zoom !== null) return `set ${named}zoom to ${zoom.toFixed(1)}×`;
  return null;
}

/** The slot role a revise/configure patch aimed at, when it named one. */
function slotRole(input: Record<string, unknown>): string | null {
  const selector = isRecord(input.slotSelector) ? input.slotSelector : null;
  return text(selector?.role) ?? text(selector?.label) ?? null;
}

/** The single crop patch a configure_print carried, if it carried exactly one. */
function configureCrop(input: Record<string, unknown>): { crop: unknown; role: string | null } | null {
  if (isRecord(input.directCrop)) return { crop: input.directCrop, role: null };
  const patches = Array.isArray(input.slotPatches) ? input.slotPatches.filter(isRecord) : [];
  const cropPatches = patches.filter((patch) => patch.operation === "set_crop");
  if (cropPatches.length !== 1) return null;
  const patch = cropPatches[0]!;
  // The addressing fields are how the patch found its slot, not part of the
  // crop it carries, so they must not be read as crop values below.
  const crop = Object.fromEntries(
    Object.entries(patch).filter(([key]) => key !== "slotKey" && key !== "label" && key !== "operation"),
  );
  return { crop, role: text(patch.label) ?? text(patch.slotKey) };
}

/**
 * The printed lines a configure_print wrote, named as the template labels them
 * rather than by the opaque slot key the agent aimed at. A shopper watching
 * "Agent set the Team line to Spartans" can check it against the artwork.
 */
function textClause(input: Record<string, unknown>, result: Record<string, unknown>): string | null {
  const patches = Array.isArray(input.slotPatches) ? input.slotPatches.filter(isRecord) : [];
  if (patches.length === 0 || patches.some((patch) => patch.operation !== "set_text")) return null;
  if (patches.length > 1) return `filled ${patches.length} text lines on the ${productName(result)}`;
  const patch = patches[0]!;
  const reference = text(patch.slotKey) ?? text(patch.label);
  const slots = Array.isArray(result.text_slots) ? result.text_slots.filter(isRecord) : [];
  const slot = slots.find((candidate) => text(candidate.slot_key) === reference)
    ?? slots.find((candidate) => text(candidate.label)?.trim().toLowerCase() === reference?.trim().toLowerCase());
  const label = text(slot?.label) ?? reference;
  if (!label) return null;
  const value = text(patch.text);
  return value ? `set the ${label} line to ${value}` : `cleared the ${label} line`;
}

function configureActivity(
  input: Record<string, unknown>,
  result: Record<string, unknown>,
): AgentActivity {
  const missing = Array.isArray(result.missing_requirements) ? result.missing_requirements.length : 0;
  const inTheRail = result.placed === "draft_rail";
  const placement = inTheRail ? "in the draft rail" : "on screen";
  const detail = missing > 0
    ? `${missing} ${plural(missing, "slot")} still ${plural(missing, "needs", "need")} a photograph`
    : undefined;

  // Text is the other revision that "configured a print" would describe
  // uselessly: the shopper watches four lines appear on the artwork.
  const lines = textClause(input, result);
  if (lines && text(result.draft_id)) {
    return { message: `Agent ${lines}`, detail, pulse: "workbench", undoable: true };
  }
  // A crop-only revision of an existing draft is the most common shape by far,
  // and "configured a print" would describe it uselessly.
  const patch = configureCrop(input);
  const clause = patch ? cropClause(patch.crop, patch.role) : null;
  if (clause && text(result.draft_id)) {
    return { message: `Agent ${clause}`, detail, pulse: "workbench", undoable: true };
  }
  return {
    message: `Agent configured a ${productName(result)} ${placement}`,
    detail,
    pulse: "workbench",
    undoable: true,
  };
}

function reviseActivity(
  input: Record<string, unknown>,
  result: Record<string, unknown>,
): AgentActivity {
  const applied = count(result.applied_count) ?? 0;
  const skipped = count(result.skipped_count) ?? 0;
  if (applied === 0) {
    return { message: "Agent could not apply that framing", detail: "No draft took it", pulse: "workbench", undoable: false };
  }
  const clause = cropClause(input.crop, slotRole(input));
  const prints = `${applied} ${plural(applied, "print")}`;
  return {
    message: clause ? `Agent ${clause} across ${prints}` : `Agent reframed ${prints}`,
    detail: skipped > 0 ? `${skipped} left alone` : undefined,
    pulse: "workbench",
    undoable: true,
  };
}

function proposeActivity(result: Record<string, unknown>): AgentActivity {
  const proposed = count(result.proposed_count) ?? 0;
  if (proposed === 0) {
    return { message: "Agent staged nothing", detail: "No photograph could be staged", pulse: null, undoable: false };
  }
  const summary = isRecord(result.review_summary) ? result.review_summary : null;
  const ready = count(summary?.ready);
  const needsReview = count(summary?.needs_review);
  const detail = ready !== null && needsReview !== null && needsReview > 0
    ? `${ready} ready, ${needsReview} ${plural(needsReview, "needs", "need")} review`
    : `Waiting on you — accept or reject each card`;
  return {
    message: `Agent staged ${proposed} × ${productName(result)}`,
    detail,
    // The deck animates every card in on its own; a second pulse would fight it.
    pulse: null,
    undoable: true,
  };
}

function addToCartActivity(result: Record<string, unknown>): AgentActivity {
  const quantity = count(result.quantity) ?? 1;
  const name = productName(result);
  if (result.status === "added") {
    return {
      message: `Agent added ${quantity} × ${name} to the cart`,
      pulse: null,
      undoable: true,
    };
  }
  return {
    message: result.duplicate_of_pending_proposal === true
      ? `Agent re-checked its card for ${quantity} × ${name}`
      : `Agent proposed ${quantity} × ${name}`,
    detail: result.duplicate_of_pending_proposal === true
      ? "That card was already waiting"
      : "The card is waiting on your answer",
    pulse: null,
    undoable: result.duplicate_of_pending_proposal !== true,
  };
}

function resolveActivity(result: Record<string, unknown>): AgentActivity {
  // Setting a standing card's quantity is not an accept: nothing entered the
  // cart, so the line must not imply anything did.
  if (result.decision === "quantity_updated") {
    const quantity = count(result.quantity) ?? 1;
    return {
      message: `Agent set that card to ${quantity} ${plural(quantity, "copy", "copies")}`,
      detail: `${productName(result)} — still waiting on your answer`,
      pulse: null,
      undoable: true,
    };
  }
  const resolved = count(result.resolved_count) ?? 0;
  const accepted = result.decision === "accepted";
  const prints = `${resolved} ${plural(resolved, "print")}`;
  const remaining = count(result.pending_proposal_count) ?? 0;
  return {
    message: accepted ? `Agent relayed your yes to ${prints}` : `Agent relayed your no to ${prints}`,
    detail: remaining > 0
      ? `${remaining} ${plural(remaining, "card")} still waiting`
      : accepted ? `${count(result.cart_item_count) ?? 0} now in the cart` : undefined,
    pulse: null,
    undoable: true,
  };
}

function manageCartActivity(result: Record<string, unknown>): AgentActivity | null {
  // Viewing the cart changes nothing, so it is as read-only as ask_storefront
  // even though the tool it arrived on can also mutate.
  if (result.action === "view") return null;
  const items = count(result.cart_item_count) ?? 0;
  const message = result.action === "clear"
    ? "Agent cleared the cart"
    : result.action === "remove"
      ? "Agent removed a cart line"
      : "Agent changed a cart quantity";
  return {
    message,
    detail: `${items} ${plural(items, "print")} in the cart`,
    pulse: null,
    undoable: true,
  };
}

function undoActivity(result: Record<string, unknown>): AgentActivity {
  const undone = text(result.undone);
  const redoSteps = count(result.remaining_redo_steps) ?? 0;
  return {
    message: undone ? `Undid: ${undone}` : "Undid the last change",
    detail: redoSteps > 0
      ? "Redo is available"
      : count(result.remaining_undo_steps) === 0 ? "Nothing further to undo" : undefined,
    pulse: "workbench",
    // The visible Undo action can now genuinely reverse this redo-capable
    // history traversal rather than pretending the operation was one-way.
    undoable: false,
  };
}

function redoActivity(result: Record<string, unknown>): AgentActivity {
  const redone = text(result.redone);
  return {
    message: redone ? `Redid: ${redone}` : "Redid the last undone change",
    detail: count(result.remaining_redo_steps) === 0 ? "Nothing further to redo" : undefined,
    pulse: "workbench",
    // Redo restores its entry to the real undo stack, so the regular toast
    // action is truthful again.
    undoable: true,
  };
}

/**
 * The one place an action and its own response become a line of shopper-facing
 * text. Returns null when there is honestly nothing to say.
 */
export function agentActivity(
  action: string,
  input: unknown,
  result: unknown,
): AgentActivity | null {
  if (!isMutatingAgentAction(action)) return null;
  if (!isRecord(result)) return null;
  const safeInput = isRecord(input) ? input : {};

  switch (action) {
    case "configure_print": return configureActivity(safeInput, result);
    case "revise_prints": return reviseActivity(safeInput, result);
    case "propose_prints": return proposeActivity(result);
    case "add_to_cart": return addToCartActivity(result);
    case "resolve_cart_proposal": return resolveActivity(result);
    case "manage_cart": return manageCartActivity(result);
    case "undo_last_change": return undoActivity(result);
    case "redo_last_change": return redoActivity(result);
  }
}

/**
 * The label recorded with an undo snapshot, describing the change that is about
 * to happen — read back verbatim when it is undone, so "Undid: revise_prints
 * framing across 5 drafts" names the thing the shopper actually watched.
 *
 * Derived from the request rather than the response because the snapshot is
 * pushed before the mutation runs, and there is no response yet.
 */
export function agentActionLabel(action: string, input: unknown): string {
  const safeInput = isRecord(input) ? input : {};
  switch (action) {
    case "configure_print": {
      // No response exists yet, so the text clause is read from the request:
      // how many lines it is about to write is enough to name the change.
      const written = Array.isArray(safeInput.slotPatches) ? safeInput.slotPatches.filter(isRecord) : [];
      if (written.length > 0 && written.every((patch) => patch.operation === "set_text")) {
        return `configure_print ${written.length} text ${plural(written.length, "line")}`;
      }
      const patch = configureCrop(safeInput);
      const clause = patch ? cropClause(patch.crop, patch.role) : null;
      return clause ? `configure_print ${clause.replace(/^set |^centred /, "")}` : "configure_print";
    }
    case "revise_prints": {
      const ids = Array.isArray(safeInput.draftIds)
        ? safeInput.draftIds
        : Array.isArray(safeInput.draft_ids) ? safeInput.draft_ids : [];
      return `revise_prints framing across ${ids.length} ${plural(ids.length, "draft")}`;
    }
    case "propose_prints": {
      const refs = Array.isArray(safeInput.photoRefs)
        ? safeInput.photoRefs
        : Array.isArray(safeInput.photo_refs) ? safeInput.photo_refs : [];
      return `propose_prints staging ${refs.length} ${plural(refs.length, "print")}`;
    }
    case "add_to_cart": return "add_to_cart";
    case "resolve_cart_proposal": {
      const decision = text(safeInput.decision) ?? "accept";
      return `resolve_cart_proposal ${decision}`;
    }
    case "manage_cart": return `manage_cart ${text(safeInput.action) ?? "change"}`;
    case "redo_last_change": return "redo_last_change";
    default: return action;
  }
}
