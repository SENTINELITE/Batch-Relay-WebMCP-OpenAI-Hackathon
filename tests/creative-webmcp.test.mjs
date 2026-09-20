import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const tools = [
  ["inspectCreativeProject", "creative.inspect_project", "inspect_creative_project", "inspect_project"],
  ["updateCreativeEvent", "creative.update_event", "update_creative_event", "update_event_details"],
  ["proposeCreativeBackground", "creative.propose_background", "propose_creative_background", "propose_background"],
  ["checkCreativeGeneration", "creative.check_generation", "check_creative_generation", "check_generation"],
  ["applyCreativeBackground", "creative.apply_background", "apply_creative_background", "apply_background_candidate"],
  ["switchCreativeLayout", "creative.switch_layout", "switch_creative_layout", "switch_layout"],
  ["exportCreativeArtwork", "creative.export_artwork", "export_creative_artwork", "export_artwork"],
  ["undoCreativeChange", "creative.undo", "undo_creative_change", "undo"],
  ["redoCreativeChange", "creative.redo", "redo_creative_change", "redo"],
];

function definition(source, exportName) {
  const start = source.indexOf(`export const ${exportName} = defineTool`);
  assert.notEqual(start, -1, `${exportName} is defined`);
  const end = source.indexOf("\n});", start);
  assert.notEqual(end, -1, `${exportName} has a closed definition`);
  return source.slice(start, end + 4);
}

test("creative WebMCP publishes the approved bounded tool surface", async () => {
  const source = await read("src/webmcp/creative/tools.ts");
  assert.equal((source.match(/^export const \w+ = defineTool/gm) ?? []).length, tools.length);

  for (const [exportName, stableKey, name, action] of tools) {
    const tool = definition(source, exportName);
    assert.match(tool, new RegExp(`stableKey: "${stableKey}"`));
    assert.match(tool, new RegExp(`name: "${name}"`));
    assert.match(tool, /source: "merchant_authored"/);
    assert.match(tool, /description:\s*"[^\"]{20,}"/);
    assert.match(tool, /inputSchema:/);
    assert.match(tool, /additionalProperties: false/);
    assert.match(tool, new RegExp(`requestCreativeWebMcpAction\\(\\"${action}\\"`));
  }
});

test("creative registration is client-scoped and uses the installed SDK telemetry surface", async () => {
  const source = await read("src/webmcp/creative/CreativeWebMcpRegistrar.tsx");
  assert.match(source, /^"use client";/);
  assert.match(source, /registerTools\(creativeWebMcpTools/);
  assert.match(source, /registerTools\(creativeWebMcpTools, \{ telemetry: true \}\)/);
  assert.match(source, /registration\.unregister\(\)/);
});

test("creative bridge keeps provider work out of the tool request and exposes all actions", async () => {
  const source = await read("src/webmcp/creative/bridge.ts");
  for (const action of [
    "inspect_project",
    "update_event_details",
    "propose_background",
    "check_generation",
    "apply_background_candidate",
    "switch_layout",
    "export_artwork",
    "undo",
    "redo",
  ]) {
    assert.match(source, new RegExp(`"${action}"`));
  }
  assert.match(source, /requestTimeoutMs = 15_000/);
  assert.match(source, /check_generation/);
  assert.match(source, /must be checked separately/);
  assert.match(source, /subscribeToCreativeWebMcpActions/);
  assert.match(source, /respondToCreativeWebMcpAction/);
});

test("creative documentation records baseline, setup, safety boundary, and unresolved eligibility", async () => {
  const readme = await read("docs/creative/README.md");
  const checklist = await read("docs/creative/submission-checklist.md");
  for (const content of [readme, checklist]) {
    assert.match(content, /84ce005/);
    assert.match(content, /npm (install|test|run typecheck|run lint|run build)/);
    assert.match(content, /atumera\.com\/hackathon/);
    assert.match(content, /eligib|reuse|visibility|licensing/i);
    assert.match(content, /credential|participant endpoint/i);
  }
});
