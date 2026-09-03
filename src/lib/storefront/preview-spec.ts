import type { BrowserPreviewDocument, BrowserPreviewInputSlot, BrowserPreviewSurface } from "./browser-preview";
import type { TemplateContract, TemplateOutput } from "./client";

/**
 * Converts a published `batchrelay.render-template/v6` document into the
 * browser-preview subset that `browserPreviewCanvas` already accepts. This is
 * used only when the API's browser-preview endpoint is unavailable and a local
 * copy of the published spec is bundled for the template, so the shopper sees
 * the real composition instead of a synthesized approximation.
 *
 * The two models share the same anchor-relative geometry, so the conversion is
 * a faithful re-shaping rather than a re-layout:
 *   frame.anchor/offsetIn/sizeIn -> anchor/insetIn/sizeIn
 *   source { kind: "binding", key } -> imageSource + an exact input_slots row
 *   fit.mode -> fitMode
 */

/**
 * These types are a deliberately tolerant *reader's view* of the published
 * schema, not a full model of it: the index signatures absorb the many fields
 * the preview has no use for (blend modes, safety areas, orientation policy,
 * effective-PPI floors) so a verbatim copy of a published document type-checks
 * without being edited down.
 */
export type RenderTemplateSpecSlot = {
  [field: string]: unknown;
  key: string;
  kind: string;
  label?: string;
  semanticRole?: string;
  required?: boolean;
  requiredAspectRatio?: { width: number; height: number };
  /** The published effective-PPI floor for this slot, when the spec declares one. */
  minimumEffectivePpi?: number;
  maxLength?: number;
};

type SpecFill = {
  [field: string]: unknown;
  kind: string;
  color?: string;
  opacity?: number;
  angleDeg?: number;
  stops?: Array<{ offset: number; color: string }>;
};

export type RenderTemplateSpecLayer = {
  [field: string]: unknown;
  id: string;
  name?: string;
  kind: string;
  frame?: {
    anchor?: string;
    offsetIn?: { x: number; y: number };
    sizeIn?: { width: number; height: number };
  };
  rotationDeg?: number;
  opacity?: number;
  fills?: SpecFill[];
  source?: { kind: string; key?: string; assetRef?: string };
  content?: {
    kind?: string;
    fragments?: Array<{ kind?: string; key?: string; value?: string }>;
  };
  fit?: { mode?: string };
  cornerRadiusIn?: number;
  cornerRadiiIn?: { tl: number; tr: number; br: number; bl: number };
  color?: string;
  sample?: string;
  align?: string;
  verticalAlign?: string;
  typeSizePt?: number;
  fontFamily?: string;
  fontId?: string;
  fontWeight?: number;
  trackingEm?: number;
};

export type RenderTemplateSpecVariant = {
  [field: string]: unknown;
  id: string;
  name?: string;
  layers: RenderTemplateSpecLayer[];
};

export type RenderTemplateSpecSurface = {
  [field: string]: unknown;
  id: string;
  widthIn: number;
  heightIn: number;
  variants: RenderTemplateSpecVariant[];
};

export type RenderTemplateSpec = {
  [field: string]: unknown;
  schemaVersion: string;
  templateId: string;
  revisionId: string;
  revisionNumber?: number;
  name?: string;
  slots?: RenderTemplateSpecSlot[];
  surfaces: RenderTemplateSpecSurface[];
};

type ContractSlot = TemplateContract["slots"][number];

/**
 * Bundled specs are files that can be dropped into the repository, so a
 * template asset URL is only honoured when it points at a known public image
 * host. This keeps the preview from being pointed at an arbitrary origin.
 */
const trustedTemplateAssetHosts: ReadonlySet<string> = new Set(["images.batchrelay.com"]);

/**
 * Public template art is served from a credential-free CDN, so it is used
 * directly and deliberately never routed through the credentialed API proxy.
 * Returns null for anything not on the allowlist, including the `builtin:`
 * refs whose bytes only the API can resolve.
 */
export function publicTemplateAssetURL(assetRef: string | undefined): string | null {
  if (typeof assetRef !== "string" || !assetRef.startsWith("https://")) return null;
  let parsed: URL;
  try {
    parsed = new URL(assetRef);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  return trustedTemplateAssetHosts.has(parsed.hostname) ? parsed.toString() : null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function aspectKey(ratio: { width?: number; height?: number } | undefined): string | null {
  const width = positive(ratio?.width);
  const height = positive(ratio?.height);
  return width === null || height === null ? null : (width / height).toFixed(4);
}

function uniqueMatch(candidates: readonly ContractSlot[]): ContractSlot | null {
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * The published spec names slots semantically ("athlete.portrait.5x7") while
 * the storefront binds everything by the contract's stable key
 * ("image_122qlv9"). The preview has to speak the contract's language, so spec
 * keys are resolved against the contract in order of decreasing certainty and
 * every match is claimed exactly once.
 */
export function contractSlotKeysForSpec(
  specSlots: readonly RenderTemplateSpecSlot[],
  contractSlots: readonly ContractSlot[],
): ReadonlyMap<string, string> {
  const resolved = new Map<string, string>();
  const unclaimed = [...contractSlots].sort((left, right) => left.ordinal - right.ordinal);
  const pending: RenderTemplateSpecSlot[] = [];

  function claim(specSlot: RenderTemplateSpecSlot, contractSlot: ContractSlot | null): boolean {
    if (!contractSlot) return false;
    resolved.set(specSlot.key, contractSlot.key);
    unclaimed.splice(unclaimed.indexOf(contractSlot), 1);
    return true;
  }

  for (const specSlot of specSlots) {
    const exact = unclaimed.find((slot) => slot.key === specSlot.key && slot.kind === specSlot.kind);
    if (!claim(specSlot, exact ?? null)) pending.push(specSlot);
  }
  for (const stage of ["aspect", "label", "semantic"] as const) {
    for (const specSlot of pending.splice(0, pending.length)) {
      const sameKind = unclaimed.filter((slot) => slot.kind === specSlot.kind);
      const specAspect = aspectKey(specSlot.requiredAspectRatio);
      const match = stage === "aspect"
        ? (specAspect === null ? null : uniqueMatch(sameKind.filter((slot) => aspectKey(slot.expected_aspect_ratio) === specAspect)))
        : stage === "label"
          ? (!specSlot.label ? null : uniqueMatch(sameKind.filter((slot) => slot.suggested_label === specSlot.label)))
          : (!specSlot.semanticRole ? null : uniqueMatch(sameKind.filter((slot) => slot.suggested_semantic_key === specSlot.semanticRole)));
      if (!claim(specSlot, match)) pending.push(specSlot);
    }
  }
  // Anything still ambiguous falls back to declaration order within its kind.
  for (const specSlot of pending) {
    claim(specSlot, unclaimed.find((slot) => slot.kind === specSlot.kind) ?? null);
  }
  return resolved;
}

function fillsFor(layer: RenderTemplateSpecLayer): SpecFill[] | undefined {
  return Array.isArray(layer.fills) && layer.fills.length > 0 ? layer.fills : undefined;
}

/**
 * The preview renderer paints a shape's first fill as an opaque background and
 * applies transparency at the layer. Folding a solid fill's own opacity into
 * the layer keeps a published tint compositing exactly as the spec intends
 * without loosening the renderer.
 */
function shapeOpacity(layer: RenderTemplateSpecLayer): number {
  const layerOpacity = typeof layer.opacity === "number" && Number.isFinite(layer.opacity) ? layer.opacity : 1;
  const fill = fillsFor(layer)?.[0];
  const fillOpacity = fill?.kind === "solid" && typeof fill.opacity === "number" && Number.isFinite(fill.opacity) ? fill.opacity : 1;
  return Math.min(1, Math.max(0, layerOpacity * fillOpacity));
}

type ConvertedTextFragment =
  | { kind: "literal"; value: string }
  | { kind: "binding"; slotKey: string; placeholder?: string };

function textFragmentsFor(
  layer: RenderTemplateSpecLayer,
  slotKeys: ReadonlyMap<string, string>,
  slotLabels: ReadonlyMap<string, string>,
): ConvertedTextFragment[] | undefined {
  if (layer.content?.kind !== "composition" || !Array.isArray(layer.content.fragments)) return undefined;
  const fragments: ConvertedTextFragment[] = [];
  for (const fragment of layer.content.fragments) {
    if (fragment.kind === "literal" && typeof fragment.value === "string") {
      fragments.push({ kind: "literal", value: fragment.value });
      continue;
    }
    if (fragment.kind === "binding" && fragment.key) {
      const slotKey = slotKeys.get(fragment.key);
      if (slotKey) fragments.push({ kind: "binding", slotKey, placeholder: slotLabels.get(fragment.key) });
    }
  }
  return fragments.some((fragment) => fragment.kind === "binding") ? fragments : undefined;
}

function browserFontFamily(layer: RenderTemplateSpecLayer): string | undefined {
  const family = layer.fontFamily ?? layer.fontId;
  return family === "barlow-semi-condensed"
    ? "var(--font-barlow-semi-condensed), 'Arial Narrow', sans-serif"
    : family;
}

function convertLayer(layer: RenderTemplateSpecLayer, slotKeys: ReadonlyMap<string, string>, slotLabels: ReadonlyMap<string, string>): Record<string, unknown> | null {
  const offsetIn = layer.frame?.offsetIn;
  const sizeIn = layer.frame?.sizeIn;
  if (!layer.id || !offsetIn || !sizeIn) return null;
  // Template art hosted on the public CDN is drawn as published. Any other
  // ref (notably `builtin:`) resolves only through the API that is down, so
  // those layers are dropped rather than drawn as empty placeholders.
  const publicAssetURL = layer.source?.kind === "templateAsset" ? publicTemplateAssetURL(layer.source.assetRef) : null;
  if (layer.source?.kind === "templateAsset" && !publicAssetURL) return null;
  const boundKey = layer.source?.kind === "binding" && layer.source.key ? slotKeys.get(layer.source.key) ?? null : null;
  const boundLabel = layer.source?.kind === "binding" && layer.source.key ? slotLabels.get(layer.source.key) : undefined;
  if (layer.kind === "image" && !boundKey && !publicAssetURL) return null;
  const role = boundKey ?? layer.name ?? layer.id;
  const common = {
    id: layer.id,
    role,
    anchor: layer.frame?.anchor ?? "tl",
    insetIn: { x: offsetIn.x, y: offsetIn.y },
    sizeIn: { width: sizeIn.width, height: sizeIn.height },
    rotationDeg: layer.rotationDeg ?? 0,
    cornerRadiusIn: layer.cornerRadiusIn ?? 0,
    cornerRadiiIn: layer.cornerRadiiIn,
  };
  if (layer.kind === "image") {
    return {
      ...common,
      kind: "image",
      opacity: layer.opacity ?? 1,
      fitMode: layer.fit?.mode ?? "cover",
      inputSlotLabel: boundLabel,
      imageSource: publicAssetURL
        ? { kind: "templateAsset", assetRef: layer.source?.assetRef }
        : { kind: "binding" },
    };
  }
  if (layer.kind === "shape") {
    const fills = fillsFor(layer);
    // The first fill's own opacity has been folded into the layer, so it is
    // reset here rather than left to composite a second time.
    const flattened = fills?.map((fill, index) => (index === 0 && fill.kind === "solid" ? { ...fill, opacity: 1 } : fill));
    return { ...common, kind: "shape", opacity: shapeOpacity(layer), fills: flattened };
  }
  return {
    ...common,
    kind: "text",
    opacity: layer.opacity ?? 1,
    color: layer.color,
    sample: layer.sample ?? null,
    textFragments: textFragmentsFor(layer, slotKeys, slotLabels),
    align: layer.align,
    verticalAlign: layer.verticalAlign,
    typeSizePt: layer.typeSizePt,
    fontFamily: browserFontFamily(layer),
    fontWeight: layer.fontWeight,
    trackingEm: layer.trackingEm,
  };
}

/** A full-bleed opaque solid shape doubles as the canvas base colour. */
function baseColorFor(surface: RenderTemplateSpecSurface, variant: RenderTemplateSpecVariant): string | undefined {
  for (const layer of variant.layers) {
    if (layer.kind !== "shape" || (layer.opacity ?? 1) < 1) continue;
    const fill = fillsFor(layer)?.[0];
    if (fill?.kind !== "solid" || !fill.color || (fill.opacity ?? 1) < 1) continue;
    if (layer.frame?.sizeIn?.width === surface.widthIn && layer.frame.sizeIn.height === surface.heightIn) return fill.color;
  }
  return undefined;
}

type SurfaceSelection = { surface: RenderTemplateSpecSurface; variant: RenderTemplateSpecVariant; published?: TemplateContractSurface };

type TemplateContractSurface = NonNullable<TemplateContract["output"]["surfaces"]>[number];

/**
 * The storefront's output id ("memory-mate-8x10-portrait-a") is the spec's
 * surface id joined to its variant id. The working contract endpoint publishes
 * that pairing outright, so it is trusted first and the naming convention is
 * only a fallback.
 */
function selectSurfaces(spec: RenderTemplateSpec, contract: TemplateContract, output: TemplateOutput): SurfaceSelection[] {
  function pair(surfaceID: string, variantID: string, published?: TemplateContractSurface): SurfaceSelection | null {
    const surface = spec.surfaces.find((candidate) => candidate.id === surfaceID);
    const variant = surface?.variants.find((candidate) => candidate.id === variantID);
    return surface && variant ? { surface, variant, published } : null;
  }

  // When the contract publishes the pairing it is authoritative and exclusive:
  // if it names a surface the bundled copy does not contain, the copy simply
  // does not cover this output. A bundled copy holds only the surfaces it was
  // taken with, so "the spec has one surface" is never evidence of coverage.
  const published = contract.output.surfaces ?? [];
  if (published.length > 0) {
    return published.flatMap((entry) => {
      const selection = pair(entry.id, entry.variant_id, entry);
      return selection ? [selection] : [];
    });
  }

  return spec.surfaces.flatMap((surface) => surface.variants
    .filter((variant) => `${surface.id}-${variant.id}` === output.id)
    .map((variant) => ({ surface, variant })));
}

/**
 * Builds a browser preview document from a bundled copy of the published spec.
 * Returns null when the spec does not cover the requested output, so callers
 * can fall back to a synthesized layout.
 */
export function specBrowserPreviewDocument({
  spec,
  contract,
  output,
}: {
  spec: RenderTemplateSpec;
  contract: TemplateContract;
  output: TemplateOutput;
}): BrowserPreviewDocument | null {
  if (spec.templateId !== contract.template.id) return null;
  const selections = selectSurfaces(spec, contract, output);
  if (selections.length === 0) return null;

  const slotKeys = contractSlotKeysForSpec(spec.slots ?? [], contract.slots);
  const slotLabels = new Map((spec.slots ?? []).flatMap((slot) => slot.label ? [[slot.key, slot.label] as const] : []));
  const inputSlots: BrowserPreviewInputSlot[] = [];
  const surfaces: BrowserPreviewSurface[] = [];
  const documentSurfaces: unknown[] = [];
  const assets = new Map<string, BrowserPreviewDocument["assets"][number]>();

  selections.forEach((selection, index) => {
    const { surface, variant, published } = selection;
    const nodes = variant.layers.flatMap((layer) => {
      const converted = convertLayer(layer, slotKeys, slotLabels);
      if (!converted) return [];
      if (layer.source?.kind === "binding" && layer.kind === "image") {
        const slotKey = layer.source.key ? slotKeys.get(layer.source.key) : undefined;
        if (slotKey) inputSlots.push({ surface_id: surface.id, variant_id: variant.id, node_id: layer.id, slot_key: slotKey });
      }
      if (layer.source?.kind === "templateAsset") {
        const contentURL = publicTemplateAssetURL(layer.source.assetRef);
        // The ref is the absolute CDN URL, so it is its own content URL.
        if (contentURL && layer.source.assetRef) {
          assets.set(layer.source.assetRef, { asset_ref: layer.source.assetRef, kind: "public_template_asset", content_url: contentURL });
        }
      }
      return [converted];
    });
    const baseColor = baseColorFor(surface, variant);
    documentSurfaces.push({
      id: surface.id,
      widthIn: surface.widthIn,
      heightIn: surface.heightIn,
      variants: [{ id: variant.id, background: baseColor ? { baseColor, art: "none" } : undefined, nodes }],
    });
    surfaces.push({
      id: surface.id,
      variant_id: variant.id,
      width_in: published?.width_in ?? surface.widthIn,
      height_in: published?.height_in ?? surface.heightIn,
      fulfillment_role: published?.fulfillment_role ?? "artwork",
      ordinal: published?.ordinal ?? index,
    });
  });

  return {
    preview_source: "local_published_copy",
    template: {
      id: contract.template.id,
      revision_id: contract.template.revision_id,
      revision_number: contract.template.revision_number,
      // Held locally rather than fetched, so no published digest is asserted.
      document_sha256: "",
      browser_document: { surfaces: documentSurfaces },
      browser_document_sha256: "",
    },
    output: { id: output.id, surfaces },
    input_slots: inputSlots,
    assets: [...assets.values()],
  };
}

/**
 * The published important-content inset, as a fraction of each axis.
 *
 * The print-review heuristics ask how close to the trim a framing has carried
 * the subject, and a template that publishes `surfaceGeometry.importantContentArea`
 * has already answered that in inches. Reading it here means the warning is
 * grounded in the template's own safety geometry rather than a house number;
 * `null` sends the caller to its documented default.
 */
export function specImportantContentMargin(
  spec: RenderTemplateSpec,
  surfaceID?: string,
): { x: number; y: number } | null {
  const surface = (surfaceID ? spec.surfaces.find((candidate) => candidate.id === surfaceID) : spec.surfaces[0])
    ?? spec.surfaces[0];
  if (!surface) return null;
  const geometry = surface.surfaceGeometry as { outputBoundsIn?: { width?: number; height?: number }; importantContentArea?: { insetIn?: Record<string, unknown> } } | undefined;
  const width = positive(geometry?.outputBoundsIn?.width) ?? positive(surface.widthIn);
  const height = positive(geometry?.outputBoundsIn?.height) ?? positive(surface.heightIn);
  if (!width || !height) return null;

  const inset = geometry?.importantContentArea?.insetIn;
  const edge = (name: string) => {
    const value = inset?.[name];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const horizontal = Math.max(edge("left") ?? 0, edge("right") ?? 0);
  const vertical = Math.max(edge("top") ?? 0, edge("bottom") ?? 0);
  if (horizontal > 0 || vertical > 0) return { x: horizontal / width, y: vertical / height };

  // Older surfaces publish the same fact as one scalar under `safety`.
  const safety = surface.safety as { importantContentInsetIn?: unknown } | undefined;
  const scalar = positive(typeof safety?.importantContentInsetIn === "number" ? safety.importantContentInsetIn : null);
  return scalar === null ? null : { x: scalar / width, y: scalar / height };
}

/**
 * The strictest effective-PPI floor any image slot in the spec publishes.
 *
 * Taken across the whole spec rather than per slot: matching spec slot keys to
 * contract keys needs a contract, and a template that expects 300 PPI of one
 * image expects it of the others too. `null` means the spec declared none.
 */
export function specMinimumEffectivePpi(spec: RenderTemplateSpec): number | null {
  const floors = (spec.slots ?? [])
    .filter((slot) => slot.kind === "image")
    .flatMap((slot) => {
      const value = positive(slot.minimumEffectivePpi ?? null);
      return value === null ? [] : [value];
    });
  return floors.length > 0 ? Math.min(...floors) : null;
}

/**
 * Reads a bundled `*.render-request.json` file into a spec the converter can
 * use, accepting either the render-request wrapper or a bare template
 * document. Returns null rather than throwing so one malformed file can never
 * take the whole registry down with it.
 */
export function renderTemplateSpecFromRequest(value: unknown): RenderTemplateSpec | null {
  if (!value || typeof value !== "object") return null;
  const wrapper = value as { template?: unknown };
  const candidate = (wrapper.template && typeof wrapper.template === "object" ? wrapper.template : value) as Partial<RenderTemplateSpec>;
  if (typeof candidate.templateId !== "string" || !candidate.templateId) return null;
  if (typeof candidate.revisionId !== "string" || !candidate.revisionId) return null;
  if (!Array.isArray(candidate.surfaces) || candidate.surfaces.length === 0) return null;
  const surfaces = candidate.surfaces.filter((surface) =>
    surface
    && typeof surface.id === "string"
    && typeof surface.widthIn === "number"
    && typeof surface.heightIn === "number"
    && Array.isArray(surface.variants)
    && surface.variants.every((variant) => variant && typeof variant.id === "string" && Array.isArray(variant.layers)));
  if (surfaces.length === 0) return null;
  return {
    ...candidate,
    schemaVersion: typeof candidate.schemaVersion === "string" ? candidate.schemaVersion : "",
    templateId: candidate.templateId,
    revisionId: candidate.revisionId,
    slots: Array.isArray(candidate.slots) ? candidate.slots : [],
    surfaces,
  };
}
