/**
 * Browser bridge for the creative workbench WebMCP tools.
 *
 * The editor owns the authoritative project, history, export, and same-origin
 * API calls. This bridge only carries bounded requests between the WebMCP
 * tools and the visible `/creative` UI so the two interaction modes share the
 * same state and approval affordances.
 */

import type { CreativeFormat } from "../../lib/creative/types";

export type CreativeLayout = CreativeFormat;

export type CreativeWebMcpAction =
  | "inspect_project"
  | "update_event_details"
  | "propose_background"
  | "check_generation"
  | "apply_background_candidate"
  | "switch_layout"
  | "export_artwork"
  | "undo"
  | "redo";

export type CreativeWebMcpState = {
  projectId: string | null;
  revision: number;
  layout: CreativeLayout;
  hasProject: boolean;
  hasApprovedBackground: boolean;
  pendingJobCount: number;
  pendingCandidateCount: number;
  canUndo: boolean;
  canRedo: boolean;
  /** The last export metadata, when the editor has exported this project. */
  lastExport?: { format: CreativeLayout; filename: string; width: number; height: number };
};

export type CreativeWebMcpActionRequest = {
  requestId: string;
  action: CreativeWebMcpAction;
  input: Record<string, unknown>;
};

export type CreativeWebMcpActionResponse = {
  requestId: string;
  result?: unknown;
  error?: string | CreativeWebMcpExpectedError;
};

export type CreativeWebMcpExpectedError = {
  code:
    | "invalid_input"
    | "project_unavailable"
    | "stale_revision"
    | "candidate_not_found"
    | "job_not_found"
    | "job_failed"
    | "export_failed"
    | "history_unavailable"
    | "creative_error";
  message: string;
  retryable: boolean;
  commitStatus: "not_committed" | "committed" | "unknown";
  details?: Record<string, unknown>;
};

export const creativeWebMcpEvents = {
  state: "batchrelay:creative:webmcp:state",
  action: "batchrelay:creative:webmcp:action",
  result: "batchrelay:creative:webmcp:result",
} as const;

const requestTimeoutMs = 15_000;

const defaultState: CreativeWebMcpState = {
  projectId: null,
  revision: 0,
  layout: "card",
  hasProject: false,
  hasApprovedBackground: false,
  pendingJobCount: 0,
  pendingCandidateCount: 0,
  canUndo: false,
  canRedo: false,
};

let visibleState = defaultState;

function browserWindow(): Window {
  if (typeof window === "undefined") {
    throw new Error("Creative WebMCP tools can only run in the browser.");
  }
  return window;
}

function isLayout(value: unknown): value is CreativeLayout {
  return value === "card" || value === "banner";
}

function isState(value: unknown): value is CreativeWebMcpState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<CreativeWebMcpState>;
  return (
    (typeof state.projectId === "string" || state.projectId === null) &&
    typeof state.revision === "number" && Number.isInteger(state.revision) && state.revision >= 0 &&
    isLayout(state.layout) &&
    typeof state.hasProject === "boolean" &&
    typeof state.hasApprovedBackground === "boolean" &&
    typeof state.pendingJobCount === "number" && Number.isInteger(state.pendingJobCount) && state.pendingJobCount >= 0 &&
    typeof state.pendingCandidateCount === "number" && Number.isInteger(state.pendingCandidateCount) && state.pendingCandidateCount >= 0 &&
    typeof state.canUndo === "boolean" && typeof state.canRedo === "boolean"
  );
}

function isExpectedError(value: unknown): value is CreativeWebMcpExpectedError {
  if (!value || typeof value !== "object") return false;
  const error = value as Partial<CreativeWebMcpExpectedError>;
  return (
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.retryable === "boolean" &&
    (error.commitStatus === "not_committed" || error.commitStatus === "committed" || error.commitStatus === "unknown")
  );
}

export function publishCreativeWebMcpState(state: CreativeWebMcpState): void {
  if (!isState(state)) throw new Error("Invalid visible creative WebMCP state.");
  visibleState = state;
  browserWindow().dispatchEvent(new CustomEvent<CreativeWebMcpState>(creativeWebMcpEvents.state, { detail: state }));
}

export function getCreativeWebMcpState(): CreativeWebMcpState {
  return visibleState;
}

export function subscribeToCreativeWebMcpState(
  listener: (state: CreativeWebMcpState) => void,
): () => void {
  const target = browserWindow();
  const onState = (event: Event) => {
    const state = (event as CustomEvent<unknown>).detail;
    if (!isState(state)) return;
    visibleState = state;
    listener(state);
  };
  target.addEventListener(creativeWebMcpEvents.state, onState);
  return () => target.removeEventListener(creativeWebMcpEvents.state, onState);
}

export function subscribeToCreativeWebMcpActions(
  listener: (request: CreativeWebMcpActionRequest) => void,
): () => void {
  const target = browserWindow();
  const onAction = (event: Event) => {
    const request = (event as CustomEvent<CreativeWebMcpActionRequest>).detail;
    if (!request?.requestId || !request.action || !request.input) return;
    listener(request);
  };
  target.addEventListener(creativeWebMcpEvents.action, onAction);
  return () => target.removeEventListener(creativeWebMcpEvents.action, onAction);
}

export function respondToCreativeWebMcpAction(response: CreativeWebMcpActionResponse): void {
  if (
    !response.requestId ||
    (response.result === undefined && response.error === undefined) ||
    (response.error !== undefined && typeof response.error !== "string" && !isExpectedError(response.error))
  ) {
    throw new Error("A creative WebMCP response requires a request ID and result or error.");
  }
  browserWindow().dispatchEvent(new CustomEvent<CreativeWebMcpActionResponse>(creativeWebMcpEvents.result, { detail: response }));
}

function createRequestId(): string {
  const cryptoObject = globalThis.crypto;
  return cryptoObject?.randomUUID?.() ?? `creative-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Dispatch one visible editor action. Background generation must return a
 * proposal or pending job from the editor; it must not keep this promise open
 * while a provider job runs.
 */
export function requestCreativeWebMcpAction(
  action: CreativeWebMcpAction,
  input: Record<string, unknown>,
): Promise<unknown> {
  const target = browserWindow();
  const requestId = createRequestId();

  return new Promise((resolve, reject) => {
    const timeoutRef: { id?: number } = {};
    const cleanup = () => {
      if (timeoutRef.id !== undefined) target.clearTimeout(timeoutRef.id);
      target.removeEventListener(creativeWebMcpEvents.result, onResult);
    };
    const onResult = (event: Event) => {
      const response = (event as CustomEvent<CreativeWebMcpActionResponse>).detail;
      if (!response || response.requestId !== requestId) return;
      cleanup();
      if (response.error !== undefined) {
        const error = typeof response.error === "string"
          ? new Error(response.error)
          : Object.assign(new Error(response.error.message), { code: response.error.code, details: response.error.details });
        reject(error);
      } else if (response.result !== undefined) {
        resolve(response.result);
      } else {
        reject(new Error(`The creative editor returned no result for ${action}.`));
      }
    };

    timeoutRef.id = target.setTimeout(() => {
      cleanup();
      reject(new Error(`The visible creative editor did not complete ${action} before the ${requestTimeoutMs}ms handoff timeout. Background jobs must be checked separately with check_generation.`));
    }, requestTimeoutMs);

    target.addEventListener(creativeWebMcpEvents.result, onResult);
    target.dispatchEvent(new CustomEvent<CreativeWebMcpActionRequest>(creativeWebMcpEvents.action, {
      detail: { requestId, action, input },
    }));
  });
}
