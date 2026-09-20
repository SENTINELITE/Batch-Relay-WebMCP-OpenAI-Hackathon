import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { isIP } from "node:net";

import { assert, CreativeAPIError } from "./errors";
import { assertBudgetAvailable, budgetSnapshot, readJournalSnapshot, withJournal } from "./journal";
import { callLivepeerTool, isLivepeerConfigured, providerHost, providerValue } from "./mcp";
import type {
  CreativeEstimate,
  CreativeJob,
  CreativeJobStatus,
  CreativePalette,
  CreativeOperation,
  EstimateRecord,
  JobRecord,
  ProviderToolResult,
  SourceUploadRecord,
} from "./types";

const MODEL = "flux-schnell";
const ASPECT_RATIO = "4:3" as const;
const MAX_RENDER_USD = 0.1;
const ESTIMATE_TTL_MS = 10 * 60_000;

function stringField(value: unknown, name: string, maxLength: number): string {
  assert(typeof value === "string" && value.trim().length > 0 && value.length <= maxLength, 400, `creative_${name}_invalid`, `A valid ${name} is required.`);
  return value.trim();
}

function projectRevision(value: unknown): number {
  assert(typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000, 400, "creative_revision_invalid", "A valid project revision is required.");
  return value;
}

function palette(value: unknown): CreativePalette {
  assert(value && typeof value === "object" && !Array.isArray(value), 400, "creative_palette_invalid", "A valid color palette is required.");
  const candidate = value as Record<string, unknown>;
  const primary = stringField(candidate.primary, "palette", 32);
  const accent = stringField(candidate.accent, "palette", 32);
  assert(/^#[0-9a-f]{3,8}$/i.test(primary) && /^#[0-9a-f]{3,8}$/i.test(accent), 400, "creative_palette_invalid", "Palette colors must be hexadecimal values.");
  return { primary, accent };
}

function bindingHash(input: { projectId: string; revision: number; prompt: string; palette?: CreativePalette; model: string; output: { aspectRatio?: string; format: string }; operation: CreativeOperation; sourceAssetId?: string; sourceContentHash?: string }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function providerJSON(result: ProviderToolResult): Record<string, unknown> {
  const value = providerValue(result);
  assert(value && typeof value === "object" && !Array.isArray(value), 502, "livepeer_invalid_result", "Livepeer Creative returned an invalid result.");
  return value as Record<string, unknown>;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return undefined;
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function nestedValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  for (const key of keys) if (object[key] !== undefined) return object[key];
  return undefined;
}

function estimateFromProvider(result: ProviderToolResult, expectedModel?: string): { planId: string; cost: number; model: string } {
  const value = providerJSON(result);
  const steps = Array.isArray(value.steps) ? value.steps : [];
  const firstStep = (steps[0] && typeof steps[0] === "object" ? steps[0] : {}) as Record<string, unknown>;
  const args = firstStep.args && typeof firstStep.args === "object" ? firstStep.args as Record<string, unknown> : {};
  const planId = stringValue(value.plan_id, value.planId, value.id);
  const cost = numberValue(value.total_est_cost_usd, value.totalEstCostUsd, firstStep.est_cost_usd, firstStep.estimated_cost_usd);
  // Some Creative proposals omit the model when the requested override is
  // accepted. Preserve the operation's expected model in that case, while
  // still rejecting an explicitly reported substitution below.
  const reportedModel = stringValue(value.model, args.model_override);
  const model = reportedModel ?? expectedModel ?? MODEL;
  assert(planId, 502, "livepeer_invalid_estimate", "Livepeer Creative returned no plan identifier.");
  assert(cost !== undefined && cost >= 0 && cost <= MAX_RENDER_USD, 502, "livepeer_invalid_estimate", "Livepeer Creative returned an unusable estimate.");
  if (expectedModel) assert(model === expectedModel, 502, "livepeer_model_mismatch", "Livepeer Creative returned an unexpected cutout model.");
  return { planId, cost, model };
}

function estimateView(record: EstimateRecord): CreativeEstimate {
  return {
    id: record.id,
    projectId: record.projectId,
    revision: record.revision,
    prompt: record.prompt,
    palette: record.palette,
    output: record.output,
    estimatedCostUsd: record.estimatedCostUsd,
    model: record.model,
    planId: record.planId,
    expiresAt: record.expiresAt,
    requestId: record.requestId,
    operation: record.operation,
    ...(record.sourceAssetId ? { sourceAssetId: record.sourceAssetId } : {}),
    ...(record.sourceContentHash ? { sourceContentHash: record.sourceContentHash } : {}),
  };
}

function responseJob(record: JobRecord): CreativeJob {
  return {
    id: record.id,
    projectId: record.projectId,
    revision: record.revision,
    status: record.status,
    estimatedCostUsd: record.estimatedCostUsd,
    ...(record.actualCostUsd === undefined ? {} : { actualCostUsd: record.actualCostUsd }),
    ...(record.model ? { model: record.model } : {}),
    ...(record.operation ? { operation: record.operation } : {}),
    ...(record.sourceAssetId ? { sourceAssetId: record.sourceAssetId } : {}),
    ...(record.warnings?.length ? { warnings: record.warnings } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(record.status === "succeeded" ? { imageUrl: `/api/creative/jobs/${encodeURIComponent(record.id)}/image` } : {}),
  };
}

export function validateEstimateInput(value: Record<string, unknown>): { projectId: string; revision: number; prompt: string; palette: CreativePalette; requestId: string } {
  return {
    projectId: stringField(value.projectId, "project_id", 200),
    revision: projectRevision(value.revision),
    prompt: stringField(value.prompt, "prompt", 8_000),
    palette: palette(value.palette),
    requestId: stringField(value.requestId, "request_id", 200),
  };
}

export async function proposeEstimate(input: { projectId: string; revision: number; prompt: string; palette: CreativePalette; requestId: string }): Promise<CreativeEstimate> {
  if (!isLivepeerConfigured()) throw new CreativeAPIError(503, "livepeer_unconfigured", "Livepeer Creative is not configured.");
  const output = { aspectRatio: ASPECT_RATIO, format: "background" } as const;
  const hash = bindingHash({ ...input, model: MODEL, output, operation: "background" });
  const key = `estimate:${input.requestId}`;
  const existing = await readJournalSnapshot();
  const existingId = existing.idempotency[key];
  const existingEstimate = existingId ? existing.estimates[existingId] : undefined;
  if (existingEstimate) {
    if (existingEstimate.bindingHash !== hash) throw new CreativeAPIError(409, "creative_idempotency_conflict", "This request ID is already bound to different creative input.");
    if (new Date(existingEstimate.expiresAt).getTime() > Date.now()) return estimateView(existingEstimate);
  }
  // The provider idempotency key is scoped to this caller request. A second
  // estimate for the same brief intentionally asks for a distinct alternative;
  // a retry with the same requestId remains stable.
  const stepRequestId = `creative-${createHash("sha256").update(`${hash}:${input.requestId}`).digest("hex").slice(0, 40)}`;
  const result = await callLivepeerTool("submit_plan", {
    goal: "Batch Relay Creative background proposal",
    budget_usd: MAX_RENDER_USD,
    steps: [{
      tool: "create_media",
      label: "Generate a reviewed sports background",
      args: {
        action: "generate",
        model_override: MODEL,
        quality: "fast",
        aspect_ratio: ASPECT_RATIO,
        prompt: `${input.prompt}\nPalette: primary ${input.palette.primary}, accent ${input.palette.accent}. No people, no lettering, no logos; leave clear negative space for separately composited foreground layers.`,
        max_cost_usd: MAX_RENDER_USD,
        max_quality_retries: 0,
        quality_gate: false,
        idempotency_key: stepRequestId,
        session_id: `batch-relay-creative:${input.projectId}`,
      },
    }],
  });
  const providerEstimate = estimateFromProvider(result);
  const now = new Date();
  const record: EstimateRecord = {
    id: `est_${randomUUID().replaceAll("-", "")}`,
    projectId: input.projectId,
    revision: input.revision,
    prompt: input.prompt,
    palette: input.palette,
    output,
    estimatedCostUsd: providerEstimate.cost,
    model: providerEstimate.model,
    planId: providerEstimate.planId,
    expiresAt: new Date(now.getTime() + ESTIMATE_TTL_MS).toISOString(),
    requestId: input.requestId,
    bindingHash: hash,
    createdAt: now.toISOString(),
    state: "proposed",
    operation: "background",
  };
  const persisted = await withJournal((journal) => {
    const concurrentID = journal.idempotency[key];
    const concurrent = concurrentID ? journal.estimates[concurrentID] : undefined;
    if (concurrent && concurrent.bindingHash === hash && new Date(concurrent.expiresAt).getTime() > Date.now()) return concurrent;
    journal.estimates[record.id] = record;
    journal.idempotency[key] = record.id;
    return record;
  });
  return estimateView(persisted);
}

const CUTOUT_MODEL = "bg-remove";
const CUTOUT_PROMPT = "Remove only the background from the supplied subject photo. Preserve the subject's original pixels, edges, colors, logos, and proportions. Return the subject on a transparent alpha background with no added styling, text, or objects.";
const cutoutEstimateInFlight = new Map<string, { bindingHash: string; promise: Promise<CreativeEstimate> }>();

function sourceAssetID(value: unknown): string {
  return stringField(value, "source_asset_id", 200);
}

function sourceContentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Uploads once per source asset identity and content hash under the journal lock. */
export async function uploadSourceImage(input: { sourceAssetId: string; contentHash: string; bytes: Uint8Array; mimeType: string; filename: string }): Promise<SourceUploadRecord> {
  if (!isLivepeerConfigured()) throw new CreativeAPIError(503, "livepeer_unconfigured", "Livepeer Creative is not configured.");
  return withJournal(async (journal) => {
    const existing = journal.sourceUploads[input.sourceAssetId];
    if (existing) {
      if (existing.contentHash !== input.contentHash) throw new CreativeAPIError(409, "creative_source_asset_conflict", "This source asset ID is already bound to different image bytes.");
      return existing;
    }
    const result = await callLivepeerTool("upload_image", {
      data: Buffer.from(input.bytes).toString("base64"),
      mime_type: input.mimeType,
      filename: input.filename,
    });
    const value = providerValue(result);
    const url = mediaURLFrom(value, true);
    assert(url && isTrustedImageURL(url), 502, "livepeer_invalid_upload", "Livepeer Creative returned an invalid uploaded image URL.");
    const record: SourceUploadRecord = {
      sourceAssetId: input.sourceAssetId,
      contentHash: input.contentHash,
      url,
      mimeType: input.mimeType,
      filename: input.filename,
      createdAt: new Date().toISOString(),
    };
    journal.sourceUploads[input.sourceAssetId] = record;
    return record;
  });
}

export function validateCutoutMetadata(value: { projectId: unknown; revision: unknown; requestId: unknown; sourceAssetId: unknown }): { projectId: string; revision: number; requestId: string; sourceAssetId: string } {
  return {
    projectId: stringField(value.projectId, "project_id", 200),
    revision: projectRevision(value.revision),
    requestId: stringField(value.requestId, "request_id", 200),
    sourceAssetId: sourceAssetID(value.sourceAssetId),
  };
}

export function proposeCutoutEstimate(input: { projectId: string; revision: number; requestId: string; sourceAssetId: string; bytes: Uint8Array; mimeType: string; filename: string }): Promise<CreativeEstimate> {
  if (!isLivepeerConfigured()) throw new CreativeAPIError(503, "livepeer_unconfigured", "Livepeer Creative is not configured.");
  const contentHash = sourceContentHash(input.bytes);
  const output = { format: "cutout" } as const;
  const hash = bindingHash({ projectId: input.projectId, revision: input.revision, prompt: CUTOUT_PROMPT, model: CUTOUT_MODEL, output, operation: "cutout", sourceAssetId: input.sourceAssetId, sourceContentHash: contentHash });
  const key = `estimate:cutout:${input.requestId}`;
  const active = cutoutEstimateInFlight.get(key);
  if (active) {
    if (active.bindingHash !== hash) return Promise.reject(new CreativeAPIError(409, "creative_idempotency_conflict", "This request ID is already bound to different cutout input."));
    return active.promise;
  }
  const promise = proposeCutoutEstimateInternal(input, contentHash, hash, key);
  cutoutEstimateInFlight.set(key, { bindingHash: hash, promise });
  void promise.finally(() => {
    const current = cutoutEstimateInFlight.get(key);
    if (current?.promise === promise) cutoutEstimateInFlight.delete(key);
  }).catch(() => undefined);
  return promise;
}

async function proposeCutoutEstimateInternal(input: { projectId: string; revision: number; requestId: string; sourceAssetId: string; bytes: Uint8Array; mimeType: string; filename: string }, contentHash: string, hash: string, key: string): Promise<CreativeEstimate> {
  const output = { format: "cutout" } as const;
  const existing = await readJournalSnapshot();
  const existingID = existing.idempotency[key];
  const existingEstimate = existingID ? existing.estimates[existingID] : undefined;
  if (existingEstimate) {
    if (existingEstimate.bindingHash !== hash) throw new CreativeAPIError(409, "creative_idempotency_conflict", "This request ID is already bound to different cutout input.");
    if (new Date(existingEstimate.expiresAt).getTime() > Date.now()) return estimateView(existingEstimate);
  }
  const upload = await uploadSourceImage({ sourceAssetId: input.sourceAssetId, contentHash, bytes: input.bytes, mimeType: input.mimeType, filename: input.filename });
  const stepRequestId = `creative-cutout-${createHash("sha256").update(`${hash}:${input.requestId}`).digest("hex").slice(0, 40)}`;
  const result = await callLivepeerTool("submit_plan", {
    goal: "Batch Relay Creative transparent athlete cutout proposal",
    budget_usd: MAX_RENDER_USD,
    steps: [{
      tool: "create_media",
      label: "Remove the supplied photo background",
      args: {
        action: "generate",
        model_override: CUTOUT_MODEL,
        source_url: upload.url,
        prompt: CUTOUT_PROMPT,
        max_cost_usd: MAX_RENDER_USD,
        max_quality_retries: 0,
        quality_gate: false,
        idempotency_key: stepRequestId,
        session_id: `batch-relay-creative:${input.projectId}`,
      },
    }],
  });
  const providerEstimate = estimateFromProvider(result, CUTOUT_MODEL);
  const now = new Date();
  const record: EstimateRecord = {
    id: `est_${randomUUID().replaceAll("-", "")}`,
    projectId: input.projectId,
    revision: input.revision,
    prompt: CUTOUT_PROMPT,
    output,
    estimatedCostUsd: providerEstimate.cost,
    model: providerEstimate.model,
    planId: providerEstimate.planId,
    expiresAt: new Date(now.getTime() + ESTIMATE_TTL_MS).toISOString(),
    requestId: input.requestId,
    bindingHash: hash,
    createdAt: now.toISOString(),
    state: "proposed",
    operation: "cutout",
    sourceAssetId: input.sourceAssetId,
    sourceContentHash: contentHash,
    sourceURL: upload.url,
  };
  const persisted = await withJournal((journal) => {
    const concurrentID = journal.idempotency[key];
    const concurrent = concurrentID ? journal.estimates[concurrentID] : undefined;
    if (concurrent && concurrent.bindingHash === hash && new Date(concurrent.expiresAt).getTime() > Date.now()) return concurrent;
    journal.estimates[record.id] = record;
    journal.idempotency[key] = record.id;
    return record;
  });
  return estimateView(persisted);
}

function jobIDFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  const direct = stringValue(object.job_id, object.jobId, object.media_job_id, object.mediaJobId);
  if (direct) return direct;
  for (const child of Object.values(object)) {
    if (Array.isArray(child)) for (const item of child) { const found = jobIDFrom(item); if (found) return found; }
    else { const found = jobIDFrom(child); if (found) return found; }
  }
  return undefined;
}

function mediaURLFrom(value: unknown, includeSourceURL = false): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  const direct = stringValue(object.url, object.image_url, object.imageUrl, object.media_url, object.mediaUrl, object.output_url, object.outputUrl, ...(includeSourceURL ? [object.source_url, object.sourceUrl] : []));
  if (direct && /^https:\/\//i.test(direct)) return direct;
  for (const child of Object.values(object)) {
    if (Array.isArray(child)) for (const item of child) { const found = mediaURLFrom(item, includeSourceURL); if (found) return found; }
    else { const found = mediaURLFrom(child, includeSourceURL); if (found) return found; }
  }
  return undefined;
}

function statusFrom(value: unknown): CreativeJobStatus {
  const raw = stringValue(nestedValue(value, ["status", "state"]), nestedValue(value, ["phase"]), "unknown")?.toLowerCase();
  if (["done", "completed", "complete", "succeeded", "success"].includes(raw ?? "")) return "succeeded";
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(raw ?? "")) return "failed";
  if (["queued", "pending", "proposed"].includes(raw ?? "")) return "queued";
  if (["running", "executing", "processing", "in_progress"].includes(raw ?? "")) return "running";
  return "unknown";
}

function warningsFrom(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const warnings = Array.isArray(object.warnings) ? object.warnings.filter((x): x is string => typeof x === "string") : [];
  if (object.fallback_fired === true || object.fallbackFired === true) warnings.push("Livepeer reported a fallback output; it was not accepted as a generated background.");
  return [...new Set(warnings)];
}

function providerPlanState(value: unknown): { status: CreativeJobStatus; jobId?: string; imageUrl?: string; actualCostUsd?: number; warnings: string[] } {
  const step = value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).steps)
    ? ((value as Record<string, unknown>).steps as unknown[])[0]
    : value;
  const source = step && typeof step === "object" ? step : value;
  const status = statusFrom(source);
  const warnings = warningsFrom(source);
  const imageUrl = mediaURLFrom(source);
  const actualCostUsd = numberValue(
    nestedValue(source, ["actual_cost_usd", "actualCostUsd", "cost_usd", "costUsd"]),
    nestedValue(value, ["actual_cost_usd", "actualCostUsd"]),
  );
  return { status: warnings.some((warning) => warning.includes("fallback")) ? "failed" : status, jobId: jobIDFrom(source) ?? jobIDFrom(value), imageUrl, actualCostUsd, warnings };
}

export async function executeEstimate(input: { estimateId: string; requestId: string; projectId: string; revision: number }): Promise<CreativeJob> {
  const key = `generate:${input.requestId}`;
  const existing = await readJournalSnapshot();
  const priorJobID = existing.idempotency[key];
  if (priorJobID && existing.jobs[priorJobID]) {
    const priorJob = existing.jobs[priorJobID];
    if (priorJob.estimateId !== input.estimateId || priorJob.projectId !== input.projectId || priorJob.revision !== input.revision) {
      throw new CreativeAPIError(409, "creative_idempotency_conflict", "This request ID is already bound to a different creative job.");
    }
    return responseJob(priorJob);
  }
  const preparedResult = await withJournal((journal) => {
    const concurrentJobID = journal.idempotency[key];
    const concurrentJob = concurrentJobID ? journal.jobs[concurrentJobID] : undefined;
    if (concurrentJob) {
      if (concurrentJob.estimateId !== input.estimateId || concurrentJob.projectId !== input.projectId || concurrentJob.revision !== input.revision) {
        throw new CreativeAPIError(409, "creative_idempotency_conflict", "This request ID is already bound to a different creative job.");
      }
      return { job: concurrentJob, duplicate: true as const };
    }
    const estimate = journal.estimates[input.estimateId];
    assert(estimate, 404, "creative_estimate_not_found", "The creative estimate was not found.");
    assert(estimate.projectId === input.projectId && estimate.revision === input.revision, 409, "creative_estimate_binding_mismatch", "The estimate does not match the current project revision.");
    assert(estimate.state === "proposed", 409, "creative_estimate_not_executable", "The creative estimate has already been used or is no longer executable.");
    assert(new Date(estimate.expiresAt).getTime() > Date.now(), 409, "creative_estimate_expired", "The creative estimate has expired; request a new estimate.");
    const reservationUsd = MAX_RENDER_USD;
    assertBudgetAvailable(journal, reservationUsd);
    const job: JobRecord = {
      id: `job_${randomUUID().replaceAll("-", "")}`,
      projectId: input.projectId,
      revision: input.revision,
      status: "queued",
      estimatedCostUsd: estimate.estimatedCostUsd,
      model: estimate.model,
      estimateId: estimate.id,
      providerPlanId: estimate.planId,
      reservationUsd,
      reservationState: "held",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      operation: estimate.operation ?? "background",
      ...(estimate.sourceAssetId ? { sourceAssetId: estimate.sourceAssetId } : {}),
    };
    estimate.state = "executing";
    journal.jobs[job.id] = job;
    journal.idempotency[key] = job.id;
    return { job, duplicate: false as const };
  });
  if (preparedResult.duplicate) return responseJob(preparedResult.job);
  const prepared = preparedResult.job;
  try {
    const result = await callLivepeerTool("submit_plan", { plan_id: prepared.providerPlanId, confirm: true });
    const value = providerValue(result);
    const provider = providerPlanState(value);
    const updated = await withJournal((journal) => {
      const job = journal.jobs[prepared.id];
      if (!job) return prepared;
      job.providerJobId = provider.jobId;
      job.providerResult = value;
      job.status = provider.status === "succeeded" ? "succeeded" : provider.status === "failed" ? "failed" : provider.status === "queued" || provider.status === "running" ? provider.status : "unknown";
      job.imageUrl = provider.imageUrl;
      job.actualCostUsd = provider.actualCostUsd;
      job.warnings = provider.warnings;
      job.updatedAt = new Date().toISOString();
      if (job.actualCostUsd !== undefined) job.reservationState = "settled";
      if (job.status === "succeeded") journal.estimates[job.estimateId].state = "completed";
      return job;
    });
    return responseJob(updated);
  } catch (error) {
    await withJournal((journal) => {
      const job = journal.jobs[prepared.id];
      if (job) { job.status = "unknown"; job.error = error instanceof Error ? error.message : "Livepeer execution status is unknown."; job.updatedAt = new Date().toISOString(); }
    });
    if (error instanceof CreativeAPIError) throw error;
    throw new CreativeAPIError(503, "livepeer_execution_unknown", "Livepeer execution status is unknown; poll the job before retrying.");
  }
}

export async function getCreativeJob(id: string): Promise<CreativeJob> {
  assert(/^job_[A-Za-z0-9]+$/.test(id), 400, "creative_job_invalid", "The creative job ID is invalid.");
  const journal = await readJournalSnapshot();
  const job = journal.jobs[id];
  assert(job, 404, "creative_job_not_found", "The creative job was not found.");
  if (job.status === "succeeded" || job.status === "failed") return responseJob(job);
  assert(isLivepeerConfigured(), 503, "livepeer_unconfigured", "Livepeer Creative is not configured.");
  try {
    const result = await callLivepeerTool("get_plan", { plan_id: job.providerPlanId });
    let value = providerValue(result);
    let provider = providerPlanState(value);
    if (!provider.imageUrl && provider.jobId) {
      const mediaResult = await callLivepeerTool("get_create_media", { job_id: provider.jobId });
      value = mediaResult.structuredContent ?? providerValue(mediaResult);
      const media = providerPlanState(value);
      provider = {
        status: media.status === "unknown" ? provider.status : media.status,
        jobId: media.jobId ?? provider.jobId,
        imageUrl: media.imageUrl,
        actualCostUsd: media.actualCostUsd ?? provider.actualCostUsd,
        warnings: [...new Set([...provider.warnings, ...media.warnings])],
      };
    }
    const updated = await withJournal((next) => {
      const current = next.jobs[id];
      if (!current) return job;
      current.providerJobId = provider.jobId ?? current.providerJobId;
      current.providerResult = value;
      current.status = provider.status;
      current.imageUrl = provider.imageUrl ?? current.imageUrl;
      current.actualCostUsd = provider.actualCostUsd ?? current.actualCostUsd;
      current.warnings = provider.warnings;
      current.updatedAt = new Date().toISOString();
      if (current.actualCostUsd !== undefined) current.reservationState = "settled";
      if (current.status === "succeeded") next.estimates[current.estimateId].state = "completed";
      if (current.status === "failed" && current.actualCostUsd !== undefined) next.estimates[current.estimateId].state = "failed";
      return current;
    });
    return responseJob(updated);
  } catch (error) {
    if (error instanceof CreativeAPIError) {
      const current = await readJournalSnapshot().then((next) => next.jobs[id]);
      if (current) return responseJob({ ...current, status: "unknown", error: error.message });
    }
    throw error;
  }
}

export async function getStoredImageURL(id: string): Promise<{ url: string; host: string; operation?: CreativeOperation }> {
  assert(/^job_[A-Za-z0-9]+$/.test(id), 400, "creative_job_invalid", "The creative job ID is invalid.");
  const journal = await readJournalSnapshot();
  const job = journal.jobs[id];
  assert(job, 404, "creative_job_not_found", "The creative job was not found.");
  assert(job.status === "succeeded" && job.imageUrl, 409, "creative_image_not_ready", "The generated background is not ready.");
  let url: URL;
  try { url = new URL(job.imageUrl); } catch { throw new CreativeAPIError(502, "creative_image_invalid", "The generated background URL is invalid."); }
  assert(isTrustedImageURL(url), 502, "creative_image_untrusted", "The generated background host is not trusted.");
  return { url: url.toString(), host: url.hostname, operation: job.operation };
}

/** Validate each image URL and redirect destination against an operator-owned allowlist. */
export function isTrustedImageURL(value: URL | string): boolean {
  let url: URL;
  try { url = typeof value === "string" ? new URL(value) : value; } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost" || url.hostname.endsWith(".local")) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split(".").map(Number);
    if (octets.length === 4 && (octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31))) return false;
  }
  if (ipVersion === 6 && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") || host.startsWith("::ffff:10.") || host.startsWith("::ffff:192.168."))) return false;
  const allowedHosts = new Set([providerHost(), ...(process.env.LIVEPEER_IMAGE_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)]);
  return allowedHosts.has(url.hostname.toLowerCase());
}

export async function creativeBudgetStatus(): Promise<{ spentUsd: number; reservedUsd: number }> {
  return budgetSnapshot(await readJournalSnapshot());
}
