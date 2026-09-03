"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type CatalogProduct,
  type IngestedAsset,
  type PublishedTemplate,
  type ProviderOffer,
  type TemplateContract,
  type TemplateOutput,
  type TemplateRender,
  storefrontClient,
} from "@/lib/storefront/client";
import { type TemplateState } from "@/lib/storefront/customization";
import {
  createPrintDraft,
  cropPatchFromSlotTransform,
  directCropFocus,
  effectiveRequiredTemplateSlotKeys,
  effectiveTemplateSlotRequired,
  isCompleteTemplateDraft,
  missingTemplateDraftRequirements,
  naturalProductMatches,
  patchPrintDraft,
  productTypeMatches,
  rememberedCompatibleOutput,
  slotTransformFromCropPatch,
  type PrintDraft,
} from "@/lib/storefront/print-drafts";
import {
  compatibleOutputVariantSummary,
  compatibleTemplateOutputs,
  visibleStorefrontProducts,
} from "@/lib/storefront/template-compatibility";
import { BrowserTemplatePreview } from "@/components/storefront/browser-template-preview";
import { DraftRail } from "@/components/storefront/draft-rail";
import { FormatPicker } from "@/components/storefront/format-picker";
import { PhotoTray } from "@/components/storefront/photo-tray";
import { PrepareStep } from "@/components/storefront/prepare-step";
import { CartProposalCard } from "@/components/storefront/cart-proposal-card";
import { CartSheet } from "@/components/storefront/cart-sheet";
import { StorefrontMasthead, type CartAcknowledgement } from "@/components/storefront/storefront-masthead";
import {
  cartItemFromProposal,
  cartProposalOutcome,
  createCartProposal,
  localCartWireItems,
  type CartProposal,
  type CartProposalOutcome,
  type LocalCartItem,
} from "@/lib/storefront/local-cart";
import {
  browserPreviewCanvas,
  initialBrowserPreviewTransform,
  type BrowserPreviewDocument,
  type BrowserPreviewTransform,
} from "@/lib/storefront/browser-preview";
import { fallbackBrowserPreviewDocument } from "@/lib/storefront/preview-fallback";
import { publicTemplateAssetURL, specBrowserPreviewDocument } from "@/lib/storefront/preview-spec";
import { bundledTemplateSpec } from "@/lib/storefront/template-specs";
import {
  deriveImageSlotAliases,
  imageSlotBoxesFromCanvases,
  resolveSlotPatchTarget,
  slotBoxFromLabel,
  type SlotBox,
} from "@/lib/storefront/slot-aliases";
import {
  directPhotoDefault,
  emptyPhotoRoleMemory,
  photoRolesBySlotKey,
  prefillProvenance,
  prefillSlotAssignments,
  rememberDirectPhoto,
  rememberPhotoRole,
  rememberSlotAssignments,
  type PhotoRole,
  type PhotoRoleMemory,
  type SlotPrefill,
} from "@/lib/storefront/photo-role-defaults";
import {
  emptyPhotoLibrary,
  photoLibraryReducer,
  resolvePhotoReference,
  revokePhotoObjectURLs,
  type PhotoLibraryAction,
  type PhotoTarget,
} from "@/lib/storefront/photo-library";
import {
  publishStorefrontWebMcpState,
  respondToStorefrontWebMcpAction,
  subscribeToStorefrontWebMcpActions,
} from "@/webmcp/storefront-bridge";

type Notice = { tone: "error" | "info"; message: string } | null;
type ActiveStep = "catalog" | "prepare";

const productSelectionKey = (product: Pick<CatalogProduct, "id" | "revision">) =>
  JSON.stringify([product.id, product.revision]);
const cropFor = (product: CatalogProduct): "5:7" | "4:5" => {
  const output = product.physical_output;
  return output && output.width / output.height < 0.75 ? "5:7" : "4:5";
};
const responseMessage = (error: unknown) => error instanceof Error
  ? error.message
  : "The public API request could not be completed.";
/** Lets a state change paint before a WebMCP tool call resolves. */
const nextPaint = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
});
/** Slot boxes are read from the same parsed artwork the shopper is looking at. */
function browserPreviewSlotBoxes(document: BrowserPreviewDocument | null): Record<string, SlotBox> {
  if (!document) return {};
  const browserDocumentJSON = JSON.stringify(document.template.browser_document);
  return imageSlotBoxesFromCanvases(document.output.surfaces.flatMap((surface) => {
    const canvas = browserPreviewCanvas(browserDocumentJSON, surface.id, surface.variant_id, document.input_slots ?? []);
    return canvas ? [canvas] : [];
  }));
}

/**
 * The semantic role of each image slot, read from the same derived alias
 * vocabulary the agent is given. Only the artwork speaks here: a slot the
 * aliases cannot tell apart carries no role and receives no default.
 */
function imageSlotRoles(
  slots: TemplateContract["slots"],
  boxesBySlotKey: Record<string, SlotBox>,
): Record<string, PhotoRole> {
  const imageSlots = slots.filter((slot) => slot.kind === "image");
  const aliases = deriveImageSlotAliases(imageSlots, boxesBySlotKey);
  return photoRolesBySlotKey(imageSlots.map((slot) => ({
    key: slot.key,
    aliases: aliases[slot.key],
    box: boxesBySlotKey[slot.key] ?? slotBoxFromLabel(slot.suggested_label),
  })));
}

const templatePreferenceKey = "batchrelay-storefront-template-preferences-v1";
type TemplatePreference = { templateId: string; outputId?: string };

function rememberedTemplatePreference(product: CatalogProduct): TemplatePreference | null {
  if (typeof window === "undefined") return null;
  try {
    const values = JSON.parse(window.localStorage.getItem(templatePreferenceKey) ?? "{}") as Record<string, TemplatePreference>;
    return values[productSelectionKey(product)] ?? null;
  } catch { return null; }
}

function rememberTemplatePreference(product: CatalogProduct, templateId: string, outputId?: string): void {
  if (typeof window === "undefined") return;
  try {
    const values = JSON.parse(window.localStorage.getItem(templatePreferenceKey) ?? "{}") as Record<string, TemplatePreference>;
    values[productSelectionKey(product)] = { templateId, outputId };
    window.localStorage.setItem(templatePreferenceKey, JSON.stringify(values));
  } catch {
    // Preference persistence is optional; returned server compatibility stays authoritative.
  }
}

export function ManualStorefront() {
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);
  const [step, setStep] = useState<ActiveStep>("catalog");
  const [notice, setNotice] = useState<Notice>(null);
  const [photoLibrary, dispatchPhotoLibrary] = useReducer(photoLibraryReducer, undefined, emptyPhotoLibrary);
  const [cropX, setCropX] = useState(50);
  const [cropY, setCropY] = useState(50);
  const [cropZoom, setCropZoom] = useState(1);
  const [managedAsset, setManagedAsset] = useState<IngestedAsset | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [offers, setOffers] = useState<ProviderOffer[]>([]);
  const [offerState, setOfferState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [templates, setTemplates] = useState<PublishedTemplate[]>([]);
  const [templateState, setTemplateState] = useState<TemplateState>("idle");
  const [templateNotice, setTemplateNotice] = useState<Notice>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [compatibleOutputs, setCompatibleOutputs] = useState<TemplateOutput[]>([]);
  const [templateOutputsRevisionID, setTemplateOutputsRevisionID] = useState("");
  const [selectedTemplateOutputId, setSelectedTemplateOutputId] = useState("");
  const [templateOutput, setTemplateOutput] = useState<TemplateOutput | null>(null);
  const [templateContract, setTemplateContract] = useState<TemplateContract | null>(null);
  const [templateInputs, setTemplateInputs] = useState<Record<string, string>>({});
  const [templateAssignments, setTemplateAssignments] = useState<Record<string, string>>({});
  const [templateManagedAssets, setTemplateManagedAssets] = useState<Record<string, IngestedAsset>>({});
  const [slotTransforms, setSlotTransforms] = useState<Record<string, BrowserPreviewTransform>>({});
  const [activeImageSlotKey, setActiveImageSlotKey] = useState<string | null>(null);
  const [templateRender, setTemplateRender] = useState<TemplateRender | null>(null);
  const [browserPreviewDocument, setBrowserPreviewDocument] = useState<BrowserPreviewDocument | null>(null);
  const [selectedBrowserPreviewSurfaceID, setSelectedBrowserPreviewSurfaceID] = useState("");
  const [rendering, setRendering] = useState(false);
  const [customization, setCustomization] = useState<"direct" | "template">("direct");
  const [cart, setCart] = useState<LocalCartItem[]>([]);
  // The demo cart is a sheet over the current step, so the masthead chip can
  // show cart contents from any step without navigating. Nothing else opens it.
  const [cartOpen, setCartOpen] = useState(false);
  // An accepted proposal never opens the sheet; it flashes the masthead chip.
  const [cartAcknowledgement, setCartAcknowledgement] = useState<CartAcknowledgement | null>(null);
  const [pendingProposal, setPendingProposal] = useState<CartProposal | null>(null);
  const [lastProposalOutcome, setLastProposalOutcome] = useState<CartProposalOutcome | null>(null);
  const [drafts, setDrafts] = useState<PrintDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  // Which tray photograph the shopper last chose for each semantic role. It
  // lives for the session only and is never persisted or sent anywhere.
  const photoRoleMemory = useRef<PhotoRoleMemory>(emptyPhotoRoleMemory);
  const [prefilledSlots, setPrefilledSlots] = useState<Record<string, PhotoRole>>({});
  const lastSlotPrefills = useRef<{ assignments: Record<string, string>; prefills: SlotPrefill[] }>({ assignments: {}, prefills: [] });
  const templateRequestVersion = useRef(0);
  const browserPreviewRequestVersion = useRef(0);
  const lastBrowserPreviewTransforms = useRef<Record<string, BrowserPreviewTransform>>({});
  const photoLibraryRef = useRef(photoLibrary);
  const draftsRef = useRef(drafts);
  const browserPreviewDocumentRef = useRef<BrowserPreviewDocument | null>(browserPreviewDocument);

  useEffect(() => {
    let live = true;
    storefrontClient.catalog().then((response) => {
      if (!live) return;
      setCatalog(visibleStorefrontProducts(response.products));
      setCatalogState("ready");
    }).catch((error: unknown) => {
      if (!live) return;
      setCatalogState("error");
      setNotice({ tone: "error", message: `Catalog unavailable: ${responseMessage(error)}` });
    });
    return () => { live = false; };
  }, []);

  useEffect(() => { photoLibraryRef.current = photoLibrary; }, [photoLibrary]);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);
  useEffect(() => { browserPreviewDocumentRef.current = browserPreviewDocument; }, [browserPreviewDocument]);
  useEffect(() => () => revokePhotoObjectURLs(photoLibraryRef.current.photos), []);

  const selectedProduct = useMemo(
    () => catalog.find((product) => productSelectionKey(product) === selectedProductKey) ?? null,
    [catalog, selectedProductKey],
  );
  const selectedPhoto = useMemo(
    () => photoLibrary.photos.find((photo) => photo.id === photoLibrary.selectedPhotoId) ?? null,
    [photoLibrary.photos, photoLibrary.selectedPhotoId],
  );
  const imagePreview = selectedPhoto?.previewURL ?? null;
  const imageName = selectedPhoto?.filename ?? null;
  const localImage = selectedPhoto?.file ?? null;
  const selectedProductId = selectedProduct?.id ?? null;
  const selectedOffer = offers.find((offer) => offer.id === selectedOfferId) ?? null;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const browserPreviewAssetURLs = useMemo(() => browserPreviewDocument
    ? Object.fromEntries(browserPreviewDocument.assets.flatMap((asset) => {
      // API-issued assets go through the credentialed same-origin proxy.
      // Public template art from a bundled spec is already an absolute URL on
      // a trusted image host and is used directly, never proxied.
      const url = storefrontClient.browserPreviewAssetProxyURL(asset.content_url) ?? publicTemplateAssetURL(asset.content_url);
      return url ? [[asset.asset_ref, url]] : [];
    }))
    : {}, [browserPreviewDocument]);
  const crop = selectedProduct ? cropFor(selectedProduct) : "4:5";
  const renderArtifact = templateRender?.status === "succeeded" ? templateRender.artifacts[0] : undefined;
  const visibleTemplateSlots = useMemo(() => templateContract?.slots.map((slot) => ({
    ...slot,
    required: selectedProduct ? effectiveTemplateSlotRequired(selectedProduct, slot) : slot.required,
  })) ?? [], [selectedProduct, templateContract]);
  // Derived slot vocabulary ("team", "individual") published so an agent can
  // aim a slot patch at what the artwork visibly shows.
  const visibleSlotAliases = useMemo(() => deriveImageSlotAliases(
    templateContract?.slots.filter((slot) => slot.kind === "image") ?? [],
    browserPreviewSlotBoxes(browserPreviewDocument),
  ), [browserPreviewDocument, templateContract]);
  // The role each visible image slot speaks for, used to carry a shopper's
  // earlier choice across print types.
  const visibleSlotRoles = useMemo(
    () => imageSlotRoles(templateContract?.slots ?? [], browserPreviewSlotBoxes(browserPreviewDocument)),
    [browserPreviewDocument, templateContract],
  );
  const prefilledSlotProvenance = useMemo(() => Object.fromEntries(
    Object.entries(prefilledSlots).map(([slotKey, role]) => [slotKey, prefillProvenance(role)]),
  ), [prefilledSlots]);
  const activeSlotTransform = activeImageSlotKey && templateAssignments[activeImageSlotKey]
    ? slotTransforms[activeImageSlotKey] ?? initialBrowserPreviewTransform
    : null;
  const browserPreviewImageSlots = useMemo(() => Object.fromEntries(Object.entries(templateAssignments).flatMap(([slotKey, photoId]) => {
    const photo = photoLibrary.photos.find((candidate) => candidate.id === photoId);
    return photo ? [[slotKey, { source: photo.previewURL, transform: slotTransforms[slotKey] ?? initialBrowserPreviewTransform }]] : [];
  })), [photoLibrary.photos, slotTransforms, templateAssignments]);
  const productForDraft = (draft: PrintDraft) => catalog.find((candidate) =>
    candidate.id === draft.productId && candidate.revision === draft.productRevision) ?? null;
  const isAddableDraft = (draft: PrintDraft) => {
    const product = productForDraft(draft);
    return draft.template
      ? isCompleteTemplateDraft(draft)
      : Boolean(product && product.template_requirement !== "required" && draft.photoIds.length > 0);
  };
  const canAddAnyVisibleDraft = drafts.some(isAddableDraft);
  const proposalProduct = pendingProposal
    ? catalog.find((candidate) => candidate.id === pendingProposal.productId) ?? null
    : null;
  const proposalAspect = proposalProduct?.physical_output
    ? `${proposalProduct.physical_output.width} / ${proposalProduct.physical_output.height}`
    : "4 / 5";

  /**
   * The loaded browser preview is only a geometry source for the contract it
   * belongs to; a stale document must never name another template's slots.
   */
  function contractSlotBoxes(contract: TemplateContract): Record<string, SlotBox> {
    const document = browserPreviewDocumentRef.current;
    const matches = document?.template.id === contract.template.id
      && document.template.revision_id === contract.template.revision_id;
    return matches ? browserPreviewSlotBoxes(document) : {};
  }

  function imageSlotAliasesForContract(contract: TemplateContract): Record<string, string[]> {
    return deriveImageSlotAliases(
      contract.slots.filter((slot) => slot.kind === "image"),
      contractSlotBoxes(contract),
    );
  }

  function patchDraft(draftId: string, patch: Parameters<typeof patchPrintDraft>[1]) {
    setDrafts((items) => items.map((draft) => draft.id === draftId ? patchPrintDraft(draft, patch) : draft));
  }

  function selectDraft(draft: PrintDraft) {
    setSelectedDraftId(draft.id);
    const product = catalog.find((candidate) => candidate.id === draft.productId && candidate.revision === draft.productRevision);
    if (product) selectProduct(product, false);
    const firstPhoto = draft.photoIds[0];
    if (firstPhoto) dispatchPhotoLibrary({ type: "select", photoId: firstPhoto });
    setTemplateAssignments(draft.slotAssignments);
    setTemplateInputs(draft.textValues);
    setSlotTransforms(draft.slotTransforms);
    setCropZoom(draft.directCrop.zoom);
    setCropX(draft.directCrop.focusX);
    setCropY(draft.directCrop.focusY);
    if (!draft.template) setCustomization("direct");
    if (draft.template && product) {
      setCustomization("template");
      void chooseTemplate(draft.template.id, product, draft.template.outputId, undefined, draft.id).then(() => {
        // A draft with no saved assignments keeps whatever role defaults the
        // reloaded output just prefilled.
        if (Object.keys(draft.slotAssignments).length > 0) setTemplateAssignments(draft.slotAssignments);
        setTemplateInputs(draft.textValues);
        setSlotTransforms(draft.slotTransforms);
      }).catch((error) => setTemplateNotice({ tone: "error", message: `Template contract unavailable: ${responseMessage(error)}` }));
    }
  }

  function handlePhotoAction(action: PhotoLibraryAction) {
    if (action.type === "remove") {
      const photo = photoLibrary.photos.find((candidate) => candidate.id === action.photoId);
      if (photo) revokePhotoObjectURLs([photo]);
      setTemplateAssignments((assignments) => Object.fromEntries(
        Object.entries(assignments).filter(([, photoId]) => photoId !== action.photoId),
      ));
      setTemplateManagedAssets({});
    }
    // A direct print has no slots, so its printed shape names the role the
    // visible tray selection stands for.
    if (action.type === "select" && action.photoId && selectedProduct && customization === "direct") {
      photoRoleMemory.current = rememberDirectPhoto(photoRoleMemory.current, selectedProduct.physical_output, action.photoId);
    }
    if (action.type === "select" || action.type === "remove") {
      setManagedAsset(null);
      setCropX(50);
      setCropY(50);
      setCropZoom(1);
    }
    if (action.type === "add" || action.type === "move" || action.type === "remove") {
      setTemplateRender(null);
    }
    dispatchPhotoLibrary(action);
  }

  /**
   * Loads a product into the workbench. `navigate` is false for tool-driven
   * work: an agent updates the draft behind whatever the shopper is looking at
   * and never yanks them to another step.
   */
  function selectProduct(product: CatalogProduct, createVisibleDraft = true, navigate = true) {
    setSelectedProductKey(productSelectionKey(product));
    setManagedAsset(null);
    setSelectedTemplateId("");
    setCompatibleOutputs([]);
    setTemplateOutputsRevisionID("");
    setSelectedTemplateOutputId("");
    setTemplateRender(null);
    setTemplateContract(null);
    setTemplateOutput(null);
    setTemplateInputs({});
    setTemplateAssignments({});
    setPrefilledSlots({});
    setTemplateManagedAssets({});
    setSlotTransforms({});
    setActiveImageSlotKey(null);
    setBrowserPreviewDocument(null);
    browserPreviewDocumentRef.current = null;
    setSelectedBrowserPreviewSurfaceID("");
    browserPreviewRequestVersion.current += 1;
    if (navigate) setStep("prepare");
    setNotice(null);
    setOffers([]);
    setOfferState("loading");
    setSelectedOfferId("");
    // Provider offers are shown as published cost evidence only. The cart and
    // checkout are browser-local, so nothing here gates the flow: a product
    // with no published offer stays fully usable.
    storefrontClient.offers(product.id).then((result) => {
      const available = result.offers.filter((offer) =>
        offer.availability === "available" && offer.provider_id === "whcc");
      setOffers(available);
      setOfferState("ready");
      if (available.length > 0) setSelectedOfferId(available[0].id);
    }).catch(() => {
      // An offer lookup failure is reported quietly inside the offer panel.
      setOfferState("error");
    });
    // The template composition is the print, so it is the default preview
    // whenever the product publishes one.
    setCustomization(product.template_requirement === "unsupported" ? "direct" : "template");
    if (createVisibleDraft && photoLibrary.photos.length > 0) {
      // A print with no template composition is framed by the tray selection,
      // so a remembered photograph for this shape becomes the visible default.
      const roleDefault = product.template_requirement === "unsupported"
        ? directPhotoDefault(photoRoleMemory.current, product.physical_output, photoLibrary.photos.map((photo) => photo.id))
        : null;
      const photoId = roleDefault?.photoId ?? photoLibrary.selectedPhotoId ?? photoLibrary.photos[0]!.id;
      const draft = createPrintDraft(product, [photoId]);
      setDrafts((items) => [...items, draft]);
      setSelectedDraftId(draft.id);
      if (roleDefault) {
        dispatchPhotoLibrary({ type: "select", photoId });
        setNotice({ tone: "info", message: `Started this print with your ${prefillProvenance(roleDefault.role)} photograph. Choose another tray photo to change it.` });
      } else if (product.template_requirement === "unsupported") {
        photoRoleMemory.current = rememberDirectPhoto(photoRoleMemory.current, product.physical_output, photoId);
      }
      if (product.template_requirement !== "unsupported") {
        void chooseRememberedOrFirstCompatibleTemplate(product, draft).then((template) => {
          if (!template && product.template_requirement === "required") {
            setTemplateNotice({ tone: "info", message: "No active server template has a compatible published output for this product." });
          }
        }).catch((error) => setTemplateNotice({ tone: "error", message: `Published templates unavailable: ${responseMessage(error)}` }));
      }
    }
  }

  async function croppedFile(
    file: File,
    ratio: number,
    frame: { zoom: number; focusX: number; focusY: number; offsetX?: number; offsetY?: number } = { zoom: cropZoom, focusX: cropX, focusY: cropY },
  ): Promise<{ file: File; width: number; height: number }> {
    const bitmap = await createImageBitmap(file);
    try {
      const sourceRatio = bitmap.width / bitmap.height;
      let baseWidth = bitmap.width;
      let baseHeight = bitmap.height;
      if (sourceRatio > ratio) baseWidth = bitmap.height * ratio;
      else baseHeight = bitmap.width / ratio;
      const width = baseWidth / frame.zoom;
      const height = baseHeight / frame.zoom;
      const effectiveFocus = directCropFocus({ focusX: frame.focusX, focusY: frame.focusY, offsetX: frame.offsetX ?? 0, offsetY: frame.offsetY ?? 0 });
      const left = (bitmap.width - width) * (effectiveFocus.focusX / 100);
      const top = (bitmap.height - height) * (effectiveFocus.focusY / 100);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot prepare the selected image.");
      context.drawImage(bitmap, left, top, width, height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The crop could not be encoded.")), "image/jpeg", 0.94));
      const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
      return {
        file: new File([blob], `${baseName}-${crop.replace(":", "x")}.jpg`, { type: "image/jpeg" }),
        width: canvas.width,
        height: canvas.height,
      };
    } finally { bitmap.close(); }
  }

  async function prepareLocalImage() {
    if (!localImage || !selectedProduct || !selectedPhoto) return;
    const target: PhotoTarget = { productId: selectedProduct.id, productRevision: selectedProduct.revision };
    templateRequestVersion.current += 1;
    setTemplateRender(null);
    setPreparing(true);
    setNotice(null);
    dispatchPhotoLibrary({ type: "set-preparation", photoId: selectedPhoto.id, target, preparation: { status: "preparing" } });
    try {
      const prepared = await croppedFile(localImage, crop === "5:7" ? 5 / 7 : 4 / 5);
      const uploaded = await storefrontClient.uploadStudioAsset(prepared.file);
      const asset: IngestedAsset = {
        asset_id: uploaded.asset_id,
        pixel_width: prepared.width,
        pixel_height: prepared.height,
        format: "jpeg",
        original_filename: prepared.file.name,
        reused: false,
      };
      setManagedAsset(asset);
      dispatchPhotoLibrary({ type: "set-preparation", photoId: selectedPhoto.id, target, preparation: { status: "ready", managedAssetId: asset.asset_id, preparedFilename: asset.original_filename } });
      setTemplateRender(null);
      setNotice({ tone: "info", message: `Prepared ${prepared.width} × ${prepared.height}px through the published studio asset API.` });
    } catch (error) {
      dispatchPhotoLibrary({ type: "set-preparation", photoId: selectedPhoto.id, target, preparation: { status: "error", error: responseMessage(error) } });
      setNotice({ tone: "error", message: `Image preparation failed: ${responseMessage(error)}` });
    } finally { setPreparing(false); }
  }

  async function discoverTemplates() {
    const requestVersion = ++templateRequestVersion.current;
    setTemplateState("loading");
    setTemplateNotice(null);
    try {
      const result = await storefrontClient.templates();
      if (requestVersion !== templateRequestVersion.current) return;
      setTemplates(result.items);
      setTemplateState("ready");
      if (result.items.length === 0) setTemplateNotice({ tone: "info", message: "The API returned no active templates for the server-configured studio." });
    } catch (error) {
      if (requestVersion !== templateRequestVersion.current) return;
      setTemplateState("error");
      setTemplateNotice({ tone: "error", message: `Published templates unavailable: ${responseMessage(error)}. No templates are substituted locally.` });
    }
  }

  async function chooseTemplate(
    templateId: string,
    productForCompatibility: CatalogProduct | null = selectedProduct,
    preferredOutputId?: string,
    orientation?: "portrait" | "landscape",
    draftId?: string,
  ): Promise<PrintDraft["template"] | null> {
    const requestVersion = ++templateRequestVersion.current;
    setSelectedTemplateId(templateId);
    setCompatibleOutputs([]);
    setTemplateOutputsRevisionID("");
    setSelectedTemplateOutputId("");
    setTemplateContract(null);
    setTemplateOutput(null);
    setTemplateRender(null);
    setTemplateInputs({});
    setTemplateAssignments({});
    setPrefilledSlots({});
    setTemplateManagedAssets({});
    setSlotTransforms({});
    setActiveImageSlotKey(null);
    setBrowserPreviewDocument(null);
    browserPreviewDocumentRef.current = null;
    setSelectedBrowserPreviewSurfaceID("");
    browserPreviewRequestVersion.current += 1;
    setTemplateNotice(null);
    if (!templateId || !productForCompatibility) return null;
    setTemplateState("loading");
    try {
      const outputs = await storefrontClient.templateOutputs(templateId);
      if (requestVersion !== templateRequestVersion.current) return;
      const compatible = compatibleTemplateOutputs(outputs.outputs, productForCompatibility).filter((output) =>
        !orientation || compatibleOutputVariantSummary(output, productForCompatibility) === orientation);
      if (compatible.length === 0) {
        throw new Error(`The template has no published ${productForCompatibility.name} output at canonical revision ${productForCompatibility.revision}.`);
      }
      if (preferredOutputId && !compatible.some((output) => output.id === preferredOutputId)) {
        throw new Error("The requested output is not a compatible published output for this product and orientation.");
      }
      setCompatibleOutputs(compatible);
      setTemplateOutputsRevisionID(outputs.revision_id);
      const preferred = compatible.find((output) => output.id === preferredOutputId) ?? compatible[0]!;
      rememberTemplatePreference(productForCompatibility, templateId, preferred.id);
      return await selectTemplateOutput({
        templateID: templateId,
        outputID: preferred.id,
        outputs: compatible,
        revisionID: outputs.revision_id,
        requestVersion,
        draftId,
        product: productForCompatibility,
      });
    } catch (error) {
      if (requestVersion !== templateRequestVersion.current) return;
      setTemplateState("error");
      setTemplateNotice({ tone: "error", message: `Template contract unavailable: ${responseMessage(error)}` });
      throw error;
    }
  }

  async function chooseRememberedOrFirstCompatibleTemplate(
    product: CatalogProduct,
    draft: PrintDraft,
    requestedOutputId?: string,
    requestedOrientation?: "portrait" | "landscape",
  ): Promise<PrintDraft["template"] | null> {
    const discovered = templates.length > 0 ? templates : (await storefrontClient.templates()).items;
    if (templates.length === 0) setTemplates(discovered);
    const stored = rememberedTemplatePreference(product);
    const preferredTemplateID = draft.template?.id ?? stored?.templateId;
    const ordered = [...discovered].sort((left, right) => Number(right.id === preferredTemplateID) - Number(left.id === preferredTemplateID));
    for (const template of ordered) {
      try {
        const outputs = await storefrontClient.templateOutputs(template.id);
        const compatible = compatibleTemplateOutputs(outputs.outputs, product).filter((output) =>
          !requestedOrientation || compatibleOutputVariantSummary(output, product) === requestedOrientation);
        if (compatible.length === 0) continue;
        const output = requestedOutputId
          ? compatible.find((candidate) => candidate.id === requestedOutputId)
          : rememberedCompatibleOutput(draft.template, template.id, outputs.revision_id, compatible)
            ?? compatible.find((candidate) => template.id === stored?.templateId && candidate.id === stored.outputId)
            ?? compatible[0];
        if (!output) continue;
        const selected = await chooseTemplate(template.id, product, output.id, requestedOrientation, draft.id);
        if (!selected) continue;
        return selected;
      } catch {
        // A template with an unreadable output contract is not compatible for
        // this visible flow. Continue only with the server-returned list.
      }
    }
    return null;
  }

  async function selectTemplateOutput({
    templateID = selectedTemplateId,
    outputID,
    outputs = compatibleOutputs,
    revisionID = templateOutputsRevisionID,
    requestVersion = ++templateRequestVersion.current,
    draftId,
    product,
  }: {
    templateID?: string;
    outputID: string;
    outputs?: TemplateOutput[];
    revisionID?: string;
    requestVersion?: number;
    draftId?: string;
    product?: CatalogProduct | null;
  }): Promise<NonNullable<PrintDraft["template"]> | null> {
    const output = outputs.find((candidate) => candidate.id === outputID);
    if (!templateID || !output || !revisionID) {
      throw new Error("Choose one of the published compatible outputs.");
    }
    setSelectedTemplateOutputId(outputID);
    setTemplateOutput(null);
    setTemplateContract(null);
    setTemplateRender(null);
    setTemplateInputs({});
    setTemplateAssignments({});
    setPrefilledSlots({});
    setTemplateManagedAssets({});
    setSlotTransforms({});
    setActiveImageSlotKey(null);
    setBrowserPreviewDocument(null);
    browserPreviewDocumentRef.current = null;
    setSelectedBrowserPreviewSurfaceID("");
    setTemplateState("loading");
    lastSlotPrefills.current = { assignments: {}, prefills: [] };
    try {
      const contract = await storefrontClient.templateContract(templateID, output.id, revisionID);
      if (requestVersion !== templateRequestVersion.current) return null;
      setTemplateOutput(output);
      setTemplateContract(contract);
      if (selectedProduct) rememberTemplatePreference(selectedProduct, templateID, output.id);
      const selected = { id: templateID, outputId: output.id, revisionId: contract.template.revision_id };
      const targetDraftId = draftId ?? selectedDraftId;
      if (targetDraftId) patchDraft(targetDraftId, {
        template: selected,
        templateContractKnown: true,
        requiredSlotKeys: product
          ? effectiveRequiredTemplateSlotKeys(product, contract.slots)
          : contract.slots.filter((slot) => slot.required).map((slot) => slot.key),
      });
      setTemplateAssignments({});
      setActiveImageSlotKey(null);
      setTemplateState("ready");
      setTemplateNotice({ tone: "info", message: `Loaded ${contract.slots.length} stable slot${contract.slots.length === 1 ? "" : "s"} from ${output.label ?? output.id}.` });
      let previewDocument: BrowserPreviewDocument | null = null;
      try {
        const browserDocument = await storefrontClient.browserPreviewDocument(templateID, output.id, revisionID);
        if (requestVersion !== templateRequestVersion.current) return null;
        previewDocument = browserDocument;
        setBrowserPreviewDocument(browserDocument);
        browserPreviewDocumentRef.current = browserDocument;
        setSelectedBrowserPreviewSurfaceID(browserDocument.output.surfaces[0]?.id ?? "");
      } catch (browserPreviewError) {
        if (requestVersion !== templateRequestVersion.current) return null;
        // The published artwork is unavailable. A bundled copy of the
        // published document is preferred, and a layout synthesized from the
        // contract is the last resort; either way the notice says which.
        const spec = bundledTemplateSpec(templateID);
        const fallback = (spec ? specBrowserPreviewDocument({ spec, contract, output }) : null)
          ?? fallbackBrowserPreviewDocument({ templateID, contract, output });
        previewDocument = fallback;
        setBrowserPreviewDocument(fallback);
        browserPreviewDocumentRef.current = fallback;
        setSelectedBrowserPreviewSurfaceID(fallback?.output.surfaces[0]?.id ?? "");
        setTemplateNotice(fallback
          ? {
            tone: "info",
            message: fallback.preview_source === "local_published_copy"
              ? "Live template artwork is unavailable — showing the published layout from a local copy."
              : "Live template artwork is unavailable — showing a simplified layout.",
          }
          : { tone: "error", message: `Live template artwork is unavailable and no local layout could be built: ${responseMessage(browserPreviewError)}` });
      }
      // The loaded output starts with whatever this draft already holds; every
      // still-empty image slot takes the photograph the shopper already chose
      // for that role on another print, and says so.
      const existingAssignments = draftsRef.current.find((candidate) => candidate.id === targetDraftId)?.slotAssignments ?? {};
      const { assignments, prefills } = prefillSlotAssignments({
        assignments: existingAssignments,
        memory: photoRoleMemory.current,
        rolesBySlotKey: imageSlotRoles(contract.slots, browserPreviewSlotBoxes(previewDocument)),
        availablePhotoIds: photoLibraryRef.current.photos.map((photo) => photo.id),
      });
      lastSlotPrefills.current = { assignments, prefills };
      if (prefills.length > 0) {
        setTemplateAssignments(assignments);
        setPrefilledSlots(Object.fromEntries(prefills.map((prefill) => [prefill.slotKey, prefill.role])));
        if (targetDraftId) patchDraft(targetDraftId, { slotAssignments: assignments, proofState: "idle" });
      }
      return selected;
    } catch (error) {
      if (requestVersion !== templateRequestVersion.current) return null;
      setTemplateState("error");
      setTemplateNotice({ tone: "error", message: `Template contract unavailable: ${responseMessage(error)}` });
      throw error;
    }
  }

  function assignTemplatePhoto(slotKey: string, photoId: string | null) {
    setTemplateAssignments((assignments) => {
      const next = { ...assignments };
      if (photoId) next[slotKey] = photoId;
      else delete next[slotKey];
      if (selectedDraftId) patchDraft(selectedDraftId, { slotAssignments: next, proofState: "idle" });
      return next;
    });
    setTemplateManagedAssets((assets) => Object.fromEntries(Object.entries(assets).filter(([key]) => key !== slotKey)));
    // Framing belongs to the browser preview and is never baked into the
    // source File. Keeping it while unassigned makes reassignment reversible.
    if (photoId) setSlotTransforms((transforms) => ({ ...transforms, [slotKey]: transforms[slotKey] ?? initialBrowserPreviewTransform }));
    setActiveImageSlotKey(photoId ? slotKey : null);
    // A deliberate choice always wins over a carried-over default, and becomes
    // the photograph remembered for that role.
    photoRoleMemory.current = rememberPhotoRole(photoRoleMemory.current, visibleSlotRoles[slotKey] ?? null, photoId);
    setPrefilledSlots((slots) => {
      if (!(slotKey in slots)) return slots;
      const next = { ...slots };
      delete next[slotKey];
      return next;
    });
    invalidateTemplateRenderForBrowserPreviewChange();
  }

  async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
    const bitmap = await createImageBitmap(file);
    try { return { width: bitmap.width, height: bitmap.height }; }
    finally { bitmap.close(); }
  }

  async function prepareTemplateSlotAssets(assignments: Record<string, string> = templateAssignments): Promise<Record<string, IngestedAsset>> {
    if (!selectedProduct || !selectedTemplate || !templateContract || !templateOutput) {
      throw new Error("Choose a compatible published template output before preparing its photographs.");
    }
    const imageSlots = templateContract.slots.filter((slot) => slot.kind === "image");
    const nextAssets = assignments === templateAssignments ? { ...templateManagedAssets } : {};
    for (const slot of imageSlots) {
      const photoId = assignments[slot.key];
      if (!photoId) {
        if (effectiveTemplateSlotRequired(selectedProduct, slot)) throw new Error(`Assign a tray photo to ${slot.suggested_label ?? slot.key}.`);
        continue;
      }
      const photo = photoLibrary.photos.find((candidate) => candidate.id === photoId);
      if (!photo) throw new Error(`The photo assigned to ${slot.suggested_label ?? slot.key} is no longer in the tray.`);
      if (nextAssets[slot.key]) continue;
      const target: PhotoTarget = {
        productId: selectedProduct.id,
        productRevision: selectedProduct.revision,
        templateId: selectedTemplate.id,
        templateRevisionId: templateContract.template.revision_id,
        slotKey: slot.key,
      };
      dispatchPhotoLibrary({ type: "set-preparation", photoId, target, preparation: { status: "preparing" } });
      try {
        const [uploaded, dimensions] = await Promise.all([
          storefrontClient.uploadStudioAsset(photo.file),
          imageDimensions(photo.file),
        ]);
        const asset: IngestedAsset = {
          asset_id: uploaded.asset_id,
          pixel_width: dimensions.width,
          pixel_height: dimensions.height,
          format: photo.mimeType === "image/png" ? "png" : "jpeg",
          original_filename: photo.filename,
          reused: false,
        };
        nextAssets[slot.key] = asset;
        dispatchPhotoLibrary({ type: "set-preparation", photoId, target, preparation: { status: "ready", managedAssetId: asset.asset_id, preparedFilename: photo.filename } });
      } catch (error) {
        dispatchPhotoLibrary({ type: "set-preparation", photoId, target, preparation: { status: "error", error: responseMessage(error) } });
        throw error;
      }
    }
    setTemplateManagedAssets(nextAssets);
    return nextAssets;
  }

  function templateRenderInputs(assets: Record<string, IngestedAsset>, textValues: Record<string, string> = templateInputs) {
    if (!templateContract) throw new Error("Choose a published template contract before requesting a render.");
    const entries: Array<[string, { asset_id: string } | { value: string }]> = [];
    for (const slot of templateContract.slots) {
      if (slot.kind === "image") {
        const asset = assets[slot.key];
        if (asset) entries.push([slot.key, { asset_id: asset.asset_id }]);
      } else {
        entries.push([slot.key, { value: textValues[slot.key] ?? "" }]);
      }
    }
    return Object.fromEntries(entries);
  }

  function invalidateTemplateRenderForBrowserPreviewChange() {
    templateRequestVersion.current += 1;
    browserPreviewRequestVersion.current += 1;
    setTemplateRender(null);
    setRendering(false);
  }

  /** Live framing, shared by preview dragging and the prepare-step sliders, so
   *  each one shows what the other is doing. Nothing is committed yet. */
  function changeBrowserPreviewTransform(slotKey: string, transform: BrowserPreviewTransform) {
    const next = { ...lastBrowserPreviewTransforms.current, [slotKey]: transform };
    lastBrowserPreviewTransforms.current = next;
    setSlotTransforms(next);
  }

  function updateBrowserPreviewTransform(slotKey: string, transform: BrowserPreviewTransform) {
    const next = { ...lastBrowserPreviewTransforms.current, [slotKey]: transform };
    lastBrowserPreviewTransforms.current = next;
    setSlotTransforms(next);
    if (selectedDraftId) patchDraft(selectedDraftId, { slotTransforms: next, proofState: "idle" });
    invalidateTemplateRenderForBrowserPreviewChange();
  }

  async function runTemplateRender(
    assignmentOverrides: Record<string, string> = templateAssignments,
    textOverrides: Record<string, string> = templateInputs,
  ) {
    if (!selectedTemplate || !templateContract || !templateOutput) {
      throw new Error("Choose a compatible published template before rendering.");
    }
    const assets = await prepareTemplateSlotAssets(assignmentOverrides);
    const inputs = templateRenderInputs(assets, textOverrides);
    const slotKeys = new Set(templateContract.slots.map((slot) => slot.key));
    if (Object.keys(inputs).some((key) => !slotKeys.has(key))) {
      throw new Error("Template inputs must use only stable keys from the visible published contract.");
    }
    for (const slot of templateContract.slots) {
      const input = inputs[slot.key];
      if (input && slot.kind === "image" && (!("asset_id" in input) || typeof input.asset_id !== "string" || input.asset_id.length === 0)) {
        throw new Error(`Template image input ${slot.key} must use the photo assigned to that exact stable slot key.`);
      }
      if (input && slot.kind === "text" && !("value" in input)) {
        throw new Error("Template text inputs must provide a text value.");
      }
    }
    for (const slot of templateContract.slots.filter((candidate) => effectiveTemplateSlotRequired(selectedProduct!, candidate))) {
      const input = inputs[slot.key];
      if (!input || ("value" in input && (typeof input.value !== "string" || input.value.length === 0))) {
        throw new Error(`Complete the required ${slot.suggested_label ?? slot.kind} slot.`);
      }
    }
    const requestVersion = ++templateRequestVersion.current;
    setRendering(true);
    setTemplateNotice(null);
    try {
      let result = await storefrontClient.createTemplateRender(selectedTemplate.id, {
        revision_id: templateContract.template.revision_id,
        output_id: templateOutput.id,
        inputs,
      });
      if (requestVersion !== templateRequestVersion.current) return result;
      for (let attempt = 0; attempt < 15 && ["queued", "running"].includes(result.status); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        result = await storefrontClient.templateRender(result.render_id);
        if (requestVersion !== templateRequestVersion.current) return result;
      }
      setTemplateRender(result);
      if (result.status !== "succeeded" || result.artifacts.length !== 1) {
        throw new Error(`Batch Relay render ${result.render_id} is ${result.status} with ${result.artifacts.length} artifacts; this single-surface print requires exactly one.`);
      }
      setTemplateNotice({ tone: "info", message: `Render ${result.render_id} succeeded with ${result.artifacts.length} fulfillment artifact${result.artifacts.length === 1 ? "" : "s"}. The public API does not expose artifact bytes for an inline PNG preview.` });
      return result;
    } catch (error) {
      if (requestVersion !== templateRequestVersion.current) throw error;
      setTemplateNotice({ tone: "error", message: `Template render failed: ${responseMessage(error)}` });
      throw error;
    } finally {
      if (requestVersion === templateRequestVersion.current) setRendering(false);
    }
  }

  /**
   * The direct-print framing in the same vocabulary configure_print accepts, so
   * an agent can read the current crop and ask for a relative change such as
   * "zoom in a little" without guessing where the frame already sits.
   */
  function visibleDirectCrop(draft: PrintDraft | null) {
    const frame = draft?.directCrop ?? { zoom: cropZoom, focusX: cropX, focusY: cropY, offsetX: 0, offsetY: 0 };
    const focus = directCropFocus(frame);
    return { zoom: frame.zoom, focusX: focus.focusX, focusY: focus.focusY, offsetX: 0, offsetY: 0 };
  }

  function draftThumbnailURL(draft: PrintDraft): string | null {
    const photoId = Object.values(draft.slotAssignments)[0] ?? draft.photoIds[0];
    return photoLibrary.photos.find((candidate) => candidate.id === photoId)?.previewURL ?? null;
  }

  /** Shows the picture-in-picture proposal. Nothing enters the cart until the
   *  shopper accepts it here or through resolve_cart_proposal. */
  function proposeDraft(draft: PrintDraft, quantity: number): CartProposal {
    const product = productForDraft(draft);
    if (!product) throw new Error("That visible draft no longer has its returned catalog product.");
    if (!isAddableDraft(draft)) {
      throw new Error(draft.template
        ? "Complete every required visible template slot before proposing this draft."
        : "Choose at least one visible tray photograph before proposing this draft.");
    }
    const proposal = createCartProposal({
      draftId: draft.id,
      productId: product.id,
      productName: product.name,
      quantity,
      thumbnailURL: draftThumbnailURL(draft),
      source: draft.template ? "template" : "direct",
      draft,
    });
    setPendingProposal(proposal);
    setLastProposalOutcome(null);
    setNotice({ tone: "info", message: `Proposed ${quantity} × ${product.name}. Accept or reject the preview card.` });
    return proposal;
  }

  function resolveProposal(proposal: CartProposal, decision: "accept" | "reject"): LocalCartItem[] {
    const accepted = decision === "accept";
    const nextCart = accepted ? [...cart, cartItemFromProposal(proposal)] : cart;
    if (accepted) {
      setCart(nextCart);
      // Deliberately does not open the cart sheet: the masthead chip count
      // updates and flashes, so the add is noticeable without stealing focus.
      setCartAcknowledgement((previous) => ({ id: (previous?.id ?? 0) + 1, quantity: proposal.quantity }));
    }
    setPendingProposal(null);
    setLastProposalOutcome(cartProposalOutcome(proposal, accepted ? "accepted" : "rejected"));
    setNotice({ tone: "info", message: accepted
      ? `Added ${proposal.quantity} × ${proposal.productName} to this browser's demo cart. Nothing was ordered or charged.`
      : `Dismissed the ${proposal.productName} proposal. Nothing entered the demo cart.` });
    return nextCart;
  }

  useEffect(() => {
    publishStorefrontWebMcpState({
      revision: photoLibrary.revision + cart.length + (selectedProduct ? 1 : 0) + (templateContract ? 1 : 0),
      trayRevision: photoLibrary.revision,
      photoCount: photoLibrary.photos.length,
      selectedPhotoId: photoLibrary.selectedPhotoId,
      selectedProductId,
      selectedTemplateId: selectedTemplate?.id ?? null,
      selectedTemplateOutputId: templateOutput?.id ?? null,
      canConfigurePrint: catalogState === "ready" && photoLibrary.photos.length > 0,
      canRenderTemplatePreview: Boolean(selectedTemplate && templateContract && templateOutput &&
        visibleTemplateSlots.filter((slot) => slot.kind === "image" && slot.required)
          .every((slot) => Boolean(templateAssignments[slot.key]))),
      canAddToCart: canAddAnyVisibleDraft,
      pendingProposal: Boolean(pendingProposal),
      cartItemCount: cart.length,
    });
  }, [canAddAnyVisibleDraft, catalogState, pendingProposal, cart.length, customization, managedAsset, photoLibrary, renderArtifact, selectedOffer, selectedProduct, selectedProductId, selectedTemplate, templateAssignments, templateContract, templateOutput, visibleTemplateSlots]);

  useEffect(() => subscribeToStorefrontWebMcpActions((request) => {
    void (async () => {
      try {
        if (request.action === "ask_storefront") {
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
            answer: "This storefront works from the visible left-to-right tray and local print drafts. Its cart and checkout are a browser-local demo: nothing is fulfilled, charged, or ordered.",
            state: {
              tray: { revision: photoLibrary.revision, photos: photoLibrary.photos.map((photo, index) => ({ photo_id: photo.id, position: index + 1, filename: photo.filename })) },
              selection: { product_id: selectedProductId, template_id: selectedTemplate?.id ?? null, output_id: templateOutput?.id ?? null, active_draft_id: selectedDraftId, preview_source: browserPreviewDocument ? browserPreviewDocument.preview_source ?? "published" : null },
              drafts: drafts.map((draft) => ({ draft_id: draft.id, product_id: draft.productId, product_revision: draft.productRevision, photo_ids: draft.photoIds, template: draft.template ?? null, proof_state: draft.proofState })),
              template_slots: visibleTemplateSlots.map((slot) => ({
                key: slot.key,
                kind: slot.kind,
                required: slot.required,
                published_required: templateContract?.slots.find((candidate) => candidate.key === slot.key)?.required ?? slot.required,
                assigned_photo_id: slot.kind === "image" ? templateAssignments[slot.key] ?? null : null,
                value: slot.kind === "text" ? templateInputs[slot.key] ?? "" : null,
                label: slot.suggested_label ?? null,
                aliases: slot.kind === "image" ? visibleSlotAliases[slot.key] ?? [] : [],
                role: slot.kind === "image" ? visibleSlotRoles[slot.key] ?? null : null,
                prefilled_from: prefilledSlots[slot.key] ? prefillProvenance(prefilledSlots[slot.key]!) : null,
                // The set_crop values that reproduce the visible framing, so a
                // relative crop request can be computed rather than guessed.
                crop: slot.kind === "image"
                  ? cropPatchFromSlotTransform(slotTransforms[slot.key] ?? initialBrowserPreviewTransform)
                  : null,
              })),
              direct_crop: visibleDirectCrop(selectedDraft),
              // The photograph the shopper last chose for each semantic role,
              // which is what a new print's empty slots start from.
              photo_role_defaults: photoRoleMemory.current,
              cart_item_count: cart.length,
              cart_items: localCartWireItems(cart),
              pending_proposal: pendingProposal
                ? { proposal_id: pendingProposal.id, draft_id: pendingProposal.draftId, product_name: pendingProposal.productName, quantity: pendingProposal.quantity }
                : null,
              last_proposal_outcome: lastProposalOutcome
                ? { proposal_id: lastProposalOutcome.proposalId, draft_id: lastProposalOutcome.draftId, product_name: lastProposalOutcome.productName, quantity: lastProposalOutcome.quantity, decision: lastProposalOutcome.decision }
                : null,
            },
            guidance: pendingProposal
              ? "A proposal card is visible; ask the shopper to accept or reject it, or call resolve_cart_proposal with their answer."
              : selectedDraftId
                ? "Complete the active draft's visible slots, then propose it for the demo cart."
                : "Configure a print from visible tray photos to create a draft.",
          } });
          return;
        }
        if (request.action === "find_prints") {
          const query = typeof request.input.query === "string" ? request.input.query : "";
          const productType = typeof request.input.productType === "string" ? request.input.productType : "";
          const requestedMaximum = typeof request.input.maxResults === "number" ? request.input.maxResults : 50;
          const max = Math.max(1, Math.min(Math.floor(requestedMaximum), 50));
          const matches = (query ? naturalProductMatches(catalog, query) : catalog)
            .filter((product) => productTypeMatches(product, productType))
            .slice(0, max)
            .map(({ id, revision, name, description, category, fulfillment_type, template_requirement, physical_output }) => ({
              id, revision, name, description, category, fulfillment_type, template_requirement, physical_output,
            }));
          setStep("catalog");
          const note = matches.length > 0
            ? `Found ${matches.length} live catalog product${matches.length === 1 ? "" : "s"}.`
            : "No live catalog products match that query and product type.";
          setNotice({ tone: "info", message: `WebMCP ${note}` });
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: { matches, note } });
          return;
        }
        if (request.action === "configure_print") {
          if (request.input.trayRevision !== photoLibrary.revision) throw new Error(`The photo tray changed; use visible tray revision ${photoLibrary.revision}.`);
          const requestedDraftId = typeof request.input.draftId === "string" ? request.input.draftId : null;
          const existingDraft = requestedDraftId ? draftsRef.current.find((draft) => draft.id === requestedDraftId) : null;
          if (requestedDraftId && !existingDraft) throw new Error("That visible draft no longer exists. Create a new print configuration instead.");
          const productId = typeof request.input.productId === "string" ? request.input.productId : existingDraft?.productId ?? null;
          const productQuery = typeof request.input.productQuery === "string" ? request.input.productQuery.trim().toLowerCase() : "";
          const productMatches = productId
            ? catalog.filter((candidate) => candidate.id === productId && (!existingDraft || candidate.revision === existingDraft.productRevision))
            : productQuery ? naturalProductMatches(catalog, productQuery) : selectedProduct ? [selectedProduct] : [];
          if (productMatches.length !== 1) throw new Error(productMatches.length === 0
            ? "No live print matches that product reference."
            : "That natural product reference matches more than one live print; use the canonical product ID.");
          const refs = Array.isArray(request.input.photoRefs) ? request.input.photoRefs : [];
          const resolved = refs.map((reference) => resolvePhotoReference(photoLibrary.photos, reference as string | number));
          const ambiguous = resolved.find((result) => result.kind === "ambiguous");
          if (ambiguous?.kind === "ambiguous") throw new Error(`${ambiguous.reference} matches multiple tray photographs; use the returned photo ID.`);
          const missing = resolved.find((result) => result.kind === "missing");
          if (missing?.kind === "missing") throw new Error(`${missing.reference} is not in the current photo tray.`);
          const photos = resolved.flatMap((result) => result.kind === "resolved" ? [result.photo] : []);
          const product = productMatches[0]!;
          // With no photograph named, a print falls back to the photograph the
          // shopper already chose for this shape's role, if one is still visible.
          const roleDefault = photos.length === 0 && !existingDraft
            ? directPhotoDefault(photoRoleMemory.current, product.physical_output, photoLibrary.photos.map((photo) => photo.id))
            : null;
          if (photos.length === 0 && !existingDraft && !roleDefault) throw new Error("Choose at least one photograph from the visible tray.");
          const photoIds = photos.length > 0
            ? photos.map((photo) => photo.id)
            : roleDefault ? [roleDefault.photoId] : existingDraft!.photoIds;
          const draft = existingDraft
            ? patchPrintDraft(existingDraft, { photoIds, proofState: "idle" })
            : createPrintDraft(product, photoIds);
          let finalDraft = draft;
          let responseContract: TemplateContract | null = null;
          let appliedPrefills: SlotPrefill[] = [];
          setDrafts((items) => existingDraft ? items.map((item) => item.id === draft.id ? draft : item) : [...items, draft]);
          setSelectedDraftId(draft.id);
          // The draft, its template and its live preview all load behind the
          // step the shopper is already on. Configuring a print is not a
          // reason to move them.
          selectProduct(product, false, false);
          dispatchPhotoLibrary({ type: "select", photoId: photoIds[0] ?? null });
          const directCrop = request.input.directCrop && typeof request.input.directCrop === "object" ? request.input.directCrop as Record<string, unknown> : null;
          if (directCrop) {
            const nextCrop = {
              zoom: typeof directCrop.zoom === "number" ? directCrop.zoom : draft.directCrop.zoom,
              focusX: typeof directCrop.focusX === "number" ? directCrop.focusX : draft.directCrop.focusX,
              focusY: typeof directCrop.focusY === "number" ? directCrop.focusY : draft.directCrop.focusY,
              offsetX: typeof directCrop.offsetX === "number" ? directCrop.offsetX : draft.directCrop.offsetX,
              offsetY: typeof directCrop.offsetY === "number" ? directCrop.offsetY : draft.directCrop.offsetY,
            };
            setCropZoom(nextCrop.zoom); setCropX(nextCrop.focusX); setCropY(nextCrop.focusY);
            finalDraft = patchPrintDraft(finalDraft, { directCrop: nextCrop });
            patchDraft(draft.id, { directCrop: nextCrop });
          }
          const requestedTemplateId = typeof request.input.templateId === "string" ? request.input.templateId : undefined;
          const requestedOutputId = typeof request.input.outputId === "string" ? request.input.outputId : undefined;
          const requestedOrientation = request.input.orientation === "portrait" || request.input.orientation === "landscape" ? request.input.orientation : undefined;
          const selectedTemplateForDraft = product.template_requirement === "unsupported"
            ? null
            : requestedTemplateId
              ? (() => (async () => {
                const outputs = await storefrontClient.templateOutputs(requestedTemplateId);
                const compatible = compatibleTemplateOutputs(outputs.outputs, product).filter((output) => !requestedOrientation || compatibleOutputVariantSummary(output, product) === requestedOrientation);
                const output = requestedOutputId ? compatible.find((candidate) => candidate.id === requestedOutputId) : compatible[0];
                if (!output) throw new Error("The requested template output is not compatible with this returned product and orientation.");
                return await chooseTemplate(requestedTemplateId, product, output.id, requestedOrientation, draft.id);
              })())()
              : chooseRememberedOrFirstCompatibleTemplate(product, draft, requestedOutputId, requestedOrientation);
          const templateForPatch = await selectedTemplateForDraft;
          if (product.template_requirement !== "unsupported" && (requestedOutputId || requestedOrientation) && !templateForPatch) {
            throw new Error("No active server template has the requested compatible output or orientation.");
          }
          const slotPatches = Array.isArray(request.input.slotPatches) ? request.input.slotPatches as Array<Record<string, unknown>> : [];
          if (templateForPatch) {
            finalDraft = patchPrintDraft(finalDraft, { template: templateForPatch });
            patchDraft(draft.id, { template: templateForPatch });
          }
          if (!templateForPatch) {
            // A direct print's photograph is the whole print, so the printed
            // shape records which role that photograph now stands for.
            photoRoleMemory.current = rememberDirectPhoto(photoRoleMemory.current, product.physical_output, photoIds[0]);
          }
          if (templateForPatch && slotPatches.length === 0) {
            const contract = await storefrontClient.templateContract(templateForPatch.id, templateForPatch.outputId, templateForPatch.revisionId);
            responseContract = contract;
            // Selecting an existing draft must restore its own saved inputs,
            // never silently replace them with every tray image. An untouched
            // draft keeps the role defaults the loaded output just prefilled.
            appliedPrefills = lastSlotPrefills.current.prefills;
            const assignments = appliedPrefills.length > 0 ? lastSlotPrefills.current.assignments : draft.slotAssignments;
            setTemplateAssignments(assignments);
            setTemplateInputs(draft.textValues);
            setSlotTransforms(draft.slotTransforms);
            const contractPatch: Parameters<typeof patchPrintDraft>[1] = {
              template: templateForPatch,
              templateContractKnown: true,
              requiredSlotKeys: effectiveRequiredTemplateSlotKeys(product, contract.slots),
              slotAssignments: assignments,
            };
            finalDraft = patchPrintDraft(finalDraft, contractPatch);
            patchDraft(draft.id, contractPatch);
          }
          if (templateForPatch && slotPatches.length > 0) {
            const contract = await storefrontClient.templateContract(templateForPatch.id, templateForPatch.outputId, templateForPatch.revisionId);
            responseContract = contract;
            appliedPrefills = lastSlotPrefills.current.prefills;
            const assignments = { ...(appliedPrefills.length > 0 ? lastSlotPrefills.current.assignments : draft.slotAssignments) };
            const values = { ...draft.textValues };
            const transforms = { ...draft.slotTransforms };
            const patchAliases = imageSlotAliasesForContract(contract);
            const patchRoles = imageSlotRoles(contract.slots, contractSlotBoxes(contract));
            const explicitAssignments: Record<string, string> = {};
            for (const patch of slotPatches) {
              const resolution = resolveSlotPatchTarget(contract.slots, patch, patchAliases);
              if (resolution.kind !== "resolved") throw new Error("Each slot patch must name an exact visible published slot key or unique visible label.");
              const slot = resolution.slot;
              if (patch.operation === "assign") {
                if (slot.kind !== "image" || (typeof patch.photoRef !== "string" && typeof patch.photoRef !== "number")) throw new Error(`Assign requires a tray photo for image slot ${slot.key}.`);
                const photo = resolvePhotoReference(photoLibrary.photos, patch.photoRef);
                if (photo.kind !== "resolved") throw new Error(`Photo reference for ${slot.key} is not uniquely visible in the tray.`);
                assignments[slot.key] = photo.photo.id;
                explicitAssignments[slot.key] = photo.photo.id;
              } else if (patch.operation === "unassign") {
                if (slot.kind !== "image") throw new Error(`Only image slot ${slot.key} can be unassigned.`);
                delete assignments[slot.key];
              } else if (patch.operation === "set_text") {
                if (slot.kind !== "text" || typeof patch.text !== "string") throw new Error(`set_text requires text for ${slot.key}.`);
                values[slot.key] = patch.text;
              } else if (patch.operation === "set_crop") {
                if (slot.kind !== "image") throw new Error(`set_crop applies only to image slot ${slot.key}.`);
                transforms[slot.key] = slotTransformFromCropPatch(transforms[slot.key] ?? initialBrowserPreviewTransform, {
                  zoom: typeof patch.zoom === "number" ? patch.zoom : undefined,
                  focusX: typeof patch.focusX === "number" ? patch.focusX : undefined,
                  focusY: typeof patch.focusY === "number" ? patch.focusY : undefined,
                  offsetX: typeof patch.offsetX === "number" ? patch.offsetX : undefined,
                  offsetY: typeof patch.offsetY === "number" ? patch.offsetY : undefined,
                });
              } else throw new Error("Unknown slot patch operation.");
            }
            // An explicit patch is the shopper's own instruction: it overrides a
            // carried-over default and becomes the photograph remembered for
            // that role.
            photoRoleMemory.current = rememberSlotAssignments(photoRoleMemory.current, explicitAssignments, patchRoles);
            appliedPrefills = appliedPrefills.filter((prefill) => assignments[prefill.slotKey] === prefill.photoId);
            setPrefilledSlots(Object.fromEntries(appliedPrefills.map((prefill) => [prefill.slotKey, prefill.role])));
            setTemplateAssignments(assignments); setTemplateInputs(values); setSlotTransforms(transforms);
            const slotPatch: Parameters<typeof patchPrintDraft>[1] = {
              template: templateForPatch,
              templateContractKnown: true,
              requiredSlotKeys: effectiveRequiredTemplateSlotKeys(product, contract.slots),
              slotAssignments: assignments,
              textValues: values,
              slotTransforms: transforms,
              proofState: "idle",
            };
            finalDraft = patchPrintDraft(finalDraft, slotPatch);
            patchDraft(draft.id, slotPatch);
          }
          // The response is derived from this fully patched local draft rather
          // than React's asynchronous state, so it reports the same slot facts
          // that proof and cart eligibility will read.
          patchDraft(draft.id, {
            template: finalDraft.template,
            templateContractKnown: finalDraft.templateContractKnown,
            requiredSlotKeys: finalDraft.requiredSlotKeys,
            slotAssignments: finalDraft.slotAssignments,
            textValues: finalDraft.textValues,
            slotTransforms: finalDraft.slotTransforms,
            directCrop: finalDraft.directCrop,
            proofState: finalDraft.proofState,
          });
          const missingRequirements = product.template_requirement === "required"
            ? missingTemplateDraftRequirements(finalDraft)
            : [];
          const effectivePhotoIds = [...new Set([...finalDraft.photoIds, ...Object.values(finalDraft.slotAssignments)])];
          setNotice({ tone: "info", message: `Draft ${draft.id} is visible for ${product.name}. The files remain local until they are prepared.` });
          // The live template preview must repaint before the agent hears back.
          await nextPaint();
          const responseSlotAliases = responseContract ? imageSlotAliasesForContract(responseContract) : {};
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
            status: "configured",
            draft_id: draft.id,
            trayRevision: photoLibrary.revision,
            product: { id: product.id, revision: product.revision, name: product.name },
            photos: effectivePhotoIds.flatMap((photoId) => {
              const photo = photoLibrary.photos.find((candidate) => candidate.id === photoId);
              return photo ? [{ photo_id: photo.id, position: photoLibrary.photos.indexOf(photo) + 1, filename: photo.filename }] : [];
            }),
            template: finalDraft.template ?? null,
            slot_assignments: responseContract?.slots.filter((slot) => slot.kind === "image").map((slot) => {
              const prefill = appliedPrefills.find((candidate) => candidate.slotKey === slot.key);
              const assignedPhotoId = finalDraft.slotAssignments[slot.key] ?? null;
              return {
                slot_key: slot.key,
                label: slot.suggested_label ?? null,
                aliases: responseSlotAliases[slot.key] ?? [],
                required: effectiveTemplateSlotRequired(product, slot),
                assigned_photo_id: assignedPhotoId,
                // Say plainly when a photograph was carried over from an
                // earlier print rather than chosen for this one.
                prefilled_from: prefill && prefill.photoId === assignedPhotoId ? prefillProvenance(prefill.role) : null,
                // The set_crop values that reproduce this slot's framing, so a
                // relative crop change can be computed from what is visible.
                crop: cropPatchFromSlotTransform(finalDraft.slotTransforms[slot.key] ?? initialBrowserPreviewTransform),
              };
            }) ?? [],
            direct_crop: visibleDirectCrop(finalDraft),
            default_photo_from: roleDefault ? prefillProvenance(roleDefault.role) : null,
            missing_requirements: missingRequirements,
            nextStep: product.template_requirement === "required"
              ? missingRequirements.length === 0 ? "ready_for_proof_or_cart" : "complete_template_slots"
              : "prepare_visible_crop",
          } });
          return;
        }
        if (request.action === "add_to_cart") {
          const requestedDraftId = typeof request.input.draftId === "string" ? request.input.draftId : null;
          if (!requestedDraftId) throw new Error("add_to_cart requires the visible draft ID it is proposing.");
          if (pendingProposal) throw new Error(`Proposal ${pendingProposal.id} is still waiting on the shopper; resolve it with resolve_cart_proposal first.`);
          const draft = draftsRef.current.find((candidate) => candidate.id === requestedDraftId);
          if (!draft) throw new Error("That visible draft no longer exists.");
          const requestedQuantity = Number(request.input.quantity ?? 1);
          if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 99) {
            throw new Error("quantity must be a whole number from 1 through 99.");
          }
          // Deliberately no selectDraft here. Adding to the cart must not move
          // the shopper to another step, and reselecting the draft would also
          // tear down and refetch the very template preview the proposal card
          // is about to show.
          const proposal = proposeDraft(draft, requestedQuantity);
          // The proposal card must be on screen before the agent hears back.
          await nextPaint();
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
            status: "awaiting_shopper_confirmation",
            proposal_id: proposal.id,
            draft_id: proposal.draftId,
            product_name: proposal.productName,
          } });
          return;
        }
        if (request.action === "resolve_cart_proposal") {
          const proposalId = typeof request.input.proposalId === "string" ? request.input.proposalId : null;
          const decision = request.input.decision;
          if (decision !== "accept" && decision !== "reject") throw new Error("decision must be accept or reject.");
          if (!pendingProposal) throw new Error("No cart proposal is visible.");
          if (proposalId !== pendingProposal.id) throw new Error(`The visible proposal is ${pendingProposal.id}.`);
          const nextCart = resolveProposal(pendingProposal, decision);
          await nextPaint();
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
            proposal_id: pendingProposal.id,
            decision: decision === "accept" ? "accepted" : "rejected",
            cart_item_count: nextCart.length,
            items: localCartWireItems(nextCart),
          } });
          return;
        }
        const action = request.input.action;
        const itemId = typeof request.input.itemId === "string" ? request.input.itemId : undefined;
        const quantity = typeof request.input.quantity === "number" ? request.input.quantity : undefined;
        let nextCart = cart;
        if (action === "clear") nextCart = [];
        else if (action === "remove") {
          if (!itemId || !cart.some((item) => item.id === itemId)) throw new Error("remove requires a visible cart item ID.");
          nextCart = cart.filter((item) => item.id !== itemId);
        } else if (action === "update_quantity") {
          if (!itemId || !cart.some((item) => item.id === itemId)) throw new Error("update_quantity requires a visible cart item ID.");
          if (!Number.isInteger(quantity) || !quantity || quantity < 1 || quantity > 99) throw new Error("update_quantity requires a quantity from 1 through 99.");
          nextCart = cart.map((item) => item.id === itemId ? { ...item, quantity } : item);
        } else if (action !== "view") throw new Error("Choose view, update_quantity, remove, or clear.");
        if (action !== "view") {
          setCart(nextCart);
          await nextPaint();
        }
        respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
          action,
          cart_item_count: nextCart.length,
          items: localCartWireItems(nextCart),
        } });
      } catch (error) {
        respondToStorefrontWebMcpAction({ requestId: request.requestId, error: responseMessage(error) });
      }
    })();
  }));

  return <>
    <StorefrontMasthead
      cartAcknowledgement={cartAcknowledgement}
      cartCount={cart.length}
      notice={notice}
      onOpenCart={() => setCartOpen(true)}
      onOpenHome={() => setStep("catalog")}
    />
    <PhotoTray library={photoLibrary} onAction={handlePhotoAction} onImportError={(message) => setNotice({ tone: "error", message })} />

    <main className="mx-auto w-full max-w-[1400px] px-5 pb-16 sm:px-8 lg:px-12">
      {drafts.length > 0 && <div className="pt-8">
        <DraftRail
          drafts={drafts}
          onSelect={selectDraft}
          productNameFor={(draft) => catalog.find((product) => product.id === draft.productId && product.revision === draft.productRevision)?.name ?? draft.productId}
          selectedDraftId={selectedDraftId}
        />
      </div>}

      {step === "catalog" && <div className="pb-10" id="catalog">
        <FormatPicker onSelect={selectProduct} products={catalog} selectedProductKey={selectedProductKey} state={catalogState} />
      </div>}

      {step === "prepare" && selectedProduct && <PrepareStep
        activeImageSlotKey={activeImageSlotKey}
        activeSlotTransform={activeSlotTransform}
        browserPreview={browserPreviewDocument ? <BrowserTemplatePreview activeImageSlotKey={activeImageSlotKey} assetURLs={browserPreviewAssetURLs} document={browserPreviewDocument} key={selectedBrowserPreviewSurfaceID} localImageSlots={browserPreviewImageSlots} onActiveImageSlotChange={setActiveImageSlotKey} onPreviewChange={(slotKey, transform) => changeBrowserPreviewTransform(slotKey, transform)} onPreviewCommit={(_, slotKey, transform) => updateBrowserPreviewTransform(slotKey, transform)} onSurfaceChange={(surfaceID) => { invalidateTemplateRenderForBrowserPreviewChange(); setSelectedBrowserPreviewSurfaceID(surfaceID); }} selectedSurfaceID={selectedBrowserPreviewSurfaceID} serverProof={null} textValues={templateInputs} /> : null}
        compatibleOutputs={compatibleOutputs}
        crop={crop}
        cropX={cropX}
        cropY={cropY}
        cropZoom={cropZoom}
        customization={customization}
        hasLocalImage={Boolean(localImage)}
        imageName={imageName}
        imagePreview={imagePreview}
        managedAsset={managedAsset}
        offerState={offerState}
        offers={offers}
        onAddPreparedLine={() => { try { if (selectedDraft) proposeDraft(selectedDraft, 1); else throw new Error("Select a visible draft before adding it to the demo cart."); } catch (error) { setNotice({ tone: "error", message: responseMessage(error) }); } }}
        onAssignTemplatePhoto={assignTemplatePhoto}
        onChangeFormat={() => setStep("catalog")}
        onCropXChange={(focusX) => { setCropX(focusX); if (selectedDraftId) patchDraft(selectedDraftId, { directCrop: { zoom: cropZoom, focusX, focusY: cropY } }); }}
        onCropYChange={(focusY) => { setCropY(focusY); if (selectedDraftId) patchDraft(selectedDraftId, { directCrop: { zoom: cropZoom, focusX: cropX, focusY } }); }}
        onCropZoomChange={(zoom) => { setCropZoom(zoom); if (selectedDraftId) patchDraft(selectedDraftId, { directCrop: { zoom, focusX: cropX, focusY: cropY } }); }}
        onDiscoverTemplates={discoverTemplates}
        onPrepareLocalImage={prepareLocalImage}
        onRunTemplateRender={() => void runTemplateRender().catch(() => undefined)}
        onSelectOffer={setSelectedOfferId}
        onSelectTemplate={(templateId) => void chooseTemplate(templateId).catch((error) => setTemplateNotice({ tone: "error", message: responseMessage(error) }))}
        onSelectTemplateOutput={(outputID) => void selectTemplateOutput({ outputID }).catch((error) => setTemplateNotice({ tone: "error", message: responseMessage(error) }))}
        onSlotTransformChange={changeBrowserPreviewTransform}
        onSlotTransformCommit={updateBrowserPreviewTransform}
        onTemplateTextChange={(slotKey, value) => { invalidateTemplateRenderForBrowserPreviewChange(); setTemplateInputs((values) => ({ ...values, [slotKey]: value })); }}
        photos={photoLibrary.photos}
        prefilledSlotProvenance={prefilledSlotProvenance}
        preparing={preparing}
        renderArtifact={renderArtifact}
        rendering={rendering}
        selectedOfferId={selectedOfferId}
        selectedPhotoId={selectedPhoto?.id ?? null}
        selectedPhotoOrdinal={photoLibrary.selectedPhotoId ? String(photoLibrary.photos.findIndex((photo) => photo.id === photoLibrary.selectedPhotoId) + 1).padStart(2, "0") : "—"}
        selectedProduct={selectedProduct}
        selectedTemplateId={selectedTemplateId}
        selectedTemplateOutputId={selectedTemplateOutputId}
        templateAssignments={templateAssignments}
        templateContract={templateContract}
        templateInputs={templateInputs}
        templateNotice={templateNotice}
        templateOutput={templateOutput}
        templateRender={templateRender}
        templateState={templateState}
        templates={templates}
        visibleTemplateSlots={visibleTemplateSlots}
      />}

      <footer className="mt-6 flex justify-center border-t border-border pt-6 text-center text-sm text-muted-foreground">
        <span>
          © 2026{" "}
          <a
            className="text-inherit no-underline underline-offset-4 transition-colors hover:text-orange-500 hover:underline focus-visible:text-orange-500 focus-visible:underline motion-reduce:transition-none"
            href="https://batchrelay.com"
            rel="noopener noreferrer"
            target="_blank"
          >
            Batch Relay
          </a>
          {" / "}
          <a
            className="text-inherit no-underline underline-offset-4 transition-colors hover:text-orange-500 hover:underline focus-visible:text-orange-500 focus-visible:underline motion-reduce:transition-none"
            href="https://ftrbnd.com"
            rel="noopener noreferrer"
            target="_blank"
          >
            FTRBND
          </a>
        </span>
      </footer>
    </main>

    {/* The cart has no persistent page corner: it is mounted only while the
        masthead chip has opened it. */}
    <CartSheet
      items={cart}
      onConfirmCheckout={() => { setCart([]); setNotice({ tone: "info", message: "Demo checkout complete. No order was placed and nothing was charged." }); }}
      onOpenChange={setCartOpen}
      onRemoveItem={(itemId) => setCart((items) => items.filter((item) => item.id !== itemId))}
      open={cartOpen}
    />

    {/* The proposal card keeps the bottom-left corner. */}
    <div className="pointer-events-none fixed bottom-5 left-5 z-50 flex w-[min(92vw,300px)] flex-col gap-3 [&>*]:pointer-events-auto">
      {pendingProposal && <CartProposalCard
        aspect={proposalAspect}
        onAccept={() => resolveProposal(pendingProposal, "accept")}
        onReject={() => resolveProposal(pendingProposal, "reject")}
        proposal={pendingProposal}
        templatePreview={pendingProposal.source === "template" && browserPreviewDocument && selectedDraftId === pendingProposal.draftId
          ? <BrowserTemplatePreview
            activeImageSlotKey={null}
            assetURLs={browserPreviewAssetURLs}
            document={browserPreviewDocument}
            localImageSlots={browserPreviewImageSlots}
            onActiveImageSlotChange={() => undefined}
            onSurfaceChange={() => undefined}
            selectedSurfaceID={selectedBrowserPreviewSurfaceID}
            serverProof={null}
            textValues={templateInputs}
          />
          : null}
      />}
    </div>
  </>;
}
