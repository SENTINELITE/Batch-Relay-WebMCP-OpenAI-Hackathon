import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test, { after, afterEach, beforeEach } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const Module = require("node:module");

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const servicePath = resolve(sourceRoot, "lib/livepeer/service.ts");
const mcpPath = resolve(sourceRoot, "lib/livepeer/mcp.ts");
const journalPath = resolve(sourceRoot, "lib/livepeer/journal.ts");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalExtension = Module._extensions[".ts"];
const originalMcpCache = require.cache[mcpPath];
const providerCalls = [];
let providerResponder;

const providerAdapter = {
  callLivepeerTool: async (name, args) => {
    providerCalls.push({ name, args });
    return providerResponder(name, args);
  },
  isLivepeerConfigured: () => true,
  providerHost: () => "provider.example.test",
  providerValue: (result) => result.structuredContent ?? result,
};

require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: providerAdapter };
Module._extensions[".ts"] = function loadTypeScript(module, filename) {
  const source = require("node:fs").readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};
Module._resolveFilename = function resolveTypeScript(request, parent, isMain, options) {
  let candidate = request;
  if (candidate.startsWith("@/")) candidate = join(sourceRoot, candidate.slice(2));
  if (candidate.startsWith(".") || candidate.startsWith("/")) {
    for (const extension of ["", ".ts", ".tsx", ".js", ".json"]) {
      const pathname = `${candidate}${extension}`;
      try { if (require("node:fs").statSync(pathname).isFile()) return resolve(pathname); } catch { /* continue */ }
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
Module._load = function loadStubs(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const service = require(servicePath);
const cutout = require(resolve(sourceRoot, "lib/livepeer/cutout.ts"));
const journal = require(journalPath);
let dataDirectory;

const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const jpegBytes = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);

function multipart(fields, bytes = pngBytes, mime = "image/png", filename = "athlete.png") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("image", new Blob([bytes], { type: mime }), filename);
  return new Request("http://localhost/api/creative/cutouts/estimate", { method: "POST", body: form });
}

function estimateInput(requestId, sourceAssetId = "athlete-1", bytes = pngBytes) {
  return { projectId: "project-cutout", revision: 3, requestId, sourceAssetId, bytes, mimeType: "image/png", filename: "athlete.png" };
}

beforeEach(async () => {
  dataDirectory = await mkdtemp(join("/tmp", "batch-relay-cutout-"));
  process.env.NODE_ENV = "test";
  process.env.LIVEPEER_JOURNAL_PATH = join(dataDirectory, "journal.json");
  process.env.LIVEPEER_MCP_URL = "http://localhost:9999";
  process.env.LIVEPEER_IMAGE_HOSTS = "";
  process.env.LIVEPEER_CREATIVE_BUDGET_USD = "20";
  providerCalls.length = 0;
  providerResponder = async (name, args) => {
    if (name === "upload_image") return { structuredContent: { url: "https://provider.example.test/uploads/athlete.png", mime_type: args.mime_type } };
    return { structuredContent: { status: "proposed", plan_id: "plan-cutout", total_est_cost_usd: 0.1, steps: [{ args: { model_override: "bg-remove", source_url: "https://provider.example.test/uploads/athlete.png" }, est_cost_usd: 0.1 }] } };
  };
});

afterEach(async () => {
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
});

after(async () => {
  if (originalMcpCache) require.cache[mcpPath] = originalMcpCache;
  else delete require.cache[mcpPath];
  Module._extensions[".ts"] = originalExtension;
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
});

test("multipart validation rejects empty metadata, forged MIME, and oversized streams without content-length", async () => {
  await assert.rejects(cutout.parseCutoutMultipart(multipart({ projectId: "project", revision: "", requestId: "request", sourceAssetId: "asset" })), (error) => error?.code === "creative_revision_invalid");
  for (const field of ["projectId", "requestId", "sourceAssetId"]) {
    const parsed = await cutout.parseCutoutMultipart(multipart({ projectId: "project", revision: "1", requestId: "request", sourceAssetId: "asset", [field]: "" }));
    assert.throws(() => service.validateCutoutMetadata(parsed), (error) => error?.code === `creative_${field === "projectId" ? "project_id" : field === "sourceAssetId" ? "source_asset_id" : "request_id"}_invalid`);
  }
  await assert.rejects(cutout.parseCutoutMultipart(multipart({ projectId: "project", revision: "1", requestId: "request", sourceAssetId: "asset" }, pngBytes, "image/jpeg")), (error) => error?.code === "creative_image_type_mismatch");

  const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(cutout.MAX_CUTOUT_REQUEST_BYTES + 1)); controller.close(); } });
  const request = new Request("http://localhost/api/creative/cutouts/estimate", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=missing" }, body: oversized, duplex: "half" });
  await assert.rejects(cutout.parseCutoutMultipart(request), (error) => error?.code === "creative_request_too_large");
});

test("cutout upload and quote use exact source bytes and the bg-remove source_url contract", async () => {
  const estimate = await service.proposeCutoutEstimate(estimateInput("cutout-request"));
  const upload = providerCalls.find((call) => call.name === "upload_image");
  const proposal = providerCalls.find((call) => call.name === "submit_plan");
  assert.ok(upload);
  assert.equal(upload.args.data, Buffer.from(pngBytes).toString("base64"));
  assert.equal(upload.args.mime_type, "image/png");
  assert.equal(upload.args.filename, "athlete.png");
  assert.ok(proposal);
  const args = proposal.args.steps[0].args;
  assert.equal(args.action, "generate");
  assert.equal(args.model_override, "bg-remove");
  assert.equal(args.source_url, "https://provider.example.test/uploads/athlete.png");
  assert.equal("aspect_ratio" in args, false);
  assert.equal("palette" in args, false);
  assert.equal(estimate.operation, "cutout");
  assert.equal(estimate.sourceAssetId, "athlete-1");
  assert.equal(estimate.sourceContentHash, createHash("sha256").update(pngBytes).digest("hex"));
});

test("source uploads and cutout estimates are idempotent, while source hash changes conflict", async () => {
  const first = await service.proposeCutoutEstimate(estimateInput("same-request"));
  const retry = await service.proposeCutoutEstimate(estimateInput("same-request"));
  assert.equal(retry.id, first.id);
  assert.equal(providerCalls.filter((call) => call.name === "upload_image").length, 1);
  assert.equal(providerCalls.filter((call) => call.name === "submit_plan").length, 1);
  await assert.rejects(service.proposeCutoutEstimate(estimateInput("same-request", "athlete-1", jpegBytes)), (error) => error?.code === "creative_idempotency_conflict");
  await assert.rejects(service.proposeCutoutEstimate(estimateInput("different-request", "athlete-1", jpegBytes)), (error) => error?.code === "creative_source_asset_conflict");
  assert.equal(providerCalls.filter((call) => call.name === "upload_image").length, 1);
});

test("simultaneous identical cutout estimates share one quote", async () => {
  providerResponder = async (name) => {
    if (name === "upload_image") return { structuredContent: { url: "https://provider.example.test/uploads/athlete.png" } };
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { structuredContent: { status: "proposed", plan_id: "plan-concurrent", total_est_cost_usd: 0.1, steps: [{ args: { model_override: "bg-remove" }, est_cost_usd: 0.1 }] } };
  };
  const [first, retry] = await Promise.all([
    service.proposeCutoutEstimate(estimateInput("concurrent-request")),
    service.proposeCutoutEstimate(estimateInput("concurrent-request")),
  ]);
  assert.equal(retry.id, first.id);
  assert.equal(providerCalls.filter((call) => call.name === "upload_image").length, 1);
  assert.equal(providerCalls.filter((call) => call.name === "submit_plan").length, 1);
});

test("cutout proposal fails closed when Livepeer substitutes an unexpected model", async () => {
  providerResponder = async (name) => {
    if (name === "upload_image") return { structuredContent: { url: "https://provider.example.test/uploads/athlete.png" } };
    return { structuredContent: { status: "proposed", plan_id: "plan-wrong-model", total_est_cost_usd: 0.1, steps: [{ args: { model_override: "flux-schnell" }, est_cost_usd: 0.1 }] } };
  };
  await assert.rejects(service.proposeCutoutEstimate(estimateInput("wrong-model")), (error) => error?.code === "livepeer_model_mismatch");
  assert.equal(providerCalls.filter((call) => call.name === "submit_plan").length, 1);
});

test("cutout proposal uses bg-remove when provider omits the model", async () => {
  providerResponder = async (name) => {
    if (name === "upload_image") return { structuredContent: { url: "https://provider.example.test/uploads/athlete.png" } };
    return { structuredContent: { status: "proposed", plan_id: "plan-implicit-model", total_est_cost_usd: 0.1, steps: [{ args: {}, est_cost_usd: 0.1 }] } };
  };
  const estimate = await service.proposeCutoutEstimate(estimateInput("implicit-model"));
  assert.equal(estimate.model, "bg-remove");
});

test("a stale lock owned by this live process is not reclaimed during an upload window", async () => {
  const lock = `${process.env.LIVEPEER_JOURNAL_PATH}.lock`;
  await writeFile(lock, `${process.pid}\n`, "utf8");
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  await assert.rejects(journal.withJournal(() => undefined), (error) => error?.code === "creative_persistence_busy");
});
