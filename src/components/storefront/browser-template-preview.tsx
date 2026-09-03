"use client";

/* eslint-disable @next/next/no-img-element -- local object URLs are browser-only preview state. */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import { Notice, PrintFrame, RangeField, SelectField } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  browserPreviewCanvas,
  browserPreviewLayerPosition,
  clampBrowserPreviewTransform,
  initialBrowserPreviewTransform,
  type BrowserPreviewCanvas,
  type BrowserPreviewDocument,
  type BrowserPreviewLayer,
  type BrowserPreviewTransform,
} from "@/lib/storefront/browser-preview";

type PreviewCommitReason = "pointer_release" | "slider_release";

export type LocalBrowserPreviewImage = {
  source: string;
  transform?: BrowserPreviewTransform;
};

type BrowserTemplatePreviewProps = {
  document: BrowserPreviewDocument;
  selectedSurfaceID: string;
  /** Keys are published template-contract slot keys, never display labels. */
  localImageSlots: Record<string, LocalBrowserPreviewImage>;
  activeImageSlotKey: string | null;
  assetURLs: Record<string, string>;
  serverProof: { url: string; transforms: Record<string, BrowserPreviewTransform> } | null;
  textValues: Record<string, string>;
  onSurfaceChange: (surfaceID: string) => void;
  onActiveImageSlotChange: (slotKey: string) => void;
  onPreviewChange?: (slotKey: string, transform: BrowserPreviewTransform) => void;
  onPreviewCommit?: (reason: PreviewCommitReason, slotKey: string, transform: BrowserPreviewTransform) => void;
};

/** The canvas keeps `container-type: inline-size` so text layers can size in `cqw`. */
const canvasClassName =
  "relative mx-auto max-h-[430px] w-[min(100%,340px)] cursor-grab touch-none overflow-hidden [container-type:inline-size] active:cursor-grabbing";

/** Published background art, ported from the legacy stylesheet's pattern rules. */
function backgroundArtStyle(art: BrowserPreviewCanvas["backgroundArt"]): CSSProperties {
  if (art === "grain") return { backgroundImage: "radial-gradient(rgb(23 17 12 / .5) .5px, transparent .6px)", backgroundSize: "4px 4px" };
  if (art === "lines") return { backgroundImage: "repeating-linear-gradient(90deg, rgb(23 17 12 / .35) 0 1px, transparent 1px 26px)" };
  return { backgroundImage: "linear-gradient(to top, rgb(23 17 12 / .55) 0 22%, transparent 22%)" };
}

function shapeBackground(layer: BrowserPreviewLayer): string {
  const fill = layer.fills?.[0];
  if (!fill) return "transparent";
  if (fill.kind === "solid") return fill.color ?? "transparent";
  const stops = fill.stops?.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(", ");
  return stops ? `linear-gradient(${fill.angleDeg ?? 0}deg, ${stops})` : "transparent";
}

function layerStyle(layer: BrowserPreviewLayer, canvas: NonNullable<ReturnType<typeof browserPreviewCanvas>>): CSSProperties {
  const position = browserPreviewLayerPosition(layer, canvas);
  const fallbackRadius = Math.max(0, layer.cornerRadiusIn ?? 0);
  const radii = layer.cornerRadiiIn ?? { tl: fallbackRadius, tr: fallbackRadius, br: fallbackRadius, bl: fallbackRadius };
  const radiusScale = 100 / canvas.widthIn;
  return {
    position: "absolute",
    left: `${(position.x / canvas.widthIn) * 100}%`,
    top: `${(position.y / canvas.heightIn) * 100}%`,
    width: `${(layer.sizeIn.width / canvas.widthIn) * 100}%`,
    height: `${(layer.sizeIn.height / canvas.heightIn) * 100}%`,
    borderRadius: `${radii.tl * radiusScale}cqw ${radii.tr * radiusScale}cqw ${radii.br * radiusScale}cqw ${radii.bl * radiusScale}cqw`,
    opacity: layer.opacity,
    overflow: "hidden",
    transform: layer.rotationDeg ? `rotate(${layer.rotationDeg}deg)` : undefined,
    transformOrigin: "center",
  };
}

function transformsFor(slots: Record<string, LocalBrowserPreviewImage>): Record<string, BrowserPreviewTransform> {
  return Object.fromEntries(Object.entries(slots).map(([slotKey, image]) => [slotKey, clampBrowserPreviewTransform(image.transform ?? initialBrowserPreviewTransform)]));
}

function sameTransform(left: BrowserPreviewTransform | undefined, right: BrowserPreviewTransform | undefined): boolean {
  return Boolean(left && right && left.zoom === right.zoom && left.offsetX === right.offsetX && left.offsetY === right.offsetY);
}

export function BrowserTemplatePreview({
  document,
  selectedSurfaceID,
  localImageSlots,
  activeImageSlotKey,
  assetURLs,
  serverProof,
  textValues,
  onSurfaceChange,
  onActiveImageSlotChange,
  onPreviewChange,
  onPreviewCommit,
}: BrowserTemplatePreviewProps) {
  const selectedSurface = document.output.surfaces.find((surface) => surface.id === selectedSurfaceID) ?? document.output.surfaces[0] ?? null;
  const canvas = useMemo(() => selectedSurface
    ? browserPreviewCanvas(JSON.stringify(document.template.browser_document), selectedSurface.id, selectedSurface.variant_id, document.input_slots ?? [])
    : null, [document.input_slots, document.template.browser_document, selectedSurface]);
  const [transforms, setTransforms] = useState<Record<string, BrowserPreviewTransform>>(() => transformsFor(localImageSlots));
  const nextTransforms = useRef(transforms);
  const frame = useRef<number | null>(null);
  const drag = useRef<{ pointerID: number; slotKey: string; target: HTMLDivElement; x: number; y: number } | null>(null);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  // Committed framing arrives as a prop, so an agent's configure_print crop
  // patch repaints here immediately. A live drag owns the transform instead.
  const committedTransforms = JSON.stringify(transformsFor(localImageSlots));
  useEffect(() => {
    if (drag.current) return;
    const committed = JSON.parse(committedTransforms) as Record<string, BrowserPreviewTransform>;
    nextTransforms.current = committed;
    setTransforms(committed);
  }, [committedTransforms]);

  function renderTransformFor(slotKey: string): BrowserPreviewTransform {
    return transforms[slotKey] ?? clampBrowserPreviewTransform(localImageSlots[slotKey]?.transform ?? initialBrowserPreviewTransform);
  }

  function eventTransformFor(slotKey: string): BrowserPreviewTransform {
    return nextTransforms.current[slotKey] ?? clampBrowserPreviewTransform(localImageSlots[slotKey]?.transform ?? initialBrowserPreviewTransform);
  }

  function updateTransform(slotKey: string, next: BrowserPreviewTransform) {
    const normalized = clampBrowserPreviewTransform(next);
    nextTransforms.current = { ...nextTransforms.current, [slotKey]: normalized };
    onPreviewChange?.(slotKey, normalized);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setTransforms(nextTransforms.current);
    });
  }

  function commit(reason: PreviewCommitReason, slotKey: string | null) {
    if (!slotKey) return;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      setTransforms(nextTransforms.current);
    }
    onPreviewCommit?.(reason, slotKey, eventTransformFor(slotKey));
  }

  function startDrag(event: PointerEvent<HTMLDivElement>, requestedSlotKey?: string) {
    const slotKey = requestedSlotKey ?? activeImageSlotKey;
    if (!slotKey || !localImageSlots[slotKey]?.source || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerID: event.pointerId, slotKey, target: event.currentTarget, x: event.clientX, y: event.clientY };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerID !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dx = ((event.clientX - active.x) / bounds.width) * 100;
    const dy = ((event.clientY - active.y) / bounds.height) * 100;
    drag.current = { ...active, x: event.clientX, y: event.clientY };
    const transform = eventTransformFor(active.slotKey);
    updateTransform(active.slotKey, { ...transform, offsetX: transform.offsetX + dx, offsetY: transform.offsetY + dy });
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerID !== event.pointerId) return;
    drag.current = null;
    active.target.releasePointerCapture?.(event.pointerId);
    commit("pointer_release", active.slotKey);
  }

  function selectLocalSlot(slotKey: string) {
    if (localImageSlots[slotKey]?.source) onActiveImageSlotChange(slotKey);
  }

  function selectLocalSlotFromKeyboard(event: KeyboardEvent<HTMLDivElement>, slotKey: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectLocalSlot(slotKey);
  }

  const activeTransform = activeImageSlotKey ? renderTransformFor(activeImageSlotKey) : initialBrowserPreviewTransform;
  const proofMatchesTransforms = Boolean(serverProof && Object.entries(localImageSlots).every(([slotKey]) => sameTransform(serverProof.transforms[slotKey], renderTransformFor(slotKey))));

  if (!selectedSurface || !canvas) return <Notice tone="error" role="alert">The published browser document does not contain the selected output surface.</Notice>;

  return <section className="grid gap-4 rounded-[18px] border border-border bg-card p-4" aria-label="Responsive template preview">
    {document.output.surfaces.length > 1 && <SelectField label="Surface" value={selectedSurface.id} onChange={(event) => onSurfaceChange(event.target.value)}>{document.output.surfaces.map((surface) => <option key={surface.id} value={surface.id}>{surface.id} · {surface.fulfillment_role}</option>)}</SelectField>}
    <PrintFrame className="mx-auto w-[min(100%,352px)]">
      <div className={canvasClassName} style={{ aspectRatio: `${canvas.widthIn} / ${canvas.heightIn}`, background: canvas.backgroundColor }} onPointerCancel={endDrag} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}>
        {canvas.backgroundAssetRef && assetURLs[canvas.backgroundAssetRef] && <img alt="Published template background" className="pointer-events-none absolute inset-0 h-full w-full object-cover" src={assetURLs[canvas.backgroundAssetRef]} />}
        {!canvas.backgroundAssetRef && canvas.backgroundArt !== "none" && <span aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-[.55]" style={backgroundArtStyle(canvas.backgroundArt)} />}
        {canvas.layers.map((layer) => {
          const localSlotKey = layer.inputSlotKey;
          const localImage = localSlotKey ? localImageSlots[localSlotKey] : undefined;
          // A local image is allowed only through the browser document's exact input slot.
          // Published template asset refs stay authoritative and are never replaced.
          const source = layer.assetRef ? assetURLs[layer.assetRef] ?? null : localImage?.source ?? null;
          const isLocalSlot = Boolean(!layer.assetRef && localSlotKey);
          const isActive = isLocalSlot && localSlotKey === activeImageSlotKey;
          const style = layerStyle(layer, canvas);
          if (layer.kind === "image") return <div aria-label={isLocalSlot ? `Select ${localSlotKey} image slot` : undefined} className={cn("absolute", !source && "border border-dashed border-border-strong bg-foreground/5", isActive && "ring-2 ring-primary")} key={layer.id} onClick={isLocalSlot ? () => selectLocalSlot(localSlotKey!) : undefined} onKeyDown={isLocalSlot ? (event) => selectLocalSlotFromKeyboard(event, localSlotKey!) : undefined} onPointerDown={isLocalSlot ? (event) => { event.stopPropagation(); selectLocalSlot(localSlotKey!); startDrag(event, localSlotKey!); } : undefined} role={isLocalSlot ? "button" : undefined} style={style} tabIndex={isLocalSlot ? 0 : undefined}>
            {source ? <img alt={layer.assetRef ? "Published template artwork" : `Local preview for ${localSlotKey} image slot`} className="block select-none" draggable={false} src={source} style={{ height: "100%", objectFit: layer.fitMode === "contain" ? "contain" : "cover", transform: isLocalSlot ? `translate(${renderTransformFor(localSlotKey!).offsetX}%, ${renderTransformFor(localSlotKey!).offsetY}%) scale(${renderTransformFor(localSlotKey!).zoom})` : undefined, transformOrigin: "center", width: "100%" }} /> : <span className="flex h-full items-center justify-center p-1.5 text-center text-[13px] leading-[1.3] text-muted-foreground">{isLocalSlot ? `No local photo assigned to ${localSlotKey}.` : "Published image content is unavailable."}</span>}
          </div>;
          if (layer.kind === "shape") return <div aria-hidden key={layer.id} style={{ ...style, background: shapeBackground(layer) }} />;
          const value = textValues[layer.role] ?? layer.sample ?? "";
          return <div className="flex overflow-hidden leading-[1.12] whitespace-pre-wrap" key={layer.id} style={{ ...style, color: layer.color, fontFamily: layer.fontFamily, fontSize: `${(layer.typeSizePt ?? 12) / 72 / canvas.widthIn * 100}cqw`, fontWeight: layer.fontWeight, letterSpacing: `${layer.trackingEm ?? 0}em`, justifyContent: layer.verticalAlign === "bottom" ? "flex-end" : layer.verticalAlign === "middle" ? "center" : "flex-start", textAlign: layer.align }}>{value}</div>;
        })}
        {proofMatchesTransforms && serverProof && <img alt="Server-rendered template proof" className="absolute inset-0 z-[5] h-full w-full object-cover" src={serverProof.url} />}
      </div>
    </PrintFrame>
    {activeImageSlotKey && localImageSlots[activeImageSlotKey]?.source && <RangeField aria-label={`Image zoom for ${activeImageSlotKey}`} label={<>Image zoom · <span className="font-mono text-[13px]">{activeImageSlotKey}</span></>} max="4" min="1" onBlur={() => commit("slider_release", activeImageSlotKey)} onChange={(event) => updateTransform(activeImageSlotKey, { ...eventTransformFor(activeImageSlotKey), zoom: Number(event.target.value) })} onPointerUp={() => commit("slider_release", activeImageSlotKey)} step="0.01" value={activeTransform.zoom} />}
    <p className="text-sm text-muted-foreground">Select an assigned image slot to reposition it. Local preview updates at animation-frame speed; server proof remains tied to the published framing contract.</p>
  </section>;
}
