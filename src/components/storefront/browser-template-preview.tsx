"use client";

/* eslint-disable @next/next/no-img-element -- local object URLs are browser-only preview state. */

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import { photoDropTargetClassName, usePhotoDropTarget } from "@/components/storefront/photo-drag";
import { Notice, PrintFrame, SelectField } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  browserPreviewCanvas,
  browserPreviewLayerPosition,
  browserPreviewPanLimits,
  clampBrowserPreviewTransform,
  initialBrowserPreviewTransform,
  minimumBrowserPreviewPanLimit,
  type BrowserPreviewCanvas,
  type BrowserPreviewDocument,
  type BrowserPreviewLayer,
  type BrowserPreviewPanLimits,
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
  onPreviewPanLimitsChange?: (slotKey: string, limits: BrowserPreviewPanLimits) => void;
  /** Proposal cards render a read-only preview and never register drop slots. */
  dropEnabled?: boolean;
};

/** The canvas keeps `container-type: inline-size` so text layers can size in `cqw`. */
const canvasClassName =
  "relative mx-auto max-h-[560px] w-[min(100%,440px)] cursor-grab touch-none overflow-hidden [container-type:inline-size] active:cursor-grabbing";

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

type SlotDropSurfaceProps = ComponentPropsWithoutRef<"div"> & {
  /** Null for a published asset layer, which no photograph may replace. */
  slotKey: string | null;
  isActive: boolean;
  dropEnabled: boolean;
};

/**
 * An image layer that also accepts a photograph dragged from the tray.
 *
 * Dropping only contributes a ref, never a pointer handler, so this layer's own
 * pointer-down pan, its activation click, and its pointer capture all continue
 * to run exactly as they did before.
 */
function SlotDropSurface({ children, className, dropEnabled, isActive, slotKey, ...rest }: SlotDropSurfaceProps) {
  const { connect, isDragActive, isOver, settled } = usePhotoDropTarget({ kind: "template_slot", slotKey: slotKey ?? "" }, !dropEnabled || slotKey === null);
  const dropRing = isOver || settled || isDragActive;
  return <div
    {...rest}
    className={cn(className, photoDropTargetClassName({ isDragActive, isOver, settled }), isActive && !dropRing && "ring-2 ring-primary")}
    ref={connect}
  >{children}</div>;
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
  onPreviewPanLimitsChange,
  dropEnabled = true,
}: BrowserTemplatePreviewProps) {
  const selectedSurface = document.output.surfaces.find((surface) => surface.id === selectedSurfaceID) ?? document.output.surfaces[0] ?? null;
  const canvas = useMemo(() => selectedSurface
    ? browserPreviewCanvas(JSON.stringify(document.template.browser_document), selectedSurface.id, selectedSurface.variant_id, document.input_slots ?? [])
    : null, [document.input_slots, document.template.browser_document, selectedSurface]);
  const [transforms, setTransforms] = useState<Record<string, BrowserPreviewTransform>>(() => transformsFor(localImageSlots));
  const nextTransforms = useRef(transforms);
  const frame = useRef<number | null>(null);
  const drag = useRef<{ pointerID: number; slotKey: string; target: HTMLDivElement; x: number; y: number } | null>(null);
  const finishDragRef = useRef<(pointerID: number, releasePointerCapture?: boolean) => void>(() => {});
  const [sourceSizes, setSourceSizes] = useState<Record<string, { width: number; height: number }>>({});
  const lastPanLimits = useRef<string | null>(null);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const active = drag.current;
    drag.current = null;
    if (active?.target.hasPointerCapture?.(active.pointerID)) active.target.releasePointerCapture(active.pointerID);
  }, []);

  // Committed framing arrives as a prop, so an agent's configure_print crop
  // patch repaints here immediately. A live drag owns the transform instead.
  const committedTransforms = JSON.stringify(Object.fromEntries(Object.entries(localImageSlots).map(([slotKey, image]) => [
    slotKey,
    image.transform ?? initialBrowserPreviewTransform,
  ])));
  useEffect(() => {
    if (drag.current) return;
    const committed = JSON.parse(committedTransforms) as Record<string, BrowserPreviewTransform>;
    const normalized = Object.fromEntries(Object.entries(committed).map(([slotKey, transform]) => {
      const layer = canvas?.layers.find((candidate) => !candidate.assetRef && candidate.inputSlotKey === slotKey);
      const source = localImageSlots[slotKey]?.source;
      const size = source ? sourceSizes[source] : undefined;
      const aspectRatio = layer && layer.sizeIn.height > 0 ? layer.sizeIn.width / layer.sizeIn.height : 1;
      return [slotKey, clampBrowserPreviewTransform(transform, size, aspectRatio)];
    }));
    nextTransforms.current = normalized;
    setTransforms(normalized);
    for (const [slotKey, transform] of Object.entries(normalized)) {
      if (!sameTransform(transform, committed[slotKey])) onPreviewChange?.(slotKey, transform);
    }
  }, [canvas, committedTransforms, localImageSlots, onPreviewChange, sourceSizes]);

  function layerForSlot(slotKey: string) {
    return canvas?.layers.find((layer) => !layer.assetRef && layer.inputSlotKey === slotKey) ?? null;
  }

  function sourceSizeForSlot(slotKey: string) {
    const source = localImageSlots[slotKey]?.source;
    return source ? sourceSizes[source] : undefined;
  }

  function targetAspectForSlot(slotKey: string) {
    const layer = layerForSlot(slotKey);
    return layer && layer.sizeIn.height > 0 ? layer.sizeIn.width / layer.sizeIn.height : 1;
  }

  function normalizeTransform(slotKey: string, transform: BrowserPreviewTransform): BrowserPreviewTransform {
    const sourceSize = sourceSizeForSlot(slotKey);
    if (sourceSize) return clampBrowserPreviewTransform(transform, sourceSize, targetAspectForSlot(slotKey));
    const zoom = Math.min(4, Math.max(1, Number.isFinite(transform.zoom) ? transform.zoom : 1));
    const limit = minimumBrowserPreviewPanLimit(zoom);
    const clamp = (value: number) => Math.min(limit, Math.max(-limit, Number.isFinite(value) ? value : 0));
    return { zoom, offsetX: clamp(transform.offsetX), offsetY: clamp(transform.offsetY) };
  }

  function renderTransformFor(slotKey: string): BrowserPreviewTransform {
    return normalizeTransform(slotKey, transforms[slotKey] ?? localImageSlots[slotKey]?.transform ?? initialBrowserPreviewTransform);
  }

  function eventTransformFor(slotKey: string): BrowserPreviewTransform {
    return normalizeTransform(slotKey, nextTransforms.current[slotKey] ?? localImageSlots[slotKey]?.transform ?? initialBrowserPreviewTransform);
  }

  function updateTransform(slotKey: string, next: BrowserPreviewTransform) {
    const normalized = normalizeTransform(slotKey, next);
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
    if (!slotKey || !localImageSlots[slotKey]?.source || event.button !== 0 || drag.current) return;
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

  function finishDrag(pointerID: number, releasePointerCapture = true) {
    const active = drag.current;
    if (!active || active.pointerID !== pointerID) return;
    drag.current = null;
    if (releasePointerCapture && active.target.hasPointerCapture?.(pointerID)) active.target.releasePointerCapture(pointerID);
    commit("pointer_release", active.slotKey);
  }
  useEffect(() => {
    finishDragRef.current = finishDrag;
  });

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    finishDrag(event.pointerId);
  }

  function loseDrag(event: PointerEvent<HTMLDivElement>) {
    // Pointer capture can be released by the browser if the pointer leaves the
    // document or an element is removed. Treat that as an ended drag rather
    // than allowing a later pointer move to revive stale state.
    finishDrag(event.pointerId, false);
  }

  useEffect(() => {
    // Capture normally routes releases back to the slot, but retain a window
    // fallback for browser chrome/out-of-document releases. Without this,
    // returning to the canvas after releasing outside can keep the old drag
    // active and make the image follow the pointer again.
    const endWindowDrag = (event: WindowEventMap["pointerup"] | WindowEventMap["pointercancel"]) => finishDragRef.current(event.pointerId);
    window.addEventListener("pointerup", endWindowDrag);
    window.addEventListener("pointercancel", endWindowDrag);
    return () => {
      window.removeEventListener("pointerup", endWindowDrag);
      window.removeEventListener("pointercancel", endWindowDrag);
    };
  }, []);

  function selectLocalSlot(slotKey: string) {
    if (localImageSlots[slotKey]?.source) onActiveImageSlotChange(slotKey);
  }

  function selectLocalSlotFromKeyboard(event: KeyboardEvent<HTMLDivElement>, slotKey: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectLocalSlot(slotKey);
  }

  const activeTransform = activeImageSlotKey ? renderTransformFor(activeImageSlotKey) : initialBrowserPreviewTransform;
  const activePanLimits = useMemo(() => {
    if (!activeImageSlotKey) return { x: 0, y: 0 };
    const layer = canvas?.layers.find((candidate) => !candidate.assetRef && candidate.inputSlotKey === activeImageSlotKey);
    const source = localImageSlots[activeImageSlotKey]?.source;
    const size = source ? sourceSizes[source] : undefined;
    const aspectRatio = layer && layer.sizeIn.height > 0 ? layer.sizeIn.width / layer.sizeIn.height : 1;
    return browserPreviewPanLimits(size ?? { width: 1, height: 1 }, aspectRatio, activeTransform.zoom);
  }, [activeImageSlotKey, activeTransform.zoom, canvas, localImageSlots, sourceSizes]);
  const proofMatchesTransforms = Boolean(serverProof && Object.entries(localImageSlots).every(([slotKey]) => sameTransform(serverProof.transforms[slotKey], renderTransformFor(slotKey))));

  useEffect(() => {
    if (!activeImageSlotKey) return;
    const key = `${activeImageSlotKey}:${activePanLimits.x}:${activePanLimits.y}`;
    if (key === lastPanLimits.current) return;
    lastPanLimits.current = key;
    onPreviewPanLimitsChange?.(activeImageSlotKey, activePanLimits);
  }, [activeImageSlotKey, activePanLimits, onPreviewPanLimitsChange]);

  if (!selectedSurface || !canvas) return <Notice tone="error" role="alert">The published browser document does not contain the selected output surface.</Notice>;

  return <section className="grid gap-4" aria-label="Responsive template preview">
    {document.output.surfaces.length > 1 && <SelectField label="Surface" value={selectedSurface.id} onChange={(event) => onSurfaceChange(event.target.value)}>{document.output.surfaces.map((surface) => <option key={surface.id} value={surface.id}>{surface.id} · {surface.fulfillment_role}</option>)}</SelectField>}
    <PrintFrame className="mx-auto w-[min(100%,452px)]">
      <div className={canvasClassName} style={{ aspectRatio: `${canvas.widthIn} / ${canvas.heightIn}`, background: canvas.backgroundColor }} onLostPointerCapture={loseDrag} onPointerCancel={endDrag} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}>
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
          const transform = isLocalSlot ? renderTransformFor(localSlotKey!) : null;
          const sourceSize = isLocalSlot ? sourceSizeForSlot(localSlotKey!) : undefined;
          const slotAspectRatio = layer.sizeIn.height > 0 ? layer.sizeIn.width / layer.sizeIn.height : 1;
          const sourceAspectRatio = sourceSize ? sourceSize.width / sourceSize.height : 1;
          const coveredWidth = sourceAspectRatio > slotAspectRatio ? sourceAspectRatio / slotAspectRatio : 1;
          const coveredHeight = sourceAspectRatio > slotAspectRatio ? 1 : slotAspectRatio / sourceAspectRatio;
          const localImageStyle: CSSProperties | undefined = isLocalSlot && transform
            ? sourceSize
              ? {
                height: `${coveredHeight * transform.zoom * 100}%`,
                left: "50%",
                maxWidth: "none",
                objectFit: "fill",
                position: "absolute",
                top: "50%",
                transform: `translate(-50%, -50%) translate(${transform.offsetX}%, ${transform.offsetY}%)`,
                transformOrigin: "center",
                width: `${coveredWidth * transform.zoom * 100}%`,
              }
              : {
                height: "100%",
                objectFit: "cover",
                transform: `translate(${transform.offsetX}%, ${transform.offsetY}%) scale(${transform.zoom})`,
                transformOrigin: "center",
                width: "100%",
              }
            : undefined;
          if (layer.kind === "image") return <SlotDropSurface aria-label={isLocalSlot ? `Select ${localSlotKey} image slot` : undefined} className={cn("absolute", !source && "border border-dashed border-border-strong bg-foreground/5")} dropEnabled={dropEnabled} isActive={isActive} key={layer.id} slotKey={isLocalSlot ? localSlotKey! : null} onClick={isLocalSlot ? () => selectLocalSlot(localSlotKey!) : undefined} onKeyDown={isLocalSlot ? (event) => selectLocalSlotFromKeyboard(event, localSlotKey!) : undefined} onLostPointerCapture={isLocalSlot ? loseDrag : undefined} onPointerDown={isLocalSlot ? (event) => { event.stopPropagation(); selectLocalSlot(localSlotKey!); startDrag(event, localSlotKey!); } : undefined} role={isLocalSlot ? "button" : undefined} style={style} tabIndex={isLocalSlot ? 0 : undefined}>
            {source ? <img alt={layer.assetRef ? "Published template artwork" : `Local preview for ${localSlotKey} image slot`} className={cn("block select-none", isLocalSlot && "absolute max-w-none")} draggable={false} onLoad={isLocalSlot ? (event) => {
              const { naturalHeight: height, naturalWidth: width } = event.currentTarget;
              if (!localImage || width <= 0 || height <= 0) return;
              setSourceSizes((sizes) => sizes[localImage.source]?.width === width && sizes[localImage.source]?.height === height
                ? sizes
                : { ...sizes, [localImage.source]: { width, height } });
            } : undefined} src={source} style={localImageStyle ?? { height: "100%", objectFit: layer.fitMode === "contain" ? "contain" : "cover", transformOrigin: "center", width: "100%" }} /> : <span className="flex h-full items-center justify-center p-1.5 text-center text-[13px] leading-[1.3] text-muted-foreground">{isLocalSlot ? `No local photo assigned to ${localSlotKey}.` : "Published image content is unavailable."}</span>}
          </SlotDropSurface>;
          if (layer.kind === "shape") return <div aria-hidden key={layer.id} style={{ ...style, background: shapeBackground(layer) }} />;
          const value = textValues[layer.role] ?? layer.sample ?? "";
          return <div className="flex overflow-hidden leading-[1.12] whitespace-pre-wrap" key={layer.id} style={{ ...style, color: layer.color, fontFamily: layer.fontFamily, fontSize: `${(layer.typeSizePt ?? 12) / 72 / canvas.widthIn * 100}cqw`, fontWeight: layer.fontWeight, letterSpacing: `${layer.trackingEm ?? 0}em`, justifyContent: layer.verticalAlign === "bottom" ? "flex-end" : layer.verticalAlign === "middle" ? "center" : "flex-start", textAlign: layer.align }}>{value}</div>;
        })}
        {proofMatchesTransforms && serverProof && <img alt="Server-rendered template proof" className="absolute inset-0 z-[5] h-full w-full object-cover" src={serverProof.url} />}
      </div>
    </PrintFrame>
  </section>;
}
