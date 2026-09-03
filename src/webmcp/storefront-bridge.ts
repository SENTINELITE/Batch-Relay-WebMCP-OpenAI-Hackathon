/**
 * Browser-only bridge between WebMCP tools and the visible storefront.
 *
 * The UI publishes the currently visible capabilities and handles requests by
 * listening for `batchrelay:webmcp:action`. This module intentionally has no
 * network calls: the UI keeps ownership of its same-origin data/actions.
 */

export type StorefrontWebMcpState = {
  /** Revision for the visible storefront state as a whole. */
  revision: number;
  /** Monotonically increasing revision for the left-to-right photo tray. */
  trayRevision: number;
  photoCount: number;
  selectedPhotoId: string | null;
  selectedProductId: string | null;
  selectedTemplateId: string | null;
  selectedTemplateOutputId: string | null;
  canConfigurePrint: boolean;
  canRenderTemplatePreview: boolean;
  canAddToCart: boolean;
  /** A cart proposal card is visible and waiting on the shopper. */
  pendingProposal: boolean;
  cartItemCount: number;
};

export type StorefrontWebMcpAction =
  | "ask_storefront"
  | "find_prints"
  | "configure_print"
  | "add_to_cart"
  | "resolve_cart_proposal"
  | "manage_cart";

export type StorefrontWebMcpActionRequest = {
  requestId: string;
  action: StorefrontWebMcpAction;
  input: Record<string, unknown>;
};

export type StorefrontWebMcpActionResponse = {
  requestId: string;
  result?: unknown;
  error?: string;
};

export const storefrontWebMcpEvents = {
  state: "batchrelay:webmcp:state",
  action: "batchrelay:webmcp:action",
  result: "batchrelay:webmcp:result",
} as const;
// Client actions resolve as soon as the visible workbench has applied them, so
// a tool call returns one final grounded result rather than a progress guess.
const requestTimeoutMs = 45_000;

const defaultState: StorefrontWebMcpState = {
  revision: 0,
  trayRevision: 0,
  photoCount: 0,
  selectedPhotoId: null,
  selectedProductId: null,
  selectedTemplateId: null,
  selectedTemplateOutputId: null,
  canConfigurePrint: false,
  canRenderTemplatePreview: false,
  canAddToCart: false,
  pendingProposal: false,
  cartItemCount: 0,
};

let visibleState = defaultState;

function browserWindow(): Window {
  if (typeof window === "undefined") {
    throw new Error("WebMCP storefront tools can only run in the browser.");
  }

  return window;
}

function isState(value: unknown): value is StorefrontWebMcpState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<StorefrontWebMcpState>;
  return (
    typeof candidate.revision === "number" &&
    Number.isInteger(candidate.revision) &&
    candidate.revision >= 0 &&
    typeof candidate.trayRevision === "number" &&
    Number.isInteger(candidate.trayRevision) &&
    candidate.trayRevision >= 0 &&
    typeof candidate.photoCount === "number" &&
    Number.isInteger(candidate.photoCount) &&
    candidate.photoCount >= 0 &&
    (typeof candidate.selectedPhotoId === "string" || candidate.selectedPhotoId === null) &&
    (typeof candidate.selectedProductId === "string" || candidate.selectedProductId === null) &&
    (typeof candidate.selectedTemplateId === "string" || candidate.selectedTemplateId === null) &&
    (typeof candidate.selectedTemplateOutputId === "string" || candidate.selectedTemplateOutputId === null) &&
    typeof candidate.canConfigurePrint === "boolean" &&
    typeof candidate.canRenderTemplatePreview === "boolean" &&
    typeof candidate.canAddToCart === "boolean" &&
    typeof candidate.pendingProposal === "boolean" &&
    typeof candidate.cartItemCount === "number" &&
    Number.isInteger(candidate.cartItemCount) &&
    candidate.cartItemCount >= 0
  );
}

/** Publish the visible UI's current WebMCP capabilities. */
export function publishStorefrontWebMcpState(state: StorefrontWebMcpState): void {
  if (!isState(state)) {
    throw new Error("Invalid visible storefront WebMCP state.");
  }

  visibleState = state;
  browserWindow().dispatchEvent(
    new CustomEvent<StorefrontWebMcpState>(storefrontWebMcpEvents.state, { detail: state }),
  );
}

/** Read the last state published by the visible storefront. */
export function getStorefrontWebMcpState(): StorefrontWebMcpState {
  return visibleState;
}

/** Subscribe a registrar to visible capability changes. */
export function subscribeToStorefrontWebMcpState(
  listener: (state: StorefrontWebMcpState) => void,
): () => void {
  const target = browserWindow();
  const onState = (event: Event) => {
    const state = (event as CustomEvent<unknown>).detail;
    if (!isState(state)) return;
    visibleState = state;
    listener(state);
  };

  target.addEventListener(storefrontWebMcpEvents.state, onState);
  return () => target.removeEventListener(storefrontWebMcpEvents.state, onState);
}

/** Subscribe the visible UI to WebMCP action requests. */
export function subscribeToStorefrontWebMcpActions(
  handler: (request: StorefrontWebMcpActionRequest) => void,
): () => void {
  const target = browserWindow();
  const onAction = (event: Event) => {
    const request = (event as CustomEvent<StorefrontWebMcpActionRequest>).detail;
    if (!request?.requestId || !request.action || !request.input) return;
    handler(request);
  };

  target.addEventListener(storefrontWebMcpEvents.action, onAction);
  return () => target.removeEventListener(storefrontWebMcpEvents.action, onAction);
}

/**
 * Resolve or reject a request received from the action event. UI action
 * handlers should call this after their same-origin client action completes.
 */
export function respondToStorefrontWebMcpAction(response: StorefrontWebMcpActionResponse): void {
  if (!response.requestId || (response.error === undefined && response.result === undefined)) {
    throw new Error("A WebMCP action response requires a request ID and result or error.");
  }

  browserWindow().dispatchEvent(
    new CustomEvent<StorefrontWebMcpActionResponse>(storefrontWebMcpEvents.result, { detail: response }),
  );
}

/**
 * Ask the visible storefront to run one of its own client actions. The result
 * is supplied by the UI via `respondToStorefrontWebMcpAction`.
 */
export function requestStorefrontWebMcpAction(
  action: StorefrontWebMcpAction,
  input: Record<string, unknown>,
): Promise<unknown> {
  const target = browserWindow();
  const requestId = crypto.randomUUID();

  return new Promise<unknown>((resolve, reject) => {
    const timeout = target.setTimeout(() => {
      cleanup();
      reject(new Error(`The visible storefront did not complete ${action}.`));
    }, requestTimeoutMs);

    const onResult = (event: Event) => {
      const response = (event as CustomEvent<StorefrontWebMcpActionResponse>).detail;
      if (!response || response.requestId !== requestId) return;

      cleanup();
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      if (response.result === undefined) {
        reject(new Error(`The visible storefront returned no result for ${action}.`));
        return;
      }
      resolve(response.result);
    };

    const cleanup = () => {
      target.clearTimeout(timeout);
      target.removeEventListener(storefrontWebMcpEvents.result, onResult);
    };

    target.addEventListener(storefrontWebMcpEvents.result, onResult);
    target.dispatchEvent(
      new CustomEvent<StorefrontWebMcpActionRequest>(storefrontWebMcpEvents.action, {
        detail: { requestId, action, input },
      }),
    );
  });
}
