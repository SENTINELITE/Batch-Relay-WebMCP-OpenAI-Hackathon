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

/**
 * The exact set_crop patch that reproduces a framing. Focus carries the whole
 * translation, so no residual offset delta remains; publishing this beside each
 * slot lets an agent read the current crop and ask for a relative change.
 */
export function cropPatchFromSlotTransform(
  transform: { zoom: number; offsetX: number; offsetY: number },
): { zoom: number; focusX: number; focusY: number; offsetX: number; offsetY: number } {
  return {
    zoom: clamp(transform.zoom, 1, 4),
    focusX: focusFromPreviewOffset(transform.offsetX),
    focusY: focusFromPreviewOffset(transform.offsetY),
    offsetX: 0,
    offsetY: 0,
  };
}

/** A crop patch may specify focus, offset, or both; each deliberate signal is retained. */
export function slotTransformFromCropPatch(
  current: { zoom: number; offsetX: number; offsetY: number },
  patch: { zoom?: number; focusX?: number; focusY?: number; offsetX?: number; offsetY?: number },
): { zoom: number; offsetX: number; offsetY: number } {
  return {
    zoom: clamp(typeof patch.zoom === "number" ? patch.zoom : current.zoom, 1, 4),
    offsetX: clamp((typeof patch.offsetX === "number" ? patch.offsetX : 0) + (typeof patch.focusX === "number" ? previewOffsetFromFocus(patch.focusX) : current.offsetX), -100, 100),
    offsetY: clamp((typeof patch.offsetY === "number" ? patch.offsetY : 0) + (typeof patch.focusY === "number" ? previewOffsetFromFocus(patch.focusY) : current.offsetY), -100, 100),
  };
}

/** Positive preview translation exposes more source pixels on the left/top. */
export function directCropFocus(frame: Pick<PrintDraft["directCrop"], "focusX" | "focusY" | "offsetX" | "offsetY">) {
  return {
    focusX: clamp(frame.focusX - (frame.offsetX ?? 0) / 2, 0, 100),
    focusY: clamp(frame.focusY - (frame.offsetY ?? 0) / 2, 0, 100),
  };
}
