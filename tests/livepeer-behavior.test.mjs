import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test, { after, afterEach, beforeEach } from "node:test";

/**
 * These tests load the real service and journal modules while replacing only
 * the provider boundary. That gives the race and recovery assertions a real
 * on-disk journal without making a network request or spending a provider
 * credit.
 */
const require = createRequire(import.meta.url);
const Module = require("node:module");
const typescript = require("typescript");
const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const sourceRoot = join(repositoryRoot, "src");
const mcpPath = join(sourceRoot, "lib/livepeer/mcp.ts");
const journalPath = join(sourceRoot, "lib/livepeer/journal.ts");
const originalExtension = Module._extensions[".ts"];
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;

const providerCalls = [];
let providerResponder = async (name, args) => {
  if (name === "submit_plan" && args.confirm === true) {
    return { structuredContent: { status: "queued", steps: [{ status: "queued", job_id: "media-default" }] } };
  }
  const proposalNumber = providerCalls.filter((call) => call.name === "submit_plan" && call.args.confirm !== true).length;
  return {
    structuredContent: {
      status: "proposed",
      plan_id: `plan-${proposalNumber}`,
      total_est_cost_usd: 0.1,
      steps: [{ args: { model_override: "flux-schnell" }, est_cost_usd: 0.1 }],
    },
  };
};

const providerAdapter = {
  callLivepeerTool: async (name, args) => {
    providerCalls.push({ name, args });
    return providerResponder(name, args);
  },
  isLivepeerConfigured: () => true,
  providerHost: () => "provider.example.test",
  providerValue: (result) => result.structuredContent ?? result,
};

const cookiesStore = new Map();
const originalMcpCache = require.cache[mcpPath];
require.cache[mcpPath] = {
  id: mcpPath,
  filename: mcpPath,
  loaded: true,
  exports: providerAdapter,
};

Module._extensions[".ts"] = function loadTypeScript(module, filename) {
  const source = require("node:fs").readFileSync(filename, "utf8");
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      target: typescript.ScriptTarget.ES2022,
      module: typescript.ModuleKind.CommonJS,
      moduleResolution: typescript.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      sourceMap: false,
    },
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
      try {
        if (require("node:fs").statSync(pathname).isFile()) return resolve(pathname);
      } catch {
        // Keep Node's normal resolution error for missing modules.
      }
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

Module._load = function loadTestStubs(request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/headers") {
    return { cookies: async () => ({ get: (name) => cookiesStore.get(name), set: (name, value) => cookiesStore.set(name, { value }) }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const service = require(join(sourceRoot, "lib/livepeer/service.ts"));
const journal = require(journalPath);

let dataDirectory;

function input(requestId, overrides = {}) {
  return {
    projectId: "project-behavior",
    revision: 1,
    prompt: "A dramatic stadium tunnel with clean negative space",
    palette: { primary: "#123456", accent: "#abcdef" },
    requestId,
    ...overrides,
  };
}

async function makeEstimate(requestId, overrides = {}) {
  return service.proposeEstimate(input(requestId, overrides));
}

async function snapshot() {
  return journal.readJournalSnapshot();
}

async function waitForProviderCalls(count) {
  const started = Date.now();
  while (providerCalls.length < count) {
    if (Date.now() - started > 2_000) throw new Error(`Timed out waiting for provider call ${count}.`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "batch-relay-creative-livepeer-"));
  process.env.NODE_ENV = "test";
  process.env.LIVEPEER_JOURNAL_PATH = join(dataDirectory, "journal.json");
  process.env.LIVEPEER_MCP_URL = "http://localhost:9999";
  process.env.LIVEPEER_IMAGE_HOSTS = "images.example.test";
  process.env.LIVEPEER_CREATIVE_BUDGET_USD = "20";
  providerCalls.length = 0;
  providerResponder = async (name, args) => {
    if (name === "submit_plan" && args.confirm === true) {
      return { structuredContent: { status: "queued", steps: [{ status: "queued", job_id: "media-default" }] } };
    }
    const proposalNumber = providerCalls.filter((call) => call.name === "submit_plan" && call.args.confirm !== true).length;
    return {
      structuredContent: {
        status: "proposed",
        plan_id: `plan-${proposalNumber}`,
        total_est_cost_usd: 0.1,
        steps: [{ args: { model_override: "flux-schnell" }, est_cost_usd: 0.1 }],
      },
    };
  };
});

afterEach(async () => {
  if (dataDirectory) {
    await rm(dataDirectory, { recursive: true, force: true });
    dataDirectory = undefined;
  }
});

after(async () => {
  if (originalMcpCache) require.cache[mcpPath] = originalMcpCache;
  else delete require.cache[mcpPath];
  Module._extensions[".ts"] = originalExtension;
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
});

test("rejects an expired estimate before provider execution", async () => {
  const estimate = await makeEstimate("expired-request");
  const journalValue = await snapshot();
  journalValue.estimates[estimate.id].expiresAt = new Date(Date.now() - 1).toISOString();
  await writeFile(process.env.LIVEPEER_JOURNAL_PATH, `${JSON.stringify(journalValue)}\n`);

  await assert.rejects(
    service.executeEstimate({ estimateId: estimate.id, requestId: "expired-request", projectId: estimate.projectId, revision: estimate.revision }),
    (error) => error?.code === "creative_estimate_expired",
  );
  assert.equal(providerCalls.filter((call) => call.name === "submit_plan" && call.args.confirm === true).length, 0);
});

test("deduplicates sequential execution retries by request ID", async () => {
  const estimate = await makeEstimate("sequential-request");
  const request = { estimateId: estimate.id, requestId: "sequential-request", projectId: estimate.projectId, revision: estimate.revision };
  const first = await service.executeEstimate(request);
  const second = await service.executeEstimate(request);

  assert.equal(first.id, second.id);
  assert.equal(providerCalls.filter((call) => call.name === "submit_plan" && call.args.confirm === true).length, 1);
});

test("deduplicates concurrent execution retries before either caller can spend twice", async () => {
  const estimate = await makeEstimate("concurrent-request");
  const request = { estimateId: estimate.id, requestId: "concurrent-request", projectId: estimate.projectId, revision: estimate.revision };
  let releaseProvider;
  const providerFinished = new Promise((resolvePromise) => { releaseProvider = resolvePromise; });
  providerResponder = async (name, args) => {
    if (name === "submit_plan" && args.confirm === true) {
      await providerFinished;
      return { structuredContent: { status: "queued", steps: [{ status: "queued", job_id: "media-concurrent" }] } };
    }
    return { structuredContent: { status: "proposed", plan_id: "plan-concurrent", total_est_cost_usd: 0.1, steps: [{ args: { model_override: "flux-schnell" }, est_cost_usd: 0.1 }] } };
  };

  const firstPromise = service.executeEstimate(request);
  await waitForProviderCalls(1);
  const secondPromise = service.executeEstimate(request);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  releaseProvider();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(first.id, second.id);
  assert.equal(providerCalls.filter((call) => call.name === "submit_plan" && call.args.confirm === true).length, 1);
});

test("counts concurrent pending reservations against the budget cap", async () => {
  process.env.LIVEPEER_CREATIVE_BUDGET_USD = "0.1";
  const firstEstimate = await makeEstimate("budget-first");
  const secondEstimate = await makeEstimate("budget-second");
  let releaseProvider;
  const providerFinished = new Promise((resolvePromise) => { releaseProvider = resolvePromise; });
  providerResponder = async (name, args) => {
    if (name === "submit_plan" && args.confirm === true) {
      await providerFinished;
      return { structuredContent: { status: "queued", steps: [{ status: "queued", job_id: "media-budget" }] } };
    }
    return { structuredContent: { status: "proposed", plan_id: "plan-budget", total_est_cost_usd: 0.1, steps: [{ args: { model_override: "flux-schnell" }, est_cost_usd: 0.1 }] } };
  };

  const firstRequest = { estimateId: firstEstimate.id, requestId: "budget-first", projectId: firstEstimate.projectId, revision: firstEstimate.revision };
  const secondRequest = { estimateId: secondEstimate.id, requestId: "budget-second", projectId: secondEstimate.projectId, revision: secondEstimate.revision };
  const firstPromise = service.executeEstimate(firstRequest);
  await waitForProviderCalls(3);
  await assert.rejects(service.executeEstimate(secondRequest), (error) => error?.code === "creative_budget_exhausted");
  releaseProvider();
  await firstPromise;
  assert.equal(providerCalls.filter((call) => call.name === "submit_plan" && call.args.confirm === true).length, 1);
});

test("uses distinct provider idempotency keys for alternatives and stable keys for retries", async () => {
  const first = await makeEstimate("alternative-one");
  const second = await makeEstimate("alternative-two");
  const proposalCalls = providerCalls.filter((call) => call.name === "submit_plan" && call.args.confirm !== true);
  const firstKey = proposalCalls[0].args.steps[0].args.idempotency_key;
  const secondKey = proposalCalls[1].args.steps[0].args.idempotency_key;
  const retry = await makeEstimate("alternative-one");

  assert.notEqual(firstKey, secondKey);
  assert.equal(retry.id, first.id);
  assert.equal(providerCalls.filter((call) => call.name === "submit_plan" && call.args.confirm !== true).length, 2);
  assert.notEqual(first.id, second.id);
});

test("does not resubmit an execution whose provider result is unknown", async () => {
  const estimate = await makeEstimate("unknown-request");
  let failedOnce = false;
  providerResponder = async (name, args) => {
    if (name === "submit_plan" && args.confirm === true && !failedOnce) {
      failedOnce = true;
      throw new Error("mock transport timeout");
    }
    if (name === "get_plan") {
      return { structuredContent: { status: "succeeded", steps: [{ status: "succeeded", job_id: "media-recovered", url: "https://images.example.test/recovered.png", actual_cost_usd: 0.05 }] } };
    }
    return { structuredContent: { status: "proposed", plan_id: "plan-unknown", total_est_cost_usd: 0.1, steps: [{ args: { model_override: "flux-schnell" }, est_cost_usd: 0.1 }] } };
  };

  const request = { estimateId: estimate.id, requestId: "unknown-request", projectId: estimate.projectId, revision: estimate.revision };
  await assert.rejects(service.executeEstimate(request), (error) => error?.code === "livepeer_execution_unknown");
  const unknownJob = Object.values((await snapshot()).jobs)[0];
  assert.equal(unknownJob.status, "unknown");

  const recovered = await service.getCreativeJob(unknownJob.id);
  const retry = await service.executeEstimate(request);
  assert.equal(recovered.status, "succeeded");
  assert.equal(retry.status, "succeeded");
  assert.equal(providerCalls.filter((call) => call.name === "submit_plan" && call.args.confirm === true).length, 1);
  assert.equal(providerCalls.filter((call) => call.name === "get_plan").length, 1);
});

test("rejects untrusted image redirect destinations", () => {
  assert.equal(service.isTrustedImageURL("https://evil.example.test/background.png"), false);
  assert.equal(service.isTrustedImageURL("https://images.example.test/background.png"), true);
  assert.equal(service.isTrustedImageURL("https://192.168.1.20/background.png"), false);
});
