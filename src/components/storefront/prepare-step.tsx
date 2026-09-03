"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import {
  Button,
  Notice,
  PrintFrame,
  RangeField,
  SelectField,
  Surface,
} from "@/components/ui";
import { TemplateSlotAssignment } from "@/components/storefront/template-slot-assignment";
import type {
  CatalogProduct,
  IngestedAsset,
  ProviderOffer,
  PublishedTemplate,
  TemplateContract,
  TemplateOutput,
  TemplateRender,
} from "@/lib/storefront/client";
import type { TemplateState } from "@/lib/storefront/customization";
import type { BrowserPreviewTransform } from "@/lib/storefront/browser-preview";
import type { BrowserPhoto } from "@/lib/storefront/photo-library";
import { compatibleOutputVariantSummary } from "@/lib/storefront/template-compatibility";

export type PrepareStepNotice = { tone: "error" | "info"; message: string } | null;

export type PrepareStepProps = {
  /** The template image slot the preview is currently editing, if it holds a photo. */
  activeImageSlotKey: string | null;
  activeSlotTransform: BrowserPreviewTransform | null;
  browserPreview: ReactNode;
  compatibleOutputs: TemplateOutput[];
  crop: "5:7" | "4:5";
  cropX: number;
  cropY: number;
  cropZoom: number;
  customization: "direct" | "template";
  hasLocalImage: boolean;
  imageName: string | null;
  imagePreview: string | null;
  managedAsset: IngestedAsset | null;
  offerState: "idle" | "loading" | "error" | "ready";
  offers: ProviderOffer[];
  onAddPreparedLine: () => void;
  onAssignTemplatePhoto: (slotKey: string, photoId: string | null) => void;
  onChangeFormat: () => void;
  onCropXChange: (focusX: number) => void;
  onCropYChange: (focusY: number) => void;
  onCropZoomChange: (zoom: number) => void;
  onDiscoverTemplates: () => void;
  onPrepareLocalImage: () => void;
  onRunTemplateRender: () => void;
  onSelectOffer: (offerId: string) => void;
  onSelectTemplate: (templateId: string) => void;
  onSelectTemplateOutput: (outputId: string) => void;
  /** Live framing while a slider is moving; the preview repaints from it. */
  onSlotTransformChange: (slotKey: string, transform: BrowserPreviewTransform) => void;
  /** Released framing: the same commit the preview's drag editing makes. */
  onSlotTransformCommit: (slotKey: string, transform: BrowserPreviewTransform) => void;
  onTemplateTextChange: (slotKey: string, value: string) => void;
  photos: BrowserPhoto[];
  prefilledSlotProvenance: Record<string, string>;
  preparing: boolean;
  renderArtifact?: TemplateRender["artifacts"][number];
  rendering: boolean;
  selectedOfferId: string;
  selectedPhotoId: string | null;
  selectedPhotoOrdinal: string;
  selectedProduct: CatalogProduct;
  selectedTemplateId: string;
  selectedTemplateOutputId: string;
  templateAssignments: Record<string, string>;
  templateContract: TemplateContract | null;
  templateInputs: Record<string, string>;
  templateNotice: PrepareStepNotice;
  templateOutput: TemplateOutput | null;
  templateRender: TemplateRender | null;
  templateState: TemplateState;
  templates: PublishedTemplate[];
  visibleTemplateSlots: TemplateContract["slots"];
};

function PanelHeading({ id, number, title }: { id: string; number: string; title: string }) {
  return (
    <h3 className="flex items-center gap-3 text-lg font-semibold" id={id}>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-[13px] font-semibold text-primary">
        {number}
      </span>
      {title}
    </h3>
  );
}

export function PrepareStep({
  activeImageSlotKey,
  activeSlotTransform,
  browserPreview,
  compatibleOutputs,
  crop,
  cropX,
  cropY,
  cropZoom,
  customization,
  hasLocalImage,
  imageName,
  imagePreview,
  managedAsset,
  offerState,
  offers,
  onAddPreparedLine,
  onAssignTemplatePhoto,
  onChangeFormat,
  onCropXChange,
  onCropYChange,
  onCropZoomChange,
  onDiscoverTemplates,
  onPrepareLocalImage,
  onRunTemplateRender,
  onSelectOffer,
  onSelectTemplate,
  onSelectTemplateOutput,
  onSlotTransformChange,
  onSlotTransformCommit,
  onTemplateTextChange,
  photos,
  prefilledSlotProvenance,
  preparing,
  renderArtifact,
  rendering,
  selectedOfferId,
  selectedPhotoId,
  selectedPhotoOrdinal,
  selectedProduct,
  selectedTemplateId,
  selectedTemplateOutputId,
  templateAssignments,
  templateContract,
  templateInputs,
  templateNotice,
  templateOutput,
  templateRender,
  templateState,
  templates,
  visibleTemplateSlots,
}: PrepareStepProps) {
  // A template draft previews the whole composed print; a direct print has only
  // its single-photo crop to show.
  const templatePreviewIsPrimary = customization === "template" && Boolean(browserPreview);
  const renderDisabled =
    rendering ||
    !visibleTemplateSlots
      .filter((slot) => slot.kind === "image" && slot.required)
      .every((slot) => Boolean(templateAssignments[slot.key]));

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
          Change format
        </Button>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(320px,.9fr)_minmax(360px,1.1fr)]">
        <div className="lg:sticky lg:top-5 lg:self-start">
          {templatePreviewIsPrimary ? (
            <>
              {browserPreview}

              {activeImageSlotKey && activeSlotTransform && (
                // The same per-slot framing the preview's drag editing owns, so
                // dragging moves these and these move the preview. It lives with
                // the preview so framing is adjusted where it is seen.
                <div className="mt-3 flex flex-col gap-4 rounded-[14px] border border-border bg-background/60 p-3">
                  <div className="grid gap-1">
                    <p className="text-base font-semibold text-foreground">Framing this image</p>
                    <p className="font-mono text-[13px] break-words text-muted-foreground">
                      {activeImageSlotKey}
                    </p>
                  </div>
                  <RangeField
                    hint={`${activeSlotTransform.zoom.toFixed(2)} times`}
                    label="Zoom"
                    max={4}
                    min={1}
                    onBlur={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                    onChange={(event) =>
                      onSlotTransformChange(activeImageSlotKey, {
                        ...activeSlotTransform,
                        zoom: Number(event.target.value),
                      })
                    }
                    onPointerUp={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                    step={0.01}
                    value={activeSlotTransform.zoom}
                  />
                  <RangeField
                    hint={`${Math.round(activeSlotTransform.offsetX)} percent horizontally`}
                    label="Pan X"
                    max={100}
                    min={-100}
                    onBlur={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                    onChange={(event) =>
                      onSlotTransformChange(activeImageSlotKey, {
                        ...activeSlotTransform,
                        offsetX: Number(event.target.value),
                      })
                    }
                    onPointerUp={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                    step={1}
                    value={activeSlotTransform.offsetX}
                  />
                  <RangeField
                    hint={`${Math.round(activeSlotTransform.offsetY)} percent vertically`}
                    label="Pan Y"
                    max={100}
                    min={-100}
                    onBlur={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                    onChange={(event) =>
                      onSlotTransformChange(activeImageSlotKey, {
                        ...activeSlotTransform,
                        offsetY: Number(event.target.value),
                      })
                    }
                    onPointerUp={() => onSlotTransformCommit(activeImageSlotKey, activeSlotTransform)}
                    step={1}
                    value={activeSlotTransform.offsetY}
                  />
                </div>
              )}

              <p className="mt-3 text-sm text-muted-foreground">
                Live template preview · {selectedProduct.name}
              </p>
              <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">
                Every photograph stays attached to its exact published slot key. This preview
                repaints as slots are assigned, swapped, or recropped. It is not a provider proof.
              </p>
            </>
          ) : (
            <>
              <PrintFrame
                aspect={crop === "5:7" ? "5 / 7" : "4 / 5"}
                className="w-full"
                innerClassName="relative bg-surface-warm"
              >
                {imagePreview ? (
                  <Image
                    alt="Selected image crop preview"
                    fill
                    sizes="(max-width: 760px) 340px, 390px"
                    src={imagePreview}
                    style={{
                      objectFit: "cover",
                      objectPosition: `${cropX}% ${cropY}%`,
                      transform: `scale(${cropZoom})`,
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

              {hasLocalImage && (
                // Direct-print framing lives with its preview too, so both
                // customization modes adjust the crop where it is seen.
                <div className="mt-3 flex flex-col gap-4 rounded-[14px] border border-border bg-background/60 p-3">
                  <p className="text-base font-semibold text-foreground">Framing this crop</p>
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
                  <RangeField
                    hint={`${cropZoom.toFixed(2)} times`}
                    label="Zoom"
                    max={4}
                    min={1}
                    onChange={(event) => onCropZoomChange(Number(event.target.value))}
                    step={0.05}
                    value={cropZoom}
                  />
                </div>
              )}

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
            <PanelHeading id="prepare-photo-title" number="1" title="Prepare selected photo" />
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
                <p className="text-sm text-muted-foreground">
                  Pan and zoom this crop with the sliders under the preview.
                </p>
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
              <PanelHeading id="template-title" number="2" title="Published studio template" />
              <div className="mt-4 flex flex-col gap-4">
                <Button
                  className="self-start"
                  disabled={templateState === "loading"}
                  onClick={onDiscoverTemplates}
                  variant="secondary"
                >
                  {templateState === "loading" ? "Reading…" : "Read active templates"}
                </Button>
                {templateNotice && (
                  <Notice tone={templateNotice.tone === "error" ? "error" : "info"}>
                    {templateNotice.message}
                  </Notice>
                )}
                {templates.length > 0 && (
                  <SelectField
                    label="Template"
                    onChange={(event) => onSelectTemplate(event.target.value)}
                    value={selectedTemplateId}
                  >
                    <option value="">Select a returned template</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name ?? template.id}
                      </option>
                    ))}
                  </SelectField>
                )}
                {compatibleOutputs.length > 0 && (
                  <SelectField
                    hint={`Matched only by canonical product ${selectedProduct.id} at revision ${selectedProduct.revision}; every compatible output remains selectable.`}
                    label="Compatible published output"
                    onChange={(event) => onSelectTemplateOutput(event.target.value)}
                    value={selectedTemplateOutputId}
                  >
                    {compatibleOutputs.map((output) => (
                      <option key={output.id} value={output.id}>
                        {output.label ?? output.id}
                        {compatibleOutputVariantSummary(output, selectedProduct)
                          ? ` · ${compatibleOutputVariantSummary(output, selectedProduct)}`
                          : ""}
                      </option>
                    ))}
                  </SelectField>
                )}
                {templateContract && (
                  <div className="flex flex-col gap-4">
                    <p className="max-w-[65ch] text-sm text-muted-foreground">
                      Compatible output: {templateOutput?.label ?? templateOutput?.id}. Every image
                      remains attached to its exact published slot key.
                    </p>
                    <TemplateSlotAssignment
                      assignments={templateAssignments}
                      onAssign={onAssignTemplatePhoto}
                      onTextChange={onTemplateTextChange}
                      photos={photos}
                      prefilledSlotProvenance={prefilledSlotProvenance}
                      slots={visibleTemplateSlots}
                      textValues={templateInputs}
                    />
                    <Button
                      className="w-full"
                      disabled={renderDisabled}
                      onClick={onRunTemplateRender}
                    >
                      {rendering ? "Preparing slots and rendering…" : "Create real template render"}
                    </Button>
                  </div>
                )}
                {templateRender && (
                  <p className="rounded-[12px] bg-card px-4 py-3 font-mono text-[13px] text-foreground">
                    Render <b className="font-semibold">{templateRender.render_id}</b>{" "}
                    <span className="text-muted-foreground">
                      {templateRender.status}
                      {renderArtifact
                        ? ` · ${renderArtifact.pixel_width} × ${renderArtifact.pixel_height}px`
                        : ""}
                    </span>
                  </p>
                )}
                <p className="max-w-[65ch] text-sm text-muted-foreground">
                  Server rendering uses the returned stable slot contract. Local framing is not sent
                  unless the public API publishes that input.
                </p>
              </div>
            </Surface>
          )}

          <Surface aria-labelledby="provider-offer-title" as="section">
            <PanelHeading id="provider-offer-title" number="3" title="Returned provider offer" />
            {offerState === "loading" && (
              <p className="mt-4 text-sm text-muted-foreground">Reading live offer evidence…</p>
            )}
            {offers.length > 0 && (
              <div className="mt-4">
                <SelectField
                  label="Available configuration"
                  onChange={(event) => onSelectOffer(event.target.value)}
                  value={selectedOfferId}
                >
                  {offers.map((offer) => (
                    <option key={offer.id} value={offer.id}>
                      {offer.provider_id.toUpperCase()} ·{" "}
                      {Object.entries(offer.configuration)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(", ")}{" "}
                      · provider cost {((offer.unit_cost_cents ?? 0) / 100).toFixed(2)}{" "}
                      {offer.currency}
                    </option>
                  ))}
                </SelectField>
              </div>
            )}
            {offerState === "ready" && offers.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                No provider offer is published for this product (demo cart only).
              </p>
            )}
            {offerState === "error" && (
              <p className="mt-4 text-sm text-muted-foreground">
                Published provider offers are unavailable right now (demo cart only).
              </p>
            )}
            <p className="mt-4 max-w-[65ch] text-sm text-muted-foreground">
              Provider unit cost is API evidence, not a retail price.
            </p>
          </Surface>

          <Button className="w-full" onClick={onAddPreparedLine} size="lg">
            Propose this print for the demo cart
          </Button>
        </div>
      </div>
    </section>
  );
}
