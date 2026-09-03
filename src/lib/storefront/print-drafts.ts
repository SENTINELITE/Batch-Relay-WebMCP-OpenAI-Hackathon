import type { CatalogProduct, PublishedTemplate, TemplateOutput } from "./client";

export type DraftProofState = "idle" | "preparing" | "proofing" | "ready" | "unavailable";

/** Browser-local configuration metadata.  Drafts deliberately retain photo IDs,
 * never File contents or managed image bytes. */
export type PrintDraft = {
  id: string;
  productId: string;
  productRevision: number;
  photoIds: string[];
  template?: { id: string; outputId: string; revisionId: string };
  templateContractKnown: boolean;
  requiredSlotKeys: string[];
  slotAssignments: Record<string, string>;
  textValues: Record<string, string>;
  slotTransforms: Record<string, { zoom: number; offsetX: number; offsetY: number }>;
  directCrop: { zoom: number; focusX: number; focusY: number; offsetX?: number; offsetY?: number };
  proofState: DraftProofState;
  createdAt: string;
  updatedAt: string;
};

export type DraftPatch = Omit<Partial<Pick<PrintDraft, "photoIds" | "template" | "templateContractKnown" | "requiredSlotKeys" | "slotAssignments" | "textValues" | "slotTransforms" | "proofState">>, "directCrop"> & {
  directCrop?: Partial<PrintDraft["directCrop"]>;
};

export function createPrintDraft(product: CatalogProduct, photoIds: string[]): PrintDraft {
  const now = new Date().toISOString();
  return {
    id: `draft_${crypto.randomUUID()}`,
    productId: product.id,
    productRevision: product.revision,
    photoIds: [...photoIds],
    templateContractKnown: false,
    requiredSlotKeys: [],
    slotAssignments: {},
    textValues: {},
    slotTransforms: {},
    directCrop: { zoom: 1, focusX: 50, focusY: 50, offsetX: 0, offsetY: 0 },
    proofState: "idle",
    createdAt: now,
    updatedAt: now,
  };
}

export function patchPrintDraft(draft: PrintDraft, patch: DraftPatch): PrintDraft {
  return {
    ...draft,
    ...patch,
    photoIds: patch.photoIds ? [...patch.photoIds] : draft.photoIds,
    requiredSlotKeys: patch.requiredSlotKeys ? [...patch.requiredSlotKeys] : draft.requiredSlotKeys,
    slotAssignments: patch.slotAssignments ? { ...patch.slotAssignments } : draft.slotAssignments,
    textValues: patch.textValues ? { ...patch.textValues } : draft.textValues,
    slotTransforms: patch.slotTransforms ? { ...patch.slotTransforms } : draft.slotTransforms,
    directCrop: patch.directCrop ? { ...draft.directCrop, ...patch.directCrop } : draft.directCrop,
    updatedAt: new Date().toISOString(),
  };
}

export function isCompleteTemplateDraft(draft: PrintDraft): boolean {
  return missingTemplateDraftRequirements(draft).length === 0;
}

/** Stable requirement keys let the bridge explain exactly what remains before proof or cart. */
export function missingTemplateDraftRequirements(draft: PrintDraft): string[] {
  if (!draft.template) return ["published_template_output"];
  if (!draft.templateContractKnown) return ["published_template_contract"];
  return draft.requiredSlotKeys.filter((slotKey) =>
    !draft.slotAssignments[slotKey] && !draft.textValues[slotKey]?.trim());
}

/**
 * A missing requirement stated in words the agent can hand straight to the
 * shopper. A bare slot key invites an agent to guess a photograph; a named role
 * and a written question invite it to ask.
 */
export type MissingRequirement = {
  slot_key: string;
  label: string | null;
  kind: "image" | "text" | "template";
  aliases: string[];
  ask_shopper: string;
};

type DescribableSlot = { key: string; kind: "image" | "text"; suggested_label?: string | null };

/** The role word an agent and a shopper would both recognise for this slot. */
function requirementName(slot: DescribableSlot, aliases: readonly string[]): string {
  return aliases[0] ?? slot.suggested_label ?? slot.key.replace(/[_-]+/g, " ");
}

export function askShopperForRequirement(slot: DescribableSlot, aliases: readonly string[]): string {
  const name = requirementName(slot, aliases);
  return slot.kind === "text"
    ? `What should the ${name} say?`
    : `Which photo should be the ${name} image?`;
}

/**
 * Turns the stable requirement keys into slot facts plus a written question.
 * The two template-level sentinels describe themselves, because neither is
 * something the shopper can answer with a photograph.
 */
export function describeMissingRequirements(
  missing: readonly string[],
  slots: readonly DescribableSlot[],
  aliasesBySlotKey: Readonly<Record<string, readonly string[]>>,
): MissingRequirement[] {
  return missing.map((key) => {
    const slot = slots.find((candidate) => candidate.key === key);
    if (!slot) {
      return {
        slot_key: key,
        label: null,
        kind: "template" as const,
        aliases: [],
        ask_shopper: key === "published_template_output"
          ? "No compatible published template output is applied yet; ask the shopper which layout they want."
          : "The published template contract has not loaded yet; retry configure_print before asking the shopper for photographs.",
      };
    }
    const aliases = [...(aliasesBySlotKey[slot.key] ?? [])];
    return {
      slot_key: slot.key,
      label: slot.suggested_label ?? null,
      kind: slot.kind,
      aliases,
      ask_shopper: askShopperForRequirement(slot, aliases),
    };
  });
}

/**
 * The top-level instruction. Naming the slots and forbidding a guess is what
 * turns a silently incomplete draft into a question the shopper gets asked.
 */
export function missingRequirementsGuidance(missing: readonly MissingRequirement[]): string | null {
  if (missing.length === 0) return null;
  const questions = missing.map((requirement) => requirement.ask_shopper).join(" ");
  const names = missing.map((requirement) => requirement.aliases[0] ?? requirement.label ?? requirement.slot_key).join(", ");
  return `This draft is not finished: ${names} still unfilled. Ask the shopper — ${questions} — and wait for their answer before calling configure_print again. Do not choose photographs for them, and do not call add_to_cart until every named requirement is filled.`;
}

type TemplateRequirementSlot = { key: string; kind: "image" | "text"; required: boolean };

/**
 * Memory Mate's published product contract requires an individual and team
 * image. Some older template contracts mark those image inputs optional, so
 * the visible product requirement is the stricter, effective requirement.
 */
export function effectiveTemplateSlotRequired(
  product: Pick<CatalogProduct, "id">,
  slot: TemplateRequirementSlot,
): boolean {
  return slot.required || (product.id === "memory-mate-8x10" && slot.kind === "image");
}

export function effectiveRequiredTemplateSlotKeys(
  product: Pick<CatalogProduct, "id">,
  slots: readonly TemplateRequirementSlot[],
): string[] {
  return slots.filter((slot) => effectiveTemplateSlotRequired(product, slot)).map((slot) => slot.key);
}

/**
 * Product matching is deliberately grounded in returned fields.  It accepts
 * natural requests such as "an 8 by 10 print", but only resolves when one
 * live product is the clear match.
 */
export function naturalProductMatches(products: CatalogProduct[], query: string): CatalogProduct[] {
  const dimension = query.toLowerCase().match(/\b(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\b/);
  const normalized = query.toLowerCase().replace(/[×x]/g, " by ").replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return [];
  const dimensionPair = dimension ? { width: Number(dimension[1]), height: Number(dimension[2]) } : null;
  const remaining = dimension ? query.slice(0, dimension.index) + query.slice((dimension.index ?? 0) + dimension[0].length) : query;
  const tokens = new Set(remaining.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean));
  return products.filter((product) => {
    if (dimensionPair && (!product.physical_output || product.physical_output.width !== dimensionPair.width || product.physical_output.height !== dimensionPair.height)) return false;
    const searchable = `${product.id} ${product.name} ${product.description} ${product.category} ${product.fulfillment_type}`
      .toLowerCase().replace(/[^a-z0-9]+/g, " ");
    return [...tokens].every((token) => searchable.includes(token));
  });
}

/** Product-type filtering stays separate from the shopper's free-form query. */
export function productTypeMatches(product: Pick<CatalogProduct, "category" | "fulfillment_type">, productType: string): boolean {
  const normalized = productType.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return true;
  const returnedType = `${product.category} ${product.fulfillment_type}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return normalized.split(/\s+/).every((token) => returnedType.includes(token));
}

export function rememberedCompatibleOutput(
  remembered: PrintDraft["template"] | undefined,
  templateId: string,
  revisionId: string,
  outputs: TemplateOutput[],
): TemplateOutput | null {
  if (!remembered || remembered.id !== templateId || remembered.revisionId !== revisionId) return null;
  return outputs.find((output) => output.id === remembered.outputId) ?? null;
}

export function draftTemplate(template: PublishedTemplate, output: TemplateOutput, revisionId: string): NonNullable<PrintDraft["template"]> {
  return { id: template.id, outputId: output.id, revisionId };
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

/** Maps a 0–100 focus point onto the centered preview transform vocabulary. */
export function previewOffsetFromFocus(focus: number): number {
  return clamp((50 - focus) * 2, -100, 100);
}

/** The inverse of previewOffsetFromFocus, so a framing can name its own focus. */
export function focusFromPreviewOffset(offset: number): number {
  return clamp(50 - offset / 2, 0, 100);
}

export type SlotCropGeometry = {
  sourceAspectRatio: number | null;
  targetAspectRatio: number | null;
};

/**
 * Maps crop focus onto the preview's actual translation unit: a percentage of
 * the full source image. The older geometry-free mapping treated the focus as
 * if every crop had the same amount of overflow, which pushed edge faces all
 * the way to the pan limit after zooming.
 */
function geometricPreviewOffset(
  focus: number,
  sourceAspectRatio: number,
  targetAspectRatio: number,
  zoom: number,
  axis: "x" | "y",
): number {
  const wider = sourceAspectRatio > targetAspectRatio;
  const baseVisible = axis === "x"
    ? (wider ? targetAspectRatio / sourceAspectRatio : 1)
    : (wider ? 1 : sourceAspectRatio / targetAspectRatio);
  const visible = clamp(baseVisible / zoom, 0, 1);
  return (1 - visible) * (50 - clamp(focus, 0, 100));
}

function geometricFocusFromPreviewOffset(
  offset: number,
  sourceAspectRatio: number,
  targetAspectRatio: number,
  zoom: number,
  axis: "x" | "y",
): number {
  const wider = sourceAspectRatio > targetAspectRatio;
  const baseVisible = axis === "x"
    ? (wider ? targetAspectRatio / sourceAspectRatio : 1)
    : (wider ? 1 : sourceAspectRatio / targetAspectRatio);
  const slack = 1 - clamp(baseVisible / zoom, 0, 1);
  return slack <= 0 ? 50 : clamp(50 - offset / slack, 0, 100);
}

function validCropGeometry(geometry: SlotCropGeometry | undefined): geometry is { sourceAspectRatio: number; targetAspectRatio: number } {
  return Boolean(
    geometry &&
    typeof geometry.sourceAspectRatio === "number" && Number.isFinite(geometry.sourceAspectRatio) && geometry.sourceAspectRatio > 0 &&
    typeof geometry.targetAspectRatio === "number" && Number.isFinite(geometry.targetAspectRatio) && geometry.targetAspectRatio > 0,
  );
}

/**
 * The exact set_crop patch that reproduces a framing. Focus carries the whole
 * translation, so no residual offset delta remains; publishing this beside each
 * slot lets an agent read the current crop and ask for a relative change.
 */
export function cropPatchFromSlotTransform(
  transform: { zoom: number; offsetX: number; offsetY: number },
  geometry?: SlotCropGeometry,
): { zoom: number; focusX: number; focusY: number; offsetX: number; offsetY: number } {
  const zoom = clamp(transform.zoom, 1, 4);
  return {
    zoom,
    focusX: validCropGeometry(geometry)
      ? geometricFocusFromPreviewOffset(transform.offsetX, geometry.sourceAspectRatio, geometry.targetAspectRatio, zoom, "x")
      : focusFromPreviewOffset(transform.offsetX),
    focusY: validCropGeometry(geometry)
      ? geometricFocusFromPreviewOffset(transform.offsetY, geometry.sourceAspectRatio, geometry.targetAspectRatio, zoom, "y")
      : focusFromPreviewOffset(transform.offsetY),
    offsetX: 0,
    offsetY: 0,
  };
}

/** A crop patch may specify focus, offset, or both; each deliberate signal is retained. */
export function slotTransformFromCropPatch(
  current: { zoom: number; offsetX: number; offsetY: number },
  patch: { zoom?: number; focusX?: number; focusY?: number; offsetX?: number; offsetY?: number },
  geometry?: SlotCropGeometry,
): { zoom: number; offsetX: number; offsetY: number } {
  const zoom = clamp(typeof patch.zoom === "number" ? patch.zoom : current.zoom, 1, 4);
  const focusOffset = (focus: number, axis: "x" | "y") => validCropGeometry(geometry)
    ? geometricPreviewOffset(focus, geometry.sourceAspectRatio, geometry.targetAspectRatio, zoom, axis)
    : previewOffsetFromFocus(focus);
  return {
    zoom,
    offsetX: clamp((typeof patch.offsetX === "number" ? patch.offsetX : 0) + (typeof patch.focusX === "number" ? focusOffset(patch.focusX, "x") : current.offsetX), -100, 100),
    offsetY: clamp((typeof patch.offsetY === "number" ? patch.offsetY : 0) + (typeof patch.focusY === "number" ? focusOffset(patch.focusY, "y") : current.offsetY), -100, 100),
  };
}

/** Positive preview translation exposes more source pixels on the left/top. */
export function directCropFocus(frame: Pick<PrintDraft["directCrop"], "focusX" | "focusY" | "offsetX" | "offsetY">) {
  return {
    focusX: clamp(frame.focusX - (frame.offsetX ?? 0) / 2, 0, 100),
    focusY: clamp(frame.focusY - (frame.offsetY ?? 0) / 2, 0, 100),
  };
}
