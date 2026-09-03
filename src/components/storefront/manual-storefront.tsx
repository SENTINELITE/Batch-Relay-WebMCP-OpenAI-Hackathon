"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type CatalogProduct,
  type IngestedAsset,
  type PublishedTemplate,
  type TemplateContract,
  type TemplateOutput,
  type TemplateOutputs,
  storefrontClient,
} from "@/lib/storefront/client";
import { type TemplateState } from "@/lib/storefront/customization";
import {
  createPrintDraft,
  cropPatchFromSlotTransform,
  describeMissingRequirements,
  directCropFocus,
  effectiveRequiredTemplateSlotKeys,
  effectiveTemplateSlotRequired,
  isCompleteTemplateDraft,
  missingRequirementsGuidance,
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
import { FormatPicker } from "@/components/storefront/format-picker";
import { PhotoTray } from "@/components/storefront/photo-tray";
import { PrepareStep } from "@/components/storefront/prepare-step";
import { CartProposalStack } from "@/components/storefront/cart-proposal-stack";
import { CartSheet } from "@/components/storefront/cart-sheet";
import { StorefrontMasthead, type CartAcknowledgement } from "@/components/storefront/storefront-masthead";
import {
  CART_PROPOSAL_EXIT_MS,
  cartItemFromProposal,
  cartProposalOutcome,
  cartProposalWireItems,
  createCartItem,
  localCartPrintCount,
  createCartProposal,
  localCartWireItems,
  mergeLocalCartItem,
  pendingCartProposalForDraft,
  pendingCartProposals,
  type CartProposal,
  type CartProposalOutcome,
  type CartProposalStackEntry,
  type LocalCartItem,
} from "@/lib/storefront/local-cart";
import { readIdentifierAlias, requireIdentifierAlias } from "@/lib/storefront/tool-input";
import {
  agentDraftPlacement,
  emptyShopperViewContext,
  isShopperVisibleDraft,
  shopperViewContext,
  type DraftPlacement,
  type ShopperViewContext,
} from "@/lib/storefront/shopper-view";
import {
  browserPreviewCanvas,
  initialBrowserPreviewTransform,
  type BrowserPreviewDocument,
  type BrowserPreviewPanLimits,
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
/** Everything a draft configured behind the shopper's screen needs, resolved
 *  without touching any workbench state. */
type OffScreenTemplate = {
  template: NonNullable<PrintDraft["template"]>;
  contract: TemplateContract;
  document: BrowserPreviewDocument | null;
  assignments: Record<string, string>;
  prefills: SlotPrefill[];
};
type ActiveStep = "catalog" | "prepare";
type PreloadedTemplatePreview = {
  templateId: string;
  compatibleOutputs: TemplateOutput[];
  outputRevisionId: string;
  output: TemplateOutput;
  contract: TemplateContract;
  document: BrowserPreviewDocument;
};

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
 * Identity of one published output's artwork, so a document already resolved
 * for the workbench can be reused by the proposal card without refetching.
 *
 * The template and output alone name it. A draft records the template revision
 * from its contract while the preview is fetched at the outputs revision, so
 * those two revisions are not the same string and cannot key a shared store;
 * within one page session each output is read at one revision anyway.
 */
const previewDocumentKey = (templateID: string, outputID: string) => `${templateID}|${outputID}`;

const draftPreviewDocumentKey = (draft: PrintDraft): string | null => draft.template
  ? previewDocumentKey(draft.template.id, draft.template.outputId)
  : null;

/**
 * Resolvable URLs for a preview document's artwork. API-issued assets go
 * through the credentialed same-origin proxy; public template art from a
 * bundled spec is already an absolute URL on a trusted image host and is used
 * directly, never proxied.
 */
function previewAssetURLs(document: BrowserPreviewDocument | null): Record<string, string> {
  if (!document) return {};
  return Object.fromEntries(document.assets.flatMap((asset) => {
    const url = storefrontClient.browserPreviewAssetProxyURL(asset.content_url) ?? publicTemplateAssetURL(asset.content_url);
    return url ? [[asset.asset_ref, url]] : [];
  }));
}

/** Binds a draft's slot assignments and framing to the tray photographs it
 *  names, which is everything a template preview needs to paint. */
function previewImageSlots(
  assignments: Record<string, string>,
  transforms: Record<string, BrowserPreviewTransform>,
  photos: { id: string; previewURL: string }[],
): Record<string, { source: string; transform: BrowserPreviewTransform }> {
  return Object.fromEntries(Object.entries(assignments).flatMap(([slotKey, photoId]) => {
    const photo = photos.find((candidate) => candidate.id === photoId);
    return photo ? [[slotKey, { source: photo.previewURL, transform: transforms[slotKey] ?? initialBrowserPreviewTransform }]] : [];
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
  const [templates, setTemplates] = useState<PublishedTemplate[]>([]);
  const [, setTemplateState] = useState<TemplateState>("idle");
  const [, setTemplateNotice] = useState<Notice>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [compatibleOutputs, setCompatibleOutputs] = useState<TemplateOutput[]>([]);
  const [templateOutputsRevisionID, setTemplateOutputsRevisionID] = useState("");
  const [, setSelectedTemplateOutputId] = useState("");
  const [templateOutput, setTemplateOutput] = useState<TemplateOutput | null>(null);
  const [templateContract, setTemplateContract] = useState<TemplateContract | null>(null);
  const [templateInputs, setTemplateInputs] = useState<Record<string, string>>({});
  const [templateAssignments, setTemplateAssignments] = useState<Record<string, string>>({});
  const [slotTransforms, setSlotTransforms] = useState<Record<string, BrowserPreviewTransform>>({});
  const [activeImageSlotKey, setActiveImageSlotKey] = useState<string | null>(null);
  const [activeSlotPanLimits, setActiveSlotPanLimits] = useState<BrowserPreviewPanLimits>({ x: 0, y: 0 });
  const [browserPreviewDocument, setBrowserPreviewDocument] = useState<BrowserPreviewDocument | null>(null);
  const [selectedBrowserPreviewSurfaceID, setSelectedBrowserPreviewSurfaceID] = useState("");
  const [customization, setCustomization] = useState<"direct" | "template">("direct");
  const [cart, setCart] = useState<LocalCartItem[]>([]);
  const cartPrintCount = localCartPrintCount(cart);
  // The demo cart is a sheet over the current step, so the masthead chip can
  // show cart contents from any step without navigating. Nothing else opens it.
  const [cartOpen, setCartOpen] = useState(false);
  // An accepted proposal never opens the sheet; it flashes the masthead chip.
  const [cartAcknowledgement, setCartAcknowledgement] = useState<CartAcknowledgement | null>(null);
  // Proposals stack: several prints can be waiting on the shopper at once, each
  // with its own card. Entries stay in place while their exit animation plays,
  // so `pendingCartProposals` — not this array — is what "waiting" means.
  const [proposalStack, setProposalStack] = useState<CartProposalStackEntry[]>([]);
  const proposalExitTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [lastProposalOutcome, setLastProposalOutcome] = useState<CartProposalOutcome | null>(null);
  const [drafts, setDrafts] = useState<PrintDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  // Every preview document resolved so far, by published output. The proposal
  // card paints an off-screen draft from this, so it never depends on that
  // draft being selected and never refetches artwork the workbench already has.
  const [previewDocuments, setPreviewDocuments] = useState<Record<string, BrowserPreviewDocument>>({});
  const previewDocumentsRef = useRef<Record<string, BrowserPreviewDocument>>({});
  // Which tray photograph the shopper last chose for each semantic role. It
  // lives for the session only and is never persisted or sent anywhere.
  const photoRoleMemory = useRef<PhotoRoleMemory>(emptyPhotoRoleMemory);
  const [prefilledSlots, setPrefilledSlots] = useState<Record<string, PhotoRole>>({});
  const lastSlotPrefills = useRef<{ assignments: Record<string, string>; prefills: SlotPrefill[] }>({ assignments: {}, prefills: [] });
  const templateRequestVersion = useRef(0);
  const preloadedTemplatePreviews = useRef(new Map<string, PreloadedTemplatePreview>());
  const templateOutputRequests = useRef(new Map<string, Promise<TemplateOutputs>>());
  const lastBrowserPreviewTransforms = useRef<Record<string, BrowserPreviewTransform>>({});
  const photoLibraryRef = useRef(photoLibrary);
  const draftsRef = useRef(drafts);
  const browserPreviewDocumentRef = useRef<BrowserPreviewDocument | null>(browserPreviewDocument);
  // Which draft's preview the shopper actually has in front of them, and how it
  // got there. add_to_cart adds straight to the cart for this draft and asks
  // with the proposal card for any other. A ref, not state: nothing renders
  // from it, and add_to_cart must read the value as of the moment it is called.
  const shopperViewRef = useRef<ShopperViewContext>(emptyShopperViewContext);

  /** Files a resolved preview document under its published output, so any other
   *  surface — notably the proposal card — can paint from it directly. */
  function rememberPreviewDocument(key: string, document: BrowserPreviewDocument | null) {
    if (!document || previewDocumentsRef.current[key]) return;
    previewDocumentsRef.current = { ...previewDocumentsRef.current, [key]: document };
    setPreviewDocuments(previewDocumentsRef.current);
  }

  /**
   * The published artwork for one output, preferring anything already resolved.
   * A failed live fetch degrades to the bundled published copy and then to a
   * layout synthesized from the contract — never to nothing.
   */
  async function resolvePreviewDocument(
    templateID: string,
    output: TemplateOutput,
    revisionID: string,
    contract: TemplateContract,
  ): Promise<BrowserPreviewDocument | null> {
    const key = previewDocumentKey(templateID, output.id);
    const known = previewDocumentsRef.current[key];
    if (known) return known;
    const document = await storefrontClient.browserPreviewDocument(templateID, output.id, revisionID).catch(() => {
      const spec = bundledTemplateSpec(templateID);
      return (spec ? specBrowserPreviewDocument({ spec, contract, output }) : null)
        ?? fallbackBrowserPreviewDocument({ templateID, contract, output });
    });
    rememberPreviewDocument(key, document);
    return document;
  }

  /** Records the draft now occupying the prepare step, and who put it there. */
  function noteVisibleDraft(draftId: string | null, origin: ShopperViewContext["origin"]) {
    shopperViewRef.current = shopperViewContext(draftId, origin, Date.now());
  }

  /**
   * Any hands-on edit is proof the shopper is looking at the selected draft, so
   * it promotes an agent-selected draft to shopper-visible without waiting.
   */
  function noteShopperLookingAtSelectedDraft() {
    if (selectedDraftId) noteVisibleDraft(selectedDraftId, "shopper");
  }

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

  // Fetch the available templates as the storefront opens. Selecting a print
  // can then immediately choose the first compatible template and output.
  useEffect(() => {
    void discoverTemplates();
  }, []);

  useEffect(() => {
    if (catalog.length === 0 || templates.length === 0) return;
    let cancelled = false;
    preloadedTemplatePreviews.current.clear();
    templateOutputRequests.current.clear();

    const outputsFor = (templateId: string) => {
      const existing = templateOutputRequests.current.get(templateId);
      if (existing) return existing;
      const request = storefrontClient.templateOutputs(templateId);
      templateOutputRequests.current.set(templateId, request);
      return request;
    };

    const preload = async (product: CatalogProduct) => {
      if (product.template_requirement === "unsupported") return;
      for (const template of templates) {
        try {
          const outputs = await outputsFor(template.id);
          const compatibleOutputs = compatibleTemplateOutputs(outputs.outputs, product);
          const output = compatibleOutputs[0];
          if (!output) continue;
          const contract = await storefrontClient.templateContract(template.id, output.id, outputs.revision_id);
          const document = await storefrontClient.browserPreviewDocument(template.id, output.id, outputs.revision_id).catch(() => {
            const spec = bundledTemplateSpec(template.id);
            return (spec ? specBrowserPreviewDocument({ spec, contract, output }) : null)
              ?? fallbackBrowserPreviewDocument({ templateID: template.id, contract, output });
          });
          if (cancelled || !document) return;
          rememberPreviewDocument(previewDocumentKey(template.id, output.id), document);
          preloadedTemplatePreviews.current.set(productSelectionKey(product), {
            templateId: template.id,
            compatibleOutputs,
            outputRevisionId: outputs.revision_id,
            output,
            contract,
            document,
          });
          return;
        } catch {
          // Try the next published template. The selected print will still use
          // the normal request path if none can be warmed successfully.
        }
      }
    };

    void Promise.all(catalog.map(preload));
    return () => { cancelled = true; };
  }, [catalog, templates]);

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
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const browserPreviewAssetURLs = useMemo(() => previewAssetURLs(browserPreviewDocument), [browserPreviewDocument]);
  const crop = selectedProduct ? cropFor(selectedProduct) : "4:5";
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
  const browserPreviewImageSlots = useMemo(
    () => previewImageSlots(templateAssignments, slotTransforms, photoLibrary.photos),
    [photoLibrary.photos, slotTransforms, templateAssignments],
  );
  const productForDraft = (draft: PrintDraft) => catalog.find((candidate) =>
    candidate.id === draft.productId && candidate.revision === draft.productRevision) ?? null;
  const isAddableDraft = (draft: PrintDraft) => {
    const product = productForDraft(draft);
    return draft.template
      ? isCompleteTemplateDraft(draft)
      : Boolean(product && product.template_requirement !== "required" && draft.photoIds.length > 0);
  };
  const canAddAnyVisibleDraft = drafts.some(isAddableDraft);
  // The proposals still awaiting an answer, oldest first. A card on its way out
  // has already been answered, so it is not one of these.
  const pendingProposals = useMemo(() => pendingCartProposals(proposalStack), [proposalStack]);

  /**
   * Everything one card needs to paint itself.
   *
   * Each card is bound to its own proposed draft — that draft's own artwork,
   * slot assignments, framing and text — and never to the workbench's document,
   * because the print worth proposing is precisely the one not on screen: the
   * card is the shopper's first and only look at it. With a stack, that binding
   * has to be per proposal rather than one set of component-wide values.
   */
  function proposalPreviewBinding(proposal: CartProposal) {
    const product = catalog.find((candidate) => candidate.id === proposal.productId) ?? null;
    const previewKey = proposal.source === "template" ? draftPreviewDocumentKey(proposal.draft) : null;
    const document = previewKey ? previewDocuments[previewKey] ?? null : null;
    const proposalPreviewDocument = document;
    const proposalPreviewAssetURLs = previewAssetURLs(proposalPreviewDocument);
    const proposalPreviewImageSlots = previewImageSlots(
      proposal.draft.slotAssignments,
      proposal.draft.slotTransforms,
      photoLibrary.photos,
    );
    return {
      aspect: product?.physical_output
        ? `${product.physical_output.width} / ${product.physical_output.height}`
        : "4 / 5",
      templatePreview: proposalPreviewDocument
        ? <BrowserTemplatePreview
          activeImageSlotKey={null}
          assetURLs={proposalPreviewAssetURLs}
          document={proposalPreviewDocument}
          localImageSlots={proposalPreviewImageSlots}
          onActiveImageSlotChange={() => undefined}
          onSurfaceChange={() => undefined}
          selectedSurfaceID={proposalPreviewDocument.output.surfaces[0]?.id ?? ""}
          serverProof={null}
          textValues={proposal.draft.textValues}
        />
        : null,
    };
  }

  // Safety net for proposed template drafts whose artwork was never resolved.
  // Both paths that create such a draft already file the document, so this
  // normally does nothing; when it does run, a failed fetch still lands on the
  // bundled or synthesized layout rather than leaving a card blank.
  const proposalTemplates = useMemo(() => {
    const targets = new Map<string, { id: string; outputId: string }>();
    for (const proposal of pendingProposals) {
      const template = proposal.source === "template" ? proposal.draft.template ?? null : null;
      if (!template) continue;
      targets.set(previewDocumentKey(template.id, template.outputId), { id: template.id, outputId: template.outputId });
    }
    return [...targets.values()];
  }, [pendingProposals]);
  const proposalTemplateSignature = proposalTemplates
    .map((template) => previewDocumentKey(template.id, template.outputId))
    .join("|");
  useEffect(() => {
    let live = true;
    for (const template of proposalTemplates) {
      if (previewDocumentsRef.current[previewDocumentKey(template.id, template.outputId)]) continue;
      void (async () => {
        try {
          const outputs = await storefrontClient.templateOutputs(template.id);
          const published: TemplateOutput[] = outputs.outputs;
          const output = published.find((candidate) => candidate.id === template.outputId);
          if (!output || !live) return;
          const contract = await storefrontClient.templateContract(template.id, output.id, outputs.revision_id);
          if (!live) return;
          await resolvePreviewDocument(template.id, output, outputs.revision_id, contract);
        } catch {
          // The card keeps its cropped-photograph window rather than going blank.
        }
      })();
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the resolved output list; resolvePreviewDocument is a stable component-body helper reading refs.
  }, [proposalTemplateSignature]);

  /**
   * The loaded browser preview is only a geometry source for the contract it
   * belongs to; a stale document must never name another template's slots.
   */
  function contractSlotBoxes(
    contract: TemplateContract,
    document: BrowserPreviewDocument | null = browserPreviewDocumentRef.current,
  ): Record<string, SlotBox> {
    const matches = document?.template.id === contract.template.id
      && document.template.revision_id === contract.template.revision_id;
    return matches ? browserPreviewSlotBoxes(document) : {};
  }

  function imageSlotAliasesForContract(
    contract: TemplateContract,
    document?: BrowserPreviewDocument | null,
  ): Record<string, string[]> {
    return deriveImageSlotAliases(
      contract.slots.filter((slot) => slot.kind === "image"),
      contractSlotBoxes(contract, document === undefined ? browserPreviewDocumentRef.current : document),
    );
  }

  function patchDraft(draftId: string, patch: Parameters<typeof patchPrintDraft>[1]) {
    setDrafts((items) => items.map((draft) => draft.id === draftId ? patchPrintDraft(draft, patch) : draft));
  }

  function handlePhotoAction(action: PhotoLibraryAction) {
    if (action.type === "remove") {
      const photo = photoLibrary.photos.find((candidate) => candidate.id === action.photoId);
      if (photo) revokePhotoObjectURLs([photo]);
      setTemplateAssignments((assignments) => Object.fromEntries(
        Object.entries(assignments).filter(([, photoId]) => photoId !== action.photoId),
      ));
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
    setTemplateContract(null);
    setTemplateOutput(null);
    setTemplateInputs({});
    setTemplateAssignments({});
    setPrefilledSlots({});
    setSlotTransforms({});
    setActiveImageSlotKey(null);
    setBrowserPreviewDocument(null);
    browserPreviewDocumentRef.current = null;
    setSelectedBrowserPreviewSurfaceID("");
    if (navigate) setStep("prepare");
    setNotice(null);
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
      // Only the visible format chooser creates a draft this way, so the
      // shopper chose this print and is watching it load.
      noteVisibleDraft(draft.id, "shopper");
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
    setTemplateInputs({});
    setTemplateAssignments({});
    setPrefilledSlots({});
    setSlotTransforms({});
    setActiveImageSlotKey(null);
    setBrowserPreviewDocument(null);
    browserPreviewDocumentRef.current = null;
    setSelectedBrowserPreviewSurfaceID("");
    setTemplateNotice(null);
    if (!templateId || !productForCompatibility) return null;
    setTemplateState("loading");
    try {
      const warmed = preloadedTemplatePreviews.current.get(productSelectionKey(productForCompatibility));
      const warmedForTemplate = warmed?.templateId === templateId
        ? { outputs: warmed.compatibleOutputs, revision_id: warmed.outputRevisionId }
        : null;
      const outputs = warmedForTemplate ?? await storefrontClient.templateOutputs(templateId);
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

  /**
   * Resolves a template, its contract, its artwork and its role prefills for a
   * draft that is *not* on screen.
   *
   * Deliberately a pure read of the API and the caches: it sets no workbench
   * state at all, so a shopper hand-customizing another print keeps their
   * preview, their active slot and their crop exactly as they left them. The
   * document it returns is what the proposal card will paint.
   */
  async function resolveTemplateOffScreen(
    product: CatalogProduct,
    draft: PrintDraft,
    requested: { templateId?: string; outputId?: string; orientation?: "portrait" | "landscape" },
  ): Promise<OffScreenTemplate | null> {
    const discovered = requested.templateId
      ? [{ id: requested.templateId }]
      : templates.length > 0 ? templates : (await storefrontClient.templates()).items;
    const stored = rememberedTemplatePreference(product);
    const preferredTemplateID = draft.template?.id ?? stored?.templateId;
    const ordered = [...discovered].sort((left, right) =>
      Number(right.id === preferredTemplateID) - Number(left.id === preferredTemplateID));
    for (const template of ordered) {
      try {
        const outputs = await storefrontClient.templateOutputs(template.id);
        const compatible = compatibleTemplateOutputs(outputs.outputs, product).filter((output) =>
          !requested.orientation || compatibleOutputVariantSummary(output, product) === requested.orientation);
        if (compatible.length === 0) continue;
        const output = requested.outputId
          ? compatible.find((candidate) => candidate.id === requested.outputId)
          : rememberedCompatibleOutput(draft.template, template.id, outputs.revision_id, compatible)
            ?? compatible.find((candidate) => template.id === stored?.templateId && candidate.id === stored.outputId)
            ?? compatible[0];
        if (!output) continue;
        const contract = await storefrontClient.templateContract(template.id, output.id, outputs.revision_id);
        const document = await resolvePreviewDocument(template.id, output, outputs.revision_id, contract);
        rememberTemplatePreference(product, template.id, output.id);
        // Every still-empty image slot takes the photograph the shopper already
        // chose for that role, exactly as the on-screen path would.
        const { assignments, prefills } = prefillSlotAssignments({
          assignments: draft.slotAssignments,
          memory: photoRoleMemory.current,
          rolesBySlotKey: imageSlotRoles(contract.slots, browserPreviewSlotBoxes(document)),
          availablePhotoIds: photoLibraryRef.current.photos.map((photo) => photo.id),
        });
        return {
          template: { id: template.id, outputId: output.id, revisionId: contract.template.revision_id },
          contract,
          document,
          assignments,
          prefills,
        };
      } catch {
        // A template with an unreadable output contract is not usable for this
        // draft. Continue only with the server-returned list.
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
    setTemplateInputs({});
    setTemplateAssignments({});
    setPrefilledSlots({});
    setSlotTransforms({});
    setActiveImageSlotKey(null);
    setBrowserPreviewDocument(null);
    browserPreviewDocumentRef.current = null;
    setSelectedBrowserPreviewSurfaceID("");
    setTemplateState("loading");
    lastSlotPrefills.current = { assignments: {}, prefills: [] };
    const warmed = product
      ? preloadedTemplatePreviews.current.get(productSelectionKey(product))
      : undefined;
    const warmedForOutput = warmed?.templateId === templateID &&
      warmed.outputRevisionId === revisionID &&
      warmed.output.id === outputID
      ? warmed
      : null;
    if (warmedForOutput) {
      setTemplateOutput(output);
      setTemplateContract(warmedForOutput.contract);
      setBrowserPreviewDocument(warmedForOutput.document);
      browserPreviewDocumentRef.current = warmedForOutput.document;
      setSelectedBrowserPreviewSurfaceID(warmedForOutput.document.output.surfaces[0]?.id ?? "");
    }
    try {
      const contract = warmedForOutput?.contract
        ?? await storefrontClient.templateContract(templateID, output.id, revisionID);
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
      let previewDocument: BrowserPreviewDocument | null = warmedForOutput?.document ?? null;
      if (!previewDocument) {
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
      // Filed under its published output so the proposal card can paint this
      // same artwork later without the draft being selected or refetched.
      rememberPreviewDocument(previewDocumentKey(templateID, output.id), previewDocument);
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
  }

  /** Live framing, shared by preview dragging and the prepare-step sliders, so
   *  each one shows what the other is doing. Nothing is committed yet. */
  function changeBrowserPreviewTransform(slotKey: string, transform: BrowserPreviewTransform) {
    const next = { ...lastBrowserPreviewTransforms.current, [slotKey]: transform };
    lastBrowserPreviewTransforms.current = next;
    setSlotTransforms(next);
  }

  /** Only the shopper's own drag or slider release commits framing, so this is
   *  proof they are looking at the selected draft. */
  function updateBrowserPreviewTransform(slotKey: string, transform: BrowserPreviewTransform) {
    noteShopperLookingAtSelectedDraft();
    const next = { ...lastBrowserPreviewTransforms.current, [slotKey]: transform };
    lastBrowserPreviewTransforms.current = next;
    setSlotTransforms(next);
    if (selectedDraftId) patchDraft(selectedDraftId, { slotTransforms: next, proofState: "idle" });
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

  function addableProductForDraft(draft: PrintDraft, verb: "adding" | "proposing"): CatalogProduct {
    const product = productForDraft(draft);
    if (!product) throw new Error("That visible draft no longer has its returned catalog product.");
    if (!isAddableDraft(draft)) {
      const noun = verb === "adding" ? "adding" : "proposing";
      throw new Error(draft.template
        ? `Complete every required visible template slot before ${noun} this draft.`
        : `Choose at least one visible tray photograph before ${noun} this draft.`);
    }
    return product;
  }

  /**
   * Puts a completed draft straight into the demo cart, with no proposal card.
   * This is what the shopper's own Add to cart button does, and what
   * add_to_cart does for the draft whose preview they are already looking at:
   * in both cases the visible print was the pre-visualization, so a card asking
   * about it would only re-show what is already on screen. The masthead chip's
   * +1 flash is the acknowledgment.
   */
  function addDraftToCart(draft: PrintDraft, quantity: number) {
    const product = addableProductForDraft(draft, "adding");
    const incoming = createCartItem({
      draftId: draft.id,
      productId: product.id,
      productName: product.name,
      quantity,
      thumbnailURL: draftThumbnailURL(draft),
      source: draft.template ? "template" : "direct",
      draft,
    });
    const merged = mergeLocalCartItem(cart, incoming);
    setCart(merged.items);
    setCartAcknowledgement((previous) => ({ id: (previous?.id ?? 0) + 1, quantity }));
    setNotice({ tone: "info", message: `Added ${quantity} × ${product.name} to this browser's demo cart. Nothing was ordered or charged.` });
    return merged;
  }

  /**
   * Adds one picture-in-picture proposal to the stack. Nothing enters the cart
   * until the shopper accepts it here or through resolve_cart_proposal.
   *
   * Proposing a draft that already has a card waiting returns that standing
   * card: a second identical question is not a second decision to make.
   */
  function proposeDraft(draft: PrintDraft, quantity: number): { proposal: CartProposal; duplicate: boolean } {
    const standing = pendingCartProposalForDraft(proposalStack, draft.id);
    if (standing) return { proposal: standing, duplicate: true };

    const product = addableProductForDraft(draft, "proposing");
    const proposal = createCartProposal({
      draftId: draft.id,
      productId: product.id,
      productName: product.name,
      quantity,
      thumbnailURL: draftThumbnailURL(draft),
      source: draft.template ? "template" : "direct",
      draft,
    });
    // Newest last, which is nearest the corner the stack is anchored to.
    setProposalStack((entries) => [...entries, { proposal, exit: null }]);
    setLastProposalOutcome(null);
    setNotice({ tone: "info", message: `Proposed ${quantity} × ${product.name}. Accept or reject the preview card.` });
    return { proposal, duplicate: false };
  }

  /**
   * Answers one or more cards at once, which is what "add them all" is.
   *
   * The cart moves immediately, but the cards keep their place with `exit` set
   * so each can play its accept or reject animation where it stands; only then
   * do they leave the stack and let the rest settle.
   */
  function resolveProposals(proposals: readonly CartProposal[], decision: "accept" | "reject"): LocalCartItem[] {
    if (proposals.length === 0) return cart;
    const accepted = decision === "accept";
    let nextCart = cart;
    if (accepted) {
      for (const proposal of proposals) {
        nextCart = mergeLocalCartItem(nextCart, cartItemFromProposal(proposal)).items;
      }
      setCart(nextCart);
      // Deliberately does not open the cart sheet: the masthead chip count
      // updates and flashes, so the add is noticeable without stealing focus.
      const quantity = proposals.reduce((total, proposal) => total + proposal.quantity, 0);
      setCartAcknowledgement((previous) => ({ id: (previous?.id ?? 0) + 1, quantity }));
    }

    const answered = new Set(proposals.map((proposal) => proposal.id));
    setProposalStack((entries) => entries.map((entry) =>
      answered.has(entry.proposal.id) && !entry.exit ? { ...entry, exit: decision } : entry));
    const timer = setTimeout(() => {
      setProposalStack((entries) => entries.filter((entry) => !answered.has(entry.proposal.id)));
    }, CART_PROPOSAL_EXIT_MS[decision]);
    proposalExitTimers.current = [...proposalExitTimers.current, timer];

    const last = proposals[proposals.length - 1]!;
    setLastProposalOutcome(cartProposalOutcome(last, accepted ? "accepted" : "rejected"));
    const names = proposals.length === 1
      ? `${last.quantity} × ${last.productName}`
      : `${proposals.length} proposed prints`;
    setNotice({ tone: "info", message: accepted
      ? `Added ${names} to this browser's demo cart. Nothing was ordered or charged.`
      : `Dismissed ${names}. Nothing entered the demo cart.` });
    return nextCart;
  }

  function resolveProposal(proposal: CartProposal, decision: "accept" | "reject"): LocalCartItem[] {
    return resolveProposals([proposal], decision);
  }

  // A card leaving mid-unmount must not call setState on a gone component.
  useEffect(() => () => {
    for (const timer of proposalExitTimers.current) clearTimeout(timer);
  }, []);

  useEffect(() => {
    publishStorefrontWebMcpState({
      revision: photoLibrary.revision + cartPrintCount + (selectedProduct ? 1 : 0) + (templateContract ? 1 : 0),
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
      pendingProposalCount: pendingProposals.length,
      cartItemCount: cartPrintCount,
    });
  }, [canAddAnyVisibleDraft, cartPrintCount, catalogState, pendingProposals, customization, managedAsset, photoLibrary, selectedProduct, selectedProductId, selectedTemplate, templateAssignments, templateContract, templateOutput, visibleTemplateSlots]);

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
              cart_item_count: cartPrintCount,
              cart_line_count: cart.length,
              cart_items: localCartWireItems(cart),
              // Every card still waiting, oldest first, because several can be
              // stacked at once and each awaits its own answer.
              pending_proposals: cartProposalWireItems(pendingProposals),
              pending_proposal_count: pendingProposals.length,
              last_proposal_outcome: lastProposalOutcome
                ? { proposal_id: lastProposalOutcome.proposalId, draft_id: lastProposalOutcome.draftId, product_name: lastProposalOutcome.productName, quantity: lastProposalOutcome.quantity, decision: lastProposalOutcome.decision }
                : null,
            },
            guidance: pendingProposals.length > 0
              ? `${pendingProposals.length} proposal card${pendingProposals.length === 1 ? " is" : "s are"} waiting; ask the shopper to accept or reject ${pendingProposals.length === 1 ? "it" : "them"}, then call resolve_cart_proposal with their answer — one proposalId at a time, or accept_all or reject_all when they answer the whole stack at once.`
              : selectedDraftId
                ? "Complete the active draft's visible slots, then add it to the demo cart. Adding the draft the shopper is watching goes straight in; adding any other draft asks them with the proposal card first."
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
          // A shopper customizing a print by hand keeps the screen. Their "add a
          // 5x7 of image 6" asks for a second print, not for the memory mate
          // they are working on to be taken away from them; that 5x7 is made in
          // the draft rail and the proposal card is their whole view of it.
          const placement: DraftPlacement = agentDraftPlacement(shopperViewRef.current, selectedDraftId, draft.id);
          const onScreen = placement === "on_screen";
          if (onScreen) {
            setSelectedDraftId(draft.id);
            // An agent put this draft on screen. Revising the draft the shopper
            // was already watching leaves their view where it was; creating a
            // new one starts the clock, so an add_to_cart chained straight onto
            // this call is still treated as a print the shopper has not seen.
            if (!existingDraft || shopperViewRef.current.draftId !== draft.id) {
              noteVisibleDraft(draft.id, "agent");
            }
            // The draft, its template and its live preview all load behind the
            // step the shopper is already on. Configuring a print is not a
            // reason to move them.
            selectProduct(product, false, false);
            dispatchPhotoLibrary({ type: "select", photoId: photoIds[0] ?? null });
          }
          // Left untouched for a background draft: the shopper-view context
          // still names the print they are holding, so add_to_cart sees this one
          // as never having been on screen and goes to the proposal card.
          const directCrop = request.input.directCrop && typeof request.input.directCrop === "object" ? request.input.directCrop as Record<string, unknown> : null;
          if (directCrop) {
            const nextCrop = {
              zoom: typeof directCrop.zoom === "number" ? directCrop.zoom : draft.directCrop.zoom,
              focusX: typeof directCrop.focusX === "number" ? directCrop.focusX : draft.directCrop.focusX,
              focusY: typeof directCrop.focusY === "number" ? directCrop.focusY : draft.directCrop.focusY,
              offsetX: typeof directCrop.offsetX === "number" ? directCrop.offsetX : draft.directCrop.offsetX,
              offsetY: typeof directCrop.offsetY === "number" ? directCrop.offsetY : draft.directCrop.offsetY,
            };
            if (onScreen) { setCropZoom(nextCrop.zoom); setCropX(nextCrop.focusX); setCropY(nextCrop.focusY); }
            finalDraft = patchPrintDraft(finalDraft, { directCrop: nextCrop });
            patchDraft(draft.id, { directCrop: nextCrop });
          }
          const requestedTemplateId = typeof request.input.templateId === "string" ? request.input.templateId : undefined;
          const requestedOutputId = typeof request.input.outputId === "string" ? request.input.outputId : undefined;
          const requestedOrientation = request.input.orientation === "portrait" || request.input.orientation === "landscape" ? request.input.orientation : undefined;
          // On screen, the workbench loads the template and repaints. In the
          // draft rail, the same facts are resolved as a pure read so nothing
          // the shopper is looking at changes.
          let offScreenTemplate: OffScreenTemplate | null = null;
          let templateForPatch: PrintDraft["template"] | null = null;
          if (product.template_requirement !== "unsupported") {
            if (!onScreen) {
              offScreenTemplate = await resolveTemplateOffScreen(product, draft, {
                templateId: requestedTemplateId,
                outputId: requestedOutputId,
                orientation: requestedOrientation,
              });
              templateForPatch = offScreenTemplate?.template ?? null;
            } else if (requestedTemplateId) {
              const outputs = await storefrontClient.templateOutputs(requestedTemplateId);
              const compatible = compatibleTemplateOutputs(outputs.outputs, product).filter((output) => !requestedOrientation || compatibleOutputVariantSummary(output, product) === requestedOrientation);
              const output = requestedOutputId ? compatible.find((candidate) => candidate.id === requestedOutputId) : compatible[0];
              if (!output) throw new Error("The requested template output is not compatible with this returned product and orientation.");
              templateForPatch = await chooseTemplate(requestedTemplateId, product, output.id, requestedOrientation, draft.id);
            } else {
              templateForPatch = await chooseRememberedOrFirstCompatibleTemplate(product, draft, requestedOutputId, requestedOrientation);
            }
          }
          // Aliases and slot geometry are read from the artwork that belongs to
          // *this* draft, which for a background draft is never the workbench's.
          const responseDocument: BrowserPreviewDocument | null = onScreen
            ? browserPreviewDocumentRef.current
            : offScreenTemplate?.document ?? null;
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
          // The prefills that were applied belong to whichever path resolved the
          // template: the workbench's own load, or the off-screen read.
          const resolvedPrefills = () => offScreenTemplate
            ? { prefills: offScreenTemplate.prefills, assignments: offScreenTemplate.assignments }
            : lastSlotPrefills.current;
          if (templateForPatch && slotPatches.length === 0) {
            const contract = offScreenTemplate?.contract
              ?? await storefrontClient.templateContract(templateForPatch.id, templateForPatch.outputId, templateForPatch.revisionId);
            responseContract = contract;
            // Selecting an existing draft must restore its own saved inputs,
            // never silently replace them with every tray image. An untouched
            // draft keeps the role defaults the loaded output just prefilled.
            appliedPrefills = resolvedPrefills().prefills;
            const assignments = appliedPrefills.length > 0 ? resolvedPrefills().assignments : draft.slotAssignments;
            if (onScreen) {
              setTemplateAssignments(assignments);
              setTemplateInputs(draft.textValues);
              setSlotTransforms(draft.slotTransforms);
            }
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
            const contract = offScreenTemplate?.contract
              ?? await storefrontClient.templateContract(templateForPatch.id, templateForPatch.outputId, templateForPatch.revisionId);
            responseContract = contract;
            appliedPrefills = resolvedPrefills().prefills;
            const assignments = { ...(appliedPrefills.length > 0 ? resolvedPrefills().assignments : draft.slotAssignments) };
            const values = { ...draft.textValues };
            const transforms = { ...draft.slotTransforms };
            const patchAliases = imageSlotAliasesForContract(contract, responseDocument);
            const patchRoles = imageSlotRoles(contract.slots, contractSlotBoxes(contract, responseDocument));
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
            if (onScreen) {
              setPrefilledSlots(Object.fromEntries(appliedPrefills.map((prefill) => [prefill.slotKey, prefill.role])));
              setTemplateAssignments(assignments); setTemplateInputs(values); setSlotTransforms(transforms);
            }
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
          setNotice({ tone: "info", message: onScreen
            ? `Draft ${draft.id} is visible for ${product.name}. The files remain local until they are prepared.`
            : `Draft ${draft.id} for ${product.name} is waiting in the draft rail. The print you are customizing stays on screen.` });
          // The live template preview must repaint before the agent hears back.
          await nextPaint();
          const responseSlotAliases = responseContract ? imageSlotAliasesForContract(responseContract, responseDocument) : {};
          // A bare slot key invites the agent to guess a photograph. Naming the
          // role and writing the question out invites it to ask the shopper.
          const missingDetail = describeMissingRequirements(
            missingRequirements,
            responseContract?.slots ?? [],
            responseSlotAliases,
          );
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
            status: "configured",
            draft_id: draft.id,
            // Say plainly whether this draft took the screen, so the agent
            // narrates what the shopper can actually see. A background draft was
            // made without disturbing the print they are customizing by hand.
            placed: placement,
            visible: onScreen,
            placement_guidance: onScreen
              ? "This draft is on screen: the shopper can see its live preview now."
              : "This draft was made in the draft rail and is NOT on screen — the shopper is customizing another print by hand and keeps it. Do not tell them they are looking at this one. Adding it will show them a proposal card carrying its own live preview, which is their first look at it.",
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
            missing: missingDetail,
            guidance: missingRequirementsGuidance(missingDetail),
            nextStep: product.template_requirement === "required"
              ? missingRequirements.length === 0 ? "ready_for_proof_or_cart" : "ask_shopper_for_missing_slots"
              : "prepare_visible_crop",
          } });
          return;
        }
        if (request.action === "add_to_cart") {
          // Accepted under either spelling, so an ID copied out of a response
          // that says draft_id is not rejected for saying draft_id.
          const requestedDraftId = requireIdentifierAlias(
            request.input,
            "draftId",
            "draft_id",
            "add_to_cart requires the visible draft ID it is proposing.",
          );
          // No refusal for a card already waiting: proposals stack, and the
          // shopper answers each one on its own.
          const draft = draftsRef.current.find((candidate) => candidate.id === requestedDraftId);
          if (!draft) throw new Error("That visible draft no longer exists.");
          const requestedQuantity = Number(request.input.quantity ?? 1);
          if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 99) {
            throw new Error("quantity must be a whole number from 1 through 99.");
          }
          // An incomplete draft is refused in the same words configure_print
          // uses, so the agent asks the shopper for the named photograph rather
          // than reading "not ready" and picking one itself.
          const cartMissingKeys = draft.template ? missingTemplateDraftRequirements(draft) : [];
          if (cartMissingKeys.length > 0) {
            const contract = await storefrontClient
              .templateContract(draft.template!.id, draft.template!.outputId, draft.template!.revisionId)
              .catch(() => null);
            const detail = describeMissingRequirements(
              cartMissingKeys,
              contract?.slots ?? [],
              contract ? imageSlotAliasesForContract(contract) : {},
            );
            throw new Error(missingRequirementsGuidance(detail) ?? "Complete every required visible template slot before proposing this draft.");
          }
          // Deliberately no selectDraft here. Adding to the cart must not move
          // the shopper to another step, and reselecting the draft would also
          // tear down and refetch the very template preview the proposal card
          // is about to show.
          //
          // Adding the print the shopper is already looking at needs no card:
          // its live preview was the pre-visualization, and asking again about
          // what fills the screen is ceremony, not consent. Every other draft is
          // one they have not seen, so that one still goes to the card.
          if (isShopperVisibleDraft(shopperViewRef.current, draft.id, Date.now())) {
            const { items: nextCart, line: added } = addDraftToCart(draft, requestedQuantity);
            await nextPaint();
            respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
              status: "added",
              draft_id: draft.id,
              item_id: added.id,
              product_name: added.productName,
              quantity: added.quantity,
              decided_by: "shopper_visible_context",
              guidance: `${requestedQuantity} × ${added.productName} went straight into the demo cart, with no proposal card: the shopper is looking at this draft's own live preview, so they already saw the print they asked you to add. Its matching cart line now has quantity ${added.quantity}. The masthead cart chip flashed the new count. Tell them it is in the cart. Nothing was ordered or charged.`,
              nextStep: "confirm_the_add_in_words",
              pending_proposal_count: pendingProposals.length,
              cart_item_count: localCartPrintCount(nextCart),
              cart_line_count: nextCart.length,
              items: localCartWireItems(nextCart),
            } });
            return;
          }
          const { proposal, duplicate } = proposeDraft(draft, requestedQuantity);
          // The proposal card must be on screen before the agent hears back.
          await nextPaint();
          const stackCount = duplicate ? pendingProposals.length : pendingProposals.length + 1;
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
            status: "awaiting_shopper_confirmation",
            proposal_id: proposal.id,
            draft_id: proposal.draftId,
            product_name: proposal.productName,
            quantity: proposal.quantity,
            decided_by: "shopper",
            duplicate_of_pending_proposal: duplicate,
            pending_proposal_count: stackCount,
            // Said in words, because the status alone was read as permission to
            // answer the agent's own proposal.
            guidance: duplicate
              ? `Nothing has been added, and no second card was made: ${proposal.quantity} × ${proposal.productName} already has proposal ${proposal.id} waiting on the shopper. ${stackCount} card${stackCount === 1 ? " is" : "s are"} now stacked in the corner. Tell them it is already waiting and stop.`
              : `Nothing has been added yet. This is not the draft the shopper has on screen, so the proposal card for ${proposal.quantity} × ${proposal.productName} is now showing them the print itself and waiting on the shopper, who decides by clicking Add or Don't add, or by saying so out loud. ${stackCount} card${stackCount === 1 ? " is" : "s are"} now stacked in the corner, each awaiting its own answer. Tell them the card is waiting and stop. Do not call resolve_cart_proposal unless the shopper has since said what they want, and then quote their words in shopperConfirmation.`,
            nextStep: "await_shopper_decision",
          } });
          return;
        }
        if (request.action === "resolve_cart_proposal") {
          const proposalId = readIdentifierAlias(request.input, "proposalId", "proposal_id");
          const requestedDecision = request.input.decision;
          const bulk = requestedDecision === "accept_all" || requestedDecision === "reject_all";
          const decision = requestedDecision === "accept_all" ? "accept"
            : requestedDecision === "reject_all" ? "reject"
              : requestedDecision;
          if (decision !== "accept" && decision !== "reject") {
            throw new Error("decision must be accept, reject, accept_all, or reject_all.");
          }
          // The confirmation is the shopper's own sentence. Requiring it here as
          // well as in the tool means a proposal can only be answered by
          // pointing at something the shopper actually said.
          const shopperConfirmation = typeof request.input.shopperConfirmation === "string"
            ? request.input.shopperConfirmation.trim()
            : "";
          if (!shopperConfirmation) {
            throw new Error("resolve_cart_proposal relays the shopper's decision only: quote their own words in shopperConfirmation. If they have not answered the visible card yet, ask them and wait.");
          }
          if (pendingProposals.length === 0) throw new Error("No cart proposal is visible.");
          // accept_all and reject_all are the shopper answering the whole
          // stack in one sentence; every other decision names one card.
          let targets: CartProposal[];
          if (bulk) {
            targets = pendingProposals;
          } else {
            const target = pendingProposals.find((candidate) => candidate.id === proposalId);
            if (!target) {
              throw new Error(proposalId
                ? `No proposal ${proposalId} is waiting. The cards waiting now are ${cartProposalWireItems(pendingProposals).map((item) => `${item.proposal_id} (${item.product_name})`).join(", ")}.`
                : `decision ${decision} names one card: pass its proposalId, or use accept_all or reject_all for the whole stack.`);
            }
            targets = [target];
          }
          const nextCart = resolveProposals(targets, decision);
          const remaining = pendingProposals.length - targets.length;
          await nextPaint();
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
            decision: decision === "accept" ? "accepted" : "rejected",
            scope: bulk ? "all_pending" : "one_proposal",
            resolved: targets.map((proposal) => ({
              proposal_id: proposal.id,
              draft_id: proposal.draftId,
              product_name: proposal.productName,
              quantity: proposal.quantity,
              decision: decision === "accept" ? "accepted" : "rejected",
            })),
            resolved_count: targets.length,
            // Echoed so the shopper's own words stay attached to the outcome.
            shopper_confirmation: shopperConfirmation,
            decided_by: "shopper",
            pending_proposal_count: remaining,
            cart_item_count: localCartPrintCount(nextCart),
            cart_line_count: nextCart.length,
            items: localCartWireItems(nextCart),
            guidance: remaining > 0
              ? `${remaining} proposal card${remaining === 1 ? " is" : "s are"} still waiting on the shopper. Do not answer ${remaining === 1 ? "it" : "them"} yourself.`
              : "Every proposal card has been answered; none are waiting.",
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
          cart_item_count: localCartPrintCount(nextCart),
          cart_line_count: nextCart.length,
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
      cartCount={cartPrintCount}
      notice={notice}
      onOpenCart={() => setCartOpen(true)}
      onOpenHome={() => setStep("catalog")}
    />
    <PhotoTray library={photoLibrary} onAction={handlePhotoAction} onImportError={(message) => setNotice({ tone: "error", message })} />

    <main className="mx-auto w-full max-w-[1400px] px-5 pb-16 sm:px-8 lg:px-12">

      {step === "catalog" && <div className="pb-10" id="catalog">
        <FormatPicker onSelect={selectProduct} products={catalog} selectedProductKey={selectedProductKey} state={catalogState} />
      </div>}

      {step === "prepare" && selectedProduct && <PrepareStep
        activeImageSlotKey={activeImageSlotKey}
        activeSlotPanLimits={activeSlotPanLimits}
        activeSlotTransform={activeSlotTransform}
        browserPreview={browserPreviewDocument ? <BrowserTemplatePreview activeImageSlotKey={activeImageSlotKey} assetURLs={browserPreviewAssetURLs} document={browserPreviewDocument} key={selectedBrowserPreviewSurfaceID} localImageSlots={browserPreviewImageSlots} onActiveImageSlotChange={(slotKey) => { setActiveImageSlotKey(slotKey); setActiveSlotPanLimits({ x: 0, y: 0 }); }} onPreviewChange={(slotKey, transform) => changeBrowserPreviewTransform(slotKey, transform)} onPreviewCommit={(_, slotKey, transform) => updateBrowserPreviewTransform(slotKey, transform)} onPreviewPanLimitsChange={(slotKey, limits) => { if (slotKey === activeImageSlotKey) setActiveSlotPanLimits(limits); }} onSurfaceChange={setSelectedBrowserPreviewSurfaceID} selectedSurfaceID={selectedBrowserPreviewSurfaceID} serverProof={null} textValues={templateInputs} /> : null}
        crop={crop}
        cropX={cropX}
        cropY={cropY}
        cropZoom={cropZoom}
        customization={customization}
        hasLocalImage={Boolean(localImage)}
        imageName={imageName}
        imagePreview={imagePreview}
        managedAsset={managedAsset}
        onAddPreparedLine={() => { try { if (selectedDraft) { noteShopperLookingAtSelectedDraft(); addDraftToCart(selectedDraft, 1); } else throw new Error("Select a visible draft before adding it to the demo cart."); } catch (error) { setNotice({ tone: "error", message: responseMessage(error) }); } }}
        onAssignTemplatePhoto={(slotKey, photoId) => { noteShopperLookingAtSelectedDraft(); assignTemplatePhoto(slotKey, photoId); }}
        onChangeFormat={() => setStep("catalog")}
        onCropXChange={(focusX) => { noteShopperLookingAtSelectedDraft(); setCropX(focusX); if (selectedDraftId) patchDraft(selectedDraftId, { directCrop: { focusX } }); }}
        onCropYChange={(focusY) => { noteShopperLookingAtSelectedDraft(); setCropY(focusY); if (selectedDraftId) patchDraft(selectedDraftId, { directCrop: { focusY } }); }}
        onCropZoomChange={(zoom) => { noteShopperLookingAtSelectedDraft(); setCropZoom(zoom); if (selectedDraftId) patchDraft(selectedDraftId, { directCrop: { zoom } }); }}
        onPrepareLocalImage={prepareLocalImage}
        onSelectTemplate={(templateId) => void chooseTemplate(templateId).catch((error) => setTemplateNotice({ tone: "error", message: responseMessage(error) }))}
        onSlotTransformChange={changeBrowserPreviewTransform}
        onSlotTransformCommit={updateBrowserPreviewTransform}
        onTemplateTextChange={(slotKey, value) => { noteShopperLookingAtSelectedDraft(); setTemplateInputs((values) => ({ ...values, [slotKey]: value })); }}
        photos={photoLibrary.photos}
        prefilledSlotProvenance={prefilledSlotProvenance}
        preparing={preparing}
        selectedPhotoId={selectedPhoto?.id ?? null}
        selectedPhotoOrdinal={photoLibrary.selectedPhotoId ? String(photoLibrary.photos.findIndex((photo) => photo.id === photoLibrary.selectedPhotoId) + 1).padStart(2, "0") : "—"}
        selectedProduct={selectedProduct}
        selectedTemplateId={selectedTemplateId}
        templateAssignments={templateAssignments}
        templateContract={templateContract}
        templateInputs={templateInputs}
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
      onUpdateQuantity={(itemId, quantity) => setCart((items) => items.map((item) => item.id === itemId ? { ...item, quantity } : item))}
      open={cartOpen}
    />

    {/* Every proposal waiting on the shopper, stacked in the corner. Each
        card paints its own proposed draft; this only supplies the artwork the
        workbench has already resolved for that draft's published output. */}
    <CartProposalStack
      entries={proposalStack}
      onAccept={(proposal) => resolveProposal(proposal, "accept")}
      onReject={(proposal) => resolveProposal(proposal, "reject")}
      previewFor={proposalPreviewBinding}
    />
  </>;
}
