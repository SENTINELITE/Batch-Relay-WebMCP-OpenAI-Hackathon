"use client";

import { useEffect, useRef, type ReactNode, type PointerEvent } from "react";
import Image from "next/image";
import {
  Button,
  PrintFrame,
  RangeField,
  SelectField,
  Surface,
} from "@/components/ui";
import { photoDropTargetClassName, usePhotoDropTarget } from "@/components/storefront/photo-drag";
import { TemplateSlotAssignment } from "@/components/storefront/template-slot-assignment";
import { cn } from "@/lib/cn";
import type {
  CatalogProduct,
  IngestedAsset,
  PublishedTemplate,
  TemplateContract,
} from "@/lib/storefront/client";
import { minimumBrowserPreviewPanLimit, type BrowserPreviewPanLimits, type BrowserPreviewTransform } from "@/lib/storefront/browser-preview";
import type { BrowserPhoto } from "@/lib/storefront/photo-library";

export type PrepareStepProps = {
  /** The template image slot the preview is currently editing, if it holds a photo. */
  activeImageSlotKey: string | null;
  activeSlotPanLimits: BrowserPreviewPanLimits;
  activeSlotTransform: BrowserPreviewTransform | null;
  browserPreview: ReactNode;
  crop: "5:7" | "4:5";
  cropX: number;
  cropY: number;
  cropZoom: number;
  customization: "direct" | "template";
  hasLocalImage: boolean;
  imageName: string | null;
  imagePreview: string | null;
  managedAsset: IngestedAsset | null;
  /** Adds the visible draft straight to the demo cart, with no proposal card. */
  onAddPreparedLine: () => void;
  onAssignTemplatePhoto: (slotKey: string, photoId: string | null) => void;
  onChangeFormat: () => void;
  onCropXChange: (focusX: number) => void;
  onCropYChange: (focusY: number) => void;
  onCropZoomChange: (zoom: number) => void;
  onPrepareLocalImage: () => void;
  onSelectTemplate: (templateId: string) => void;
  /** Live framing while a slider is moving; the preview repaints from it. */
  onSlotTransformChange: (slotKey: string, transform: BrowserPreviewTransform) => void;
  /** Released framing: the same commit the preview's drag editing makes. */
  onSlotTransformCommit: (slotKey: string, transform: BrowserPreviewTransform) => void;
  onTemplateTextChange: (slotKey: string, value: string) => void;
  photos: BrowserPhoto[];
  prefilledSlotProvenance: Record<string, string>;
  preparing: boolean;
  selectedPhotoId: string | null;
  selectedPhotoOrdinal: string;
  selectedProduct: CatalogProduct;
  selectedTemplateId: string;
  templateAssignments: Record<string, string>;
  templateContract: TemplateContract | null;
  templateInputs: Record<string, string>;
  templates: PublishedTemplate[];
  visibleTemplateSlots: TemplateContract["slots"];
};

function PanelHeading({ id, title }: { id: string; title: string }) {
  return (
    <h3 className="text-lg font-semibold" id={id}>
      {title}
    </h3>
  );
}

export function PrepareStep({
  activeImageSlotKey,
  activeSlotPanLimits,
  activeSlotTransform,
  browserPreview,
  crop,
  cropX,
  cropY,
  cropZoom,
  customization,
  hasLocalImage,
  imageName,
  imagePreview,
  managedAsset,
  onAddPreparedLine,
  onAssignTemplatePhoto,
  onChangeFormat,
  onCropXChange,
  onCropYChange,
  onCropZoomChange,
  onPrepareLocalImage,
  onSelectTemplate,
  onSlotTransformChange,
  onSlotTransformCommit,
  onTemplateTextChange,
  photos,
  prefilledSlotProvenance,
  preparing,
  selectedPhotoId,
  selectedPhotoOrdinal,
  selectedProduct,
  selectedTemplateId,
  templateAssignments,
  templateContract,
  templateInputs,
  templates,
  visibleTemplateSlots,
}: PrepareStepProps) {
  // A template draft previews the whole composed print; a direct print has only
  // its single-photo crop to show.
  const templatePreviewIsPrimary = customization === "template" && Boolean(browserPreview);
  const provisionalPanLimit = activeSlotTransform ? minimumBrowserPreviewPanLimit(activeSlotTransform.zoom) : 0;
  const activeSlotPanX = Math.max(activeSlotPanLimits.x, provisionalPanLimit);
  const activeSlotPanY = Math.max(activeSlotPanLimits.y, provisionalPanLimit);
  const directDrag = useRef<{
    pointerID: number;
    target: HTMLDivElement;
    x: number;
    y: number;
    focusX: number;
    focusY: number;
    zoom: number;
  } | null>(null);
  const finishDirectDragRef = useRef<(pointerID: number, releasePointerCapture?: boolean) => void>(() => {});
  // A direct print has no slots, so its crop frame stands in for one: a
  // photograph dropped here becomes the tray selection this print uses. It
  // accepts drops exactly while it is the frame on screen, which is the same
  // condition that decides whether it is rendered at all.
  const {
    connect: connectDirectDrop,
    isDragActive: directDropDragActive,
    isOver: directDropIsOver,
    settled: directDropSettled,
  } = usePhotoDropTarget({ kind: "direct_print" }, templatePreviewIsPrimary);

  function finishDirectDrag(pointerID: number, releasePointerCapture = true) {
    const active = directDrag.current;
    if (!active || active.pointerID !== pointerID) return;
    directDrag.current = null;
    if (releasePointerCapture && active.target.hasPointerCapture?.(pointerID)) {
      active.target.releasePointerCapture(pointerID);
    }
  }

  useEffect(() => {
    finishDirectDragRef.current = finishDirectDrag;
  });

  useEffect(() => {
    const endWindowDrag = (event: WindowEventMap["pointerup"] | WindowEventMap["pointercancel"]) => {
      finishDirectDragRef.current(event.pointerId);
    };
    window.addEventListener("pointerup", endWindowDrag);
    window.addEventListener("pointercancel", endWindowDrag);
    return () => {
      window.removeEventListener("pointerup", endWindowDrag);
      window.removeEventListener("pointercancel", endWindowDrag);
    };
  }, []);

  function startDirectDrag(event: PointerEvent<HTMLDivElement>) {
    if (!imagePreview || cropZoom <= 1 || event.button !== 0 || directDrag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    directDrag.current = {
      pointerID: event.pointerId,
      target: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      focusX: cropX,
      focusY: cropY,
      zoom: cropZoom,
    };
  }

  function moveDirectDrag(event: PointerEvent<HTMLDivElement>) {
    const active = directDrag.current;
    if (!active || active.pointerID !== event.pointerId) return;
    const bounds = active.target.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const range = 100 / Math.max(0.01, active.zoom - 1);
    const focusX = Math.min(100, Math.max(0, active.focusX - ((event.clientX - active.x) / bounds.width) * range));
    const focusY = Math.min(100, Math.max(0, active.focusY - ((event.clientY - active.y) / bounds.height) * range));
    onCropXChange(focusX);
    onCropYChange(focusY);
  }
  return (
    <section aria-labelledby="prepare-title" className="py-10 lg:py-12" id="prepare">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[65ch]">
          <h2 className="text-3xl font-semibold tracking-[-0.02em]" id="prepare-title">
            {selectedProduct.name}
          </h2>
          <p className="mt-2 text-muted-foreground">{selectedProduct.description}</p>
        </div>
        <Button onClick={onChangeFormat} variant="secondary">
          Change print
        </Button>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(320px,.9fr)_minmax(360px,1.1fr)]">
        <div className="lg:sticky lg:top-5 lg:self-start">
          {templatePreviewIsPrimary ? (
            browserPreview
          ) : (
            <>
              <PrintFrame
                aspect={crop === "5:7" ? "5 / 7" : "4 / 5"}
                aria-label={cropZoom > 1 ? "Drag to pan the selected image crop" : "Selected image crop preview"}
                className={cn(
                  cropZoom > 1 ? "w-full cursor-grab touch-none active:cursor-grabbing" : "w-full",
                  photoDropTargetClassName({
                    isDragActive: directDropDragActive,
                    isOver: directDropIsOver,
                    settled: directDropSettled,
                  }),
                )}
                innerClassName="relative bg-surface-warm"
                onLostPointerCapture={(event) => finishDirectDrag(event.pointerId, false)}
                onPointerCancel={(event) => finishDirectDrag(event.pointerId)}
                onPointerDown={startDirectDrag}
                onPointerMove={moveDirectDrag}
                onPointerUp={(event) => finishDirectDrag(event.pointerId)}
                ref={connectDirectDrop}
              >
                {imagePreview ? (
                  <Image
                    alt="Selected image crop preview"
                    className="pointer-events-none select-none"
                    fill
                    sizes="(max-width: 760px) 340px, 390px"
                    src={imagePreview}
                    style={{
                      objectFit: "cover",
                      objectPosition: "center",
                      // Translate the enlarged image inside this clipped
                      // window. At every zoom level the range remains
                      // inside the image bounds, so panning cannot expose
                      // transparent pixels.
                      transform: `translate(${(50 - cropX) * (cropZoom - 1)}%, ${(50 - cropY) * (cropZoom - 1)}%) scale(${cropZoom})`,
                    }}
                    unoptimized
                  />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-1 text-center">
                    <span className="text-sm text-muted-foreground">Image contact sheet</span>
                    <b className="text-2xl font-semibold">{crop === "5:7" ? "5 × 7" : "8 × 10"}</b>
                  </div>
                )}
              </PrintFrame>

              <p className="mt-3 text-sm text-muted-foreground">
                Crop frame · {crop === "5:7" ? "5 : 7" : "4 : 5"}
              </p>
              <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">
                The frame is a local crop aid. “Prepare selected crop” creates those pixels and
                uploads them through the published studio asset session. It is not a provider proof.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Surface aria-labelledby="prepare-photo-title" as="section">
            <PanelHeading id="prepare-photo-title" title="Prepare selected photo" />
            <div className="mt-4 flex items-center gap-3 rounded-[12px] bg-surface-warm px-4 py-3">
              <span className="font-mono text-[13px] text-muted-foreground">
                {selectedPhotoOrdinal}
              </span>
              <div className="min-w-0">
                <b className="block truncate text-[15px] font-semibold">
                  {imageName ?? "Choose a photograph from the tray"}
                </b>
                {selectedPhotoId ? (
                  <small className="block truncate font-mono text-[13px] text-muted-foreground">
                    {selectedPhotoId}
                  </small>
                ) : (
                  <small className="block text-sm text-muted-foreground">
                    The tray selection is the active direct-print image.
                  </small>
                )}
              </div>
            </div>

            {hasLocalImage && (
              <div className="mt-5 flex flex-col gap-4">
                {templatePreviewIsPrimary && activeImageSlotKey && activeSlotTransform ? (
                  <div className="flex flex-col gap-4">
                    <div className="grid gap-1">
                      <p className="text-sm font-semibold text-foreground">Frame selected image</p>
                      <p className="font-mono text-[13px] break-words text-muted-foreground">{activeImageSlotKey}</p>
                    </div>
                    <RangeField
                      hint={`${activeSlotTransform.zoom.toFixed(2)} times`}
                      label="Zoom"
                      max={4}
                      min={1}
                      onBlur={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                      onChange={(event) => onSlotTransformChange(activeImageSlotKey, { ...activeSlotTransform, zoom: Number(event.target.value) })}
                      onPointerUp={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                      step={0.01}
                      value={activeSlotTransform.zoom}
                    />
                    <RangeField
                      hint={`${Math.round(activeSlotTransform.offsetX)} percent horizontally`}
                      label="Pan X"
                      disabled={activeSlotPanX === 0}
                      max={activeSlotPanX}
                      min={-activeSlotPanX}
                      onBlur={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                      onChange={(event) => onSlotTransformChange(activeImageSlotKey, { ...activeSlotTransform, offsetX: Number(event.target.value) })}
                      onPointerUp={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                      step={1}
                      value={activeSlotTransform.offsetX}
                    />
                    <RangeField
                      hint={`${Math.round(activeSlotTransform.offsetY)} percent vertically`}
                      label="Pan Y"
                      disabled={activeSlotPanY === 0}
                      max={activeSlotPanY}
                      min={-activeSlotPanY}
                      onBlur={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                      onChange={(event) => onSlotTransformChange(activeImageSlotKey, { ...activeSlotTransform, offsetY: Number(event.target.value) })}
                      onPointerUp={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                      step={1}
                      value={activeSlotTransform.offsetY}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm font-semibold text-foreground">Frame selected photo</p>
                    <RangeField
                      hint={`${cropZoom.toFixed(2)} times`}
                      label="Zoom"
                      max={4}
                      min={1}
                      onChange={(event) => onCropZoomChange(Number(event.target.value))}
                      step={0.05}
                      value={cropZoom}
                    />
                    <RangeField
                      hint={`${cropX} percent from the left`}
                      label="Pan X"
                      max={100}
                      min={0}
                      onChange={(event) => onCropXChange(Number(event.target.value))}
                      value={cropX}
                    />
                    <RangeField
                      hint={`${cropY} percent from the top`}
                      label="Pan Y"
                      max={100}
                      min={0}
                      onChange={(event) => onCropYChange(Number(event.target.value))}
                      value={cropY}
                    />
                  </div>
                )}
                <Button className="w-full" disabled={preparing} onClick={onPrepareLocalImage}>
                  {preparing ? "Preparing…" : "Prepare selected crop"}
                </Button>
              </div>
            )}

            {managedAsset && (
              <p className="mt-5 rounded-[12px] bg-surface-warm px-4 py-3 font-mono text-[13px] text-foreground">
                Managed asset <b className="font-semibold">{managedAsset.asset_id}</b>{" "}
                <span className="text-muted-foreground">
                  {managedAsset.pixel_width} × {managedAsset.pixel_height}px
                </span>
              </p>
            )}
          </Surface>

          {customization === "template" && (
            <Surface aria-labelledby="template-title" as="section">
              <PanelHeading id="template-title" title="Published studio template" />
              <div className="mt-4 flex flex-col gap-4">
                <SelectField
                  disabled={templates.length === 0}
                  label="Template"
                  onChange={(event) => onSelectTemplate(event.target.value)}
                  value={selectedTemplateId}
                >
                  <option value="">
                    {templates.length === 0 ? "Loading templates…" : "Select a template"}
                  </option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name ?? template.id}
                    </option>
                  ))}
                </SelectField>
                {templateContract && (
                  <TemplateSlotAssignment
                    assignments={templateAssignments}
                    onAssign={onAssignTemplatePhoto}
                    onTextChange={onTemplateTextChange}
                    photos={photos}
                    prefilledSlotProvenance={prefilledSlotProvenance}
                    slots={visibleTemplateSlots}
                    textValues={templateInputs}
                  />
                )}
              </div>
            </Surface>
          )}

          {/* The shopper is looking at this print, so their own click adds it
              outright. No card asks them about what already fills the screen. */}
          <Button className="w-full" onClick={onAddPreparedLine} size="lg">
            Add to cart
          </Button>
        </div>
      </div>
    </section>
  );
}
