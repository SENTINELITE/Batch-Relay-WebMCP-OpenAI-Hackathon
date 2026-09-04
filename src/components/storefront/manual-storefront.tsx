"use client";

import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  type CatalogProduct,
  type PublishedTemplate,
  type TemplateContract,
  type TemplateOutput,
  type TemplateOutputs,
  storefrontClient,
} from "@/lib/storefront/client";
import { type TemplateState } from "@/lib/storefront/customization";
import {
  faceFacts,
  readFocusPreset,
  readSubjectWidthPercent,
  resolveFocusPreset,
  type CropPatchValues,
  type FocusPreset,
  type FocusPresetResult,
} from "@/lib/storefront/focus-preset";
import { defaultCropForSubject, subjectRegionFromFaces } from "@/lib/storefront/face-geometry";
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
import { PhotoDragProvider, type PhotoDropTarget } from "@/components/storefront/photo-drag";
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
  mostRecentLocalCartItem,
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
import {
  readIdentifierAlias,
  requireIdentifierAlias,
  requireIdentifierListAlias,
} from "@/lib/storefront/tool-input";
import {
  printReviewWire,
  reviewCounts,
  reviewPrint,
  type PrintReview,
  type ReviewSlot,
} from "@/lib/storefront/print-review";
import { detectFaces, faceDetectionAvailable, type FaceBox } from "@/lib/storefront/face-detection";
import { faceDebugEnabled, workbenchResetRequested, type FaceDebugEntry, type FaceDebugMap } from "@/lib/storefront/debug-flags";
import {
  clearWorkbenchSnapshot,
  createWorkbenchHistory,
  createWorkbenchWriter,
  readWorkbenchSnapshot,
  relinkWorkbenchSnapshot,
  restoreNotice,
  workbenchSnapshotFromState,
  workbenchState,
  type WorkbenchSnapshot,
  type WorkbenchState,
  type WorkbenchStorage,
  type WorkbenchWriter,
} from "@/lib/storefront/workbench-persistence";
import {
  agentActionLabel,
  agentActivity,
  isMutatingAgentAction,
  type AgentActivity,
} from "@/lib/storefront/agent-activity";
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
import {
  publicTemplateAssetURL,
  specBrowserPreviewDocument,
  specImportantContentMargin,
  specMinimumEffectivePpi,
} from "@/lib/storefront/preview-spec";
import { bundledTemplateSpec } from "@/lib/storefront/template-specs";
import {
  deriveImageSlotAliases,
  deriveTextSlotAliases,
  imageSlotBoxesFromCanvases,
  resolveSlotPatchTarget,
  slotBoxFromLabel,
  textSlotLengthLimit,
  type SlotBox,
  type SlotKind,
} from "@/lib/storefront/slot-aliases";
import {
  directPhotoDefault,
  emptyPhotoRoleMemory,
  photoRolesBySlotKey,
  prefillProvenance,
  prefillSlotAssignments,
  rekeySlotValuesByRole,
  rememberDirectPhoto,
  rememberPhotoRole,
  rememberSlotAssignments,
  type PhotoRole,
  type PhotoRoleMemory,
  type SlotPrefill,
} from "@/lib/storefront/photo-role-defaults";
import {
  emptyPhotoLibrary,
  photoIdsByStableKey,
  photoLibraryReducer,
  resolvePhotoReference,
  revokePhotoObjectURLs,
  type BrowserPhoto,
  type PhotoLibraryAction,
} from "@/lib/storefront/photo-library";
import {
  publishStorefrontWebMcpState,
  respondToStorefrontWebMcpAction,
  subscribeToStorefrontWebMcpActions,
} from "@/webmcp/storefront-bridge";
import { toast } from "sonner";

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
type TemplateSlotState = {
  assignments: Record<string, string>;
  transforms: Record<string, BrowserPreviewTransform>;
  rolesBySlotKey: Record<string, PhotoRole>;
};
/** Shared, read-only template facts for an all-or-nothing staged batch. */
type BatchTemplatePreflight = Pick<OffScreenTemplate, "template" | "contract" | "document">;
type BatchStagingFailureCode =
  | "template_not_found"
  | "template_ambiguous"
  | "template_output_incompatible"
  | "template_contract_unavailable"
  | "template_preview_unavailable"
  | "template_required_unavailable";

class BatchStagingError extends Error {
  constructor(
    readonly code: BatchStagingFailureCode,
    message: string,
    readonly candidates: Array<{ id: string; name: string | null }> = [],
  ) {
    super(message);
    this.name = "BatchStagingError";
  }
}

type BatchStagingSession = {
  proposalIds: string[];
  results: Array<Record<string, unknown>>;
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

/** Template labels are user-facing text, so selection is case and punctuation
 * insensitive without turning a partial match into a guess. */
const normalizedTemplateName = (value: string) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const batchStagingKey = ({
  trayRevision,
  photoIds,
  product,
  quantity,
  orientation,
  templateId,
  templateQuery,
  outputId,
}: {
  trayRevision: number;
  photoIds: string[];
  product: Pick<CatalogProduct, "id" | "revision">;
  quantity: number;
  orientation?: "portrait" | "landscape";
  templateId?: string;
  templateQuery?: string;
  outputId?: string;
}) => JSON.stringify([
  trayRevision,
  photoIds,
  product.id,
  product.revision,
  quantity,
  orientation ?? null,
  templateId ?? null,
  templateQuery ? normalizedTemplateName(templateQuery) : null,
  outputId ?? null,
]);

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
): Record<string, { photoId: string; source: string; transform: BrowserPreviewTransform }> {
  return Object.fromEntries(Object.entries(assignments).flatMap(([slotKey, photoId]) => {
    const photo = photos.find((candidate) => candidate.id === photoId);
    return photo ? [[slotKey, { photoId, source: photo.previewURL, transform: transforms[slotKey] ?? initialBrowserPreviewTransform }]] : [];
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

/** The slot kind each patch operation can possibly mean. */
function slotPatchRequiredKind(operation: unknown): SlotKind | null {
  if (operation === "set_text") return "text";
  if (operation === "assign" || operation === "unassign" || operation === "set_crop") return "image";
  return null;
}

/** The words published beside each text slot, derived from its own label and
 *  semantic key so an agent may aim a set_text at "team" or "jersey". */
function textSlotAliases(slots: TemplateContract["slots"]): Record<string, string[]> {
  return deriveTextSlotAliases(slots.filter((slot) => slot.kind === "text"));
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

/**
 * The URL cannot change under this page without a reload, so the store has
 * nothing to publish and the unsubscribe is a no-op.
 */
function subscribeToNothing(): () => void {
  return () => {};
}

/** Whether the developer face overlay may run here. Never true on the server. */
function readFaceDebugFlag(): boolean {
  return typeof window === "undefined" ? false : faceDebugEnabled(window.location);
}

/**
 * This browser's local storage, or nothing. Absent on the server, and absent in
 * the browsers and privacy modes that make touching it throw; in both cases the
 * workbench simply stays in memory exactly as it did before.
 */
function browserWorkbenchStorage(): WorkbenchStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * How long a restore waits for the remembered folder to re-import before giving
 * up on its photographs. The handle read, the permission check and the folder
 * walk are all async, so a snapshot that restored immediately would drop every
 * photo reference a fraction of a second before the pictures arrived.
 */
const WORKBENCH_RELINK_WAIT_MS = 4000;

/**
 * Everything the shopper could have *changed* since a restore, as one string.
 *
 * `updatedAt` is deliberately excluded. Restoring the view writes a draft's own
 * saved assignments straight back onto it, which bumps the timestamp without
 * altering a single value; counting that as the shopper's own edit would make
 * the workbench give up on re-linking the moment it finished restoring.
 */
const workbenchSignature = (
  drafts: readonly PrintDraft[],
  cart: readonly LocalCartItem[],
  proposals: readonly CartProposal[],
) => {
  const settled = (draft: PrintDraft) => ({ ...draft, updatedAt: "" });
  return JSON.stringify([
    drafts.map(settled),
    cart.map((item) => ({ ...item, draft: settled(item.draft), thumbnailURL: null })),
    proposals.map((proposal) => ({ ...proposal, draft: settled(proposal.draft), thumbnailURL: null })),
  ]);
};

/** Removes `reset=workbench` so the next reload does not wipe the fresh start. */
function urlWithoutWorkbenchReset(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("reset");
  if (workbenchResetRequested({ hash: url.hash })) url.hash = "";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function ManualStorefront() {
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);
  const [step, setStep] = useState<ActiveStep>("catalog");
  const [, setNotice] = useState<Notice>(null);
  const [photoLibrary, dispatchPhotoLibrary] = useReducer(photoLibraryReducer, undefined, emptyPhotoLibrary);
  const [cropX, setCropX] = useState(50);
  const [cropY, setCropY] = useState(50);
  const [cropZoom, setCropZoom] = useState(1);
  // The focal intent is local UI state rather than a hidden print contract.
  // It is keyed per direct crop / template slot so changing slots cannot make
  // another photograph unexpectedly inherit a face-centred zoom.
  const [framingFocusByTarget, setFramingFocusByTarget] = useState<Record<string, FocusPreset>>({});
  const [templates, setTemplates] = useState<PublishedTemplate[]>([]);
  const [templateState, setTemplateState] = useState<TemplateState>("idle");
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
  // The compatible output each published template would print on, keyed by
  // product and template, so the template picker can show every template's
  // artwork and not only the chosen one's.
  const [carouselOutputs, setCarouselOutputs] = useState<Record<string, string>>({});
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
  // Pixel dimensions of each tray photograph, decoded lazily. The review
  // heuristics need them to say anything honest about effective PPI.
  const [, setImageDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const imageDimensionsRef = useRef<Record<string, { width: number; height: number }>>({});
  // Faces found in each tray photograph by the optional local detector. Absent
  // for every photograph until — and unless — it succeeds, which is why nothing
  // downstream waits on it.
  const [, setPhotoFaces] = useState<Record<string, readonly FaceBox[]>>({});
  const photoFacesRef = useRef<Record<string, readonly FaceBox[]>>({});
  // The detection pass in flight for each photograph, and which passes have
  // finished. `photoFacesRef` alone cannot tell "found none" from "not looked
  // yet" — it only ever holds non-empty results — and `focusOn: "faces"` has to
  // report those two as different answers, so readiness is tracked separately.
  const photoFaceJobsRef = useRef<Record<string, Promise<readonly FaceBox[]>>>({});
  const photoFacesResolvedRef = useRef<Record<string, true>>({});
  // The localhost-only face overlay (`?debug=faces`). Decided once, after
  // mount, because the gate reads the host actually serving the page and the
  // server has no opinion about that. Off means the tray is handed nothing.
  // Read through useSyncExternalStore rather than an effect: the URL is an
  // external value that never changes for the life of this page, so there is
  // one client answer, one server answer (never on), and no render cascade.
  const faceDebugOn = useSyncExternalStore(subscribeToNothing, readFaceDebugFlag, () => false);
  const faceDebugRef = useRef(false);
  useEffect(() => { faceDebugRef.current = faceDebugOn; }, [faceDebugOn]);
  // Detection results live in refs, so a pass finishing does not by itself
  // repaint anything. This nudge makes the top-rail face badges appear as the
  // local pass finishes; its value is never read, exactly like `setPhotoFaces`
  // above. The debug overlay shares that repaint but is not the reason for it.
  const [, setFaceDetectionRevision] = useState(0);
  // Which drafts were made behind the shopper's screen, so a proposal card can
  // say the print was found in the catalog rather than chosen on screen.
  const backgroundDraftIds = useRef<Set<string>>(new Set());
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
  const proposalStackRef = useRef(proposalStack);
  // A timed-out WebMCP request can be retried after the visible state already
  // committed. Keep the standing proposals by deterministic batch key so that
  // retry never deals the shopper a second set of cards.
  const batchStagingSessions = useRef(new Map<string, BatchStagingSession>());
  const browserPreviewDocumentRef = useRef<BrowserPreviewDocument | null>(browserPreviewDocument);
  // Which draft's preview the shopper actually has in front of them, and how it
  // got there. add_to_cart adds straight to the cart for this draft and asks
  // with the proposal card for any other. A ref, not state: nothing renders
  // from it, and add_to_cart must read the value as of the moment it is called.
  const shopperViewRef = useRef<ShopperViewContext>(emptyShopperViewContext);
  // ── Saved workbench ──────────────────────────────────────────────────────
  // The debounced write-through, created once after mount because it needs a
  // storage this component has no opinion about while rendering on the server.
  const workbenchWriter = useRef<WorkbenchWriter | null>(null);
  // The snapshot read at mount, held until the tray import lands. Nulled the
  // moment the shopper's own work makes a further re-link pass unwelcome.
  const pendingRestore = useRef<WorkbenchSnapshot | null>(null);
  // What the workbench looked like immediately after the restore, so a later
  // re-link pass can tell "untouched" from "the shopper has moved on".
  const restoreSignature = useRef<string | null>(null);
  // Stable keys a restored draft named that the tray did not hold at the time.
  const unlinkedPhotoKeys = useRef<string[]>([]);
  // The step, product and draft the shopper had in front of them, replayed once
  // the catalog is back — a draft alone cannot repaint the workbench.
  const pendingViewRestore = useRef<{ draftId: string | null; productKey: string | null; step: ActiveStep } | null>(null);
  /**
   * The saved workbench as it stood when this page opened, read once during the
   * first render rather than in an effect. Whether there is anything to restore
   * decides the initial `restoreState`, and deciding it after the first paint
   * would mean an extra render before the workbench could even start waiting.
   * On the server there is no storage and therefore nothing to restore.
   */
  const [savedWorkbench] = useState<{
    storage: WorkbenchStorage | null;
    snapshot: WorkbenchSnapshot | null;
    reset: boolean;
  }>(() => {
    const storage = browserWorkbenchStorage();
    if (!storage) return { storage: null, snapshot: null, reset: false };
    if (workbenchResetRequested(window.location)) return { storage, snapshot: null, reset: true };
    return { storage, snapshot: readWorkbenchSnapshot(storage), reset: false };
  });
  const [restoreState, setRestoreState] = useState<"waiting" | "done">(
    savedWorkbench.snapshot ? "waiting" : "done",
  );
  // Bumped by every restore pass, so a late re-link repaints the visible step
  // as well as the drafts behind it.
  const [viewRestoreRevision, setViewRestoreRevision] = useState(0);
  // The one quiet line a restore is allowed to say, held until the workbench has
  // finished repainting: loading a product clears the notice area, so saying it
  // any earlier means saying it to a shopper who never sees it.
  const restoreMessage = useRef<string | null>(null);
  const [relinkWaitExpired, setRelinkWaitExpired] = useState(false);
  // Role memory lives in a ref because nothing renders from it, so the saved
  // workbench needs its own signal that it changed.
  const [roleMemoryRevision, setRoleMemoryRevision] = useState(0);
  const cartRef = useRef(cart);
  /**
   * The last ten states an agent action was about to change, newest last.
   *
   * Held in a ref rather than state because nothing renders from it: the
   * undo/redo affordances are tools and a toast action, neither of which needs
   * a re-render when their depth changes. It is deliberately not persisted — a
   * reload is already the bigger undo, and restoring a history alongside the
   * workbench it describes invites the two to disagree.
   */
  const workbenchHistory = useRef(createWorkbenchHistory());
  /**
   * Bumped when an agent changes the workbench, to play one short ring pulse
   * over the prepare step. The preview repaints and the deck animates on their
   * own; the slot table and the framing controls do not, so an agent's crop
   * change used to land with no motion at all to catch the eye.
   */
  const [workbenchPulse, setWorkbenchPulse] = useState(0);

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

  /**
   * The single writer for the role memory ref.
   *
   * The `remember*` helpers return the identical object when nothing changed,
   * so this only nudges a render — and therefore a save — when a role actually
   * moved to a different photograph.
   */
  function rememberRoles(next: PhotoRoleMemory) {
    if (next === photoRoleMemory.current) return;
    photoRoleMemory.current = next;
    setRoleMemoryRevision((revision) => revision + 1);
  }

  /**
   * Puts a saved workbench back, bound to the tray as it stands right now.
   *
   * Idempotent by design: running it again with a fuller tray simply re-links
   * more of the same snapshot, which is what the late pass below relies on.
   */
  function applyWorkbenchRestore(
    snapshot: WorkbenchSnapshot,
    photos: readonly BrowserPhoto[],
    // An undo says what it undid in its own toast, in the shopper's terms. The
    // reload notice — "Restored 4 drafts." — would be both redundant and wrong
    // about what just happened.
    { announce = true }: { announce?: boolean } = {},
  ) {
    const restore = relinkWorkbenchSnapshot(snapshot, photos);
    // A proposal resolution schedules its exit. If undo restores that very
    // card before the animation timer fires, the old timer must not erase the
    // restored card (or a later redo) by its recycled proposal id.
    for (const timer of proposalExitTimers.current) clearTimeout(timer);
    proposalExitTimers.current = [];
    setDrafts(restore.drafts);
    draftsRef.current = restore.drafts;
    setCart(restore.cart);
    cartRef.current = restore.cart;
    commitProposalStack(() => restore.proposals.map((proposal) => ({ proposal, exit: null })));
    rememberRoles(restore.roleMemory);
    backgroundDraftIds.current = new Set(restore.backgroundDraftIds);
    setSelectedDraftId(restore.selectedDraftId);
    setCropZoom(restore.directCrop.zoom);
    setCropX(restore.directCrop.focusX);
    setCropY(restore.directCrop.focusY);
    restoreSignature.current = workbenchSignature(restore.drafts, restore.cart, restore.proposals);
    unlinkedPhotoKeys.current = restore.unlinkedPhotoKeys;
    pendingViewRestore.current = {
      draftId: restore.selectedDraftId,
      productKey: restore.selectedProductKey,
      step: restore.step,
    };
    setViewRestoreRevision((revision) => revision + 1);
    restoreMessage.current = announce ? restoreNotice(restore) : null;
    if (restoreMessage.current) setNotice({ tone: "info", message: restoreMessage.current });
    return restore;
  }

  /**
   * Shows one agent action to the shopper: a line of text, a pulse where the
   * change landed, and — when there is a step to go back to — the Undo button
   * that is the visible half of `undo_last_change`.
   *
   * Only the bridge calls this. A shopper who dragged a photograph into a slot
   * watched themselves do it and does not need to be told.
   */
  function announceAgentActivity(activity: AgentActivity) {
    if (activity.pulse === "workbench") setWorkbenchPulse((revision) => revision + 1);
    const undoable = activity.undoable && workbenchHistory.current.depth() > 0;
    toast(activity.message, {
      description: activity.detail,
      action: undoable
        ? {
          label: "Undo",
          // The same restore path the tool uses, so the button and the words
          // "undo that" cannot drift apart.
          onClick: () => {
            const undone = undoWorkbenchChange(1);
            toast(undone ? `Undid: ${undone.label}` : "There is nothing left to undo");
          },
        }
        : undefined,
    });
  }

  /** The workbench as it stands right now, in the shape a snapshot records. */
  function captureWorkbenchState(): WorkbenchState {
    return workbenchState({
      photos: photoLibrary.photos,
      drafts: draftsRef.current,
      cart: cartRef.current,
      proposals: pendingCartProposals(proposalStackRef.current),
      roleMemory: photoRoleMemory.current,
      backgroundDraftIds: backgroundDraftIds.current,
      selectedDraftId,
      selectedProductKey,
      step,
      directCrop: { zoom: cropZoom, focusX: cropX, focusY: cropY },
    });
  }

  /**
   * Walks the workbench back through the same relink-and-apply path a reload
   * restore uses, so a restored proposal card renders exactly as a restored one
   * already does. Returns what was undone, or null when the history is empty.
   */
  function undoWorkbenchChange(steps: number) {
    const undone = workbenchHistory.current.undo(captureWorkbenchState(), steps);
    if (!undone) return null;
    // The shopper has plainly moved on from any half-linked reload restore, so
    // a late re-link pass must not fire on top of the state just put back.
    pendingRestore.current = null;
    const restore = applyWorkbenchRestore(
      workbenchSnapshotFromState(undone.state),
      photoLibrary.photos,
      { announce: false },
    );
    setNotice({ tone: "info", message: `Undid: ${undone.label}.` });
    return { ...undone, restore, remaining: workbenchHistory.current.depth() };
  }

  /** Re-applies a real undo through the same relinked restore path. */
  function redoWorkbenchChange(steps: number) {
    const redone = workbenchHistory.current.redo(steps);
    if (!redone) return null;
    pendingRestore.current = null;
    const restore = applyWorkbenchRestore(
      workbenchSnapshotFromState(redone.state),
      photoLibrary.photos,
      { announce: false },
    );
    setNotice({ tone: "info", message: `Redid: ${redone.label}.` });
    return { ...redone, restore, remaining: workbenchHistory.current.redoDepth() };
  }

  /**
   * Repaints the step the shopper was on. The drafts alone are not the
   * workbench: a template draft needs its published contract and artwork loaded
   * again before the prepare step can show anything, and that is a fetch.
   */
  async function applyWorkbenchViewRestore(request: NonNullable<typeof pendingViewRestore.current>) {
    if (request.step !== "prepare" || !request.productKey) return;
    const product = catalog.find((candidate) => productSelectionKey(candidate) === request.productKey);
    if (!product) return;
    const draft = draftsRef.current.find((candidate) => candidate.id === request.draftId) ?? null;
    selectProduct(product, false, true);
    if (!draft) return;
    // The shopper put this draft on screen before the reload, and putting it
    // back is not an agent placing it.
    noteVisibleDraft(draft.id, "shopper");
    setCropZoom(draft.directCrop.zoom);
    setCropX(draft.directCrop.focusX);
    setCropY(draft.directCrop.focusY);
    if (draft.photoIds[0]) dispatchPhotoLibrary({ type: "select", photoId: draft.photoIds[0] });
    if (!draft.template) return;
    await chooseTemplate(draft.template.id, product, draft.template.outputId, undefined, draft.id);
    // The saved draft has the last word over anything the reload prefilled: a
    // role default arriving on top of a restore would silently re-fill a slot
    // whose photograph the shopper had deliberately cleared.
    setTemplateAssignments(draft.slotAssignments);
    setTemplateInputs(draft.textValues);
    setSlotTransforms(draft.slotTransforms);
    lastBrowserPreviewTransforms.current = draft.slotTransforms;
    patchDraft(draft.id, {
      slotAssignments: draft.slotAssignments,
      slotTransforms: draft.slotTransforms,
      textValues: draft.textValues,
    });
  }

  // Creating the writer, wiping a reset namespace and tidying the URL are all
  // side effects; whether there is anything to restore was already decided
  // before the first paint, so nothing here has to set state to say so.
  useEffect(() => {
    if (!savedWorkbench.storage) return;
    workbenchWriter.current = createWorkbenchWriter(savedWorkbench.storage);
    if (savedWorkbench.reset) {
      clearWorkbenchSnapshot(savedWorkbench.storage);
      window.history.replaceState(null, "", urlWithoutWorkbenchReset(window.location.href));
      return;
    }
    if (!savedWorkbench.snapshot) return;
    pendingRestore.current = savedWorkbench.snapshot;
    const timer = setTimeout(() => setRelinkWaitExpired(true), WORKBENCH_RELINK_WAIT_MS);
    return () => clearTimeout(timer);
  }, [savedWorkbench]);

  // Restore as soon as the tray import lands. A snapshot with no photo
  // references has nothing to wait for; one whose folder never comes back
  // restores photo-independently when the wait expires, and says so.
  useEffect(() => {
    if (restoreState !== "waiting") return;
    const snapshot = pendingRestore.current;
    if (!snapshot) {
      setRestoreState("done");
      return;
    }
    const referencesPhotos = Object.keys(snapshot.photoKeys).length > 0;
    if (referencesPhotos && photoLibrary.photos.length === 0 && !relinkWaitExpired) return;
    applyWorkbenchRestore(snapshot, photoLibrary.photos);
    setRestoreState("done");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyWorkbenchRestore is a stable component-body helper reading refs.
  }, [photoLibrary.photos, relinkWaitExpired, restoreState]);

  // A folder chosen by hand after the wait expired still deserves its drafts
  // back. Only while the restored workbench is exactly as the restore left it:
  // once the shopper has changed anything, re-applying a snapshot would undo
  // their work, so the snapshot is dropped instead.
  useEffect(() => {
    const snapshot = pendingRestore.current;
    if (restoreState !== "done" || !snapshot) return;
    if (unlinkedPhotoKeys.current.length === 0 || photoLibrary.photos.length === 0) return;
    const current = workbenchSignature(draftsRef.current, cartRef.current, pendingCartProposals(proposalStackRef.current));
    if (current !== restoreSignature.current) {
      pendingRestore.current = null;
      return;
    }
    const available = photoIdsByStableKey(photoLibrary.photos);
    if (!unlinkedPhotoKeys.current.some((key) => available[key])) return;
    applyWorkbenchRestore(snapshot, photoLibrary.photos);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyWorkbenchRestore is a stable component-body helper reading refs.
  }, [photoLibrary.photos, restoreState]);

  // The view restore waits for the catalog, which is a separate fetch: a
  // product key names nothing until the returned products are back.
  useEffect(() => {
    const request = pendingViewRestore.current;
    if (restoreState !== "done" || !request || catalog.length === 0) return;
    pendingViewRestore.current = null;
    void applyWorkbenchViewRestore(request).catch(() => {
      // A template whose artwork will not load leaves the shopper on the
      // catalog step with every draft intact, rather than on a blank bench.
      setStep("catalog");
    }).finally(() => {
      if (restoreMessage.current) setNotice({ tone: "info", message: restoreMessage.current });
      restoreMessage.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyWorkbenchViewRestore is a stable component-body helper reading refs.
  }, [catalog, restoreState, viewRestoreRevision]);

  // The write-through. Every lifecycle path — accepting or rejecting a card,
  // deleting a draft, clearing or checking out the cart — changes one of these
  // values, so none of them needs a save of its own.
  useEffect(() => {
    if (restoreState !== "done") return;
    // A restore that could not find its photographs must not overwrite the
    // snapshot that still knows where they were. Until the shopper changes
    // something — at which point their work is what matters — the saved
    // workbench stays as it was, so choosing the folder on the next reload
    // still brings every draft back fully linked. Read from the rendered
    // values rather than the mirroring refs, which lag by one commit.
    const untouchedAfterPartialRestore = Boolean(pendingRestore.current)
      && unlinkedPhotoKeys.current.length > 0
      && workbenchSignature(drafts, cart, pendingCartProposals(proposalStack)) === restoreSignature.current;
    if (untouchedAfterPartialRestore) return;
    workbenchWriter.current?.save(workbenchState({
      photos: photoLibrary.photos,
      drafts,
      cart,
      proposals: pendingCartProposals(proposalStack),
      roleMemory: photoRoleMemory.current,
      backgroundDraftIds: backgroundDraftIds.current,
      selectedDraftId,
      selectedProductKey,
      step,
      directCrop: { zoom: cropZoom, focusX: cropX, focusY: cropY },
    }));
  }, [cart, cropX, cropY, cropZoom, drafts, photoLibrary.photos, proposalStack, restoreState, roleMemoryRevision, selectedDraftId, selectedProductKey, step]);

  // A queued write must not be lost to the tab closing or to a hot reload
  // unmounting this component mid-debounce.
  useEffect(() => {
    const flush = () => workbenchWriter.current?.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  useEffect(() => { cartRef.current = cart; }, [cart]);

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

  // Decoded pixel dimensions for each tray photograph, which is the one fact
  // the resolution review needs and the tray itself does not carry. Decoded
  // once per photo, off the render path, and never sent anywhere.
  useEffect(() => {
    let live = true;
    for (const photo of photoLibrary.photos) {
      if (imageDimensionsRef.current[photo.id]) continue;
      // Registered synchronously, before the decode starts, so a `focusOn:
      // "faces"` crop arriving mid-pass has something to await instead of
      // reporting a photograph it is already looking at as never examined.
      const job = createImageBitmap(photo.file).then(async (bitmap) => {
        const size = { width: bitmap.width, height: bitmap.height };
        if (live && !imageDimensionsRef.current[photo.id]) {
          imageDimensionsRef.current = { ...imageDimensionsRef.current, [photo.id]: size };
          setImageDimensions(imageDimensionsRef.current);
        }
        // The same decode pays for the optional face pass. It resolves to no
        // faces whenever the local detector is missing or unhappy, so this is
        // never awaited by anything the shopper is looking at; when it does
        // land, publishing it re-runs the reviews that already read this ref.
        try {
          const faces = await detectFaces(bitmap, photo.id);
          if (faces.length > 0) {
            photoFacesRef.current = { ...photoFacesRef.current, [photo.id]: faces };
            if (live) setPhotoFaces(photoFacesRef.current);
          }
          return faces;
        } finally {
          bitmap.close();
        }
      }).catch(() => {
        // A photograph this browser cannot decode simply yields no resolution
        // finding, rather than a warning invented from nothing.
        return [] as readonly FaceBox[];
      }).then((faces) => {
        // Whatever happened, this photograph has now been looked at once. The
        // refs outlive the effect deliberately: a re-render must not turn a
        // finished answer back into "not ready".
        photoFacesResolvedRef.current[photo.id] = true;
        // "Looked at and found nobody" still needs a repaint: the rail exposes
        // a quiet zero-face badge only after the detector has actually checked.
        if (live) setFaceDetectionRevision((revision) => revision + 1);
        return faces;
      });
      photoFaceJobsRef.current[photo.id] = job;
      void job;
    }
    return () => { live = false; };
  }, [photoLibrary.photos]);

  useEffect(() => { photoLibraryRef.current = photoLibrary; }, [photoLibrary]);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);
  useEffect(() => {
    proposalStackRef.current = proposalStack;
    const pending = new Set(pendingCartProposals(proposalStack).map((proposal) => proposal.id));
    for (const [key, session] of batchStagingSessions.current) {
      if (session.proposalIds.every((proposalId) => !pending.has(proposalId))) {
        batchStagingSessions.current.delete(key);
      }
    }
  }, [proposalStack]);
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
  const localImage = selectedPhoto?.file ?? null;
  const selectedProductId = selectedProduct?.id ?? null;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const framingFocusTarget = customization === "template"
    ? activeImageSlotKey && templateAssignments[activeImageSlotKey]
      ? `template:${selectedDraftId ?? selectedProductKey ?? "new"}:${activeImageSlotKey}:${templateAssignments[activeImageSlotKey]}`
      : null
    : selectedPhoto
      ? `direct:${selectedDraftId ?? selectedProductKey ?? "new"}:${selectedPhoto.id}`
      : null;
  const framingFocus = framingFocusTarget ? framingFocusByTarget[framingFocusTarget] ?? "center" : "center";
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
  // The same courtesy for the printed lines: "team", "jersey", "year" read out
  // of each text slot's own published label and semantic key.
  const visibleTextAliases = useMemo(
    () => textSlotAliases(templateContract?.slots ?? []),
    [templateContract],
  );
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
      // The verdict is computed from the proposal's own draft snapshot, so a
      // card reframed by revise_prints re-chips itself along with its preview.
      review: reviewForDraft(proposal.draft),
      foundInCatalog: backgroundDraftIds.current.has(proposal.draftId),
      aspect: product?.physical_output
        ? `${product.physical_output.width} / ${product.physical_output.height}`
        : "4 / 5",
      templatePreview: proposalPreviewDocument
        ? <BrowserTemplatePreview
          activeImageSlotKey={null}
          assetURLs={proposalPreviewAssetURLs}
          document={proposalPreviewDocument}
          dropEnabled={false}
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

  // Warms every published template's artwork for the selected product, so the
  // picker's ring shows real previews to either side of the chosen template.
  // Each template resolves independently; one that cannot be resolved keeps
  // its name on a blank card rather than holding the others back.
  useEffect(() => {
    const product = selectedProduct;
    if (!product || templates.length === 0 || product.template_requirement === "unsupported") return;
    let live = true;
    for (const template of templates) {
      void (async () => {
        try {
          const request = templateOutputRequests.current.get(template.id) ?? storefrontClient.templateOutputs(template.id);
          templateOutputRequests.current.set(template.id, request);
          const outputs = await request;
          const output = compatibleTemplateOutputs(outputs.outputs, product)[0];
          if (!output || !live) return;
          if (!previewDocumentsRef.current[previewDocumentKey(template.id, output.id)]) {
            const contract = await storefrontClient.templateContract(template.id, output.id, outputs.revision_id);
            if (!live) return;
            await resolvePreviewDocument(template.id, output, outputs.revision_id, contract);
          }
          const key = `${product.id}|${template.id}`;
          if (live) setCarouselOutputs((current) => current[key] === output.id ? current : { ...current, [key]: output.id });
        } catch {
          // The card shows the template's name without artwork.
        }
      })();
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by product and template list; resolvePreviewDocument is a stable component-body helper reading refs.
  }, [selectedProduct?.id, templates]);

  /**
   * Read-only artwork for one template in the picker's ring. The chosen
   * template paints from the live document; the others paint from the warmed
   * documents with the shopper's photographs and text wherever the slot keys
   * match, and empty slots where they do not, so nothing is promised that the
   * template cannot show.
   */
  function templateCarouselPreviewFor(templateId: string): ReactNode | null {
    const isSelected = templateId === selectedTemplateId;
    const outputId = selectedProduct ? carouselOutputs[`${selectedProduct.id}|${templateId}`] : undefined;
    const document = isSelected && browserPreviewDocument
      ? browserPreviewDocument
      : outputId ? previewDocuments[previewDocumentKey(templateId, outputId)] ?? null : null;
    if (!document) return null;
    return <BrowserTemplatePreview
      activeImageSlotKey={null}
      assetURLs={previewAssetURLs(document)}
      document={document}
      dropEnabled={false}
      localImageSlots={isSelected ? browserPreviewImageSlots : previewImageSlots(templateAssignments, slotTransforms, photoLibrary.photos)}
      onActiveImageSlotChange={() => undefined}
      onSurfaceChange={() => undefined}
      selectedSurfaceID={document.output.surfaces[0]?.id ?? ""}
      serverProof={null}
      textValues={templateInputs}
    />;
  }

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
    if (action.type === "replace") {
      // A picker selection is a fresh local photo set. Clear the live framing
      // state that names prior photo ids; immutable cart lines remain cart
      // history and continue to own their own snapshots.
      setTemplateAssignments({});
      setSlotTransforms({});
      setActiveImageSlotKey(null);
      setActiveSlotPanLimits({ x: 0, y: 0 });
      setCropX(50);
      setCropY(50);
      setCropZoom(1);
      setFramingFocusByTarget({});
      photoRoleMemory.current = emptyPhotoRoleMemory;
      setRoleMemoryRevision((revision) => revision + 1);
    }
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
      rememberRoles(rememberDirectPhoto(photoRoleMemory.current, selectedProduct.physical_output, action.photoId));
    }
    if (action.type === "select" || action.type === "remove") {
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
        rememberRoles(rememberDirectPhoto(photoRoleMemory.current, product.physical_output, photoId));
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
    // Snapshot before clearing the live template state. The outgoing template
    // owns different opaque slot keys, but its visible individual/team roles
    // are the shopper intent that may transfer to the next template.
    const currentDraft = draftsRef.current.find((candidate) => candidate.id === (draftId ?? selectedDraftId));
    const previousSlotState: TemplateSlotState = {
      assignments: currentDraft?.slotAssignments ?? templateAssignments,
      transforms: currentDraft?.slotTransforms ?? slotTransforms,
      rolesBySlotKey: visibleSlotRoles,
    };
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
        previousSlotState,
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
   * Resolves exactly one active template by stable ID or human label. This is
   * intentionally stricter than the visible picker: a batch requested as
   * "Canary" must never silently become a different published layout.
   */
  function resolveRequestedBatchTemplate(
    activeTemplates: PublishedTemplate[],
    requested: { templateId?: string; templateQuery?: string },
  ): PublishedTemplate[] {
    const candidates = activeTemplates.map((template) => ({ id: template.id, name: template.name ?? null }));
    if (requested.templateId) {
      const exact = activeTemplates.find((template) => template.id === requested.templateId);
      if (!exact) {
        throw new BatchStagingError(
          "template_not_found",
          `Template ${requested.templateId} is not an active template in this storefront session. Refresh template discovery and use one of the returned IDs.`,
          candidates,
        );
      }
      if (requested.templateQuery && normalizedTemplateName(exact.name ?? "") !== normalizedTemplateName(requested.templateQuery)) {
        throw new BatchStagingError(
          "template_not_found",
          `Active template ${requested.templateId} does not match the requested template name ${requested.templateQuery}. Use either its ID or its exact active name.`,
          candidates,
        );
      }
      return [exact];
    }
    if (!requested.templateQuery) return activeTemplates;

    const query = normalizedTemplateName(requested.templateQuery);
    if (!query) {
      throw new BatchStagingError(
        "template_not_found",
        "The template name contains no searchable letters or numbers. Use an active template ID or a name such as Canary.",
        candidates,
      );
    }
    const exact = activeTemplates.filter((template) => normalizedTemplateName(template.name ?? "") === query);
    const matches = exact.length > 0
      ? exact
      : activeTemplates.filter((template) => normalizedTemplateName(template.name ?? "").includes(query));
    if (matches.length === 0) {
      throw new BatchStagingError(
        "template_not_found",
        `No active template matches ${requested.templateQuery}. Ask the storefront for active template compatibility or use an exact template ID.`,
        candidates,
      );
    }
    if (matches.length > 1) {
      throw new BatchStagingError(
        "template_ambiguous",
        `${requested.templateQuery} matches multiple active templates. Use one returned template ID to choose deliberately.`,
        matches.map((template) => ({ id: template.id, name: template.name ?? null })),
      );
    }
    return matches;
  }

  /**
   * Shared preflight for every valid photograph in a staged batch. All API
   * reads happen here before any draft or proposal is constructed, making an
   * unavailable product/template/output/contract an atomic batch failure.
   */
  async function resolveBatchTemplatePreflight(
    product: CatalogProduct,
    requested: { templateId?: string; templateQuery?: string; outputId?: string; orientation?: "portrait" | "landscape" },
  ): Promise<BatchTemplatePreflight | null> {
    if (product.template_requirement === "unsupported") return null;
    const explicitTemplateSelection = Boolean(requested.templateId || requested.templateQuery || requested.outputId);
    let activeTemplates: PublishedTemplate[];
    try {
      activeTemplates = templates.length > 0 ? templates : (await storefrontClient.templates()).items;
    } catch (error) {
      if (!explicitTemplateSelection && product.template_requirement === "optional") return null;
      throw new BatchStagingError(
        product.template_requirement === "required" ? "template_required_unavailable" : "template_contract_unavailable",
        `Active template discovery is unavailable: ${responseMessage(error)}`,
      );
    }
    const stored = rememberedTemplatePreference(product);
    const selected = resolveRequestedBatchTemplate(activeTemplates, requested);
    const ordered = requested.templateId || requested.templateQuery
      ? selected
      : [...selected].sort((left, right) => Number(right.id === stored?.templateId) - Number(left.id === stored?.templateId));
    let outputFetchFailure: unknown = null;
    let foundCompatibleOutput = false;

    for (const template of ordered) {
      let outputs: TemplateOutputs;
      try {
        outputs = await storefrontClient.templateOutputs(template.id);
      } catch (error) {
        outputFetchFailure ??= error;
        // An unselected optional template is a convenience, not a reason to
        // block a direct print. Explicit intent remains a hard requirement.
        if (explicitTemplateSelection) break;
        continue;
      }
      const compatible = compatibleTemplateOutputs(outputs.outputs, product).filter((output) =>
        !requested.orientation || compatibleOutputVariantSummary(output, product) === requested.orientation);
      const output = requested.outputId
        ? compatible.find((candidate) => candidate.id === requested.outputId)
        : compatible.find((candidate) => template.id === stored?.templateId && candidate.id === stored.outputId)
          ?? compatible[0];
      if (!output) continue;
      foundCompatibleOutput = true;
      let contract: TemplateContract;
      try {
        contract = await storefrontClient.templateContract(template.id, output.id, outputs.revision_id);
      } catch (error) {
        throw new BatchStagingError(
          "template_contract_unavailable",
          `The active ${template.name ?? template.id} ${output.label ?? output.id} contract could not be read: ${responseMessage(error)}`,
          [{ id: template.id, name: template.name ?? null }],
        );
      }
      let document: BrowserPreviewDocument | null;
      try {
        document = await resolvePreviewDocument(template.id, output, outputs.revision_id, contract);
      } catch (error) {
        throw new BatchStagingError(
          "template_preview_unavailable",
          `The active ${template.name ?? template.id} ${output.label ?? output.id} preview could not be prepared: ${responseMessage(error)}`,
          [{ id: template.id, name: template.name ?? null }],
        );
      }
      if (!document) {
        throw new BatchStagingError(
          "template_preview_unavailable",
          `The active ${template.name ?? template.id} ${output.label ?? output.id} has no browser-readable preview document.`,
          [{ id: template.id, name: template.name ?? null }],
        );
      }
      rememberTemplatePreference(product, template.id, output.id);
      return {
        template: { id: template.id, outputId: output.id, revisionId: contract.template.revision_id },
        contract,
        document,
      };
    }

    if (!explicitTemplateSelection && product.template_requirement === "optional") return null;
    if (outputFetchFailure && !foundCompatibleOutput) {
      throw new BatchStagingError(
        "template_contract_unavailable",
        `The active template outputs could not be read: ${responseMessage(outputFetchFailure)}`,
      );
    }
    const code: BatchStagingFailureCode = product.template_requirement === "required"
      ? "template_required_unavailable"
      : "template_output_incompatible";
    throw new BatchStagingError(
      code,
      requested.outputId
        ? `No active template has requested output ${requested.outputId} for ${product.name}${requested.orientation ? ` in ${requested.orientation} orientation` : ""}.`
        : `No active template has a compatible published output for ${product.name}${requested.orientation ? ` in ${requested.orientation} orientation` : ""}.`,
    );
  }

  /** Compact discovery for ask_storefront. It intentionally reads outputs only:
   * contracts and preview documents stay out of this reconnaissance response. */
  async function requestedTemplateCompatibilityProjection(input: Record<string, unknown>) {
    const templateId = typeof input.templateId === "string" ? input.templateId.trim() || undefined : undefined;
    const templateQuery = typeof input.templateQuery === "string" ? input.templateQuery.trim() || undefined : undefined;
    const productId = typeof input.productId === "string" ? input.productId.trim() || undefined : undefined;
    const productQuery = typeof input.productQuery === "string" ? input.productQuery.trim().toLocaleLowerCase() : "";
    const orientation = input.orientation === "portrait" || input.orientation === "landscape" ? input.orientation : undefined;
    const templateRequested = Boolean(templateId || templateQuery || productId || productQuery || orientation);
    if (!templateRequested) return null;
    const requestedMaximum = typeof input.maxTemplateResults === "number" ? input.maxTemplateResults : 8;
    const max = Math.max(1, Math.min(Math.floor(requestedMaximum), 20));
    const matches = productId
      ? catalog.filter((product) => product.id === productId)
      : productQuery ? naturalProductMatches(catalog, productQuery) : [];
    if (matches.length !== 1) {
      return {
        status: matches.length === 0 ? "product_not_found" : "product_ambiguous",
        product: null,
        templates: [],
        guidance: matches.length === 0
          ? "Use a live canonical product ID or a more specific product query before checking template compatibility."
          : "The product query matches more than one live print; use its canonical product ID before checking template compatibility.",
      };
    }
    const product = matches[0]!;
    let activeTemplates: PublishedTemplate[];
    try {
      activeTemplates = templates.length > 0 ? templates : (await storefrontClient.templates()).items;
    } catch (error) {
      return {
        status: "template_discovery_unavailable",
        product: { id: product.id, revision: product.revision, name: product.name, template_requirement: product.template_requirement },
        templates: [],
        error: { code: "template_contract_unavailable", message: responseMessage(error), scope: "batch" },
      };
    }
    let selected: PublishedTemplate[];
    try {
      selected = templateId || templateQuery
        ? resolveRequestedBatchTemplate(activeTemplates, { templateId, templateQuery })
        : activeTemplates;
    } catch (error) {
      const failure = error instanceof BatchStagingError
        ? error
        : new BatchStagingError("template_not_found", responseMessage(error));
      return {
        status: failure.code,
        product: { id: product.id, revision: product.revision, name: product.name, template_requirement: product.template_requirement },
        templates: [],
        error: { code: failure.code, message: failure.message, scope: "batch", candidates: failure.candidates },
      };
    }
    const candidates = await Promise.all(selected.slice(0, max).map(async (template) => {
      try {
        const outputs = await storefrontClient.templateOutputs(template.id);
        const compatible = compatibleTemplateOutputs(outputs.outputs, product).filter((output) =>
          !orientation || compatibleOutputVariantSummary(output, product) === orientation);
        return {
          id: template.id,
          name: template.name ?? null,
          output_revision_id: outputs.revision_id,
          compatible_outputs: compatible.map((output) => ({
            id: output.id,
            label: output.label ?? null,
            orientation: compatibleOutputVariantSummary(output, product) || null,
          })),
        };
      } catch (error) {
        return { id: template.id, name: template.name ?? null, compatible_outputs: [], error: responseMessage(error) };
      }
    }));
    return {
      status: "ready",
      product: { id: product.id, revision: product.revision, name: product.name, template_requirement: product.template_requirement },
      orientation: orientation ?? null,
      templates: candidates,
      truncated: selected.length > max,
    };
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
    previousSlotState,
  }: {
    templateID?: string;
    outputID: string;
    outputs?: TemplateOutput[];
    revisionID?: string;
    requestVersion?: number;
    draftId?: string;
    product?: CatalogProduct | null;
    previousSlotState?: TemplateSlotState;
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
      // Convert the outgoing template's values into the current contract's
      // stable keys. The role is an intentional transfer hint only; all
      // resulting records remain keyed by the new contract's exact slot keys.
      const draftBeforeTemplateChange = draftsRef.current.find((candidate) => candidate.id === targetDraftId);
      const sourceSlotState: TemplateSlotState = previousSlotState ?? {
        assignments: draftBeforeTemplateChange?.slotAssignments ?? {},
        transforms: draftBeforeTemplateChange?.slotTransforms ?? {},
        rolesBySlotKey: visibleSlotRoles,
      };
      const targetRolesBySlotKey = imageSlotRoles(contract.slots, browserPreviewSlotBoxes(previewDocument));
      const roleMemory = rememberSlotAssignments(
        photoRoleMemory.current,
        sourceSlotState.assignments,
        sourceSlotState.rolesBySlotKey,
      );
      rememberRoles(roleMemory);
      const transferredAssignments = rekeySlotValuesByRole({
        values: sourceSlotState.assignments,
        sourceRolesBySlotKey: sourceSlotState.rolesBySlotKey,
        targetRolesBySlotKey,
      });
      const transferredTransforms = rekeySlotValuesByRole({
        values: sourceSlotState.transforms,
        sourceRolesBySlotKey: sourceSlotState.rolesBySlotKey,
        targetRolesBySlotKey,
      });
      // Every still-empty image slot takes the photograph the shopper already
      // chose for that role on another print, and says so.
      const { assignments, prefills } = prefillSlotAssignments({
        assignments: transferredAssignments,
        memory: roleMemory,
        rolesBySlotKey: targetRolesBySlotKey,
        availablePhotoIds: photoLibraryRef.current.photos.map((photo) => photo.id),
      });
      // Filed under its published output so the proposal card can paint this
      // same artwork later without the draft being selected or refetched.
      rememberPreviewDocument(previewDocumentKey(templateID, output.id), previewDocument);
      lastSlotPrefills.current = { assignments, prefills };
      setTemplateAssignments(assignments);
      setPrefilledSlots(Object.fromEntries(prefills.map((prefill) => [prefill.slotKey, prefill.role])));
      // A carried-over photograph gets the same face-centred first framing a
      // hand-dropped one does, and only if this slot has no framing yet.
      const seeded = seededSlotTransforms(
        transferredTransforms,
        Object.fromEntries(prefills.map((prefill) => [prefill.slotKey, prefill.photoId])),
        browserPreviewSlotBoxes(previewDocument),
      );
      setSlotTransforms(seeded);
      lastBrowserPreviewTransforms.current = seeded;
      if (targetDraftId) patchDraft(targetDraftId, { slotAssignments: assignments, slotTransforms: seeded, proofState: "idle" });
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
    // A slot with no framing yet starts centred on the faces already found in
    // this photograph, which is a better first look than the middle of a
    // standing portrait; a slot that already has one is left alone.
    if (photoId) {
      setSlotTransforms((transforms) => {
        if (transforms[slotKey]) return transforms;
        const next = { ...transforms, [slotKey]: seededSlotTransform(photoId, browserPreviewSlotBoxes(browserPreviewDocumentRef.current)[slotKey] ?? null) };
        lastBrowserPreviewTransforms.current = next;
        if (selectedDraftId) patchDraft(selectedDraftId, { slotTransforms: next });
        return next;
      });
    }
    setActiveImageSlotKey(photoId ? slotKey : null);
    // A deliberate choice always wins over a carried-over default, and becomes
    // the photograph remembered for that role.
    rememberRoles(rememberPhotoRole(photoRoleMemory.current, visibleSlotRoles[slotKey] ?? null, photoId));
    setPrefilledSlots((slots) => {
      if (!(slotKey in slots)) return slots;
      const next = { ...slots };
      delete next[slotKey];
      return next;
    });
  }

  /**
   * Where a photograph dragged out of the tray lands.
   *
   * Both branches call the handler the equivalent click already calls, so a
   * drag has no assignment path of its own to drift from the visible one.
   */
  function dropPhotoOnPrintTarget(photoId: string, target: PhotoDropTarget) {
    if (target.kind === "direct_print") {
      handlePhotoAction({ type: "select", photoId });
      return;
    }
    noteShopperLookingAtSelectedDraft();
    assignTemplatePhoto(target.slotKey, photoId);
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
    // A range input's pointer-up can run from the render that started the
    // drag. Commit the latest live value rather than allowing that older prop
    // to overwrite the final zoom/focus the shopper just chose.
    const latest = lastBrowserPreviewTransforms.current[slotKey] ?? transform;
    const next = { ...lastBrowserPreviewTransforms.current, [slotKey]: latest };
    lastBrowserPreviewTransforms.current = next;
    setSlotTransforms(next);
    if (selectedDraftId) patchDraft(selectedDraftId, { slotTransforms: next, proofState: "idle" });
  }

  /**
   * The faces known for a photograph, waiting only briefly for a pass already
   * running.
   *
   * `null` means "not known yet", which is a different answer from an empty
   * array and is reported as such. The wait is capped because a crop patch is a
   * conversational turn: a shopper who said "zoom in on her face" would rather
   * hear that detection has not landed than watch the agent hang on it.
   */
  const FACE_WAIT_MS = 2000;
  async function awaitFacesForPhoto(photoId: string | null): Promise<readonly FaceBox[] | null> {
    if (!photoId) return null;
    const known = photoFacesRef.current[photoId];
    if (known) return known;
    if (photoFacesResolvedRef.current[photoId]) return [];
    const job = photoFaceJobsRef.current[photoId];
    if (!job) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      job.catch(() => [] as readonly FaceBox[]),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), FACE_WAIT_MS); }),
    ]);
    if (timer) clearTimeout(timer);
    return settled;
  }

  /**
   * The face facts published beside a slot. A photograph the detector has
   * finished with reports 0, one it has not reached reports null; conflating
   * those is how an agent ends up asserting there are no faces in a portrait.
   */
  function publishedFaceFacts(photoId: string | null) {
    if (!photoId) return faceFacts(undefined);
    return faceFacts(photoFacesRef.current[photoId] ?? (photoFacesResolvedRef.current[photoId] ? [] : null));
  }

  /** Source photograph width / height, once its pixels have been decoded. */
  function photoAspectRatio(photoId: string | null): number | null {
    const size = photoId ? imageDimensionsRef.current[photoId] ?? null : null;
    return size && size.height > 0 ? size.width / size.height : null;
  }

  function boxAspectRatio(box: { width: number; height: number } | null | undefined): number | null {
    return box && box.height > 0 ? box.width / box.height : null;
  }

  function slotCropGeometry(photoId: string | null, box: { width: number; height: number } | null | undefined) {
    return { sourceAspectRatio: photoAspectRatio(photoId), targetAspectRatio: boxAspectRatio(box) };
  }

  /**
   * One crop patch's `focusOn` turned into numbers, or honestly refused.
   *
   * Every crop entry point — set_crop, directCrop and revise_prints — goes
   * through here, so there is exactly one place that decides what "faces" means
   * and exactly one set of words for what it did.
   */
  async function resolveCropFocusPreset(options: {
    photoId: string | null;
    targetAspectRatio: number | null;
    preset: ReturnType<typeof readFocusPreset>;
    patch: CropPatchValues;
    subjectWidthPercent?: number | null;
  }): Promise<FocusPresetResult> {
    const faces = options.preset === "faces" ? await awaitFacesForPhoto(options.photoId) : (
      options.photoId
        ? photoFacesRef.current[options.photoId] ?? (photoFacesResolvedRef.current[options.photoId] ? [] : null)
        : null
    );
    return resolveFocusPreset({
      preset: options.preset,
      patch: options.patch,
      subjectWidthPercent: options.subjectWidthPercent,
      faces,
      detectionAvailable: faceDetectionAvailable(),
      targetAspectRatio: options.targetAspectRatio,
      // Read after the await: the same pass that finds the faces decodes the
      // pixels, so waiting for one has already produced the other.
      sourceAspectRatio: photoAspectRatio(options.photoId),
      hasPhoto: Boolean(options.photoId),
    });
  }

  /**
   * Visible slider changes must stay responsive. Unlike a WebMCP command, they
   * never wait for face detection: Faces either has a completed local result
   * to use now, or leaves the existing pan alone and explains why when the
   * shopper explicitly asks for it.
   */
  function resolveVisibleFramingFocus(options: {
    photoId: string | null;
    targetAspectRatio: number | null;
    preset: FocusPreset;
    zoom: number;
  }): FocusPresetResult {
    const faces = options.photoId
      ? photoFacesRef.current[options.photoId] ?? (photoFacesResolvedRef.current[options.photoId] ? [] : null)
      : null;
    return resolveFocusPreset({
      preset: options.preset,
      patch: { zoom: options.zoom },
      faces,
      detectionAvailable: faceDetectionAvailable(),
      targetAspectRatio: options.targetAspectRatio,
      sourceAspectRatio: photoAspectRatio(options.photoId),
      hasPhoto: Boolean(options.photoId),
    });
  }

  /** Apply a named focal intent whenever the shopper changes the zoom slider. */
  function applyVisibleFramingFocus(preset: FocusPreset, zoom: number, announceFailure = false) {
    const rememberFocus = () => {
      if (!framingFocusTarget) return;
      setFramingFocusByTarget((current) => ({ ...current, [framingFocusTarget]: preset }));
    };

    if (customization === "template" && activeImageSlotKey && activeSlotTransform) {
      const photoId = templateAssignments[activeImageSlotKey] ?? null;
      const box = browserPreviewSlotBoxes(browserPreviewDocumentRef.current)[activeImageSlotKey] ?? null;
      const result = resolveVisibleFramingFocus({
        photoId,
        targetAspectRatio: boxAspectRatio(box),
        preset,
        zoom,
      });
      const transform = result.focusApplied === preset
        ? slotTransformFromCropPatch(initialBrowserPreviewTransform, result.patch, slotCropGeometry(photoId, box))
        : { ...activeSlotTransform, zoom };
      changeBrowserPreviewTransform(activeImageSlotKey, transform);
      rememberFocus();
      if (announceFailure && result.focusApplied !== preset) {
        setNotice({ tone: "info", message: result.note });
      }
      return;
    }

    const photoId = selectedPhoto?.id ?? null;
    const result = resolveVisibleFramingFocus({
      photoId,
      targetAspectRatio: boxAspectRatio(selectedProduct?.physical_output ?? null),
      preset,
      zoom,
    });
    const nextFocusX = result.focusApplied === preset ? result.patch.focusX ?? cropX : cropX;
    const nextFocusY = result.focusApplied === preset ? result.patch.focusY ?? cropY : cropY;
    noteShopperLookingAtSelectedDraft();
    setCropZoom(zoom);
    setCropX(nextFocusX);
    setCropY(nextFocusY);
    if (selectedDraftId) patchDraft(selectedDraftId, {
      directCrop: { zoom, focusX: nextFocusX, focusY: nextFocusY },
    });
    rememberFocus();
    if (announceFailure && result.focusApplied !== preset) {
      setNotice({ tone: "info", message: result.note });
    }
  }

  /** The honesty fields. `focus_applied` is the only licence to claim framing. */
  function focusWire(result: FocusPresetResult) {
    return {
      focus_applied: result.focusApplied,
      focus_note: result.note,
      faces_detected: result.facesDetected,
      subject_region: result.subjectRegion,
      explicit_overrides: result.explicitOverrides,
      requested_subject_width_percent: result.requestedSubjectWidthPercent,
      achieved_subject_width_percent: result.achievedSubjectWidthPercent,
      subject_width_clamped: result.subjectWidthClamped,
    };
  }

  /**
   * The starting framing for a photograph newly dropped into a slot: centred on
   * the faces when they are already known, and the flat frame otherwise.
   *
   * Only ever used at the moment of assignment. Nothing here re-crops a slot
   * later, because a shopper may already have looked at or moved it.
   */
  function seededSlotTransform(
    photoId: string | null,
    box: { width: number; height: number } | null,
  ): BrowserPreviewTransform {
    const faces = photoId ? photoFacesRef.current[photoId] ?? null : null;
    const subject = subjectRegionFromFaces(faces);
    const target = boxAspectRatio(box);
    const source = photoAspectRatio(photoId);
    if (!subject || !target || !source) return initialBrowserPreviewTransform;
    const crop = defaultCropForSubject(subject, target, source);
    return crop
      ? slotTransformFromCropPatch(
        initialBrowserPreviewTransform,
        { zoom: crop.zoom, focusX: crop.focusX, focusY: crop.focusY },
        { sourceAspectRatio: source, targetAspectRatio: target },
      )
      : initialBrowserPreviewTransform;
  }

  /**
   * Seed a starting framing for every slot that has just been given a
   * photograph and has none yet.
   *
   * Deliberately additive: a slot that already carries a transform keeps it,
   * whether that came from the shopper's own drag or from an earlier seed. That
   * is the whole retroactivity rule — a crop is seeded once, at the moment the
   * photograph lands, and faces that arrive later never move a frame somebody
   * may already have looked at or adjusted.
   */
  function seededSlotTransforms(
    existing: Record<string, BrowserPreviewTransform>,
    assignments: Record<string, string>,
    boxes: Record<string, { width: number; height: number }>,
  ): Record<string, BrowserPreviewTransform> {
    const next = { ...existing };
    for (const [slotKey, photoId] of Object.entries(assignments)) {
      if (next[slotKey]) continue;
      const seeded = seededSlotTransform(photoId, boxes[slotKey] ?? null);
      if (seeded !== initialBrowserPreviewTransform) next[slotKey] = seeded;
    }
    return next;
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

  /**
   * The image slots of any draft, on screen or not, with everything needed to
   * aim a crop at one and to judge it.
   *
   * Read from that draft's *own* resolved artwork rather than the workbench's,
   * so a print waiting in the draft rail describes itself truthfully. The slot
   * boxes are the published printed sizes in inches, which is what makes an
   * effective-PPI figure a fact rather than an estimate.
   */
  function draftImageSlotFacts(draft: PrintDraft) {
    if (!draft.template) return [];
    const document = previewDocumentsRef.current[previewDocumentKey(draft.template.id, draft.template.outputId)] ?? null;
    const boxes = browserPreviewSlotBoxes(document);
    const keys = [...new Set([
      ...(document?.input_slots ?? []).map((slot) => slot.slot_key),
      ...Object.keys(boxes),
      ...Object.keys(draft.slotAssignments),
      ...Object.keys(draft.slotTransforms),
    ])];
    const slots = keys.map((key) => ({ key }));
    const aliases = deriveImageSlotAliases(slots, boxes);
    const roles = photoRolesBySlotKey(keys.map((key) => ({ key, aliases: aliases[key], box: boxes[key] ?? null })));
    return keys.map((key) => ({
      key,
      aliases: aliases[key] ?? [],
      role: roles[key] ?? null,
      box: boxes[key] ?? null,
      photoId: draft.slotAssignments[key] ?? null,
      crop: cropPatchFromSlotTransform(
        draft.slotTransforms[key] ?? initialBrowserPreviewTransform,
        slotCropGeometry(draft.slotAssignments[key] ?? null, boxes[key] ?? null),
      ),
      // What the detector has to say about the assigned photograph, so an agent
      // can aim its own focus point — or know there is nothing to aim at.
      faceFacts: publishedFaceFacts(draft.slotAssignments[key] ?? null),
    }));
  }

  /**
   * A draft reduced to the geometry the review reads. A direct print has no
   * published slots, so the printed product itself is the one slot.
   */
  function draftReviewSlots(draft: PrintDraft): ReviewSlot[] {
    const product = productForDraft(draft);
    const spec = draft.template ? bundledTemplateSpec(draft.template.id) : null;
    const publishedPpi = spec ? specMinimumEffectivePpi(spec) : null;
    const publishedMargin = spec ? specImportantContentMargin(spec) : null;

    if (!draft.template) {
      const photoId = draft.photoIds[0] ?? null;
      const focus = directCropFocus(draft.directCrop);
      const output = product?.physical_output ?? null;
      return [{
        slotKey: null,
        label: product?.name ?? null,
        printedSizeIn: output ? { width: output.width, height: output.height } : null,
        photoPixels: photoId ? imageDimensionsRef.current[photoId] ?? null : null,
        minimumEffectivePpi: null,
        requiredAspectRatio: output ? { width: output.width, height: output.height } : null,
        importantContentMargin: null,
        faces: photoId ? photoFacesRef.current[photoId] ?? null : null,
        crop: { zoom: draft.directCrop.zoom, focusX: focus.focusX, focusY: focus.focusY },
      }];
    }

    return draftImageSlotFacts(draft)
      .filter((slot) => slot.photoId)
      .map((slot) => ({
        slotKey: slot.key,
        label: slot.aliases[0] ?? null,
        printedSizeIn: slot.box,
        photoPixels: slot.photoId ? imageDimensionsRef.current[slot.photoId] ?? null : null,
        minimumEffectivePpi: publishedPpi,
        requiredAspectRatio: slot.box,
        importantContentMargin: publishedMargin,
        faces: slot.photoId ? photoFacesRef.current[slot.photoId] ?? null : null,
        crop: { zoom: slot.crop.zoom, focusX: slot.crop.focusX, focusY: slot.crop.focusY },
      }));
  }

  /** The geometry verdict for one draft, computed fresh from visible state. */
  function reviewForDraft(draft: PrintDraft): PrintReview {
    return reviewPrint(draftReviewSlots(draft));
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
  /**
   * The one way the proposal deck changes.
   *
   * The ref is authoritative and is written synchronously, so two tool calls
   * landing in the same tick — an agent staging "images 8-20 and 41-48" as two
   * calls — both see every card already waiting. Reading React's rendered
   * `proposalStack` here instead let the second call miss the first one's cards
   * and tell the shopper's agent a smaller deck than the deck it could see.
   */
  function commitProposalStack(
    next: (entries: readonly CartProposalStackEntry[]) => CartProposalStackEntry[],
  ): CartProposalStackEntry[] {
    const committed = next(proposalStackRef.current);
    proposalStackRef.current = committed;
    setProposalStack(committed);
    return committed;
  }

  /** The proposals waiting right now, including any staged earlier this tick. */
  function livePendingProposals(): CartProposal[] {
    return pendingCartProposals(proposalStackRef.current);
  }

  function proposeDraft(draft: PrintDraft, quantity: number): { proposal: CartProposal; duplicate: boolean } {
    const standing = pendingCartProposalForDraft(proposalStackRef.current, draft.id);
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
    commitProposalStack((entries) => [...entries, { proposal, exit: null }]);
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
    // Marked answered at once, so a second call in the same tick — and every
    // count reported back to the agent — already treats these as resolved.
    commitProposalStack((entries) => entries.map((entry) =>
      answered.has(entry.proposal.id) && !entry.exit ? { ...entry, exit: decision } : entry));
    const timer = setTimeout(() => {
      // The card has played its exit; drop it for good. Filtering by id means a
      // straggler cannot survive an overlapping resolution of another card.
      commitProposalStack((entries) => entries.filter((entry) => !answered.has(entry.proposal.id)));
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
  }, [canAddAnyVisibleDraft, cartPrintCount, catalogState, pendingProposals, customization, photoLibrary, selectedProduct, selectedProductId, selectedTemplate, templateAssignments, templateContract, templateOutput, visibleTemplateSlots]);

  useEffect(() => subscribeToStorefrontWebMcpActions((request) => {
    /**
     * The workbench as it stands before this action touches anything.
     *
     * Taken here, at the one point every bridge action passes through, and
     * before any branch has run — a snapshot taken inside a handler would
     * already contain half the change it is supposed to undo. It is only
     * *recorded* once the response says something actually changed, so a
     * refused call and a batch that staged nothing leave no empty undo step.
     *
     * History traversal is deliberately excluded: undo and redo already own
     * their opposite-stack entries, so recording either would fork history.
     */
    const preMutation = isMutatingAgentAction(request.action)
      && request.action !== "undo_last_change"
      && request.action !== "redo_last_change"
      ? { label: agentActionLabel(request.action, request.input), state: captureWorkbenchState() }
      : null;
    /**
     * Answers the agent, and — for a mutation, and only for a mutation — files
     * the undo step and tells the shopper what just happened to their screen.
     *
     * The single mapping from action plus result to a line of text lives in
     * `agent-activity.ts`; nothing here decides wording, and no branch below
     * fires a toast of its own. Read-only actions keep calling the imported
     * responder directly, so they cannot announce anything by accident.
     */
    const respondWithActivity = (response: { requestId: string; result: unknown }) => {
      const activity = agentActivity(request.action, request.input, response.result);
      if (activity?.undoable && preMutation) {
        workbenchHistory.current.push(preMutation.label, preMutation.state);
      }
      respondToStorefrontWebMcpAction(response);
      if (activity) announceAgentActivity(activity);
    };
    void (async () => {
      try {
        if (request.action === "ask_storefront") {
          const templateCompatibility = await requestedTemplateCompatibilityProjection(request.input);
          // Read after the await, so the answer describes the deck as it stands
          // when the agent is told about it rather than one render earlier.
          const askPendingProposals = livePendingProposals();
          respondToStorefrontWebMcpAction({ requestId: request.requestId, result: {
            answer: "This storefront works from the visible left-to-right tray and local print drafts. Its cart and checkout are a browser-local demo: nothing is fulfilled, charged, or ordered.",
            state: {
              tray: { revision: photoLibrary.revision, photos: photoLibrary.photos.map((photo, index) => ({ photo_id: photo.id, position: index + 1, filename: photo.filename })) },
              selection: { product_id: selectedProductId, template_id: selectedTemplate?.id ?? null, output_id: templateOutput?.id ?? null, active_draft_id: selectedDraftId, preview_source: browserPreviewDocument ? browserPreviewDocument.preview_source ?? "published" : null },
              // Every draft, not only the selected one, reports its framing in
              // the set_crop vocabulary revise_prints and configure_print
              // accept. A shopper's hand adjustment commits into the draft on
              // mouse release, so this is readable the moment they let go —
              // which is what makes "frame the others like this" answerable.
              drafts: drafts.map((draft) => {
                const review = reviewForDraft(draft);
                return {
                  draft_id: draft.id,
                  product_id: draft.productId,
                  product_revision: draft.productRevision,
                  product_name: productForDraft(draft)?.name ?? null,
                  photo_ids: draft.photoIds,
                  template: draft.template ?? null,
                  proof_state: draft.proofState,
                  on_screen: draft.id === selectedDraftId,
                  placed: backgroundDraftIds.current.has(draft.id) ? "draft_rail" : "on_screen",
                  image_slots: draftImageSlotFacts(draft).map((slot) => ({
                    slot_key: slot.key,
                    aliases: slot.aliases,
                    role: slot.role,
                    assigned_photo_id: slot.photoId,
                    crop: slot.crop,
                    // faces_detected is null while the local pass is still
                    // running: not yet known, not "none there".
                    ...slot.faceFacts,
                  })),
                  direct_crop: draft.template ? null : visibleDirectCrop(draft),
                  // A direct print has no published slots, so its one
                  // photograph's face facts are reported on the draft itself.
                  direct_photo: draft.template ? null : {
                    photo_id: draft.photoIds[0] ?? null,
                    ...publishedFaceFacts(draft.photoIds[0] ?? null),
                  },
                  // What adding this draft would do to the cart, and whether it
                  // is already spoken for by a card or a line.
                  pending_proposal_id: livePendingProposals().find((proposal) => proposal.draftId === draft.id)?.id ?? null,
                  cart_quantity: cart.filter((item) => item.draftId === draft.id).reduce((total, item) => total + item.quantity, 0),
                  review: printReviewWire(review),
                };
              }),
              template_slots: visibleTemplateSlots.map((slot) => ({
                key: slot.key,
                kind: slot.kind,
                required: slot.required,
                published_required: templateContract?.slots.find((candidate) => candidate.key === slot.key)?.required ?? slot.required,
                assigned_photo_id: slot.kind === "image" ? templateAssignments[slot.key] ?? null : null,
                value: slot.kind === "text" ? templateInputs[slot.key] ?? "" : null,
                label: slot.suggested_label ?? null,
                aliases: (slot.kind === "image" ? visibleSlotAliases[slot.key] : visibleTextAliases[slot.key]) ?? [],
                max_length: slot.kind === "text" ? slot.max_length ?? null : null,
                role: slot.kind === "image" ? visibleSlotRoles[slot.key] ?? null : null,
                prefilled_from: prefilledSlots[slot.key] ? prefillProvenance(prefilledSlots[slot.key]!) : null,
                // The set_crop values that reproduce the visible framing, so a
                // relative crop request can be computed rather than guessed.
                crop: slot.kind === "image"
                  ? cropPatchFromSlotTransform(
                    slotTransforms[slot.key] ?? initialBrowserPreviewTransform,
                    slotCropGeometry(templateAssignments[slot.key] ?? null, browserPreviewSlotBoxes(browserPreviewDocument)[slot.key] ?? null),
                  )
                  : null,
                ...(slot.kind === "image"
                  ? publishedFaceFacts(templateAssignments[slot.key] ?? null)
                  : { faces_detected: null, subject_region: null }),
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
              pending_proposals: cartProposalWireItems(askPendingProposals).map((item, index) => ({
                ...item,
                // The card's own chip, in words, so "accept the ready ones" can
                // be planned from this list without re-deriving anything.
                review: printReviewWire(reviewForDraft(askPendingProposals[index]!.draft)),
                found_in_catalog: backgroundDraftIds.current.has(item.draft_id),
              })),
              pending_proposal_count: livePendingProposals().length,
              // How the deck breaks down, which is what accept_ready acts on.
              proposal_review_summary: reviewCounts(askPendingProposals.map((proposal) => reviewForDraft(proposal.draft))),
              last_proposal_outcome: lastProposalOutcome
                ? { proposal_id: lastProposalOutcome.proposalId, draft_id: lastProposalOutcome.draftId, product_name: lastProposalOutcome.productName, quantity: lastProposalOutcome.quantity, decision: lastProposalOutcome.decision }
                : null,
              // Bounded compatibility reconnaissance for a named template and
              // product. It contains no contract or preview document payload.
              template_compatibility: templateCompatibility,
            },
            guidance: askPendingProposals.length > 0
              ? `${askPendingProposals.length} proposal card${askPendingProposals.length === 1 ? " is" : "s are"} waiting; ask the shopper to accept or reject ${askPendingProposals.length === 1 ? "it" : "them"}, then call resolve_cart_proposal with their answer — one proposalId at a time, accept_all or reject_all when they answer the whole stack at once, or accept_ready when they take only the cards the review calls ready. Say which cards are flagged and why before asking: proposal_review_summary counts them and each card's review carries the reason in words.`
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
          // Read-only with respect to navigation. Looking up catalog facts is a
          // question, not a request to be moved: an earlier iteration switched
          // the visible step to the format chooser here, which yanked a shopper
          // mid-crop off the print they were holding every time the agent
          // checked a size. The banner below is the whole visible footprint now.
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
          const namedDraft = requestedDraftId ? draftsRef.current.find((draft) => draft.id === requestedDraftId) : null;
          if (requestedDraftId && !namedDraft) throw new Error("That visible draft no longer exists. Create a new print configuration instead.");
          // A patch that names no draft and no photograph — "put SPARTANS on the
          // team line" — is aimed at the print the shopper is already looking
          // at. Only a genuinely new draft needs a photograph chosen for it.
          const patchesOnly = Array.isArray(request.input.slotPatches)
            && request.input.slotPatches.length > 0
            && (!Array.isArray(request.input.photoRefs) || request.input.photoRefs.length === 0);
          const impliedDraft = !namedDraft && patchesOnly && selectedDraftId
            ? draftsRef.current.find((draft) => draft.id === selectedDraftId) ?? null
            : null;
          const existingDraft = namedDraft ?? impliedDraft;
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
          if (photos.length === 0 && !existingDraft && !roleDefault) throw new Error("Choose at least one photograph from the visible tray, or name the draft to revise with draftId.");
          const photoIds = photos.length > 0
            ? photos.map((photo) => photo.id)
            : roleDefault ? [roleDefault.photoId] : existingDraft!.photoIds;
          const draft = existingDraft
            ? patchPrintDraft(existingDraft, { photoIds, proofState: "idle" })
            : createPrintDraft(product, photoIds);
          let finalDraft = draft;
          let responseContract: TemplateContract | null = null;
          let appliedPrefills: SlotPrefill[] = [];
          // What each focusOn in this call actually resolved to. Reported per
          // slot in the response, because a preset can succeed on one slot and
          // find nothing on another in the very same patch.
          let directCropFocusReport: FocusPresetResult | null = null;
          const slotFocusReports: Record<string, FocusPresetResult> = {};
          setDrafts((items) => existingDraft ? items.map((item) => item.id === draft.id ? draft : item) : [...items, draft]);
          // A shopper customizing a print by hand keeps the screen. Their "add a
          // 5x7 of image 6" asks for a second print, not for the memory mate
          // they are working on to be taken away from them; that 5x7 is made in
          // the draft rail and the proposal card is their whole view of it.
          const placement: DraftPlacement = agentDraftPlacement(shopperViewRef.current, selectedDraftId, draft.id);
          const onScreen = placement === "on_screen";
          // Remembered so a proposal card for this draft can say the print was
          // found in the catalog rather than chosen on screen.
          if (onScreen) backgroundDraftIds.current.delete(draft.id);
          else backgroundDraftIds.current.add(draft.id);
          // Read before the workbench is touched, because whether the loaded
          // template can be kept depends on what this call is asking for.
          let requestedTemplateId = typeof request.input.templateId === "string" ? request.input.templateId : undefined;
          const requestedTemplateQuery = typeof request.input.templateQuery === "string" ? request.input.templateQuery.trim() || undefined : undefined;
          const requestedOutputId = typeof request.input.outputId === "string" ? request.input.outputId : undefined;
          const requestedOrientation = request.input.orientation === "portrait" || request.input.orientation === "landscape" ? request.input.orientation : undefined;
          if (requestedTemplateQuery) {
            const activeTemplates = templates.length > 0 ? templates : (await storefrontClient.templates()).items;
            requestedTemplateId = resolveRequestedBatchTemplate(activeTemplates, { templateQuery: requestedTemplateQuery })[0]!.id;
          }
          const loadedTemplate: PrintDraft["template"] | null =
            selectedTemplateId && templateOutput && templateOutputsRevisionID
              ? { id: selectedTemplateId, outputId: templateOutput.id, revisionId: templateOutputsRevisionID }
              : null;
          /**
           * True when the workbench is already showing exactly this draft, on
           * this product, with this template output composed and painted.
           *
           * Reframing a slot on the print the shopper is holding must not tear
           * that preview down. Both selectProduct and chooseTemplate null
           * browserPreviewDocument and then await the network, and prepare-step
           * falls back to the raw photograph whenever that document is null — so
           * a crop patch used to flash the full-bleed picture for a frame or two
           * before the composed template came back. Keeping the loaded template
           * means a set_crop touches slot transforms and nothing else.
           */
          const reusesLoadedTemplate = Boolean(
            onScreen &&
            existingDraft &&
            selectedDraftId === draft.id &&
            selectedProduct &&
            productSelectionKey(selectedProduct) === productSelectionKey(product) &&
            product.template_requirement !== "unsupported" &&
            loadedTemplate &&
            templateContract &&
            browserPreviewDocumentRef.current &&
            existingDraft.template?.id === loadedTemplate.id &&
            existingDraft.template?.outputId === loadedTemplate.outputId &&
            (!requestedTemplateId || requestedTemplateId === loadedTemplate.id) &&
            (!requestedOutputId || requestedOutputId === loadedTemplate.outputId) &&
            (!requestedOrientation || compatibleOutputVariantSummary(templateOutput!, product) === requestedOrientation),
          );
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
            // reason to move them — and when the print is already the one they
            // are holding, it is not a reason to reload anything either.
            if (!reusesLoadedTemplate) {
              selectProduct(product, false, false);
              dispatchPhotoLibrary({ type: "select", photoId: photoIds[0] ?? null });
            }
          }
          // Left untouched for a background draft: the shopper-view context
          // still names the print they are holding, so add_to_cart sees this one
          // as never having been on screen and goes to the proposal card.
          const directCrop = request.input.directCrop && typeof request.input.directCrop === "object" ? request.input.directCrop as Record<string, unknown> : null;
          if (directCrop) {
            // focusOn is resolved before the numbers are merged, so a preset
            // that could not be honoured leaves the caller's own values —
            // including none at all — exactly where they were.
            const resolvedFocus = await resolveCropFocusPreset({
              photoId: photoIds[0] ?? draft.photoIds[0] ?? null,
              targetAspectRatio: boxAspectRatio(product.physical_output),
              preset: readFocusPreset(directCrop),
              subjectWidthPercent: readSubjectWidthPercent(directCrop),
              patch: {
                zoom: typeof directCrop.zoom === "number" ? directCrop.zoom : undefined,
                focusX: typeof directCrop.focusX === "number" ? directCrop.focusX : undefined,
                focusY: typeof directCrop.focusY === "number" ? directCrop.focusY : undefined,
                offsetX: typeof directCrop.offsetX === "number" ? directCrop.offsetX : undefined,
                offsetY: typeof directCrop.offsetY === "number" ? directCrop.offsetY : undefined,
              },
            });
            directCropFocusReport = resolvedFocus;
            const patch = resolvedFocus.patch;
            const nextCrop = {
              zoom: patch.zoom ?? draft.directCrop.zoom,
              focusX: patch.focusX ?? draft.directCrop.focusX,
              focusY: patch.focusY ?? draft.directCrop.focusY,
              // A face-centred focus carries the whole pan, so a stale offset
              // would slide the face straight back out of the middle.
              offsetX: patch.offsetX ?? (resolvedFocus.focusApplied === "faces" ? 0 : draft.directCrop.offsetX),
              offsetY: patch.offsetY ?? (resolvedFocus.focusApplied === "faces" ? 0 : draft.directCrop.offsetY),
            };
            if (onScreen) { setCropZoom(nextCrop.zoom); setCropX(nextCrop.focusX); setCropY(nextCrop.focusY); }
            finalDraft = patchPrintDraft(finalDraft, { directCrop: nextCrop });
            patchDraft(draft.id, { directCrop: nextCrop });
          }
          // On screen, the workbench loads the template and repaints. In the
          // draft rail, the same facts are resolved as a pure read so nothing
          // the shopper is looking at changes.
          let offScreenTemplate: OffScreenTemplate | null = null;
          let templateForPatch: PrintDraft["template"] | null = null;
          if (product.template_requirement !== "unsupported") {
            if (reusesLoadedTemplate) {
              // Already composed and on screen: keep it exactly as it is.
              templateForPatch = loadedTemplate;
            } else if (!onScreen) {
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
          if (product.template_requirement === "required" && !templateForPatch) {
            throw new Error("No active server template has a compatible published output for this required product.");
          }
          if ((requestedTemplateId || requestedOutputId) && !templateForPatch) {
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
            rememberRoles(rememberDirectPhoto(photoRoleMemory.current, product.physical_output, photoIds[0]));
          }
          // The prefills that were applied belong to whichever path resolved the
          // template: the workbench's own load, or the off-screen read.
          const resolvedPrefills = () => offScreenTemplate
            ? { prefills: offScreenTemplate.prefills, assignments: offScreenTemplate.assignments }
            // Nothing was loaded, so nothing was prefilled by this call. Reading
            // the last load's prefills here would let a stale default overwrite
            // a slot the shopper has since filled by hand.
            : reusesLoadedTemplate ? { prefills: [], assignments: draft.slotAssignments }
              : lastSlotPrefills.current;
          if (templateForPatch && slotPatches.length === 0) {
            const contract = offScreenTemplate?.contract
              // The loaded contract belongs to this exact output; refetching it
              // would only add a round trip to a patch that changes no template.
              ?? (reusesLoadedTemplate ? templateContract : null)
              ?? await storefrontClient.templateContract(templateForPatch.id, templateForPatch.outputId, templateForPatch.revisionId);
            responseContract = contract;
            // Selecting an existing draft must restore its own saved inputs,
            // never silently replace them with every tray image. An untouched
            // draft keeps the role defaults the loaded output just prefilled.
            appliedPrefills = resolvedPrefills().prefills;
            const assignments = appliedPrefills.length > 0 ? resolvedPrefills().assignments : draft.slotAssignments;
            // Slots filled by this call — a role prefill, or the draft's own
            // photographs landing on a freshly resolved output — start centred
            // on any faces already known. Slots that already carry a framing
            // are untouched, including one the shopper has moved by hand.
            const seededTransforms = seededSlotTransforms(
              draft.slotTransforms,
              assignments,
              contractSlotBoxes(contract, responseDocument),
            );
            if (onScreen) {
              setTemplateAssignments(assignments);
              setTemplateInputs(draft.textValues);
              setSlotTransforms(seededTransforms);
              lastBrowserPreviewTransforms.current = seededTransforms;
            }
            const contractPatch: Parameters<typeof patchPrintDraft>[1] = {
              template: templateForPatch,
              templateContractKnown: true,
              requiredSlotKeys: effectiveRequiredTemplateSlotKeys(product, contract.slots),
              slotAssignments: assignments,
              slotTransforms: seededTransforms,
            };
            finalDraft = patchPrintDraft(finalDraft, contractPatch);
            patchDraft(draft.id, contractPatch);
          }
          if (templateForPatch && slotPatches.length > 0) {
            const contract = offScreenTemplate?.contract
              // The loaded contract belongs to this exact output; refetching it
              // would only add a round trip to a patch that changes no template.
              ?? (reusesLoadedTemplate ? templateContract : null)
              ?? await storefrontClient.templateContract(templateForPatch.id, templateForPatch.outputId, templateForPatch.revisionId);
            responseContract = contract;
            appliedPrefills = resolvedPrefills().prefills;
            const assignments = { ...(appliedPrefills.length > 0 ? resolvedPrefills().assignments : draft.slotAssignments) };
            const values = { ...draft.textValues };
            // Image and text slots keep separate vocabularies but one lookup:
            // the resolver scopes them by the operation's kind, so the same
            // word may name a photograph slot and a printed line.
            const patchAliases = { ...imageSlotAliasesForContract(contract, responseDocument), ...textSlotAliases(contract.slots) };
            const patchBoxes = contractSlotBoxes(contract, responseDocument);
            // Any prefilled slot is seeded before the explicit patches run, so
            // an explicit set_crop in the same call still has the last word.
            const transforms = seededSlotTransforms(draft.slotTransforms, assignments, patchBoxes);
            const patchRoles = imageSlotRoles(contract.slots, patchBoxes);
            const explicitAssignments: Record<string, string> = {};
            for (const patch of slotPatches) {
              // The kind the operation needs is settled before anything is
              // matched, so "team" reaches the printed team line for a set_text
              // and the team photograph for an assign or a crop.
              const requiredKind = slotPatchRequiredKind(patch.operation);
              if (!requiredKind) throw new Error("Unknown slot patch operation.");
              const resolution = resolveSlotPatchTarget(contract.slots, patch, patchAliases, requiredKind);
              if (resolution.kind !== "resolved") {
                throw new Error(resolution.reason === "no_match"
                  ? `No visible ${requiredKind} slot matches that patch; name an exact published ${requiredKind} slot key, its published label, or an alias published beside it.`
                  : `That patch names more than one visible ${requiredKind} slot; use its exact published slot key.`);
              }
              const slot = resolution.slot;
              if (patch.operation === "assign") {
                if (slot.kind !== "image" || (typeof patch.photoRef !== "string" && typeof patch.photoRef !== "number")) throw new Error(`Assign requires a tray photo for image slot ${slot.key}.`);
                const photo = resolvePhotoReference(photoLibrary.photos, patch.photoRef);
                if (photo.kind !== "resolved") throw new Error(`Photo reference for ${slot.key} is not uniquely visible in the tray.`);
                assignments[slot.key] = photo.photo.id;
                explicitAssignments[slot.key] = photo.photo.id;
                // A photograph arriving in an unframed slot gets the same
                // face-centred start a hand-dropped one gets.
                if (!transforms[slot.key]) {
                  const seeded = seededSlotTransform(photo.photo.id, patchBoxes[slot.key] ?? null);
                  if (seeded !== initialBrowserPreviewTransform) transforms[slot.key] = seeded;
                }
              } else if (patch.operation === "unassign") {
                if (slot.kind !== "image") throw new Error(`Only image slot ${slot.key} can be unassigned.`);
                delete assignments[slot.key];
              } else if (patch.operation === "set_text") {
                if (slot.kind !== "text" || typeof patch.text !== "string") throw new Error(`set_text requires text for ${slot.key}.`);
                // The template's own limit when it publishes one; otherwise the
                // storefront's cap, so text no proof could carry is refused
                // here rather than printed silently.
                const { limit, published } = textSlotLengthLimit(slot);
                if (patch.text.length > limit) {
                  throw new Error(published
                    ? `Text for ${slot.key} is ${patch.text.length} characters; this template publishes a max_length of ${limit}.`
                    : `Text for ${slot.key} is ${patch.text.length} characters; this template publishes no max_length, so the storefront caps text slots at ${limit}.`);
                }
                values[slot.key] = patch.text;
              } else if (patch.operation === "set_crop") {
                if (slot.kind !== "image") throw new Error(`set_crop applies only to image slot ${slot.key}.`);
                // The photograph this crop actually lands on — including one
                // assigned by an earlier patch in this same call, which is what
                // makes "use photo 3 here and frame her face" a single turn.
                const resolvedFocus = await resolveCropFocusPreset({
                  photoId: assignments[slot.key] ?? null,
                  targetAspectRatio: boxAspectRatio(patchBoxes[slot.key] ?? null),
                  preset: readFocusPreset(patch),
                  subjectWidthPercent: readSubjectWidthPercent(patch),
                  patch: {
                    zoom: typeof patch.zoom === "number" ? patch.zoom : undefined,
                    focusX: typeof patch.focusX === "number" ? patch.focusX : undefined,
                    focusY: typeof patch.focusY === "number" ? patch.focusY : undefined,
                    offsetX: typeof patch.offsetX === "number" ? patch.offsetX : undefined,
                    offsetY: typeof patch.offsetY === "number" ? patch.offsetY : undefined,
                  },
                });
                slotFocusReports[slot.key] = resolvedFocus;
                transforms[slot.key] = slotTransformFromCropPatch(
                  // A resolved face focus is absolute, not a nudge: it starts
                  // from the flat frame so a previous pan cannot add itself in.
                  resolvedFocus.focusApplied === "faces" ? initialBrowserPreviewTransform : transforms[slot.key] ?? initialBrowserPreviewTransform,
                  resolvedFocus.patch,
                  {
                    sourceAspectRatio: photoAspectRatio(assignments[slot.key] ?? null),
                    targetAspectRatio: boxAspectRatio(patchBoxes[slot.key] ?? null),
                  },
                );
              } else throw new Error("Unknown slot patch operation.");
            }
            // An explicit patch is the shopper's own instruction: it overrides a
            // carried-over default and becomes the photograph remembered for
            // that role.
            rememberRoles(rememberSlotAssignments(photoRoleMemory.current, explicitAssignments, patchRoles));
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
          const responseTextAliases = responseContract ? textSlotAliases(responseContract.slots) : {};
          // A bare slot key invites the agent to guess a photograph. Naming the
          // role and writing the question out invites it to ask the shopper.
          const missingDetail = describeMissingRequirements(
            missingRequirements,
            responseContract?.slots ?? [],
            responseSlotAliases,
          );
          respondWithActivity({ requestId: request.requestId, result: {
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
                crop: cropPatchFromSlotTransform(
                  finalDraft.slotTransforms[slot.key] ?? initialBrowserPreviewTransform,
                  slotCropGeometry(assignedPhotoId, contractSlotBoxes(responseContract, responseDocument)[slot.key] ?? null),
                ),
                // The detector's own facts about the assigned photograph.
                ...publishedFaceFacts(assignedPhotoId),
                // What a focusOn on this slot actually did, if one was asked
                // for. Only focus_applied "faces" means the crop is centred on
                // a face: say nothing stronger than this field does.
                focus: slotFocusReports[slot.key] ? focusWire(slotFocusReports[slot.key]!) : null,
              };
            }) ?? [],
            // The printed lines as they now stand, so a set_text is confirmed
            // by the same response that made it rather than by a second read.
            text_slots: responseContract?.slots.filter((slot) => slot.kind === "text").map((slot) => ({
              slot_key: slot.key,
              label: slot.suggested_label ?? null,
              aliases: responseTextAliases[slot.key] ?? [],
              required: effectiveTemplateSlotRequired(product, slot),
              value: finalDraft.textValues[slot.key] ?? "",
              // The published limit when there is one; null means the
              // storefront's own cap applies.
              max_length: slot.max_length ?? null,
            })) ?? [],
            direct_crop: visibleDirectCrop(finalDraft),
            direct_photo: finalDraft.template ? null : {
              photo_id: finalDraft.photoIds[0] ?? null,
              ...publishedFaceFacts(finalDraft.photoIds[0] ?? null),
            },
            direct_crop_focus: directCropFocusReport ? focusWire(directCropFocusReport) : null,
            // Geometry only — resolution, zoom, trim proximity and aspect. A
            // needs_review verdict is a reason to show the shopper, never a
            // refusal to proceed.
            review: printReviewWire(reviewForDraft(finalDraft)),
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
        if (request.action === "revise_prints") {
          // The whole point of the tool: a framing the shopper approved on one
          // print, applied to the others through the same patch path
          // configure_print's set_crop uses, so there is no second crop
          // vocabulary to drift from the visible one.
          const requestedIds = requireIdentifierListAlias(
            request.input,
            "draftIds",
            "draft_ids",
            "revise_prints requires the IDs of the visible drafts to reframe.",
          );
          const crop = request.input.crop && typeof request.input.crop === "object"
            ? request.input.crop as Record<string, unknown>
            : null;
          const cropValue = (key: string) => typeof crop?.[key] === "number" ? crop[key] as number : undefined;
          const cropPatch: CropPatchValues = {
            zoom: cropValue("zoom"),
            focusX: cropValue("focusX"),
            focusY: cropValue("focusY"),
            offsetX: cropValue("offsetX"),
            offsetY: cropValue("offsetY"),
          };
          // focusOn is a crop value in its own right: "frame the others on the
          // faces too" carries no numbers at all, because each print's faces
          // are somewhere different.
          const cropPreset = readFocusPreset(crop);
          const subjectWidthPercent = readSubjectWidthPercent(crop);
          if (!cropPreset && subjectWidthPercent === null && Object.values(cropPatch).every((value) => value === undefined)) {
            throw new Error("revise_prints needs at least one crop value to propagate: focusOn, subjectWidthPercent, zoom, focusX, focusY, offsetX, or offsetY.");
          }
          const selector = request.input.slotSelector && typeof request.input.slotSelector === "object"
            ? request.input.slotSelector as Record<string, unknown>
            : {};
          const wantedRole = selector.role === "individual" || selector.role === "team" ? selector.role : null;
          const wantedSlotKey = typeof selector.slotKey === "string" ? selector.slotKey : undefined;
          const wantedLabel = typeof selector.label === "string" ? selector.label : undefined;

          const revised = new Map<string, PrintDraft>();
          type ReviseResult = {
            draft_id: string;
            status: "applied" | "skipped";
            reason: string | null;
            slot_key: string | null;
            crop: { zoom: number; focusX: number; focusY: number; offsetX: number; offsetY: number } | null;
            review: ReturnType<typeof printReviewWire> | null;
            /** Non-null only when this call asked for a focus preset. */
            focus: ReturnType<typeof focusWire> | null;
          };
          // Sequential rather than mapped, because a focus preset may have to
          // wait on that draft's own photograph before it knows any numbers.
          const reviseResults: ReviseResult[] = [];
          for (const rawId of requestedIds) {
            reviseResults.push(await (async (): Promise<ReviseResult> => {
            const draftId = typeof rawId === "string" ? rawId : String(rawId);
            const draft = draftsRef.current.find((candidate) => candidate.id === draftId);
            if (!draft) {
              return { draft_id: draftId, status: "skipped", reason: "no_such_visible_draft", slot_key: null, crop: null, review: null, focus: null };
            }
            // A direct print has no published slots: the print itself is the
            // frame, so the crop lands on exactly the values the prepare-step
            // sliders and configure_print's directCrop already write.
            if (!draft.template) {
              // Resolved against *this* print's photograph: the point of a
              // preset is that each print gets its own numbers.
              const resolvedFocus = await resolveCropFocusPreset({
                photoId: draft.photoIds[0] ?? null,
                targetAspectRatio: boxAspectRatio(productForDraft(draft)?.physical_output ?? null),
                preset: cropPreset,
                subjectWidthPercent,
                patch: cropPatch,
              });
              const patch = resolvedFocus.patch;
              const nextCrop = {
                zoom: patch.zoom ?? draft.directCrop.zoom,
                focusX: patch.focusX ?? draft.directCrop.focusX,
                focusY: patch.focusY ?? draft.directCrop.focusY,
                offsetX: patch.offsetX ?? (resolvedFocus.focusApplied === "faces" ? 0 : draft.directCrop.offsetX),
                offsetY: patch.offsetY ?? (resolvedFocus.focusApplied === "faces" ? 0 : draft.directCrop.offsetY),
              };
              patchDraft(draft.id, { directCrop: nextCrop });
              if (draft.id === selectedDraftId) {
                setCropZoom(nextCrop.zoom); setCropX(nextCrop.focusX); setCropY(nextCrop.focusY);
              }
              const next = patchPrintDraft(draft, { directCrop: nextCrop });
              revised.set(draft.id, next);
              return {
                draft_id: draft.id,
                status: "applied",
                reason: null,
                slot_key: null,
                crop: visibleDirectCrop(next),
                review: printReviewWire(reviewForDraft(next)),
                focus: cropPreset ? focusWire(resolvedFocus) : null,
              };
            }

            const facts = draftImageSlotFacts(draft);
            if (facts.length === 0) {
              return { draft_id: draft.id, status: "skipped", reason: "no_image_slot_resolved_for_this_draft", slot_key: null, crop: null, review: null, focus: null };
            }
            let slotKey: string | null = null;
            let skipReason: string | null = null;
            if (wantedSlotKey || wantedLabel) {
              const resolution = resolveSlotPatchTarget(
                // Every candidate here is an image slot, and a crop can mean
                // nothing else, so the resolver is told so explicitly.
                facts.map((fact) => ({ key: fact.key, kind: "image" as const, suggested_label: null })),
                { slotKey: wantedSlotKey, label: wantedLabel },
                Object.fromEntries(facts.map((fact) => [fact.key, fact.aliases])),
                "image",
              );
              if (resolution.kind === "resolved") slotKey = resolution.slot.key;
              else if (resolution.reason === "no_match") skipReason = "no_matching_slot";
              else skipReason = resolution.reason === "ambiguous_alias" ? "ambiguous_slot_alias" : "ambiguous_slot_label";
            } else if (wantedRole) {
              const matching = facts.filter((fact) => fact.role === wantedRole);
              if (matching.length === 1) slotKey = matching[0]!.key;
              else skipReason = matching.length === 0 ? "no_matching_slot" : "ambiguous_slot_role";
            } else if (facts.length === 1) {
              slotKey = facts[0]!.key;
            } else {
              // Refusing to guess: naming the roles it does have turns this
              // into a retry the agent can make rather than a dead end.
              skipReason = `this draft has ${facts.length} image slots (${facts.map((fact) => fact.aliases[0] ?? fact.key).join(", ")}); name one with slotSelector`;
            }
            if (!slotKey) {
              return { draft_id: draft.id, status: "skipped", reason: skipReason ?? "no_matching_slot", slot_key: null, crop: null, review: null, focus: null };
            }
            const targetFact = facts.find((fact) => fact.key === slotKey) ?? null;
            const resolvedFocus = await resolveCropFocusPreset({
              photoId: targetFact?.photoId ?? null,
              targetAspectRatio: boxAspectRatio(targetFact?.box ?? null),
              preset: cropPreset,
              subjectWidthPercent,
              patch: cropPatch,
            });
            const transforms = {
              ...draft.slotTransforms,
              [slotKey]: slotTransformFromCropPatch(
                resolvedFocus.focusApplied === "faces" ? initialBrowserPreviewTransform : draft.slotTransforms[slotKey] ?? initialBrowserPreviewTransform,
                resolvedFocus.patch,
                {
                  sourceAspectRatio: photoAspectRatio(targetFact?.photoId ?? null),
                  targetAspectRatio: boxAspectRatio(targetFact?.box ?? null),
                },
              ),
            };
            patchDraft(draft.id, { slotTransforms: transforms, proofState: "idle" });
            // The workbench preview repaints only if this is the draft on it.
            if (draft.id === selectedDraftId) {
              lastBrowserPreviewTransforms.current = transforms;
              setSlotTransforms(transforms);
            }
            const next = patchPrintDraft(draft, { slotTransforms: transforms, proofState: "idle" });
            revised.set(draft.id, next);
            return {
              draft_id: draft.id,
              status: "applied",
              reason: null,
              slot_key: slotKey,
              crop: cropPatchFromSlotTransform(
                transforms[slotKey]!,
                slotCropGeometry(targetFact?.photoId ?? null, targetFact?.box ?? null),
              ),
              review: printReviewWire(reviewForDraft(next)),
              focus: cropPreset ? focusWire(resolvedFocus) : null,
            };
            })());
          }

          // A card in the deck paints a snapshot of the draft it proposed, so a
          // reframed draft has to be written back into its standing card or the
          // shopper would be answering a picture of the old framing.
          if (revised.size > 0) {
            commitProposalStack((entries) => entries.map((entry) => {
              const next = entry.exit ? null : revised.get(entry.proposal.draftId);
              return next ? { ...entry, proposal: { ...entry.proposal, draft: next } } : entry;
            }));
          }
          const applied = reviseResults.filter((result) => result.status === "applied").length;
          const skipped = reviseResults.length - applied;
          setNotice({ tone: "info", message: applied > 0
            ? `Applied the same framing to ${applied} print${applied === 1 ? "" : "s"}${skipped > 0 ? `; ${skipped} could not take it.` : "."}`
            : "No visible draft could take that framing." });
          // Every repaint — workbench preview and proposal cards — lands before
          // the agent hears back, so it never reports a change nobody can see.
          await nextPaint();
          respondWithActivity({ requestId: request.requestId, result: {
            status: applied > 0 ? "revised" : "nothing_revised",
            applied_count: applied,
            skipped_count: skipped,
            results: reviseResults,
            guidance: applied > 0
              ? `${applied} print${applied === 1 ? " now carries" : "s now carry"} that framing, and every affected preview and proposal card has repainted.${skipped > 0 ? ` ${skipped} was left alone — each says why in its own result.` : ""} Nothing was added to the demo cart and no proposal was answered.`
              : "Nothing was reframed; each result says why. Nothing was added to the demo cart.",
            nextStep: "tell_the_shopper_what_changed",
          } });
          return;
        }
        if (request.action === "propose_prints") {
          if (request.input.trayRevision !== photoLibrary.revision) throw new Error(`The photo tray changed; use visible tray revision ${photoLibrary.revision}.`);
          const refs = requireIdentifierListAlias(
            request.input,
            "photoRefs",
            "photo_refs",
            "propose_prints requires the tray photographs to make one print from each.",
          );
          const batchProductId = typeof request.input.productId === "string" ? request.input.productId : null;
          const batchProductQuery = typeof request.input.productQuery === "string" ? request.input.productQuery.trim().toLowerCase() : "";
          const batchMatches = batchProductId
            ? catalog.filter((candidate) => candidate.id === batchProductId)
            : batchProductQuery ? naturalProductMatches(catalog, batchProductQuery) : [];
          if (batchMatches.length !== 1) throw new Error(batchMatches.length === 0
            ? "No live print matches that product reference."
            : "That natural product reference matches more than one live print; use the canonical product ID.");
          const batchProduct = batchMatches[0]!;
          const batchQuantity = Number(request.input.quantity ?? 1);
          if (!Number.isInteger(batchQuantity) || batchQuantity < 1 || batchQuantity > 99) {
            throw new Error("quantity must be a whole number from 1 through 99, and applies to each print in the batch.");
          }
          const batchOrientation = request.input.orientation === "portrait" || request.input.orientation === "landscape"
            ? request.input.orientation
            : undefined;
          const requestedTemplateId = typeof request.input.templateId === "string" ? request.input.templateId.trim() || undefined : undefined;
          const requestedTemplateQuery = typeof request.input.templateQuery === "string" ? request.input.templateQuery.trim() || undefined : undefined;
          const requestedOutputId = typeof request.input.outputId === "string" ? request.input.outputId.trim() || undefined : undefined;

          // Resolve every tray reference before talking to the shared template
          // path. Bad references remain in their original positions, while the
          // good photos all share one product/template/output/contract read.
          const resolvedPhotos = refs.map((reference, index) => {
            const photoRef = typeof reference === "string" || typeof reference === "number" ? reference : String(reference);
            const found = resolvePhotoReference(photoLibrary.photos, photoRef as string | number);
            return { position: index + 1, photoRef, found };
          });
          const batchResults: Array<Record<string, unknown>> = [];
          for (const { position, photoRef, found } of resolvedPhotos) {
            if (found.kind !== "resolved") {
              batchResults.push({
                position, photo_ref: photoRef,
                draft_id: null,
                proposal_id: null,
                status: "skipped",
                reason: found.kind === "ambiguous"
                  ? `${photoRef} matches multiple tray photographs; use the returned photo ID.`
                  : `${photoRef} is not in the current photo tray.`,
                review: null,
              });
            }
          }
          const validPhotos = resolvedPhotos.flatMap(({ position, photoRef, found }) =>
            found.kind === "resolved" ? [{ position, photoRef, photo: found.photo }] : []);
          if (validPhotos.length === 0) {
            setNotice({ tone: "info", message: `No visible tray photographs could be staged for ${batchProduct.name}.` });
            await nextPaint();
            respondWithActivity({ requestId: request.requestId, result: {
              status: "nothing_proposed",
              product: { id: batchProduct.id, revision: batchProduct.revision, name: batchProduct.name },
              quantity_each: batchQuantity,
              results: batchResults.sort((left, right) => Number(left.position) - Number(right.position)),
              proposed_count: 0,
              review_summary: { proposed: 0, ready: 0, needs_review: 0 },
              pending_proposal_count: livePendingProposals().length,
              decided_by: "shopper",
              guidance: "Nothing was staged and nothing was added; each result says why.",
              nextStep: "refresh_the_visible_tray",
            } });
            return;
          }

          const idempotencyKey = batchStagingKey({
            trayRevision: photoLibrary.revision,
            photoIds: validPhotos.map(({ photo }) => photo.id),
            product: batchProduct,
            quantity: batchQuantity,
            orientation: batchOrientation,
            templateId: requestedTemplateId,
            templateQuery: requestedTemplateQuery,
            outputId: requestedOutputId,
          });
          const existingBatch = batchStagingSessions.current.get(idempotencyKey);
          const standingProposalIds = new Set(pendingCartProposals(proposalStackRef.current).map((proposal) => proposal.id));
          if (existingBatch && existingBatch.proposalIds.some((proposalId) => standingProposalIds.has(proposalId))) {
            const retryResults = existingBatch.results.map((result) => {
              const proposalId = typeof result.proposal_id === "string" ? result.proposal_id : null;
              return proposalId && standingProposalIds.has(proposalId)
                ? { ...result, status: "already_proposed", duplicate_of_pending_proposal: true }
                : result;
            });
            const retryProposedCount = retryResults.filter((result) => result.status === "already_proposed").length;
            respondWithActivity({ requestId: request.requestId, result: {
              status: "awaiting_shopper_confirmation",
              idempotent_retry: true,
              product: { id: batchProduct.id, revision: batchProduct.revision, name: batchProduct.name },
              quantity_each: batchQuantity,
              results: retryResults,
              proposed_count: retryProposedCount,
              pending_proposal_count: livePendingProposals().length,
              decided_by: "shopper",
              guidance: "This unresolved batch is already staged. Its standing proposal IDs are returned above; no duplicate cards were added. Wait for the shopper's decision.",
              nextStep: "await_shopper_decision",
            } });
            return;
          }

          let preflight: BatchTemplatePreflight | null;
          try {
            preflight = await resolveBatchTemplatePreflight(batchProduct, {
              templateId: requestedTemplateId,
              templateQuery: requestedTemplateQuery,
              outputId: requestedOutputId,
              orientation: batchOrientation,
            });
          } catch (error) {
            const failure = error instanceof BatchStagingError
              ? error
              : new BatchStagingError("template_contract_unavailable", responseMessage(error));
            const failedResults = resolvedPhotos.map(({ position, photoRef, found }) => ({
              position,
              photo_ref: photoRef,
              draft_id: null,
              proposal_id: null,
              status: found.kind === "resolved" ? "not_staged" : "skipped",
              reason: found.kind === "resolved"
                ? "The shared batch template preflight failed, so no draft was created."
                : found.kind === "ambiguous"
                  ? `${photoRef} matches multiple tray photographs; use the returned photo ID.`
                  : `${photoRef} is not in the current photo tray.`,
              review: null,
            }));
            // A shared template failure is atomic: the batch never creates a
            // partial rail of drafts or a repeated failure for every photo.
            setNotice({ tone: "error", message: `Batch staging unavailable: ${failure.message}` });
            await nextPaint();
            respondWithActivity({ requestId: request.requestId, result: {
              status: "batch_preflight_failed",
              error: { code: failure.code, scope: "batch", message: failure.message, retryable: failure.code !== "template_not_found" && failure.code !== "template_ambiguous", candidates: failure.candidates },
              product: { id: batchProduct.id, revision: batchProduct.revision, name: batchProduct.name },
              quantity_each: batchQuantity,
              results: failedResults,
              proposed_count: 0,
              pending_proposal_count: livePendingProposals().length,
              committed: false,
              guidance: "No drafts or proposal cards were created. Correct the shared template selection or retry when the published template path is available.",
              nextStep: "resolve_batch_template_preflight",
            } });
            return;
          }

          const createdDrafts: PrintDraft[] = [];
          const createdEntries: CartProposalStackEntry[] = [];
          const batchRoles: Record<string, PhotoRole> = preflight
            ? imageSlotRoles(preflight.contract.slots, browserPreviewSlotBoxes(preflight.document))
            : {};
          const batchImageSlots = preflight?.contract.slots.filter((slot) => slot.kind === "image") ?? [];
          const primarySlot = batchImageSlots.find((slot) => batchRoles[slot.key] === "individual")
            ?? (batchImageSlots.length === 1 ? batchImageSlots[0] : null);
          for (const { position, photoRef, photo } of validPhotos) {
            let draft = createPrintDraft(batchProduct, [photo.id]);
            if (preflight) {
              const { assignments } = prefillSlotAssignments({
                assignments: draft.slotAssignments,
                memory: photoRoleMemory.current,
                rolesBySlotKey: batchRoles,
                availablePhotoIds: photoLibraryRef.current.photos.map((candidate) => candidate.id),
              });
              // This photograph is the reason the print exists, so it takes the
              // individual slot; remembered role choices fill any other slots.
              const batchAssignments = { ...assignments };
              if (primarySlot) batchAssignments[primarySlot.key] = photo.id;
              draft = patchPrintDraft(draft, {
                template: preflight.template,
                templateContractKnown: true,
                requiredSlotKeys: effectiveRequiredTemplateSlotKeys(batchProduct, preflight.contract.slots),
                slotAssignments: batchAssignments,
                // A batch print is framed before its card is ever painted, so
                // the shopper's first look at it is already on the faces.
                slotTransforms: seededSlotTransforms(
                  draft.slotTransforms,
                  batchAssignments,
                  browserPreviewSlotBoxes(preflight.document),
                ),
              });
            } else {
              rememberRoles(rememberDirectPhoto(photoRoleMemory.current, batchProduct.physical_output, photo.id));
              // An unspecified batch starts in the neutral print framing from
              // createPrintDraft: 1x, centre focus, and no pan. Face framing
              // remains an explicit configure_print/revise_prints choice.
            }
            const proposal = createCartProposal({
              draftId: draft.id,
              productId: batchProduct.id,
              productName: batchProduct.name,
              quantity: batchQuantity,
              thumbnailURL: draftThumbnailURL(draft),
              source: draft.template ? "template" : "direct",
              draft,
            });
            createdDrafts.push(draft);
            createdEntries.push({ proposal, exit: null });
            backgroundDraftIds.current.add(draft.id);
            batchResults.push({
              position,
              photo_ref: photoRef,
              photo_id: photo.id,
              draft_id: draft.id,
              proposal_id: proposal.id,
              status: "proposed",
              duplicate_of_pending_proposal: false,
              placed: "draft_rail",
              reason: null,
              review: printReviewWire(reviewForDraft(draft)),
            });
          }
          batchResults.sort((left, right) => Number(left.position) - Number(right.position));
          // Commit the complete batch together: the shopper sees one deck
          // update, not a 37-step sequence of individual proposal cards.
          setDrafts((items) => [...items, ...createdDrafts]);
          commitProposalStack((entries) => [...entries, ...createdEntries]);
          setLastProposalOutcome(null);
          batchStagingSessions.current.set(idempotencyKey, {
            proposalIds: createdEntries.map((entry) => entry.proposal.id),
            results: batchResults,
          });
          const proposedCount = batchResults.filter((result) => result.status === "proposed" || result.status === "already_proposed").length;
          const reviews = batchResults.flatMap((result) => {
            const review = result.review as { verdict?: string } | null;
            return review?.verdict ? [review.verdict] : [];
          });
          const summary = {
            proposed: proposedCount,
            ready: reviews.filter((verdict) => verdict === "ready").length,
            needs_review: reviews.filter((verdict) => verdict === "needs_review").length,
          };
          const stackCount = livePendingProposals().length;
          setNotice({ tone: "info", message: proposedCount > 0
            ? `Proposed ${proposedCount} × ${batchProduct.name}. Accept or reject each preview card.`
            : `No print could be staged for ${batchProduct.name}.` });
          // Every card must be on screen before the agent hears back.
          await nextPaint();
          respondWithActivity({ requestId: request.requestId, result: {
            status: proposedCount > 0 ? "awaiting_shopper_confirmation" : "nothing_proposed",
            product: { id: batchProduct.id, revision: batchProduct.revision, name: batchProduct.name },
            quantity_each: batchQuantity,
            // Ordered exactly as the photographs were named, so "the third one"
            // means the same thing to the shopper and to you.
            results: batchResults,
            proposed_count: proposedCount,
            review_summary: summary,
            pending_proposal_count: stackCount,
            decided_by: "shopper",
            placement_guidance: "Every print in this batch was made in the draft rail and none of them took the screen. Do not tell the shopper they are looking at any of these; the proposal cards are their first and only look at each one.",
            guidance: proposedCount > 0
              ? `Nothing has been added to the demo cart. ${proposedCount} card${proposedCount === 1 ? " is" : "s are"} now stacked in the corner, each carrying its own live preview and awaiting the SHOPPER's own answer.${summary.needs_review > 0 ? ` ${summary.needs_review} of them ${summary.needs_review === 1 ? "is" : "are"} flagged needs_review — say which and read the finding out, because that is the one worth their attention.` : " All of them come back ready."} Tell them the deck is waiting and stop. Do not call resolve_cart_proposal until they have said what they want, and then quote their words.`
              : "Nothing was staged and nothing was added; each result says why.",
            nextStep: "await_shopper_decision",
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
            respondWithActivity({ requestId: request.requestId, result: {
              status: "added",
              draft_id: draft.id,
              item_id: added.id,
              product_name: added.productName,
              quantity: added.quantity,
              review: printReviewWire(reviewForDraft(draft)),
              decided_by: "shopper_visible_context",
              guidance: `${requestedQuantity} × ${added.productName} went straight into the demo cart, with no proposal card: the shopper is looking at this draft's own live preview, so they already saw the print they asked you to add. Its matching cart line now has quantity ${added.quantity}. The masthead cart chip flashed the new count. Tell them it is in the cart. Nothing was ordered or charged.`,
              nextStep: "confirm_the_add_in_words",
              pending_proposal_count: livePendingProposals().length,
              cart_item_count: localCartPrintCount(nextCart),
              cart_line_count: nextCart.length,
              items: localCartWireItems(nextCart),
            } });
            return;
          }
          const { proposal, duplicate } = proposeDraft(draft, requestedQuantity);
          // The proposal card must be on screen before the agent hears back.
          await nextPaint();
          const stackCount = livePendingProposals().length;
          respondWithActivity({ requestId: request.requestId, result: {
            status: "awaiting_shopper_confirmation",
            proposal_id: proposal.id,
            draft_id: proposal.draftId,
            product_name: proposal.productName,
            quantity: proposal.quantity,
            review: printReviewWire(reviewForDraft(draft)),
            found_in_catalog: backgroundDraftIds.current.has(draft.id),
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
          // "Make that one two copies" changes the question the card is asking,
          // it does not answer it. Nothing enters the cart, the card keeps
          // standing, and no shopperConfirmation is demanded — quoting the
          // shopper accepting a proposal they have not accepted would be a lie
          // told to satisfy a guard meant to prevent exactly that.
          if (requestedDecision === "update_quantity") {
            const nextQuantity = Number(request.input.quantity);
            if (!Number.isInteger(nextQuantity) || nextQuantity < 1 || nextQuantity > 99) {
              throw new Error("update_quantity requires a quantity from 1 through 99.");
            }
            const standingNow = livePendingProposals();
            const target = standingNow.find((candidate) => candidate.id === proposalId);
            if (!target) {
              throw new Error(proposalId
                ? `No proposal ${proposalId} is waiting. The cards waiting now are ${cartProposalWireItems(standingNow).map((item) => `${item.proposal_id} (${item.product_name})`).join(", ")}.`
                : "update_quantity names one card: pass its proposalId.");
            }
            const previousQuantity = target.quantity;
            // Patched in place so the card keeps its position in the deck and
            // its live preview is never torn down and remounted; only the
            // quantity badge changes.
            commitProposalStack((entries) => entries.map((entry) =>
              entry.proposal.id === target.id && !entry.exit
                ? { ...entry, proposal: { ...entry.proposal, quantity: nextQuantity } }
                : entry));
            setNotice({ tone: "info", message: `That card now asks for ${nextQuantity} × ${target.productName}.` });
            // The badge must have repainted before the agent hears back.
            await nextPaint();
            respondWithActivity({ requestId: request.requestId, result: {
              decision: "quantity_updated",
              scope: "one_proposal",
              proposal_id: target.id,
              draft_id: target.draftId,
              product_name: target.productName,
              previous_quantity: previousQuantity,
              quantity: nextQuantity,
              pending_proposal_count: livePendingProposals().length,
              decided_by: "shopper_request",
              guidance: `The card for ${target.productName} now shows ${nextQuantity} and is still waiting on the shopper — nothing was added to the demo cart and no proposal was answered. Accepting it later will add ${nextQuantity}, not ${previousQuantity}. Tell them the card has been changed and stop.`,
              nextStep: "await_shopper_decision",
            } });
            return;
          }
          // accept_ready answers a subset of the stack rather than one card or
          // all of them: it is still the shopper's decision, just a narrower
          // one, so it takes no proposalId and still demands their words.
          const readyOnly = requestedDecision === "accept_ready";
          const bulk = requestedDecision === "accept_all" || requestedDecision === "reject_all" || readyOnly;
          const decision = requestedDecision === "accept_all" || readyOnly ? "accept"
            : requestedDecision === "reject_all" ? "reject"
              : requestedDecision;
          if (decision !== "accept" && decision !== "reject") {
            throw new Error("decision must be accept, reject, accept_all, reject_all, accept_ready, or update_quantity.");
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
          // Read once, live: the shopper may have clicked a card, or another
          // tool call may have staged one, since this component last rendered.
          const standing = livePendingProposals();
          if (standing.length === 0) throw new Error("No cart proposal is visible.");
          // accept_all and reject_all are the shopper answering the whole
          // stack in one sentence; every other decision names one card.
          let targets: CartProposal[];
          if (readyOnly) {
            // The flagged cards deliberately keep standing. "Accept the ready
            // ones" is an instruction about the ready ones only, and a
            // needs_review card is exactly the one the shopper meant to look at
            // themselves, so answering it here would be answering for them.
            targets = standing.filter((proposal) => reviewForDraft(proposal.draft).verdict === "ready");
            if (targets.length === 0) {
              throw new Error("No pending proposal comes back ready: every card waiting is flagged needs_review, so accept_ready would answer nothing. Read the findings to the shopper and ask about those cards one at a time.");
            }
          } else if (bulk) {
            targets = standing;
          } else {
            const target = standing.find((candidate) => candidate.id === proposalId);
            if (!target) {
              throw new Error(proposalId
                ? `No proposal ${proposalId} is waiting. The cards waiting now are ${cartProposalWireItems(standing).map((item) => `${item.proposal_id} (${item.product_name})`).join(", ")}.`
                : `decision ${decision} names one card: pass its proposalId, or use accept_all or reject_all for the whole stack.`);
            }
            targets = [target];
          }
          const nextCart = resolveProposals(targets, decision);
          const remaining = livePendingProposals().length;
          await nextPaint();
          respondWithActivity({ requestId: request.requestId, result: {
            decision: decision === "accept" ? "accepted" : "rejected",
            scope: readyOnly ? "ready_pending" : bulk ? "all_pending" : "one_proposal",
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
              ? `${remaining} proposal card${remaining === 1 ? " is" : "s are"} still waiting on the shopper.${readyOnly ? ` ${remaining === 1 ? "It is" : "They are"} the flagged one${remaining === 1 ? "" : "s"}, left standing on purpose — read the finding out and ask about ${remaining === 1 ? "it" : "each"} separately.` : ""} Do not answer ${remaining === 1 ? "it" : "them"} yourself.`
              : "Every proposal card has been answered; none are waiting.",
          } });
          return;
        }
        if (request.action === "undo_last_change") {
          const requestedSteps = request.input.steps === undefined ? 1 : Number(request.input.steps);
          if (!Number.isInteger(requestedSteps) || requestedSteps < 1 || requestedSteps > 5) {
            throw new Error("steps must be a whole number from 1 through 5.");
          }
          const undone = undoWorkbenchChange(requestedSteps);
          // Refusing in words beats restoring an identical workbench and
          // claiming to have undone something.
          if (!undone) {
            throw new Error("Nothing has changed in this workbench yet, so there is nothing to undo. The history holds only changes made since this page was opened, and it does not survive a reload.");
          }
          // Drafts, cards and cart must all be back on screen before the agent
          // hears back, exactly as they must be after a reload restore.
          await nextPaint();
          respondWithActivity({ requestId: request.requestId, result: {
            status: "undone",
            // Read straight off the recorded label, so the agent narrates the
            // change the shopper actually watched rather than describing the
            // restored state and calling that an explanation.
            undone: undone.label,
            undone_changes: undone.labels,
            undone_count: undone.undoneCount,
            requested_steps: requestedSteps,
            remaining_undo_steps: undone.remaining,
            remaining_redo_steps: workbenchHistory.current.redoDepth(),
            draft_count: undone.restore.restoredDraftCount,
            pending_proposal_count: livePendingProposals().length,
            cart_item_count: localCartPrintCount(undone.restore.cart),
            unlinked_photo_count: undone.restore.unlinkedPhotoCount,
            guidance: `The workbench is back to how it stood before ${undone.label}${undone.undoneCount > 1 ? ` and ${undone.undoneCount - 1} further change${undone.undoneCount === 2 ? "" : "s"}` : ""}. Every draft, proposal card and cart line has repainted, and each photograph was re-linked against the tray as it stands now.${undone.restore.unlinkedPhotoCount > 0 ? ` ${undone.restore.unlinkedPhotoCount} photograph${undone.restore.unlinkedPhotoCount === 1 ? " is" : "s are"} no longer in the tray, so their slots came back empty — say so.` : ""} Call redo_last_change only when the shopper wants this actual undo reapplied. If they ask to restore a cart line that was directly removed with manage_cart, call undo_last_change instead — do not stage a new proposal. ${undone.remaining > 0 ? `${undone.remaining} earlier change${undone.remaining === 1 ? "" : "s"} can still be undone.` : "Nothing further can be undone."}`,
            nextStep: "tell_the_shopper_what_came_back",
          } });
          return;
        }
        if (request.action === "redo_last_change") {
          const requestedSteps = request.input.steps === undefined ? 1 : Number(request.input.steps);
          if (!Number.isInteger(requestedSteps) || requestedSteps < 1 || requestedSteps > 5) {
            throw new Error("steps must be a whole number from 1 through 5.");
          }
          const redone = redoWorkbenchChange(requestedSteps);
          if (!redone) {
            throw new Error("There is no undone change to redo. Redo is available only immediately after undo_last_change and is cleared by any new workbench change or page reload.");
          }
          await nextPaint();
          respondWithActivity({ requestId: request.requestId, result: {
            status: "redone",
            redone: redone.label,
            redone_changes: redone.labels,
            redone_count: redone.redoneCount,
            requested_steps: requestedSteps,
            remaining_redo_steps: redone.remaining,
            draft_count: redone.restore.restoredDraftCount,
            pending_proposal_count: livePendingProposals().length,
            cart_item_count: localCartPrintCount(redone.restore.cart),
            unlinked_photo_count: redone.restore.unlinkedPhotoCount,
            guidance: `The workbench is back to how it stood after ${redone.label}${redone.redoneCount > 1 ? ` and ${redone.redoneCount - 1} further change${redone.redoneCount === 2 ? "" : "s"}` : ""}. Every draft, proposal card and cart line has repainted. If the shopper instead wants to reverse a cart removal that was performed directly with manage_cart, call undo_last_change — do not stage a fresh proposal. ${redone.remaining > 0 ? `${redone.remaining} further undone change${redone.remaining === 1 ? "" : "s"} can still be redone.` : "Nothing further can be redone."}`,
            nextStep: "tell_the_shopper_what_came_back",
          } });
          return;
        }
        const action = request.input.action;
        const explicitItemId = typeof request.input.itemId === "string" ? request.input.itemId : undefined;
        const target = request.input.target === "most_recent" ? "most_recent" : undefined;
        // Resolve shopper language once, against the cart rendered for this
        // request. This keeps "change the most recent one" atomic instead of
        // making an agent inspect the cart, infer an ID, and retry.
        const itemId = explicitItemId ?? (target === "most_recent" ? mostRecentLocalCartItem(cart)?.id : undefined);
        const quantity = typeof request.input.quantity === "number" ? request.input.quantity : undefined;
        let nextCart = cart;
        if (action === "clear") nextCart = [];
        else if (action === "remove") {
          if (!itemId || !cart.some((item) => item.id === itemId)) throw new Error("remove requires a visible cart item ID or target most_recent.");
          nextCart = cart.filter((item) => item.id !== itemId);
        } else if (action === "update_quantity") {
          if (!itemId || !cart.some((item) => item.id === itemId)) throw new Error("update_quantity requires a visible cart item ID or target most_recent.");
          if (!Number.isInteger(quantity) || !quantity || quantity < 1 || quantity > 99) throw new Error("update_quantity requires a quantity from 1 through 99.");
          nextCart = cart.map((item) => item.id === itemId ? { ...item, quantity } : item);
        } else if (action !== "view") throw new Error("Choose view, update_quantity, remove, or clear.");
        if (action !== "view") {
          setCart(nextCart);
          await nextPaint();
        }
        respondWithActivity({ requestId: request.requestId, result: {
          action,
          target,
          resolved_item_id: itemId,
          cart_item_count: localCartPrintCount(nextCart),
          cart_line_count: nextCart.length,
          items: localCartWireItems(nextCart),
          guidance: action === "remove"
            ? "That cart line was removed. If the shopper asks to undo, restore, or redo this removal, call undo_last_change to bring this exact line back; do not stage a new proposal."
            : undefined,
        } });
      } catch (error) {
        respondToStorefrontWebMcpAction({ requestId: request.requestId, error: responseMessage(error) });
      }
    })();
  }));

  /**
   * What the tray should draw over each thumbnail, read straight from the
   * detection refs. It never starts a detection pass — a photograph the lazy
   * pass has not reached yet simply reads as pending.
   */
  function buildFaceDebugMap(): FaceDebugMap {
    const entries: Record<string, FaceDebugEntry> = {};
    for (const photo of photoLibrary.photos) {
      const faces = photoFacesRef.current[photo.id] ?? null;
      const resolved = photoFacesResolvedRef.current[photo.id] === true;
      const state: FaceDebugEntry["state"] = faces && faces.length > 0
        ? "faces"
        : !resolved
          ? "pending"
          : faceDetectionAvailable() ? "none" : "unavailable";
      entries[photo.id] = { faces: faces ?? [], state, subject: subjectRegionFromFaces(faces) };
    }
    return entries;
  }

  return <PhotoDragProvider onDropPhoto={dropPhotoOnPrintTarget} photos={photoLibrary.photos}>
    <StorefrontMasthead
      cartAcknowledgement={cartAcknowledgement}
      cartCount={cartPrintCount}
      onOpenCart={() => setCartOpen(true)}
      onOpenHome={() => setStep("catalog")}
    />
    <PhotoTray
      faceDetection={buildFaceDebugMap()}
      faceDebug={faceDebugOn ? buildFaceDebugMap() : undefined}
      library={photoLibrary}
      onAction={handlePhotoAction}
      onImportError={(message) => setNotice({ tone: "error", message })}
    />

    <main className="mx-auto w-full max-w-[1400px] px-5 pb-16 sm:px-8 lg:px-12 2xl:max-w-[1800px]">

      {step === "catalog" && <div className="pb-10" id="catalog">
        <FormatPicker onSelect={selectProduct} products={catalog} selectedProductKey={selectedProductKey} state={catalogState} />
      </div>}

      {/* The pulse is a keyed sibling, never a key on the step itself: keying
          the workbench would remount the live preview the pulse exists to draw
          attention to, tearing down the very repaint the shopper should see. */}
      {step === "prepare" && selectedProduct && <div className="relative">
        {workbenchPulse > 0 && <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-3 rounded-[22px] animate-agent-pulse"
          key={`agent-pulse-${workbenchPulse}`}
        />}
        <PrepareStep
        activeImageSlotKey={activeImageSlotKey}
        activeSlotPanLimits={activeSlotPanLimits}
        activeSlotTransform={activeSlotTransform}
        browserPreview={browserPreviewDocument ? <BrowserTemplatePreview activeImageSlotKey={activeImageSlotKey} assetURLs={browserPreviewAssetURLs} document={browserPreviewDocument} faceDebug={faceDebugOn ? buildFaceDebugMap() : undefined} key={selectedBrowserPreviewSurfaceID} localImageSlots={browserPreviewImageSlots} onActiveImageSlotChange={(slotKey) => { setActiveImageSlotKey(slotKey); setActiveSlotPanLimits({ x: 0, y: 0 }); }} onPreviewChange={(slotKey, transform) => changeBrowserPreviewTransform(slotKey, transform)} onPreviewCommit={(_, slotKey, transform) => updateBrowserPreviewTransform(slotKey, transform)} onPreviewPanLimitsChange={(slotKey, limits) => { if (slotKey === activeImageSlotKey) setActiveSlotPanLimits(limits); }} onSurfaceChange={setSelectedBrowserPreviewSurfaceID} selectedSurfaceID={selectedBrowserPreviewSurfaceID} serverProof={null} textValues={templateInputs} /> : null}
        crop={crop}
        cropX={cropX}
        cropY={cropY}
        cropZoom={cropZoom}
        customization={customization}
        framingFocus={framingFocus}
        hasLocalImage={Boolean(localImage)}
        imagePreview={imagePreview}
        onAddPreparedLine={() => { try { if (selectedDraft) { noteShopperLookingAtSelectedDraft(); addDraftToCart(selectedDraft, 1); } else throw new Error("Select a visible draft before adding it to the demo cart."); } catch (error) { setNotice({ tone: "error", message: responseMessage(error) }); } }}
        onAssignTemplatePhoto={(slotKey, photoId) => { noteShopperLookingAtSelectedDraft(); assignTemplatePhoto(slotKey, photoId); }}
        onChangeFormat={() => setStep("catalog")}
        onCropXChange={(focusX) => { noteShopperLookingAtSelectedDraft(); setCropX(focusX); if (selectedDraftId) patchDraft(selectedDraftId, { directCrop: { focusX } }); }}
        onCropYChange={(focusY) => { noteShopperLookingAtSelectedDraft(); setCropY(focusY); if (selectedDraftId) patchDraft(selectedDraftId, { directCrop: { focusY } }); }}
        onFramingFocusChange={(focus) => {
          const zoom = customization === "template" && activeSlotTransform ? activeSlotTransform.zoom : cropZoom;
          applyVisibleFramingFocus(focus, zoom, true);
        }}
        onFramingZoomChange={(zoom) => applyVisibleFramingFocus(framingFocus, zoom)}
        onSelectTemplate={(templateId) => void chooseTemplate(templateId).catch((error) => setTemplateNotice({ tone: "error", message: responseMessage(error) }))}
        onSlotTransformChange={changeBrowserPreviewTransform}
        onSlotTransformCommit={updateBrowserPreviewTransform}
        onTemplateTextChange={(slotKey, value) => { noteShopperLookingAtSelectedDraft(); setTemplateInputs((values) => ({ ...values, [slotKey]: value })); }}
        photos={photoLibrary.photos}
        prefilledSlotProvenance={prefilledSlotProvenance}
        selectedPhotoId={selectedPhoto?.id ?? null}
        selectedProduct={selectedProduct}
        selectedTemplateId={selectedTemplateId}
        templateAssignments={templateAssignments}
        templateContract={templateContract}
        templateInputs={templateInputs}
        templateLoading={templateState === "loading"}
        templatePreviewFor={templateCarouselPreviewFor}
        templates={templates}
        visibleTemplateSlots={visibleTemplateSlots}
        />
      </div>}

      <footer className="mt-6 flex justify-center border-t border-border pt-6 text-center text-sm text-muted-foreground">
        <span>
          © 2026{" "}
          <a
            className="text-inherit no-underline underline-offset-4 transition-colors hover:text-orange-500 hover:underline focus-visible:text-orange-500 focus-visible:underline motion-reduce:transition-none"
            href="https://batchrelay.com?ref=webmcp"
            rel="noopener noreferrer"
            target="_blank"
          >
            Batch Relay
          </a>
          {" / "}
          <a
            className="text-inherit no-underline underline-offset-4 transition-colors hover:text-orange-500 hover:underline focus-visible:text-orange-500 focus-visible:underline motion-reduce:transition-none"
            href="https://ftrbnd.com?ref=webmcp"
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
      templatePreviewFor={(item) => proposalPreviewBinding({ ...item, createdAt: item.addedAt }).templatePreview}
    />

    {/* Every proposal waiting on the shopper, stacked in the corner. Each
        card paints its own proposed draft; this only supplies the artwork the
        workbench has already resolved for that draft's published output. */}
    <CartProposalStack
      entries={proposalStack}
      onAccept={(proposal) => resolveProposal(proposal, "accept")}
      onReject={(proposal) => resolveProposal(proposal, "reject")}
      onToggleFlag={(proposal) => {
        const flagged = proposal.reviewFlagged !== true;
        commitProposalStack((entries) => entries.map((entry) => entry.proposal.id === proposal.id
          ? { ...entry, proposal: { ...entry.proposal, reviewFlagged: flagged } }
          : entry));
        setNotice({ tone: "info", message: flagged ? "Print flagged for follow-up." : "Follow-up flag removed." });
      }}
      previewFor={proposalPreviewBinding}
    />
  </PhotoDragProvider>;
}
