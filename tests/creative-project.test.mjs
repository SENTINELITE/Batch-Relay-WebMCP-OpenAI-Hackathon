import assert from "node:assert/strict";
import test from "node:test";

import {
  addBackgroundCandidate,
  applyBackground,
  createProject,
  projectTextValues,
  setFormat,
  updateProject,
} from "../src/lib/creative/project.ts";
import { createMemoryCreativePersistence, isCreativeProject } from "../src/lib/creative/persistence.ts";

const asset = (id, slot, source = "generated") => ({
  id,
  slot,
  name: `${id}.png`,
  mimeType: "image/png",
  source,
  blobKey: `creative/${id}`,
});

test("a project has two exact format layouts and independent layer references", () => {
  const project = createProject({ id: "project_test", now: () => "2026-09-19T00:00:00.000Z" });
  assert.equal(project.id, "project_test");
  assert.equal(project.revision, 1);
  const cardTitle = project.layouts.card.text.find((layer) => layer.id === "event-name");
  const cardDate = project.layouts.card.text.find((layer) => layer.id === "event-date");
  assert.ok(cardTitle.transform.y < project.layouts.card.athlete.y);
  assert.ok(project.layouts.card.athlete.y + project.layouts.card.athlete.height < cardDate.transform.y);
  assert.deepEqual(projectTextValues(project, "card"), {
    "event-name": "Northwest Classic",
    "event-date": "Saturday, June 14",
    "event-location": "Seattle · Washington",
    "event-cta": "Bring your best game",
  });
  assert.notStrictEqual(project.layouts.card, project.layouts.banner);
  assert.deepEqual(project.assets, {});
});

test("applying a background changes only the background reference", () => {
  const original = createProject({ id: "project_test" });
  const athlete = asset("athlete", "athlete", "upload");
  const logo = asset("logo", "logo", "sample");
  const before = updateProject(original, { assets: { athlete, logo } });
  const candidate = {
    id: "candidate_1",
    asset: asset("background_1", "background"),
    prompt: "navy court lights",
    createdAt: "2026-09-19T00:02:00.000Z",
    status: "ready",
  };
  const withCandidate = addBackgroundCandidate(before, candidate);
  const after = applyBackground(withCandidate, candidate, "2026-09-19T00:03:00.000Z");
  assert.equal(after.assets.background.id, "background_1");
  assert.equal(after.assets.athlete.id, "athlete");
  assert.equal(after.assets.logo.id, "logo");
  assert.deepEqual(after.layouts, before.layouts);
  assert.deepEqual(projectTextValues(after), projectTextValues(before));
  assert.equal(after.revision, before.revision + 2);
});

test("event edits update the matching text layers without changing background or foreground", () => {
  const original = createProject({ id: "project_test", assets: {
    background: asset("background", "background"),
    athlete: asset("athlete", "athlete", "upload"),
    logo: asset("logo", "logo", "upload"),
  } });
  const changed = updateProject(original, { event: { name: "Spring Open" } });
  assert.equal(projectTextValues(changed)["event-name"], "Spring Open");
  assert.equal(projectTextValues(changed)["event-date"], original.event.date);
  assert.deepEqual(changed.assets, original.assets);
  assert.equal(changed.revision, 2);
});

test("memory persistence keeps metadata and image blobs across reload-style reads", async () => {
  const persistence = createMemoryCreativePersistence();
  const project = createProject({ id: "persisted" });
  const blob = new Blob(["sample artwork"], { type: "image/png" });
  await persistence.saveProject(project, { "creative/sample": blob });
  const restored = await persistence.loadProject(project.id);
  assert.ok(restored);
  assert.equal(isCreativeProject(restored), true);
  assert.notStrictEqual(restored, project);
  assert.equal(await (await persistence.loadAssetBlob("creative/sample")).text(), "sample artwork");
  await persistence.deleteProject(project.id);
  assert.equal(await persistence.loadProject(project.id), null);
});

test("format switching is a local revision and does not alter assets", () => {
  const project = createProject({ id: "project_test", format: "card", assets: { athlete: asset("athlete", "athlete") } });
  const switched = setFormat(project, "banner");
  assert.equal(switched.format, "banner");
  assert.deepEqual(switched.assets, project.assets);
  assert.equal(switched.revision, 2);
});
