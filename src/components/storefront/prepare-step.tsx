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
import type { FocusPreset } from "@/lib/storefront/focus-preset";
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
  /** The focal intent reapplied whenever the shopper changes zoom. */
  framingFocus: FocusPreset;
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
  onFramingFocusChange: (focus: FocusPreset) => void;
  onFramingZoomChange: (zoom: number) => void;
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

function PanelHeading({ id, subtitle, title }: { id: string; subtitle?: string; title: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[22px] font-semibold tracking-[-0.01em]" id={id}>
        {title}
      </h3>
      {subtitle ? <p className="text-[15px] text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}

/** The photograph the framing controls are acting on, named on the card that
 *  changes it. Framing lives beside the print, not on top of it, so the card
 *  has to say out loud which of the tray's photographs it is holding. */
function SelectedPhotoChip({ filename, ordinal }: { filename: string; ordinal: string }) {
  return (
    <span className="inline-flex min-w-0 shrink items-center gap-2 rounded-full border border-border bg-background/60 px-3.5 py-1.5">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
      <span className="truncate font-mono text-[13px] text-foreground">
        {ordinal} · {filename}
      </span>
    </span>
  );
}

/**
 * Zoom is an intent as much as a scale: make the anchoring rule explicit so a
 * standing portrait does not quietly drift back to the middle of its frame.
 */
function FramingFocusToggle({
  value,
  onChange,
}: {
  value: FocusPreset;
  onChange: (focus: FocusPreset) => void;
}) {
  return (
    <div
      aria-label="Keep crop focus on"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <span className="text-[15px] text-muted-foreground">Keep zoom focused on</span>
      {/* One enclosed control rather than two loose buttons: the pair is a
          single choice, and reads as one only when it shares a track. */}
      <div className="flex items-center gap-1 rounded-full border border-border bg-background/60 p-1">
        <Button
          aria-pressed={value === "center"}
          className="h-10 px-6 text-[15px]"
          onClick={() => onChange("center")}
          variant={value === "center" ? "primary" : "ghost"}
        >
          Center
        </Button>
        <Button
          aria-pressed={value === "faces"}
          className="h-10 px-6 text-[15px]"
          onClick={() => onChange("faces")}
          variant={value === "faces" ? "primary" : "ghost"}
        >
          Faces
        </Button>
      </div>
    </div>
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
  framingFocus,
  hasLocalImage,
  imageName,
  imagePreview,
  managedAsset,
  onAddPreparedLine,
  onAssignTemplatePhoto,
  onChangeFormat,
  onCropXChange,
  onCropYChange,
  onFramingFocusChange,
  onFramingZoomChange,
  onPrepareLocalImage,
  onSelectTemplate,
  onSlotTransformChange,
  onSlotTransformCommit,
  onTemplateTextChange,
  photos,
  prefilledSlotProvenance,
  preparing,
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
  // One clear commitment point belongs beside the controls that make the
  // print, not in a second summary bar below the entire workspace.
  const addToCartAction = (
    <div className="mt-5 flex justify-end">
      <Button className="min-w-40" onClick={onAddPreparedLine} size="lg">
        Add to cart
      </Button>
    </div>
  );
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
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-[52ch]">
          <h2
            className="text-[34px] font-semibold leading-[1.1] tracking-[-0.022em] lg:text-[42px]"
            id="prepare-title"
          >
            {selectedProduct.name}
          </h2>
          <p className="mt-3 text-[17px] leading-7 text-muted-foreground">
            {selectedProduct.description}
          </p>
        </div>
        <Button className="h-13 px-6 text-base" onClick={onChangeFormat} variant="secondary">
          Change print
        </Button>
      </div>

      {/* The print carries the column it sits in. Framing and the template form
          stay in one rail beside it, so nothing the shopper adjusts is a scroll
          away from the artwork it changes. */}
      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] xl:gap-14">
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
          <Surface aria-labelledby="prepare-photo-title" as="section" className="p-6 lg:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <PanelHeading
                id="prepare-photo-title"
                subtitle="Adjust the crop, then apply it to the artwork on the left."
                title="Framing"
              />
              {imageName ? (
                <SelectedPhotoChip filename={imageName} ordinal={selectedPhotoOrdinal} />
              ) : null}
            </div>
            {hasLocalImage && (
              <div className="mt-6 flex flex-col gap-6">
                {templatePreviewIsPrimary && activeImageSlotKey && activeSlotTransform ? (
                  <div className="flex flex-col gap-6" data-template-framing-controls>
                    <FramingFocusToggle onChange={onFramingFocusChange} value={framingFocus} />
                    <RangeField
                      label="Zoom"
                      maxLabel="4.00×"
                      minLabel="1.00×"
                      valueLabel={`${activeSlotTransform.zoom.toFixed(2)}×`}
                      max={4}
                      min={1}
                      onBlur={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                      onChange={(event) => onFramingZoomChange(Number(event.target.value))}
                      onPointerUp={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                      step={0.01}
                      value={activeSlotTransform.zoom}
                    />
                    <RangeField
                      label="Pan X"
                      maxLabel="Right"
                      minLabel="Left"
                      valueLabel={`${Math.round(activeSlotTransform.offsetX)}%`}
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
                      label="Pan Y"
                      maxLabel="Bottom"
                      minLabel="Top"
                      valueLabel={`${Math.round(activeSlotTransform.offsetY)}%`}
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
                  <div className="flex flex-col gap-6">
                    <FramingFocusToggle onChange={onFramingFocusChange} value={framingFocus} />
                    <RangeField
                      label="Zoom"
                      maxLabel="4.00×"
                      minLabel="1.00×"
                      valueLabel={`${cropZoom.toFixed(2)}×`}
                      max={4}
                      min={1}
                      onChange={(event) => onFramingZoomChange(Number(event.target.value))}
                      step={0.05}
                      value={cropZoom}
                    />
                    <RangeField
                      label="Pan X"
                      maxLabel="Right"
                      minLabel="Left"
                      valueLabel={`${cropX}%`}
                      max={100}
                      min={0}
                      onChange={(event) => onCropXChange(Number(event.target.value))}
                      value={cropX}
                    />
                    <RangeField
                      label="Pan Y"
                      maxLabel="Bottom"
                      minLabel="Top"
                      valueLabel={`${cropY}%`}
                      max={100}
                      min={0}
                      onChange={(event) => onCropYChange(Number(event.target.value))}
                      value={cropY}
                    />
                  </div>
                )}
                {/* Secondary, because it is a step on the way to the one primary
                    action on this page. Two orange buttons asked the shopper to
                    pick a winner between preparing a crop and buying the print. */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-5">
                  <Button
                    disabled={preparing}
                    onClick={onPrepareLocalImage}
                    variant="secondary"
                  >
                    {preparing ? "Preparing…" : "Prepare selected crop"}
                  </Button>
                  {managedAsset && (
                    <p className="text-sm text-muted-foreground">Selected crop is ready.</p>
                  )}
                </div>
              </div>
            )}

            {/* The card's own subheading promises controls. Without a
                photograph there are none, so say why rather than leave the
                shopper looking at an empty panel. */}
            {!hasLocalImage && (
              <p className="mt-5 text-[15px] text-muted-foreground">
                Choose a photograph from the tray above to frame it.
              </p>
            )}
          </Surface>

          {customization !== "template" ? addToCartAction : null}

          {customization === "template" && (
            <>
              <Surface aria-labelledby="template-title" as="section" className="p-6 lg:p-7">
                <PanelHeading
                  id="template-title"
                  subtitle="Drop photographs into the image slots, then enter the text you want printed."
                  title="Published studio template"
                />
                <div className="mt-6 flex flex-col gap-6">
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
              {addToCartAction}
            </>
          )}

        </div>
      </div>
    </section>
  );
}
