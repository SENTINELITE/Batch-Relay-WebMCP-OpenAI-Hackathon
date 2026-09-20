export type CreativeJobStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";
export type CreativeOperation = "background" | "cutout";

export type CreativePalette = {
  primary: string;
  accent: string;
};

export type CreativeOutputRequest = {
  aspectRatio?: "4:3";
  format?: "background" | "card" | "banner" | "cutout";
};

export type CreativeEstimate = {
  id: string;
  projectId: string;
  revision: number;
  prompt: string;
  palette?: CreativePalette;
  output: CreativeOutputRequest;
  estimatedCostUsd: number;
  model: string;
  planId: string;
  expiresAt: string;
  requestId: string;
  operation?: CreativeOperation;
  sourceAssetId?: string;
  sourceContentHash?: string;
};

export type CreativeJob = {
  id: string;
  projectId: string;
  revision: number;
  status: CreativeJobStatus;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  imageUrl?: string;
  model?: string;
  warnings?: string[];
  error?: string;
  operation?: CreativeOperation;
  sourceAssetId?: string;
};

export type CreativeStatus = {
  configured: boolean;
  authorized: boolean;
  budgetLimitUsd: number;
  message?: string;
};

export type CreativeJournal = {
  version: 1;
  estimates: Record<string, EstimateRecord>;
  jobs: Record<string, JobRecord>;
  idempotency: Record<string, string>;
  sourceUploads: Record<string, SourceUploadRecord>;
};

export type EstimateRecord = CreativeEstimate & {
  bindingHash: string;
  createdAt: string;
  state: "proposed" | "executing" | "completed" | "expired" | "failed";
  operation: CreativeOperation;
  sourceAssetId?: string;
  sourceContentHash?: string;
  sourceURL?: string;
};

export type JobRecord = CreativeJob & {
  estimateId: string;
  providerPlanId: string;
  providerJobId?: string;
  reservationUsd: number;
  reservationState: "held" | "settled" | "released";
  createdAt: string;
  updatedAt: string;
  providerResult?: unknown;
};

export type SourceUploadRecord = {
  sourceAssetId: string;
  contentHash: string;
  url: string;
  mimeType: string;
  filename: string;
  createdAt: string;
};

export type ProviderToolResult = {
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string; data?: string }>;
  isError?: boolean;
  [key: string]: unknown;
};
