"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import styles from "./creative-editor.module.css";
import {
  publishCreativeWebMcpState,
  respondToCreativeWebMcpAction,
  subscribeToCreativeWebMcpActions,
  type CreativeWebMcpActionRequest,
} from "@/webmcp/creative/bridge";
import { applyAthleteCutout, applyBackground, cloneProject, createProject, restoreOriginalAthlete, updateProject } from "@/lib/creative/project";
import { exportCreativePng, renderCreative } from "@/lib/creative/renderer";
import { createIndexedDbCreativePersistence, loadCreativeProject, saveCreativeProject } from "@/lib/creative/persistence";
import type { CreativeAssetReference, CreativeCutoutCandidate, CreativeFormat, CreativeProject } from "@/lib/creative/types";
import { CREATIVE_FORMAT_DIMENSIONS, type CreativeLayerTransform, type CreativeTextLayer } from "@/lib/creative/types";
import { clampLayerPosition, hitTestCreativeLayer, interactionRectForLayer, layerLabel, moveLayer, resizeImageProportionally, setTextFontSize, textFontSizePixels, type CreativeImageDimensions, type CreativeInteractionLayer } from "@/lib/creative/interaction";

type Format = CreativeFormat;
type JobStatus = "idle" | "estimating" | "quoted" | "queued" | "running" | "succeeded" | "failed" | "unconfigured";

type Project = CreativeProject;
type CutoutCandidate = CreativeCutoutCandidate;

type Quote = { id: string; cost: number; expiresAt?: string; model?: string; prompt: string; revision: number; requestId: string; operation: "background" | "cutout"; sourceAssetId?: string };
type ExportResult = { url: string; filename: string; width: number; height: number; size: number };

type HistoryState = { project: Project; past: Project[]; future: Project[] };
type HistoryAction =
  | { type: "commit"; updater: (project: Project) => Project }
  | { type: "replace"; project: Project }
  | { type: "undo" }
  | { type: "redo" };

type InteractionPreview = {
  layer: CreativeInteractionLayer;
  transform: CreativeLayerTransform;
};

type DragState = {
  layer: CreativeInteractionLayer;
  pointerId: number;
  format: Format;
  revision: number;
  start: { x: number; y: number };
  transform: CreativeLayerTransform;
  latest: CreativeLayerTransform;
  moved: boolean;
};

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "replace") return { project: action.project, past: [], future: [] };
  if (action.type === "commit") {
    const next = action.updater(state.project);
    if (next === state.project) return state;
    return { project: next, past: [...state.past.slice(-29), state.project], future: [] };
  }
  if (action.type === "undo") {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    return { project: { ...previous, revision: state.project.revision + 1 }, past: state.past.slice(0, -1), future: [state.project, ...state.future] };
  }
  const next = state.future[0];
  if (!next) return state;
  return { project: { ...next, revision: state.project.revision + 1 }, past: [...state.past, state.project], future: state.future.slice(1) };
}

export type CreativeEditorBridge = {
  inspect: () => Project;
  updateEvent: (event: Partial<Project["event"]>) => void;
  proposeBackground: (prompt?: string) => Promise<void>;
  approveQuote: () => Promise<void>;
  applyCandidate: (id: string) => void;
  switchLayout: (format: Format) => void;
  exportArtwork: (format?: Format) => Promise<ExportResult>;
  undo: () => void;
  redo: () => void;
};

const sampleAthlete = "/starter-photos/Rishab.jpg";
const sampleLogo = "/branding/lockup-horizontal-cream.svg";
const sampleBackground = "/creative/livepeer-arena-sample.jpg";

function assetReference(slot: CreativeAssetReference["slot"], id: string, name: string, mimeType: string, source: CreativeAssetReference["source"], url: string, blobKey = `creative/${id}`): CreativeAssetReference {
  return { id, slot, name, mimeType, source, url, blobKey };
}

const initialSeed = (() => {
  const seed = createProject({ id: "brc-demo-01", event: { name: "NORTHWEST FINALS", date: "OCT 18 · 2026", location: "PORTLAND, OR", callToAction: "GET IN THE GAME" }, brief: "A sharp, dusk-lit field-side composition. Keep the athlete clear and let the teal-to-copper atmosphere carry the energy.", palette: { primary: "#153633", accent: "#d46c3c", text: "#fff8ef" } });
  const background = assetReference("background", "sample-background", "Previously generated arena sample", "image/jpeg", "sample", sampleBackground);
  seed.assets = {
    background,
    athlete: assetReference("athlete", "sample-athlete", "Rishab.jpg", "image/jpeg", "sample", sampleAthlete),
    logo: assetReference("logo", "sample-logo", "Batch Relay lockup", "image/svg+xml", "sample", sampleLogo),
  };
  seed.athleteOriginal = seed.assets.athlete;
  seed.athleteCutoutCandidates = [];
  seed.backgroundCandidates = [{ id: "sample-01", asset: background, prompt: seed.brief, createdAt: seed.createdAt, status: "ready", warning: "Previously generated sample; no new provider render was used." }];
  return seed;
})();

const initialProject: Project = {
  ...initialSeed,
};

function formatCost(value: number) {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function projectLayerTransform(project: Project, layer: CreativeInteractionLayer, format = project.format): CreativeLayerTransform | null {
  const layout = project.layouts[format];
  if (layer === "background" || layer === "athlete" || layer === "logo") return layout[layer];
  return layout.text.find((candidate) => candidate.id === layer.slice("text:".length))?.transform ?? null;
}

function updateProjectLayerTransform(project: Project, layer: CreativeInteractionLayer, transform: CreativeLayerTransform, format = project.format): Project {
  const layout = project.layouts[format];
  if (layer === "background" || layer === "athlete" || layer === "logo") {
    return updateProject(project, { layouts: { ...project.layouts, [format]: { ...layout, [layer]: transform } } });
  }
  const textId = layer.slice("text:".length);
  return updateProject(project, { layouts: { ...project.layouts, [format]: { ...layout, text: layout.text.map((candidate) => candidate.id === textId ? { ...candidate, transform } : candidate) } } });
}

function previewProjectLayerTransform(project: Project, layer: CreativeInteractionLayer, transform: CreativeLayerTransform): Project {
  const next = cloneProject(project);
  const layout = next.layouts[next.format];
  if (layer === "background" || layer === "athlete" || layer === "logo") {
    layout[layer] = transform;
  } else {
    const textId = layer.slice("text:".length);
    layout.text = layout.text.map((candidate) => candidate.id === textId ? { ...candidate, transform } : candidate);
  }
  return next;
}

type NumericFieldProps = {
  label: string;
  unit: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
};

function NumericField({ label, unit, value, onCommit, min, max }: NumericFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const cancelOnBlur = useRef(false);

  const finish = () => {
    if (cancelOnBlur.current) {
      cancelOnBlur.current = false;
      setEditing(false);
      setDraft(String(value));
      return;
    }
    setEditing(false);
    const parsed = Number(draft.trim());
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const bounded = Math.min(max ?? parsed, Math.max(min ?? parsed, parsed));
    setDraft(String(bounded));
    if (bounded !== value) onCommit(bounded);
  };

  const cancel = (input: HTMLInputElement) => {
    cancelOnBlur.current = true;
    setEditing(false);
    setDraft(String(value));
    input.blur();
  };

  return <label className={styles.inspectorField}><span>{label} <small>{unit}</small></span><input type="number" inputMode="decimal" min={min} max={max} step="1" value={editing ? draft : String(value)} onFocus={() => { cancelOnBlur.current = false; setEditing(true); setDraft(String(value)); }} onChange={(event) => { setEditing(true); setDraft(event.currentTarget.value); }} onBlur={finish} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") { event.preventDefault(); cancel(event.currentTarget); } }} /></label>;
}

function imageElementFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The photograph could not be prepared.")); };
    image.src = url;
  });
}

async function prepareCutoutCopy(url: string): Promise<Blob> {
  const source = await (await fetch(url)).blob();
  const image = await imageElementFromBlob(source);
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= 900 * 1024) return blob;
  }
  throw new Error("This photograph is still larger than 900 KiB after preparation.");
}

async function hasValidCutoutAlpha(blob: Blob): Promise<boolean> {
  if (typeof createImageBitmap !== "function") throw new Error("This browser cannot verify transparent pixels.");
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d"); if (!context) { bitmap.close(); throw new Error("The cutout could not be inspected."); }
  context.drawImage(bitmap, 0, 0); bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = false;
  let visible = false;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 8) transparent = true;
    if (pixels[index] > 247) visible = true;
    if (transparent && visible) return true;
  }
  return false;
}

export default function CreativeEditor() {
  const [history, dispatchHistory] = useReducer(historyReducer, { project: initialProject, past: [], future: [] });
  const { project, past, future } = history;
  const [recovered, setRecovered] = useState(false);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Local sample ready");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<ExportResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<"background" | "cutout" | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [showPasscode, setShowPasscode] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [sessionPending, setSessionPending] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<CreativeInteractionLayer | null>(null);
  const [interactionPreview, setInteractionPreview] = useState<InteractionPreview | null>(null);
  const [assetDimensions, setAssetDimensions] = useState<Record<string, CreativeImageDimensions>>({});
  const persistence = useRef(createIndexedDbCreativePersistence());
  const hydrated = useRef(false);
  const previewCanvas = useRef<HTMLCanvasElement | null>(null);
  const proofFrame = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<DragState | null>(null);
  const pollInFlight = useRef(false);
  const approveInFlight = useRef(false);
  const exportUrl = useRef<string | null>(null);

  useEffect(() => () => {
    if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
  }, []);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void loadCreativeProject(initialProject.id, persistence.current).then(async (saved) => {
      if (cancelled) return;
      if (saved) {
        const urls: Record<string, string> = {};
        const assetsToHydrate = [
          ...(["background", "athlete", "logo"] as const).map((slot) => saved.assets[slot]),
          saved.athleteOriginal,
        ];
        for (const asset of assetsToHydrate) {
          if (!asset) continue;
          if (asset.url) urls[asset.blobKey] = asset.url;
          const blob = await persistence.current.loadAssetBlob(asset.blobKey);
          if (blob) urls[asset.blobKey] = URL.createObjectURL(blob);
        }
        for (const candidate of saved.backgroundCandidates) {
          if (candidate.asset.url) urls[candidate.asset.blobKey] = candidate.asset.url;
          const blob = await persistence.current.loadAssetBlob(candidate.asset.blobKey);
          if (blob) urls[candidate.asset.blobKey] = URL.createObjectURL(blob);
        }
        const savedCutouts = saved.athleteCutoutCandidates ?? [];
        for (const candidate of savedCutouts) {
          if (candidate.asset.url) urls[candidate.asset.blobKey] = candidate.asset.url;
          const blob = await persistence.current.loadAssetBlob(candidate.asset.blobKey);
          if (blob) urls[candidate.asset.blobKey] = URL.createObjectURL(blob);
        }
        setAssetUrls(urls);
        dispatchHistory({ type: "replace", project: saved });
        setRecovered(true);
        const pending = saved.generationRefs.find((reference) => reference.status === "queued" || reference.status === "running");
        if (pending) { setJobId(pending.id); setPendingOperation(pending.target === "athlete" ? "cutout" : "background"); setStatus("running"); setStatusMessage(pending.target === "athlete" ? "Resuming athlete cutout…" : "Resuming background generation…"); }
      } else {
        await saveCreativeProject(initialProject, {}, persistence.current);
      }
      hydrated.current = true;
    }).catch(() => { hydrated.current = true; });
    void fetch("/api/creative/status").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { configured?: boolean; authorized?: boolean };
      setProviderConfigured(Boolean(data.configured && data.authorized));
      if (!data.configured) { setStatus("unconfigured"); setStatusMessage("Provider setup required for live renders"); }
    }).catch(() => setProviderConfigured(false));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    void saveCreativeProject(project, {}, persistence.current).catch(() => setStatusMessage("Local recovery unavailable; current proof remains open"));
  }, [project]);

  const commit = useCallback((next: Project | ((current: Project) => Project)) => {
    dispatchHistory({ type: "commit", updater: typeof next === "function" ? next : () => next });
  }, []);

  const updateEvent = useCallback((key: keyof Project["event"], value: string) => {
    commit((current) => updateProject(current, { event: { ...current.event, [key]: value } }));
  }, [commit]);

  const updateBrief = useCallback((value: string) => commit((current) => updateProject(current, { brief: value })), [commit]);
  const switchLayout = useCallback((format: Format) => commit((current) => updateProject(current, { format })), [commit]);
  const applyCandidate = useCallback((id: string) => commit((current) => {
    const candidate = current.backgroundCandidates.find((item) => item.id === id);
    return candidate?.status === "ready" ? applyBackground(current, candidate) : current;
  }), [commit]);
  const applyCutoutCandidate = useCallback((id: string) => commit((current) => {
    const candidate = current.athleteCutoutCandidates?.find((item) => item.id === id);
    return candidate ? applyAthleteCutout(current, candidate) : current;
  }), [commit]);
  const restoreAthlete = useCallback(() => commit((current) => restoreOriginalAthlete(current)), [commit]);

  const undo = useCallback(() => {
    dispatchHistory({ type: "undo" });
  }, []);

  const redo = useCallback(() => {
    dispatchHistory({ type: "redo" });
  }, []);

  const createEstimate = useCallback(async (prompt = project.brief, palette = project.palette, requestedRevision = project.revision): Promise<Quote | null> => {
    setGenerationError(null);
    setStatus("estimating");
    setStatusMessage("Preparing a bound estimate…");
    if (requestedRevision !== project.revision) {
      setStatus("failed"); setStatusMessage("Estimate is out of date"); setGenerationError("The project changed; inspect it again before requesting a render."); return null;
    }
    if (!providerConfigured) {
      setStatus("unconfigured"); setStatusMessage("Live provider is not configured"); setShowPasscode(true); return null;
    }
    try {
      const estimateRequestId = crypto.randomUUID();
      const response = await fetch("/api/creative/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id, revision: requestedRevision, prompt, palette: { primary: palette.primary, accent: palette.accent }, requestId: estimateRequestId }) });
      const data = await response.json() as { id?: string; estimatedCostUsd?: number; expiresAt?: string; model?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error || "Estimate unavailable");
      const nextQuote = { id: data.id, cost: data.estimatedCostUsd ?? 0.1, expiresAt: data.expiresAt, model: data.model, prompt, revision: requestedRevision, requestId: `${data.id}:execute`, operation: "background" as const };
      setQuote(nextQuote);
      setStatus("quoted"); setStatusMessage("Estimate ready · approval required");
      return nextQuote;
    } catch (error) {
      setStatus("failed"); setStatusMessage("Estimate could not be prepared"); setGenerationError(error instanceof Error ? error.message : "Unknown estimate error");
      return null;
    }
  }, [project, providerConfigured]);

  const approveQuote = useCallback(async () => {
    if (!quote || approveInFlight.current || status === "queued" || status === "running") return;
    if (quote.revision !== project.revision) {
      setGenerationError("This estimate belongs to an earlier revision. Request a new estimate before rendering.");
      setStatus("failed"); setStatusMessage("Estimate is out of date"); return;
    }
    if (quote.operation === "cutout" && quote.sourceAssetId !== (project.athleteOriginal?.id ?? project.assets.athlete?.id)) {
      setGenerationError("This cutout estimate belongs to an earlier photograph. Upload or choose the current photograph and request a new estimate.");
      setStatus("failed"); setStatusMessage("Cutout estimate is out of date"); return;
    }
    approveInFlight.current = true;
    setStatus("queued"); setPendingOperation(quote.operation); setStatusMessage(quote.operation === "cutout" ? "Submitting approved cutout request…" : "Submitting approved background request…"); setGenerationError(null);
    try {
      const response = await fetch("/api/creative/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ estimateId: quote.id, requestId: quote.requestId, projectId: project.id, revision: quote.revision, operation: quote.operation }) });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error || "Render could not be queued");
      const job = data.id;
      setJobId(job); setStatus("running"); setStatusMessage(quote.operation === "cutout" ? "Livepeer is removing the athlete background…" : "Livepeer is preparing a background…"); setQuote(null);
      const candidateId = `candidate-${job}`;
      if (quote.operation === "cutout") {
        const sourceAssetId = quote.sourceAssetId as string;
        commit((current) => {
          const typed = current;
          const candidate: CutoutCandidate = { id: candidateId, asset: assetReference("athlete", candidateId, "Athlete cutout", "image/png", "generated", "", `creative/${candidateId}`), prompt: quote.prompt, createdAt: new Date().toISOString(), generationId: job, status: "pending", sourceAssetId };
          const next = updateProject(current, { generationRefs: [...current.generationRefs, { id: job, candidateId, prompt: quote.prompt, estimatedCostUsd: quote.cost, model: quote.model, status: "running", createdAt: new Date().toISOString(), target: "athlete", sourceAssetId }] });
          next.athleteOriginal = typed.athleteOriginal ?? current.assets.athlete;
          next.athleteCutoutCandidates = [...(typed.athleteCutoutCandidates ?? []), candidate];
          return next;
        });
        return;
      }
      commit((current) => updateProject(current, {
        backgroundCandidates: [...current.backgroundCandidates, {
          id: candidateId,
          asset: assetReference("background", candidateId, "New direction", "image/png", "generated", "", `creative/${candidateId}`),
          prompt: quote.prompt,
          createdAt: new Date().toISOString(),
          generationId: job,
          status: "pending",
        }],
        generationRefs: [...current.generationRefs, { id: job, candidateId, prompt: quote.prompt, estimatedCostUsd: quote.cost, model: quote.model, status: "running", createdAt: new Date().toISOString(), target: "background" }],
      }));
    } catch (error) {
      setStatus("failed"); setPendingOperation(null); setStatusMessage("Render was not started"); setGenerationError(error instanceof Error ? error.message : "Unknown render error");
    } finally {
      approveInFlight.current = false;
    }
  }, [commit, project.assets.athlete?.id, project.athleteOriginal?.id, project.id, project.revision, quote, status]);

  useEffect(() => {
    if (!jobId || !["running", "queued"].includes(status)) return;
    let cancelled = false;
    const poll = async () => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try {
        const response = await fetch(`/api/creative/jobs/${encodeURIComponent(jobId)}`);
        if (response.status === 401) {
          setProviderConfigured(false); setStatus("unconfigured"); setStatusMessage("Live generation session expired; unlock to resume"); setShowPasscode(true); return;
        }
        if (!response.ok) return;
        const data = await response.json() as { status?: string; imageUrl?: string; error?: string; warnings?: string[] };
        if (cancelled) return;
        if (data.status === "succeeded") {
          if (pendingOperation === "cutout") {
            const candidate = (project.athleteCutoutCandidates ?? []).find((item) => item.generationId === jobId);
            if (!candidate || candidate.sourceAssetId !== (project.athleteOriginal?.id ?? project.assets.athlete?.id) || !data.imageUrl) {
              setStatus("failed"); setStatusMessage("Cutout no longer matches this photograph"); setGenerationError("Upload changes made this cutout obsolete. Request a new cutout for the current photograph."); setJobId(null); setPendingOperation(null); return;
            }
            try {
              const imageResponse = await fetch(data.imageUrl);
              if (imageResponse.status === 401) { setProviderConfigured(false); setStatus("unconfigured"); setStatusMessage("Live generation session expired; unlock to resume"); setShowPasscode(true); return; }
              if (!imageResponse.ok) throw new Error("Image proxy did not return the cutout.");
              const blob = await imageResponse.blob();
              if (!(await hasValidCutoutAlpha(blob))) throw new Error("The returned cutout did not contain both transparent and visible pixels.");
              if (cancelled) return;
              await persistence.current.saveAssetBlob(candidate.asset.blobKey, blob);
              if (cancelled) return;
              const localUrl = URL.createObjectURL(blob);
              setAssetUrls((current) => ({ ...current, [candidate.asset.blobKey]: localUrl }));
              commit((current) => {
                const next = updateProject(current, { generationRefs: current.generationRefs.map((item) => item.id === jobId ? { ...item, status: "succeeded" } : item) });
                next.athleteOriginal = current.athleteOriginal ?? current.assets.athlete;
                next.athleteCutoutCandidates = (current.athleteCutoutCandidates ?? []).map((item) => item.id === candidate.id ? { ...item, status: "ready", warning: "Cutout ready; review before applying.", asset: { ...item.asset, url: data.imageUrl, mimeType: blob.type || item.asset.mimeType } } : item);
                return next;
              });
              setStatus("succeeded"); setStatusMessage("Athlete cutout ready for review"); setJobId(null); setPendingOperation(null); return;
            } catch (error) {
              commit((current) => {
                const next = updateProject(current, { generationRefs: current.generationRefs.map((item) => item.id === jobId ? { ...item, status: "failed" } : item) });
                next.athleteOriginal = current.athleteOriginal ?? current.assets.athlete;
                next.athleteCutoutCandidates = (current.athleteCutoutCandidates ?? []).map((item) => item.id === candidate.id ? { ...item, status: "failed", warning: error instanceof Error ? error.message : "Cutout validation failed." } : item);
                return next;
              });
              setStatus("failed"); setStatusMessage("Cutout validation failed"); setGenerationError(error instanceof Error ? error.message : "Cutout validation failed."); setJobId(null); setPendingOperation(null); return;
            }
          }
          const candidateId = `candidate-${jobId}`;
          const candidate = project.backgroundCandidates.find((item) => item.id === candidateId);
          if (!candidate || !data.imageUrl) {
            setStatus("failed"); setPendingOperation(null); setStatusMessage("Background render returned no image"); setGenerationError("The provider finished without a retrievable image."); setJobId(null); return;
          }
          let completedMimeType = candidate.asset.mimeType;
          try {
            const imageResponse = await fetch(data.imageUrl);
            if (imageResponse.status === 401) {
              setProviderConfigured(false); setStatus("unconfigured"); setStatusMessage("Live generation session expired; unlock to resume"); setShowPasscode(true); return;
            }
            if (!imageResponse.ok) throw new Error("Image proxy did not return the rendered image.");
            const blob = await imageResponse.blob();
            completedMimeType = blob.type || completedMimeType;
            if (cancelled) return;
            await persistence.current.saveAssetBlob(candidate.asset.blobKey, blob);
            if (cancelled) return;
            const localUrl = URL.createObjectURL(blob);
            setAssetUrls((current) => ({ ...current, [candidate.asset.blobKey]: localUrl }));
          } catch (error) {
            commit((current) => updateProject(current, {
              backgroundCandidates: current.backgroundCandidates.map((item) => item.id === candidateId ? { ...item, status: "failed", warning: error instanceof Error ? error.message : "Rendered image could not be stored." } : item),
              generationRefs: current.generationRefs.map((item) => item.id === jobId ? { ...item, status: "failed" } : item),
            }));
            setStatus("failed"); setPendingOperation(null); setStatusMessage("Rendered image could not be stored"); setGenerationError(error instanceof Error ? error.message : "Rendered image could not be stored."); setJobId(null); return;
          }
          commit((current) => updateProject(current, {
            backgroundCandidates: current.backgroundCandidates.map((item) => item.id === candidateId ? { ...item, status: "ready", warning: "Live render ready; review before applying.", asset: { ...item.asset, url: data.imageUrl, mimeType: completedMimeType } } : item),
            generationRefs: current.generationRefs.map((item) => item.id === jobId ? { ...item, status: "succeeded" } : item),
          }));
          setStatus("succeeded"); setPendingOperation(null); setStatusMessage("Background ready for review"); setJobId(null);
        } else if (data.status === "failed" || data.status === "unknown") {
          const candidateId = `candidate-${jobId}`;
          commit((current) => updateProject(current, {
            backgroundCandidates: current.backgroundCandidates.map((item) => item.id === candidateId ? { ...item, status: "failed", warning: data.error || "Provider returned no artwork." } : item),
            generationRefs: current.generationRefs.map((item) => item.id === jobId ? { ...item, status: data.status === "unknown" ? "unknown" : "failed" } : item),
          }));
          setStatus("failed"); setPendingOperation(null); setStatusMessage("Background render failed"); setGenerationError(data.error || "Provider returned no artwork"); setJobId(null);
        }
      } catch { /* transient poll errors keep the pending job recoverable */ }
      finally { pollInFlight.current = false; }
    };
    const timer = window.setInterval(() => void poll(), 1800);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [commit, jobId, pendingOperation, project.athleteCutoutCandidates, project.backgroundCandidates, project.assets.athlete?.id, project.athleteOriginal?.id, status]);

  const resolvedAssets = useMemo(() => ({
    background: project.assets.background ? assetUrls[project.assets.background.blobKey] ?? assetUrls[project.assets.background.id] ?? project.assets.background.url : undefined,
    athlete: project.assets.athlete ? assetUrls[project.assets.athlete.blobKey] ?? assetUrls[project.assets.athlete.id] ?? project.assets.athlete.url : undefined,
    logo: project.assets.logo ? assetUrls[project.assets.logo.blobKey] ?? assetUrls[project.assets.logo.id] ?? project.assets.logo.url : undefined,
  }), [assetUrls, project.assets]);

  useEffect(() => {
    let cancelled = false;
    for (const [slot, url] of Object.entries(resolvedAssets) as Array<["background" | "athlete" | "logo", string | undefined]>) {
      if (!url || typeof Image === "undefined") continue;
      const image = new Image();
      image.onload = () => {
        if (cancelled || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
        const reference = project.assets[slot];
        if (!reference) return;
        setAssetDimensions((current) => ({ ...current, [reference.blobKey]: { width: image.naturalWidth, height: image.naturalHeight }, [reference.id]: { width: image.naturalWidth, height: image.naturalHeight } }));
      };
      image.src = url;
    }
    return () => { cancelled = true; };
  }, [project.assets, resolvedAssets]);

  const assetDimensionsForSlot = useCallback((slot: "background" | "athlete" | "logo") => {
    const reference = project.assets[slot];
    if (!reference) return undefined;
    return assetDimensions[reference.blobKey] ?? assetDimensions[reference.id] ?? (reference.width && reference.height ? { width: reference.width, height: reference.height } : undefined);
  }, [assetDimensions, project.assets]);

  const availableAssets = useMemo(() => ({
    background: Boolean(project.assets.background),
    athlete: Boolean(project.assets.athlete),
    logo: Boolean(project.assets.logo),
  }), [project.assets]);

  const previewProject = useMemo(() => interactionPreview ? previewProjectLayerTransform(project, interactionPreview.layer, interactionPreview.transform) : project, [interactionPreview, project]);

  const commitLayerTransform = useCallback((layer: CreativeInteractionLayer, transform: CreativeLayerTransform) => {
    commit((current) => updateProjectLayerTransform(current, layer, transform));
  }, [commit]);

  const updateLayerPositionPixels = useCallback((layer: CreativeInteractionLayer, axis: "x" | "y", value: number) => {
    if (!Number.isFinite(value)) return;
    const transform = projectLayerTransform(project, layer);
    if (!transform) return;
    const dimensions = CREATIVE_FORMAT_DIMENSIONS[project.format];
    const nextPosition = clampLayerPosition(transform, axis === "x" ? value / dimensions.width : transform.x, axis === "y" ? value / dimensions.height : transform.y);
    commitLayerTransform(layer, { ...transform, ...nextPosition });
  }, [commitLayerTransform, project]);

  const resizeSelectedImage = useCallback((value: number) => {
    if (!selectedLayer || !["background", "athlete", "logo"].includes(selectedLayer) || !Number.isFinite(value)) return;
    const transform = projectLayerTransform(project, selectedLayer);
    if (!transform) return;
    const dimensions = CREATIVE_FORMAT_DIMENSIONS[project.format];
    commitLayerTransform(selectedLayer, resizeImageProportionally(transform, value / dimensions.width));
  }, [commitLayerTransform, project, selectedLayer]);

  const updateSelectedTextSize = useCallback((value: number) => {
    if (!selectedLayer?.startsWith("text:") || !Number.isFinite(value)) return;
    const textId = selectedLayer.slice("text:".length);
    const layer = project.layouts[project.format].text.find((candidate) => candidate.id === textId);
    if (!layer) return;
    const dimensions = CREATIVE_FORMAT_DIMENSIONS[project.format];
    const next = setTextFontSize(layer, value, dimensions.width, dimensions.height);
    commit((current) => updateProject(current, { layouts: { ...current.layouts, [current.format]: { ...current.layouts[current.format], text: current.layouts[current.format].text.map((candidate) => candidate.id === textId ? next : candidate) } } }));
  }, [commit, project, selectedLayer]);

  const updateSelectedTextAlignment = useCallback((align: CreativeTextLayer["align"]) => {
    if (!selectedLayer?.startsWith("text:") || !align) return;
    const textId = selectedLayer.slice("text:".length);
    commit((current) => updateProject(current, { layouts: { ...current.layouts, [current.format]: { ...current.layouts[current.format], text: current.layouts[current.format].text.map((candidate) => candidate.id === textId ? { ...candidate, align } : candidate) } } }));
  }, [commit, selectedLayer]);

  const proposeCutout = useCallback(async () => {
    const source = project.athleteOriginal ?? project.assets.athlete;
    const sourceUrl = source ? assetUrls[source.blobKey] ?? assetUrls[source.id] ?? source.url : undefined;
    if (!source || typeof sourceUrl !== "string") { setGenerationError("Add a photograph before requesting a cutout."); return; }
    if (!providerConfigured) { setStatus("unconfigured"); setStatusMessage("Live provider is not configured"); setShowPasscode(true); return; }
    setGenerationError(null); setStatus("estimating"); setStatusMessage("Preparing a private cutout estimate…");
    try {
      const copy = await prepareCutoutCopy(sourceUrl);
      const form = new FormData();
      form.set("projectId", project.id); form.set("revision", String(project.revision)); form.set("requestId", crypto.randomUUID()); form.set("sourceAssetId", source.id); form.set("image", copy, "athlete-cutout.jpg");
      const response = await fetch("/api/creative/cutouts/estimate", { method: "POST", body: form });
      const data = await response.json() as { id?: string; estimatedCostUsd?: number; expiresAt?: string; model?: string; error?: string; operation?: string; sourceAssetId?: string };
      if (!response.ok || !data.id) throw new Error(data.error || "Cutout estimate unavailable");
      const nextQuote: Quote = { id: data.id, cost: data.estimatedCostUsd ?? 0.1, expiresAt: data.expiresAt, model: data.model, prompt: "Remove the background from the supplied athlete photograph while preserving the subject.", revision: project.revision, requestId: `${data.id}:execute`, operation: "cutout", sourceAssetId: data.sourceAssetId || source.id };
      setQuote(nextQuote); setStatus("quoted"); setStatusMessage("Cutout estimate ready · approval required");
    } catch (error) {
      setStatus("failed"); setStatusMessage("Cutout estimate could not be prepared"); setGenerationError(error instanceof Error ? error.message : "Cutout estimate unavailable");
    }
  }, [assetUrls, project, providerConfigured]);

  useEffect(() => {
    const canvas = previewCanvas.current;
    if (!canvas) return;
    void renderCreative(previewProject, resolvedAssets, { canvas, format: previewProject.format }).catch(() => setStatusMessage("Preview could not resolve one or more source layers"));
  }, [previewProject, resolvedAssets]);

  const canvasPoint = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const frame = proofFrame.current;
    if (!frame) return null;
    const bounds = frame.getBoundingClientRect();
    const dimensions = CREATIVE_FORMAT_DIMENSIONS[project.format];
    return {
      x: ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * dimensions.width,
      y: ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * dimensions.height,
    };
  }, [project.format]);

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const point = canvasPoint(event);
    if (!point) return;
    const layer = hitTestCreativeLayer(point, project.layouts[project.format], project.format, {
      background: assetDimensionsForSlot("background"),
      athlete: assetDimensionsForSlot("athlete"),
      logo: assetDimensionsForSlot("logo"),
    }, availableAssets);
    if (!layer) {
      setSelectedLayer(null);
      return;
    }
    const transform = projectLayerTransform(project, layer);
    if (!transform) return;
    setSelectedLayer(layer);
    dragState.current = { layer, pointerId: event.pointerId, format: project.format, revision: project.revision, start: point, transform, latest: transform, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    proofFrame.current?.focus();
  }, [assetDimensionsForSlot, availableAssets, canvasPoint, project]);

  const handleCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.format !== project.format || drag.revision !== project.revision) {
      dragState.current = null;
      setInteractionPreview(null);
      return;
    }
    const point = canvasPoint(event);
    if (!point) return;
    const dimensions = CREATIVE_FORMAT_DIMENSIONS[project.format];
    const delta = { x: (point.x - drag.start.x) / dimensions.width, y: (point.y - drag.start.y) / dimensions.height };
    if (!drag.moved && Math.hypot(delta.x, delta.y) < 0.002) return;
    drag.moved = true;
    const nextTransform = moveLayer(drag.transform, delta);
    drag.latest = nextTransform;
    setInteractionPreview({ layer: drag.layer, transform: nextTransform });
  }, [canvasPoint, project.format, project.revision]);

  const finishCanvasDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && drag.moved && drag.format === project.format && drag.revision === project.revision) {
      commitLayerTransform(drag.layer, drag.latest);
    }
    dragState.current = null;
    setInteractionPreview(null);
  }, [commitLayerTransform, project.format, project.revision]);

  const handleCanvasKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Escape" && dragState.current) {
      dragState.current = null;
      setInteractionPreview(null);
      event.preventDefault();
      return;
    }
    if (!selectedLayer) return;
    const directions: Record<string, { x: number; y: number }> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const transform = projectLayerTransform(project, selectedLayer);
    if (!transform) return;
    const dimensions = CREATIVE_FORMAT_DIMENSIONS[project.format];
    const step = event.shiftKey ? 10 : 1;
    commitLayerTransform(selectedLayer, moveLayer(transform, { x: (direction.x * step) / dimensions.width, y: (direction.y * step) / dimensions.height }));
  }, [commitLayerTransform, project, selectedLayer]);

  const exportArtwork = useCallback(async (requestedFormat = project.format) => {
    setExportError(null);
    try {
      const blob = await exportCreativePng(project, resolvedAssets, { format: requestedFormat });
      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
      const url = URL.createObjectURL(blob);
      exportUrl.current = url;
      const result = { url, filename: `batch-relay-${requestedFormat}.png`, width: requestedFormat === "card" ? 1080 : 1920, height: requestedFormat === "card" ? 1350 : 1080, size: blob.size };
      setLastExport(result);
      const link = document.createElement("a"); link.href = url; link.download = result.filename; link.click();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The PNG could not be exported.";
      setExportError(message);
      throw error;
    }
  }, [project, resolvedAssets]);

  const bridge = useMemo<CreativeEditorBridge>(() => ({ inspect: () => project, updateEvent: (event) => commit((current) => updateProject(current, { event: { ...current.event, ...event } })), proposeBackground: async (prompt) => { await createEstimate(prompt); }, approveQuote, applyCandidate, switchLayout, exportArtwork, undo, redo }), [applyCandidate, approveQuote, commit, createEstimate, exportArtwork, project, redo, switchLayout, undo]);

  useEffect(() => {
    const event = new CustomEvent("batch-relay-creative-ready", { detail: bridge });
    window.dispatchEvent(event);
    return () => { window.dispatchEvent(new CustomEvent("batch-relay-creative-dispose")); };
  }, [bridge]);

  useEffect(() => {
    const respond = (request: CreativeWebMcpActionRequest, result: unknown) => respondToCreativeWebMcpAction({ requestId: request.requestId, result });
    const reject = (request: CreativeWebMcpActionRequest, message: string, code: "invalid_input" | "stale_revision" | "candidate_not_found" | "job_not_found" | "history_unavailable" | "export_failed" | "creative_error" = "creative_error") => respondToCreativeWebMcpAction({ requestId: request.requestId, error: { code, message, retryable: code === "job_not_found" || code === "history_unavailable", commitStatus: "not_committed" } });
    const unsubscribe = subscribeToCreativeWebMcpActions((request) => {
      const input = request.input;
      const inputProjectId = typeof input.projectId === "string" ? input.projectId : project.id;
      const inputRevision = typeof input.revision === "number" ? input.revision : project.revision;
      if (inputProjectId !== project.id) return reject(request, "The requested project is not open.", "invalid_input");
      if (["update_event_details", "propose_background", "apply_background_candidate", "switch_layout", "export_artwork"].includes(request.action) && inputRevision !== project.revision) return reject(request, "The visible project changed; inspect it again before applying this request.", "stale_revision");
      if (request.action === "inspect_project") return respond(request, { ...project, pendingJobCount: project.backgroundCandidates.filter((item) => item.status === "pending").length });
      if (request.action === "update_event_details") {
        const event = input.event && typeof input.event === "object" ? input.event as Partial<Project["event"]> : null;
        if (!event) return reject(request, "Event details are required.", "invalid_input");
        commit((current) => updateProject(current, { event: { ...current.event, ...event } }));
        return respond(request, { projectId: project.id, revision: project.revision + 1, event });
      }
      if (request.action === "propose_background") {
        const prompt = typeof input.prompt === "string" && input.prompt.trim() ? input.prompt : project.brief;
        const paletteInput = input.palette && typeof input.palette === "object" ? input.palette as { primary?: unknown; accent?: unknown } : {};
        const palette = typeof paletteInput.primary === "string" && typeof paletteInput.accent === "string" ? { primary: paletteInput.primary, accent: paletteInput.accent } : project.palette;
        void createEstimate(prompt, palette, inputRevision).then((estimate) => respond(request, estimate ? { status: "proposed", estimate } : { status: "failed", message: "Estimate unavailable" }));
        return;
      }
      if (request.action === "check_generation") {
        const requestedJobId = typeof input.jobId === "string" ? input.jobId : "";
        const candidate = project.backgroundCandidates.find((item) => item.generationId === requestedJobId);
        if (!candidate) return reject(request, "That generation job is not present in this project.", "job_not_found");
        return respond(request, { jobId: requestedJobId, status: candidate.status === "pending" ? "running" : candidate.status === "ready" ? "succeeded" : "unknown", candidateId: candidate.id, imageUrl: candidate.asset.url });
      }
      if (request.action === "apply_background_candidate") {
        const candidateId = typeof input.candidateId === "string" ? input.candidateId : "";
        const candidate = project.backgroundCandidates.find((item) => item.id === candidateId && item.status === "ready");
        if (!candidate) return reject(request, "Choose a completed background candidate first.", "candidate_not_found");
        applyCandidate(candidate.id); return respond(request, { projectId: project.id, revision: project.revision + 1, appliedCandidateId: candidate.id });
      }
      if (request.action === "switch_layout") {
        const layout = input.layout === "banner" ? "banner" : input.layout === "card" ? "card" : null;
        if (!layout) return reject(request, "Layout must be card or banner.", "invalid_input");
        switchLayout(layout); return respond(request, { projectId: project.id, revision: project.revision + 1, format: layout, width: layout === "card" ? 1080 : 1920, height: layout === "card" ? 1350 : 1080 });
      }
      if (request.action === "export_artwork") {
        const format = input.format === "banner" ? "banner" : "card";
        void exportArtwork(format).then((result) => respond(request, result)).catch(() => reject(request, "The PNG could not be exported.", "export_failed"));
        return;
      }
      if (request.action === "undo") { if (!past.length) return reject(request, "There is no earlier project state to restore.", "history_unavailable"); undo(); return respond(request, { projectId: project.id, revision: project.revision + 1, action: "undo" }); }
      if (request.action === "redo") { if (!future.length) return reject(request, "There is no later project state to restore.", "history_unavailable"); redo(); return respond(request, { projectId: project.id, revision: project.revision + 1, action: "redo" }); }
      return reject(request, `Unsupported creative action: ${request.action}`, "invalid_input");
    });
    return () => { unsubscribe(); };
  }, [applyCandidate, commit, createEstimate, exportArtwork, future.length, past.length, project, redo, switchLayout, undo]);

  useEffect(() => {
    publishCreativeWebMcpState({
      projectId: project.id,
      revision: project.revision,
      layout: project.format,
      hasProject: true,
      hasApprovedBackground: Boolean(project.assets.background),
      pendingJobCount: project.backgroundCandidates.filter((candidate) => candidate.status === "pending").length,
      pendingCandidateCount: project.backgroundCandidates.filter((candidate) => candidate.status === "ready").length,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
    });
  }, [future.length, past.length, project]);

  const selectedCandidate = project.backgroundCandidates.find((candidate) => candidate.asset.id === project.assets.background?.id) ?? project.backgroundCandidates[0];
  const updateUpload = async (kind: "athlete" | "logo", file?: File) => {
    if (!file) return;
    const blobKey = `creative/${project.id}/${kind}-${crypto.randomUUID()}`;
    const url = URL.createObjectURL(file);
    setAssetUrls((current) => ({ ...current, [blobKey]: url }));
    const reference = assetReference(kind, `${kind}-${crypto.randomUUID()}`, file.name, file.type || "application/octet-stream", "upload", url, blobKey);
    commit((current) => {
      const next = updateProject(current, { assets: { ...current.assets, [kind]: reference }, ...(kind === "athlete" ? { athleteOriginal: reference, athleteCutoutCandidates: [] } : {}) });
      return next;
    });
    await persistence.current.saveAssetBlob(blobKey, file);
  };

  const layerOptions = useMemo<CreativeInteractionLayer[]>(() => [
    "background",
    "athlete",
    "logo",
    ...project.layouts[project.format].text.map((layer) => `text:${layer.id}` as const),
  ], [project.format, project.layouts]);
  const selectedTransform = selectedLayer ? projectLayerTransform(project, selectedLayer) : null;
  const selectedText = selectedLayer?.startsWith("text:") ? project.layouts[project.format].text.find((layer) => layer.id === selectedLayer.slice("text:".length)) : null;
  const previewLayout = previewProject.layouts[previewProject.format];
  const selectedRect = selectedLayer ? interactionRectForLayer(previewLayout, project.format, selectedLayer, {
    background: assetDimensionsForSlot("background"),
    athlete: assetDimensionsForSlot("athlete"),
    logo: assetDimensionsForSlot("logo"),
  }) : null;
  const canvasDimensions = CREATIVE_FORMAT_DIMENSIONS[project.format];

  return (
    <main className={styles.workbench}>
      <header className={styles.topbar}>
        <div className={styles.brand}><span className={styles.brandMark}>BR</span><span className={styles.brandCopy}><strong>Batch Relay</strong><span>Creative desk / 01</span></span></div>
        <div className={styles.projectTitle}><span>Working project</span><strong>{project.event.name || "Untitled event"}</strong></div>
        <div className={styles.topActions}><span className={styles.status}><i className={styles.statusDot} />{status === "unconfigured" ? "Setup needed" : "Local recovery on"}</span><button className={styles.quietButton} type="button" onClick={() => void exportArtwork().catch(() => undefined)}>Download PNG</button></div>
      </header>
      <div className={styles.layout}>
        <aside className={styles.rail} aria-label="Event details and source assets">
          <section className={styles.railSection}><div className={styles.sectionHeading}><p className={styles.eyebrow}>01 / Event card</p><span className={styles.tinyLabel}>REV {String(project.revision).padStart(2, "0")}</span></div>
            <div className={styles.field}><label htmlFor="event-name">Event name</label><input id="event-name" value={project.event.name} onChange={(event) => updateEvent("name", event.target.value)} /></div>
            <div className={styles.field}><label htmlFor="event-date">Date</label><input id="event-date" value={project.event.date} onChange={(event) => updateEvent("date", event.target.value)} /></div>
            <div className={styles.field}><label htmlFor="event-location">Location</label><input id="event-location" value={project.event.location} onChange={(event) => updateEvent("location", event.target.value)} /></div>
            <div className={styles.field}><label htmlFor="event-cta">Call to action</label><input id="event-cta" value={project.event.callToAction} onChange={(event) => updateEvent("callToAction", event.target.value)} /></div>
          </section>
          <section className={styles.railSection}><p className={styles.eyebrow}>02 / Output format</p><div className={styles.formatSwitch}><button className={styles.formatButton} type="button" aria-pressed={project.format === "card"} onClick={() => switchLayout("card")}><strong>PORTRAIT</strong><span>1080 × 1350</span></button><button className={styles.formatButton} type="button" aria-pressed={project.format === "banner"} onClick={() => switchLayout("banner")}><strong>BANNER</strong><span>1920 × 1080</span></button></div></section>
          <section className={styles.railSection}><div className={styles.sectionHeading}><p className={styles.eyebrow}>03 / Direct layer edit</p><span className={styles.tinyLabel}>{project.format.toUpperCase()}</span></div>
            <p className={styles.inspectorHint}>Select a layer, then drag to move or use precise controls. Arrow keys nudge by 1 px, or 10 px with Shift.</p>
            <label className={styles.layerSelectLabel} htmlFor="creative-layer-select">LAYER</label><select id="creative-layer-select" className={styles.layerSelect} value={selectedLayer ?? ""} onChange={(event) => setSelectedLayer((event.target.value || null) as CreativeInteractionLayer | null)}><option value="">Choose a layer…</option>{layerOptions.map((layer) => <option key={layer} value={layer}>{layerLabel(layer)}</option>)}</select>
            {selectedLayer && selectedTransform && <div className={styles.layerInspector} aria-label={`${layerLabel(selectedLayer)} controls`}>
              <div className={styles.inspectorTitle}><strong>{layerLabel(selectedLayer)}</strong><span>LAYOUT / {project.format.toUpperCase()}</span></div>
              <div className={styles.inspectorGrid}><NumericField label="X" unit="px" value={Math.round(selectedTransform.x * canvasDimensions.width)} onCommit={(value) => updateLayerPositionPixels(selectedLayer, "x", value)} /><NumericField label="Y" unit="px" value={Math.round(selectedTransform.y * canvasDimensions.height)} onCommit={(value) => updateLayerPositionPixels(selectedLayer, "y", value)} /></div>
              {selectedLayer === "background" || selectedLayer === "athlete" || selectedLayer === "logo" ? <NumericField label="WIDTH" unit="px · aspect locked" min={40} max={Math.round(canvasDimensions.width * 1.8)} value={Math.round(selectedTransform.width * canvasDimensions.width)} onCommit={resizeSelectedImage} /> : null}
              {selectedText ? <><NumericField label="FONT SIZE" unit="px" min={10} max={Math.round(canvasDimensions.width * 0.25)} value={textFontSizePixels(selectedText, canvasDimensions.width)} onCommit={updateSelectedTextSize} /><div className={styles.alignmentControl}><span>ALIGNMENT</span><div>{(["left", "center", "right"] as const).map((align) => <button key={align} className={selectedText.align === align ? styles.alignmentSelected : ""} type="button" aria-pressed={selectedText.align === align} onClick={() => updateSelectedTextAlignment(align)}>{align}</button>)}</div></div><p className={styles.inspectorHint}>Long text wraps to fit the layer.</p></> : null}
            </div>}
          </section>
          <section className={styles.railSection}><p className={styles.eyebrow}>04 / Source layers</p>
            <label className={styles.upload}><input type="file" accept="image/png,image/jpeg" onChange={(event) => void updateUpload("athlete", event.target.files?.[0])} />{resolvedAssets.athlete ? <img className={styles.uploadThumb} src={resolvedAssets.athlete} alt="Athlete source preview" /> : <span className={styles.uploadMark}>+</span>}<span className={styles.uploadText}><strong>Photograph</strong><span>PNG / JPEG · pixels retained</span></span></label>
            <label className={styles.upload} style={{ marginTop: 8 }}><input type="file" accept="image/png,image/svg+xml" onChange={(event) => void updateUpload("logo", event.target.files?.[0])} />{resolvedAssets.logo ? <img className={styles.uploadThumb} src={resolvedAssets.logo} alt="Logo source preview" /> : <span className={styles.uploadMark}>+</span>}<span className={styles.uploadText}><strong>Event logo</strong><span>PNG / SVG · independent layer</span></span></label>
            <p className={styles.cutoutDisclosure}>Background removal sends a copy of your photograph to Livepeer. Your original photo stays saved locally.</p><button className={`${styles.orangeButton} ${styles.cutoutAction}`} type="button" disabled={!project.assets.athlete || status === "estimating" || status === "running" || status === "queued"} onClick={() => void proposeCutout()}>Upload photo &amp; estimate</button>
            {project.athleteOriginal && project.assets.athlete?.id !== project.athleteOriginal.id && <button className={styles.directionButton} type="button" style={{ marginTop: 8, width: "100%" }} onClick={restoreAthlete}>Restore original photo</button>}
            {(project.athleteCutoutCandidates?.length ?? 0) > 0 && <div className={styles.cutoutCandidates} aria-label="Athlete cutout candidates">{project.athleteCutoutCandidates?.map((candidate) => { const sourceId = project.athleteOriginal?.id ?? project.assets.athlete?.id; const sourceMatches = candidate.sourceAssetId === sourceId; const candidateUrl = assetUrls[candidate.asset.blobKey] ?? candidate.asset.url; return <div className={styles.cutoutCard} key={candidate.id}>{candidateUrl ? <img className={styles.cutoutThumb} src={candidateUrl} alt="Athlete cutout candidate" /> : <div className={styles.cutoutThumb} aria-hidden="true" />}<div className={styles.cutoutMeta}><strong>{candidate.status === "ready" ? "Cutout ready" : candidate.status === "pending" ? "Cutout processing" : "Cutout unavailable"}</strong><span>{sourceMatches ? "Matches current photo" : "For an earlier photo"}</span>{candidate.warning && candidate.status === "failed" && <span>{candidate.warning}</span>}{candidate.status === "ready" && <button type="button" disabled={!sourceMatches} onClick={() => applyCutoutCandidate(candidate.id)}>Apply cutout</button>}</div></div>; })}</div>}
          </section>
          <section className={styles.railSection}><p className={styles.eyebrow}>05 / History</p><div className={styles.history}><button className={styles.iconButton} type="button" aria-label="Undo last change" disabled={!past.length} onClick={undo}>↶</button><button className={styles.iconButton} type="button" aria-label="Redo last change" disabled={!future.length} onClick={redo}>↷</button><span className={styles.recovery}><i className={styles.recoveryDot} />{recovered ? "Recovered locally" : "Saved locally"}</span></div></section>
        </aside>

        <section className={styles.main} aria-label="Creative proof canvas"><div className={styles.canvasBar}><p className={styles.eyebrow}>Proof canvas / approved layers</p><div className={styles.canvasMeta}><span>{project.format === "card" ? "1080 × 1350" : "1920 × 1080"}</span><span>PNG / sRGB</span></div></div>
          <div className={styles.proofStage}><i className={styles.corner} /><i className={styles.corner} /><div ref={proofFrame} className={`${styles.proofFrame} ${project.format === "banner" ? styles.banner : ""}`} tabIndex={0} aria-label="Creative proof editor" onKeyDown={handleCanvasKeyDown}><canvas ref={previewCanvas} className={styles.proofCanvas} aria-label="Rendered creative proof" /><span className={`${styles.sampleTag} ${selectedCandidate?.asset.source === "generated" ? styles.candidateAppliedTag : ""}`}>{selectedCandidate?.asset.source === "sample" ? "Previously generated sample" : selectedCandidate?.status === "ready" ? "Candidate ready" : "Proof"}</span><div className={styles.layerInteraction} role="application" aria-label="Click or drag a creative layer to edit" onPointerDown={handleCanvasPointerDown} onPointerMove={handleCanvasPointerMove} onPointerUp={finishCanvasDrag} onPointerCancel={(event) => finishCanvasDrag(event, true)}>{selectedLayer && selectedRect && <div className={styles.selectedOutline} aria-hidden="true" style={{ left: `${(selectedRect.x / canvasDimensions.width) * 100}%`, top: `${(selectedRect.y / canvasDimensions.height) * 100}%`, width: `${(selectedRect.width / canvasDimensions.width) * 100}%`, height: `${(selectedRect.height / canvasDimensions.height) * 100}%` }} />}</div></div></div>
          <div className={styles.underCanvas}><span className={styles.recovery}><i className={styles.recoveryDot} />{statusMessage}</span><div className={styles.history}><button className={styles.iconButton} type="button" aria-label="Undo last change" disabled={!past.length} onClick={undo}>↶</button><button className={styles.iconButton} type="button" aria-label="Redo last change" disabled={!future.length} onClick={redo}>↷</button></div></div>
        </section>

        <aside className={`${styles.rail} ${styles.rightRail}`} aria-label="Background direction and exports">
          <section className={styles.railSection}><div className={styles.sectionHeading}><p className={styles.eyebrow}>06 / Background direction</p><span className={styles.tinyLabel}>LIVEPEER</span></div><div className={styles.directionCard}><p className={styles.directionText}><strong>Describe the atmosphere.</strong> During background generation, your photograph, logo, and type stay local. A background proposal is quoted separately before any render.</p><div className={styles.field}><label htmlFor="creative-brief">Brief / revision note</label><textarea id="creative-brief" value={project.brief} onChange={(event) => updateBrief(event.target.value)} /></div><div className={styles.directionButtons}><button className={styles.directionButton} type="button" onClick={() => updateBrief(`${project.brief} More negative space behind the headline.`)}>+ Clear headline space</button><button className={styles.directionButton} type="button" onClick={() => updateBrief(`${project.brief} Add warmer sideline light.`)}>+ Warm the sideline light</button><button className={styles.orangeButton} type="button" disabled={status === "estimating" || status === "running" || status === "queued"} onClick={() => void createEstimate()}>{status === "estimating" ? "Preparing estimate…" : "Get a render estimate"}</button></div>{generationError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{generationError}</div>}{status === "running" || status === "queued" ? <div className={styles.progress} aria-live="polite"><div className={styles.progressTrack}><div className={styles.progressFill} /></div><div className={styles.progressLabel}><span>{pendingOperation === "cutout" ? "Removing athlete background" : "Generating background"}</span><span>In progress</span></div></div> : null}</div>{quote && <div className={styles.quote}><div className={styles.quoteHeader}><span>Estimated cost</span><span>{quote.operation === "cutout" ? "Athlete cutout" : "Background"}</span></div><div className={styles.quoteCost}>{formatCost(quote.cost)}</div><div className={styles.quoteMeta}>{quote.model || "fast background model"} · one render · no automatic retries</div><button className={styles.orangeButton} type="button" disabled={status === "queued" || status === "running"} onClick={() => void approveQuote()}>{quote.operation === "cutout" ? "Approve cutout" : "Approve & render"}</button></div>}{status === "unconfigured" && <div className={styles.notice}>Live rendering is unavailable until setup is complete. Local editing and PNG export remain available.{showPasscode ? <form onSubmit={(event) => { event.preventDefault(); setSessionPending(true); void fetch("/api/creative/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) }).then(async (response) => { if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || "Passcode was rejected"); } setProviderConfigured(true); setStatus(jobId ? "running" : "idle"); setStatusMessage(jobId ? "Live generation resumed" : "Live generation ready"); setGenerationError(null); setShowPasscode(false); }).catch((error) => { setGenerationError(error instanceof Error ? error.message : "Passcode was rejected"); setStatus("unconfigured"); }).finally(() => setSessionPending(false)); }}><div className={styles.field}><label htmlFor="provider-passcode">Passcode</label><input id="provider-passcode" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} /><button className={styles.orangeButton} style={{ marginTop: 8, width: "100%" }} disabled={sessionPending} type="submit">{sessionPending ? "Unlocking…" : "Unlock live generation"}</button></div></form> : <button className={styles.directionButton} style={{ marginTop: 10, width: "100%" }} type="button" onClick={() => setShowPasscode(true)}>Unlock live generation</button>}</div>}</section>
          <section className={styles.railSection}><div className={styles.sectionHeading}><p className={styles.eyebrow}>07 / Candidate review</p><span className={styles.tinyLabel}>{project.backgroundCandidates.length} OPTIONS</span></div>{project.backgroundCandidates.map((candidate, index) => { const applied = candidate.asset.id === project.assets.background?.id; const pending = candidate.status === "pending"; const candidateUrl = assetUrls[candidate.asset.blobKey] ?? assetUrls[candidate.asset.id] ?? candidate.asset.url; return <article className={`${styles.candidate} ${applied ? styles.selected : ""}`} key={candidate.id}><div className={`${styles.candidateVisual} ${index % 3 === 1 ? styles.alt : index % 3 === 2 ? styles.revision : ""}`}>{candidateUrl && <img className={styles.candidateImage} src={candidateUrl} alt="" />}<span>{pending ? "Rendering…" : candidate.asset.source === "sample" ? "Previously generated sample" : candidate.status === "ready" ? "Ready to review" : candidate.warning || "Unavailable"}</span></div><div className={styles.candidateInfo}><strong>{candidate.asset.name}</strong><span>{pending ? "PENDING" : candidate.asset.source === "sample" ? "LOCAL" : candidate.status === "ready" ? "NEW" : "FAILED"}</span></div>{candidate.status === "ready" && <button className={styles.candidateAction} type="button" onClick={() => applyCandidate(candidate.id)}>{applied ? "Applied to proof" : "Apply to proof"}</button>}</article>; })}</section>
          <section className={styles.railSection}><p className={styles.eyebrow}>08 / Export set</p><div className={styles.exportList}><button className={styles.exportButton} type="button" onClick={() => void exportArtwork("card").catch(() => undefined)}>Portrait social card <span>PNG · 1080 × 1350 ↗</span></button><button className={styles.exportButton} type="button" onClick={() => void exportArtwork("banner").catch(() => undefined)}>Digital banner <span>PNG · 1920 × 1080 ↗</span></button></div>{exportError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{exportError}</div>}{lastExport && <div className={styles.exportResult}><img className={styles.exportPreview} src={lastExport.url} alt="Latest exported creative" /><div className={styles.exportDetails}><strong>{lastExport.filename}</strong><span>{lastExport.width} × {lastExport.height} · {(lastExport.size / 1024).toFixed(0)} KB</span><a className={styles.exportLink} href={lastExport.url} download={lastExport.filename}>Download this PNG</a></div></div>}</section>
        </aside>
      </div>
    </main>
  );
}
