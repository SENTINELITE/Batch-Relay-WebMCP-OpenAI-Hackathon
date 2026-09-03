import type { BrowserPreviewDocument, BrowserPreviewInputSlot } from "./browser-preview";
import type { TemplateContract, TemplateOutput } from "./client";

/**
 * A locally synthesized stand-in for the published browser document, used only
 * when the API's browser-preview endpoint is unavailable. It never claims to be
 * published artwork: the document is tagged `preview_source: "fallback"`, it
 * carries no digests, and it references no published template assets. Every
 * node it emits stays inside the exact subset `browserPreviewCanvas` accepts.
 */

/** Warm neutrals lifted from the storefront theme so the stand-in still looks like the app. */
const fallbackBackgroundColor = "#fbf2eb";
const fallbackInkColor = "#17110c";
const fallbackMatColor = "#ffffff";
const fallbackKeylineColor = "#d9cbbe";

type ContractSlot = TemplateContract["slots"][number];

type Rect = { x: number; y: number; width: number; height: number };

export type BrowserPreviewFallbackInput = {
  templateID: string;
  contract: TemplateContract;
  output: TemplateOutput;
};

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function slotAspectRatio(slot: ContractSlot | undefined, fallback: number): number {
  const width = positive(slot?.expected_aspect_ratio?.width);
  const height = positive(slot?.expected_aspect_ratio?.height);
  return width !== null && height !== null ? width / height : fallback;
}

function sampleText(slot: ContractSlot): string {
  const label = slot.suggested_label?.trim() || slot.key;
  const limit = positive(slot.max_length);
  return limit === null ? label : label.slice(0, Math.floor(limit));
}

/** Image slots keep contract order: the first slot is always the hero. */
function imageRects(slots: readonly ContractSlot[], area: Rect, gap: number): Rect[] {
  if (slots.length === 0) return [];
  if (slots.length === 1) return [area];
  if (slots.length === 2) {
    // Memory-mate shape: a full hero with the second slot inset over its
    // bottom-right corner, which is how composites actually read in print.
    const insetWidth = Math.max(0.01, area.width * 0.32);
    const insetHeight = Math.max(0.01, Math.min(area.height * 0.5, insetWidth / slotAspectRatio(slots[1], 0.8)));
    return [
      area,
      {
        x: area.x + area.width - gap - insetWidth,
        y: area.y + area.height - gap - insetHeight,
        width: insetWidth,
        height: insetHeight,
      },
    ];
  }
  const remaining = slots.length - 1;
  const columns = Math.min(remaining, 3);
  const rows = Math.ceil(remaining / columns);
  const heroHeight = Math.max(0.01, area.height * 0.58);
  const gridHeight = Math.max(0.01, area.height - heroHeight - gap);
  const cellWidth = Math.max(0.01, (area.width - gap * (columns - 1)) / columns);
  const cellHeight = Math.max(0.01, (gridHeight - gap * (rows - 1)) / rows);
  const rects: Rect[] = [{ x: area.x, y: area.y, width: area.width, height: heroHeight }];
  for (let index = 0; index < remaining; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    rects.push({
      x: area.x + column * (cellWidth + gap),
      y: area.y + heroHeight + gap + row * (cellHeight + gap),
      width: cellWidth,
      height: cellHeight,
    });
  }
  return rects;
}

function imageNode(slot: ContractSlot, rect: Rect) {
  return {
    id: `fallback_${slot.key}`,
    kind: "image",
    role: slot.key,
    anchor: "tl",
    insetIn: { x: round(rect.x), y: round(rect.y) },
    sizeIn: { width: round(Math.max(0.01, rect.width)), height: round(Math.max(0.01, rect.height)) },
    rotationDeg: 0,
    opacity: 1,
    fitMode: "cover",
    cornerRadiusIn: 0.04,
    imageSource: { kind: "binding" },
  };
}

function matNode(slot: ContractSlot, rect: Rect, pad: number) {
  return {
    id: `fallback_mat_${slot.key}`,
    kind: "shape",
    role: "fallback_mat",
    anchor: "tl",
    insetIn: { x: round(rect.x - pad), y: round(rect.y - pad) },
    sizeIn: { width: round(Math.max(0.01, rect.width + pad * 2)), height: round(Math.max(0.01, rect.height + pad * 2)) },
    rotationDeg: 0,
    opacity: 1,
    cornerRadiusIn: 0.06,
    fills: [{ kind: "solid", color: fallbackMatColor, opacity: 1 }],
  };
}

export function fallbackBrowserPreviewDocument({
  templateID,
  contract,
  output,
}: BrowserPreviewFallbackInput): BrowserPreviewDocument | null {
  const product = output.products?.[0];
  const widthIn = positive(product?.width_in);
  const heightIn = positive(product?.height_in);
  if (!templateID || !output.id || widthIn === null || heightIn === null) return null;

  const surfaceID = `${output.id}__fallback`;
  const variantID = "fallback";
  const ordered = [...contract.slots].sort((left, right) => left.ordinal - right.ordinal);
  const imageSlots = ordered.filter((slot) => slot.kind === "image");
  const textSlots = ordered.filter((slot) => slot.kind === "text");

  const shortEdge = Math.min(widthIn, heightIn);
  const margin = Math.max(0.12, shortEdge * 0.06);
  const gap = Math.max(0.06, shortEdge * 0.03);
  const contentWidth = Math.max(0.01, widthIn - margin * 2);
  const contentHeight = Math.max(0.01, heightIn - margin * 2);

  const rawLines = textSlots.map((slot, index) => {
    const typeSizePt = Math.max(8, widthIn * (index === 0 ? 3.6 : 2.4));
    return { slot, index, typeSizePt, heightIn: (typeSizePt / 72) * 1.3 };
  });
  const rawBlockHeight = rawLines.reduce((total, line) => total + line.heightIn, 0) + gap * Math.max(0, rawLines.length - 1);
  const maxBlockHeight = contentHeight * (imageSlots.length > 0 ? 0.4 : 1);
  const textScale = rawBlockHeight > maxBlockHeight && rawBlockHeight > 0 ? maxBlockHeight / rawBlockHeight : 1;
  const lines = rawLines.map((line) => ({ ...line, typeSizePt: line.typeSizePt * textScale, heightIn: line.heightIn * textScale }));
  const textBlockHeight = rawBlockHeight * textScale;

  const imageAreaHeight = imageSlots.length === 0
    ? 0
    : Math.max(contentHeight * 0.3, contentHeight - textBlockHeight - gap * 2);
  const textTop = imageSlots.length === 0
    ? margin + Math.max(0, (contentHeight - textBlockHeight) / 2)
    : margin + imageAreaHeight + gap * 2;

  const rects = imageRects(imageSlots, { x: margin, y: margin, width: contentWidth, height: imageAreaHeight }, gap);
  const nodes: unknown[] = [];
  const inputSlots: BrowserPreviewInputSlot[] = [];
  imageSlots.forEach((slot, index) => {
    const rect = rects[index];
    if (!rect) return;
    // The inset sits on top of the hero, so it gets a printed-mat backing.
    if (imageSlots.length === 2 && index === 1) nodes.push(matNode(slot, rect, gap * 0.4));
    nodes.push(imageNode(slot, rect));
    inputSlots.push({ surface_id: surfaceID, variant_id: variantID, node_id: `fallback_${slot.key}`, slot_key: slot.key });
  });

  if (imageSlots.length > 0 && lines.length > 0) {
    nodes.push({
      id: "fallback_keyline",
      kind: "shape",
      role: "fallback_keyline",
      anchor: "tl",
      insetIn: { x: round(margin + contentWidth * 0.3), y: round(margin + imageAreaHeight + gap) },
      sizeIn: { width: round(Math.max(0.01, contentWidth * 0.4)), height: 0.015 },
      rotationDeg: 0,
      opacity: 1,
      fills: [{ kind: "solid", color: fallbackKeylineColor, opacity: 1 }],
    });
  }

  let cursor = textTop;
  for (const line of lines) {
    nodes.push({
      id: `fallback_${line.slot.key}`,
      kind: "text",
      role: line.slot.key,
      anchor: "tl",
      insetIn: { x: round(margin), y: round(cursor) },
      sizeIn: { width: round(contentWidth), height: round(Math.max(0.01, line.heightIn)) },
      rotationDeg: 0,
      opacity: 1,
      color: fallbackInkColor,
      sample: sampleText(line.slot),
      align: "center",
      typeSizePt: round(line.typeSizePt),
      fontFamily: "system-ui",
      fontWeight: line.index === 0 ? 600 : 400,
      trackingEm: line.index === 0 ? 0.01 : 0,
      verticalAlign: "middle",
    });
    cursor += line.heightIn + gap;
  }

  return {
    preview_source: "fallback",
    template: {
      id: templateID,
      revision_id: contract.template.revision_id,
      revision_number: contract.template.revision_number,
      // Synthesized locally: there is no published document to digest.
      document_sha256: "",
      browser_document: {
        surfaces: [{
          id: surfaceID,
          widthIn,
          heightIn,
          variants: [{
            id: variantID,
            background: { baseColor: fallbackBackgroundColor, art: "none" },
            nodes,
          }],
        }],
      },
      browser_document_sha256: "",
    },
    output: {
      id: output.id,
      surfaces: [{
        id: surfaceID,
        variant_id: variantID,
        width_in: widthIn,
        height_in: heightIn,
        fulfillment_role: "artwork",
        ordinal: 0,
      }],
    },
    input_slots: inputSlots,
    assets: [],
  };
}
