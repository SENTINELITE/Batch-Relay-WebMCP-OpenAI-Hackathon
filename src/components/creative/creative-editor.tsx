"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import styles from "./creative-editor.module.css";
import {
  publishCreativeWebMcpState,
  respondToCreativeWebMcpAction,
  subscribeToCreativeWebMcpActions,
  type CreativeWebMcpActionRequest,
} from "@/webmcp/creative/bridge";
import { applyBackground, createProject, updateProject } from "@/lib/creative/project";
import { exportCreativePng, renderCreative } from "@/lib/creative/renderer";
import { createIndexedDbCreativePersistence, loadCreativeProject, saveCreativeProject } from "@/lib/creative/persistence";
import type { CreativeAssetReference, CreativeFormat, CreativeProject } from "@/lib/creative/types";

type Format = CreativeFormat;
type JobStatus = "idle" | "estimating" | "quoted" | "queued" | "running" | "succeeded" | "failed" | "unconfigured";

type Project = CreativeProject;

type Quote = { id: string; cost: number; expiresAt?: string; model?: string; prompt: string; revision: number; requestId: string };
type ExportResult = { url: string; filename: string; width: number; height: number; size: number };

type HistoryState = { project: Project; past: Project[]; future: Project[] };
type HistoryAction =
  | { type: "commit"; updater: (project: Project) => Project }
  | { type: "replace"; project: Project }
  | { type: "undo" }
  | { type: "redo" };

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
  seed.backgroundCandidates = [{ id: "sample-01", asset: background, prompt: seed.brief, createdAt: seed.createdAt, status: "ready", warning: "Previously generated sample; no new provider render was used." }];
  return seed;
})();

const initialProject: Project = {
  ...initialSeed,
};

function formatCost(value: number) {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
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
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [showPasscode, setShowPasscode] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [sessionPending, setSessionPending] = useState(false);
  const persistence = useRef(createIndexedDbCreativePersistence());
  const hydrated = useRef(false);
  const previewCanvas = useRef<HTMLCanvasElement | null>(null);
  const pollInFlight = useRef(false);
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
        for (const slot of ["background", "athlete", "logo"] as const) {
          const asset = saved.assets[slot];
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
        setAssetUrls(urls);
        dispatchHistory({ type: "replace", project: saved });
        setRecovered(true);
        const pending = saved.generationRefs.find((reference) => reference.status === "queued" || reference.status === "running");
        if (pending) { setJobId(pending.id); setStatus("running"); setStatusMessage("Resuming background generation…"); }
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
    return candidate ? applyBackground(current, candidate) : current;
  }), [commit]);

  const updateAthleteTransform = useCallback((key: "x" | "y" | "scale", value: number) => {
    commit((current) => {
      const layout = current.layouts[current.format];
      const athlete = layout.athlete;
      const aspect = athlete.height / Math.max(athlete.width, 0.001);
      const nextAthlete = key === "scale"
        ? { ...athlete, width: value, height: value * aspect }
        : { ...athlete, [key]: value };
      return updateProject(current, { layouts: { ...current.layouts, [current.format]: { ...layout, athlete: nextAthlete } } });
    });
  }, [commit]);

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
      const nextQuote = { id: data.id, cost: data.estimatedCostUsd ?? 0.1, expiresAt: data.expiresAt, model: data.model, prompt, revision: requestedRevision, requestId: `${data.id}:execute` };
      setQuote(nextQuote);
      setStatus("quoted"); setStatusMessage("Estimate ready · approval required");
      return nextQuote;
    } catch (error) {
      setStatus("failed"); setStatusMessage("Estimate could not be prepared"); setGenerationError(error instanceof Error ? error.message : "Unknown estimate error");
      return null;
    }
  }, [project, providerConfigured]);

  const approveQuote = useCallback(async () => {
    if (!quote) return;
    if (quote.revision !== project.revision) {
      setGenerationError("This estimate belongs to an earlier revision. Request a new estimate before rendering.");
      setStatus("failed"); setStatusMessage("Estimate is out of date"); return;
    }
    setStatus("queued"); setStatusMessage("Submitting approved background request…"); setGenerationError(null);
    try {
      const response = await fetch("/api/creative/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ estimateId: quote.id, requestId: quote.requestId, projectId: project.id, revision: quote.revision }) });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error || "Render could not be queued");
      const job = data.id;
      setJobId(job); setStatus("running"); setStatusMessage("Livepeer is preparing a background…"); setQuote(null);
      const candidateId = `candidate-${job}`;
      commit((current) => updateProject(current, {
        backgroundCandidates: [...current.backgroundCandidates, {
          id: candidateId,
          asset: assetReference("background", candidateId, "New direction", "image/png", "generated", "", `creative/${candidateId}`),
          prompt: quote.prompt,
          createdAt: new Date().toISOString(),
          generationId: job,
          status: "pending",
        }],
        generationRefs: [...current.generationRefs, { id: job, candidateId, prompt: quote.prompt, estimatedCostUsd: quote.cost, model: quote.model, status: "running", createdAt: new Date().toISOString() }],
      }));
    } catch (error) {
      setStatus("failed"); setStatusMessage("Render was not started"); setGenerationError(error instanceof Error ? error.message : "Unknown render error");
    }
  }, [commit, project.id, project.revision, quote]);

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
          const candidateId = `candidate-${jobId}`;
          const candidate = project.backgroundCandidates.find((item) => item.id === candidateId);
          if (!candidate || !data.imageUrl) {
            setStatus("failed"); setStatusMessage("Background render returned no image"); setGenerationError("The provider finished without a retrievable image."); setJobId(null); return;
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
            setStatus("failed"); setStatusMessage("Rendered image could not be stored"); setGenerationError(error instanceof Error ? error.message : "Rendered image could not be stored."); setJobId(null); return;
          }
          commit((current) => updateProject(current, {
            backgroundCandidates: current.backgroundCandidates.map((item) => item.id === candidateId ? { ...item, status: "ready", warning: "Live render ready; review before applying.", asset: { ...item.asset, url: data.imageUrl, mimeType: completedMimeType } } : item),
            generationRefs: current.generationRefs.map((item) => item.id === jobId ? { ...item, status: "succeeded" } : item),
          }));
          setStatus("succeeded"); setStatusMessage("Background ready for review"); setJobId(null);
        } else if (data.status === "failed" || data.status === "unknown") {
          const candidateId = `candidate-${jobId}`;
          commit((current) => updateProject(current, {
            backgroundCandidates: current.backgroundCandidates.map((item) => item.id === candidateId ? { ...item, status: "failed", warning: data.error || "Provider returned no artwork." } : item),
            generationRefs: current.generationRefs.map((item) => item.id === jobId ? { ...item, status: data.status === "unknown" ? "unknown" : "failed" } : item),
          }));
          setStatus("failed"); setStatusMessage("Background render failed"); setGenerationError(data.error || "Provider returned no artwork"); setJobId(null);
        }
      } catch { /* transient poll errors keep the pending job recoverable */ }
      finally { pollInFlight.current = false; }
    };
    const timer = window.setInterval(() => void poll(), 1800);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [commit, jobId, project.backgroundCandidates, status]);

  const resolvedAssets = useMemo(() => ({
    background: project.assets.background ? assetUrls[project.assets.background.blobKey] ?? assetUrls[project.assets.background.id] ?? project.assets.background.url : undefined,
    athlete: project.assets.athlete ? assetUrls[project.assets.athlete.blobKey] ?? assetUrls[project.assets.athlete.id] ?? project.assets.athlete.url : undefined,
    logo: project.assets.logo ? assetUrls[project.assets.logo.blobKey] ?? assetUrls[project.assets.logo.id] ?? project.assets.logo.url : undefined,
  }), [assetUrls, project.assets]);

  useEffect(() => {
    const canvas = previewCanvas.current;
    if (!canvas) return;
    void renderCreative(project, resolvedAssets, { canvas, format: project.format }).catch(() => setStatusMessage("Preview could not resolve one or more source layers"));
  }, [project, resolvedAssets]);

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
    commit((current) => updateProject(current, { assets: { ...current.assets, [kind]: reference } }));
    await persistence.current.saveAssetBlob(blobKey, file);
  };

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
          <section className={styles.railSection}><p className={styles.eyebrow}>03 / Source layers</p>
            <label className={styles.upload}><input type="file" accept="image/png,image/jpeg" onChange={(event) => void updateUpload("athlete", event.target.files?.[0])} />{resolvedAssets.athlete ? <img className={styles.uploadThumb} src={resolvedAssets.athlete} alt="Athlete source preview" /> : <span className={styles.uploadMark}>+</span>}<span className={styles.uploadText}><strong>Photograph</strong><span>PNG / JPEG · pixels retained</span></span></label>
            <label className={styles.upload} style={{ marginTop: 8 }}><input type="file" accept="image/png,image/svg+xml" onChange={(event) => void updateUpload("logo", event.target.files?.[0])} />{resolvedAssets.logo ? <img className={styles.uploadThumb} src={resolvedAssets.logo} alt="Logo source preview" /> : <span className={styles.uploadMark}>+</span>}<span className={styles.uploadText}><strong>Event logo</strong><span>PNG / SVG · independent layer</span></span></label>
            <div className={styles.transformControls} aria-label="Athlete placement controls"><span className={styles.tinyLabel}>ATHLETE PLACEMENT / {project.format.toUpperCase()}</span><label className={styles.transformControl}><span>X</span><input type="range" min="-0.1" max="0.8" step="0.01" value={project.layouts[project.format].athlete.x} onChange={(event) => updateAthleteTransform("x", Number(event.target.value))} /><span className={styles.transformValue}>{project.layouts[project.format].athlete.x.toFixed(2)}</span></label><label className={styles.transformControl}><span>Y</span><input type="range" min="-0.1" max="0.8" step="0.01" value={project.layouts[project.format].athlete.y} onChange={(event) => updateAthleteTransform("y", Number(event.target.value))} /><span className={styles.transformValue}>{project.layouts[project.format].athlete.y.toFixed(2)}</span></label><label className={styles.transformControl}><span>SIZE</span><input type="range" min="0.3" max="1.2" step="0.01" value={project.layouts[project.format].athlete.width} onChange={(event) => updateAthleteTransform("scale", Number(event.target.value))} /><span className={styles.transformValue}>{project.layouts[project.format].athlete.width.toFixed(2)}</span></label></div>
          </section>
          <section className={styles.railSection}><p className={styles.eyebrow}>04 / History</p><div className={styles.history}><button className={styles.iconButton} type="button" aria-label="Undo last change" disabled={!past.length} onClick={undo}>↶</button><button className={styles.iconButton} type="button" aria-label="Redo last change" disabled={!future.length} onClick={redo}>↷</button><span className={styles.recovery}><i className={styles.recoveryDot} />{recovered ? "Recovered locally" : "Saved locally"}</span></div></section>
        </aside>

        <section className={styles.main} aria-label="Creative proof canvas"><div className={styles.canvasBar}><p className={styles.eyebrow}>Proof canvas / approved layers</p><div className={styles.canvasMeta}><span>{project.format === "card" ? "1080 × 1350" : "1920 × 1080"}</span><span>PNG / sRGB</span></div></div>
          <div className={styles.proofStage}><i className={styles.corner} /><i className={styles.corner} /><div className={`${styles.proofFrame} ${project.format === "banner" ? styles.banner : ""}`}><canvas ref={previewCanvas} className={styles.proofCanvas} aria-label="Rendered creative proof" /><span className={`${styles.sampleTag} ${selectedCandidate?.asset.source === "generated" ? styles.candidateAppliedTag : ""}`}>{selectedCandidate?.asset.source === "sample" ? "Previously generated sample" : selectedCandidate?.status === "ready" ? "Candidate ready" : "Proof"}</span></div></div>
          <div className={styles.underCanvas}><span className={styles.recovery}><i className={styles.recoveryDot} />{statusMessage}</span><div className={styles.history}><button className={styles.iconButton} type="button" aria-label="Undo last change" disabled={!past.length} onClick={undo}>↶</button><button className={styles.iconButton} type="button" aria-label="Redo last change" disabled={!future.length} onClick={redo}>↷</button></div></div>
        </section>

        <aside className={`${styles.rail} ${styles.rightRail}`} aria-label="Background direction and exports">
          <section className={styles.railSection}><div className={styles.sectionHeading}><p className={styles.eyebrow}>05 / Background direction</p><span className={styles.tinyLabel}>LIVEPEER</span></div><div className={styles.directionCard}><p className={styles.directionText}><strong>Describe the atmosphere.</strong> The supplied photograph, logo, and type stay local. A background proposal is quoted separately before any render.</p><div className={styles.field}><label htmlFor="creative-brief">Brief / revision note</label><textarea id="creative-brief" value={project.brief} onChange={(event) => updateBrief(event.target.value)} /></div><div className={styles.directionButtons}><button className={styles.directionButton} type="button" onClick={() => updateBrief(`${project.brief} More negative space behind the headline.`)}>+ Clear headline space</button><button className={styles.directionButton} type="button" onClick={() => updateBrief(`${project.brief} Add warmer sideline light.`)}>+ Warm the sideline light</button><button className={styles.orangeButton} type="button" disabled={status === "estimating" || status === "running" || status === "queued"} onClick={() => void createEstimate()}>{status === "estimating" ? "Preparing estimate…" : "Get a render estimate"}</button></div>{generationError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{generationError}</div>}{status === "running" || status === "queued" ? <div className={styles.progress} aria-live="polite"><div className={styles.progressTrack}><div className={styles.progressFill} /></div><div className={styles.progressLabel}><span>Generating background</span><span>In progress</span></div></div> : null}</div>{quote && <div className={styles.quote}><div className={styles.quoteHeader}><span>Estimated cost</span><span>Review</span></div><div className={styles.quoteCost}>{formatCost(quote.cost)}</div><div className={styles.quoteMeta}>{quote.model || "fast background model"} · one render · no automatic retries</div><button className={styles.orangeButton} type="button" disabled={status === "queued" || status === "running"} onClick={() => void approveQuote()}>Approve &amp; render</button></div>}{status === "unconfigured" && <div className={styles.notice}>Live rendering is unavailable until setup is complete. Local editing and PNG export remain available.{showPasscode ? <form onSubmit={(event) => { event.preventDefault(); setSessionPending(true); void fetch("/api/creative/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) }).then(async (response) => { if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || "Passcode was rejected"); } setProviderConfigured(true); setStatus(jobId ? "running" : "idle"); setStatusMessage(jobId ? "Live generation resumed" : "Live generation ready"); setGenerationError(null); setShowPasscode(false); }).catch((error) => { setGenerationError(error instanceof Error ? error.message : "Passcode was rejected"); setStatus("unconfigured"); }).finally(() => setSessionPending(false)); }}><div className={styles.field}><label htmlFor="provider-passcode">Passcode</label><input id="provider-passcode" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} /><button className={styles.orangeButton} style={{ marginTop: 8, width: "100%" }} disabled={sessionPending} type="submit">{sessionPending ? "Unlocking…" : "Unlock live generation"}</button></div></form> : <button className={styles.directionButton} style={{ marginTop: 10, width: "100%" }} type="button" onClick={() => setShowPasscode(true)}>Unlock live generation</button>}</div>}</section>
          <section className={styles.railSection}><div className={styles.sectionHeading}><p className={styles.eyebrow}>06 / Candidate review</p><span className={styles.tinyLabel}>{project.backgroundCandidates.length} OPTIONS</span></div>{project.backgroundCandidates.map((candidate, index) => { const applied = candidate.asset.id === project.assets.background?.id; const pending = candidate.status === "pending"; const candidateUrl = assetUrls[candidate.asset.blobKey] ?? assetUrls[candidate.asset.id] ?? candidate.asset.url; return <article className={`${styles.candidate} ${applied ? styles.selected : ""}`} key={candidate.id}><div className={`${styles.candidateVisual} ${index % 3 === 1 ? styles.alt : index % 3 === 2 ? styles.revision : ""}`}>{candidateUrl && <img className={styles.candidateImage} src={candidateUrl} alt="" />}<span>{pending ? "Rendering…" : candidate.asset.source === "sample" ? "Previously generated sample" : candidate.status === "ready" ? "Ready to review" : candidate.warning || "Unavailable"}</span></div><div className={styles.candidateInfo}><strong>{candidate.asset.name}</strong><span>{pending ? "PENDING" : candidate.asset.source === "sample" ? "LOCAL" : candidate.status === "ready" ? "NEW" : "FAILED"}</span></div>{candidate.status === "ready" && <button className={styles.candidateAction} type="button" onClick={() => applyCandidate(candidate.id)}>{applied ? "Applied to proof" : "Apply to proof"}</button>}</article>; })}</section>
          <section className={styles.railSection}><p className={styles.eyebrow}>07 / Export set</p><div className={styles.exportList}><button className={styles.exportButton} type="button" onClick={() => void exportArtwork("card").catch(() => undefined)}>Portrait social card <span>PNG · 1080 × 1350 ↗</span></button><button className={styles.exportButton} type="button" onClick={() => void exportArtwork("banner").catch(() => undefined)}>Digital banner <span>PNG · 1920 × 1080 ↗</span></button></div>{exportError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{exportError}</div>}{lastExport && <div className={styles.exportResult}><img className={styles.exportPreview} src={lastExport.url} alt="Latest exported creative" /><div className={styles.exportDetails}><strong>{lastExport.filename}</strong><span>{lastExport.width} × {lastExport.height} · {(lastExport.size / 1024).toFixed(0)} KB</span><a className={styles.exportLink} href={lastExport.url} download={lastExport.filename}>Download this PNG</a></div></div>}</section>
        </aside>
      </div>
    </main>
  );
}
