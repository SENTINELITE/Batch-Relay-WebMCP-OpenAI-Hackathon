import assert from "node:assert/strict";
import test from "node:test";

import {
  addBackgroundCandidate,
  applyAthleteCutout,
  applyBackground,
  createProject,
  projectTextValues,
  restoreOriginalAthlete,
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

const cutout = (id, sourceAssetId, status = "ready") => ({
  id: `cutout-${id}`,
  asset: asset(id, "athlete", "generated"),
  sourceAssetId,
  prompt: "transparent athlete cutout",
  createdAt: "2026-09-19T00:04:00.000Z",
  status,
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

test("applying a ready cutout retains the original athlete and keeps other layers independent", () => {
  const originalAthlete = asset("athlete-original", "athlete", "upload");
  const background = asset("background", "background", "generated");
  const logo = asset("logo", "logo", "sample");
  const project = createProject({ id: "cutout-project", assets: { athlete: originalAthlete, background, logo } });
  const candidate = cutout("athlete-cutout", originalAthlete.id);
  const applied = applyAthleteCutout(project, candidate, "2026-09-19T00:05:00.000Z");

  assert.equal(applied.athleteOriginal.id, originalAthlete.id);
  assert.equal(applied.assets.athlete.id, candidate.asset.id);
  assert.equal(applied.assets.background.id, background.id);
  assert.equal(applied.assets.logo.id, logo.id);
  assert.equal(applied.layouts.card.athlete.fit, "contain");
  assert.equal(applied.layouts.banner.athlete.fit, "contain");
  assert.equal(applied.layouts.card.athlete.x, project.layouts.card.athlete.x);
  assert.deepEqual(projectTextValues(applied), projectTextValues(project));
  assert.equal(applied.revision, project.revision + 1);
});

test("cutout application fails closed for a stale source or unready candidate", () => {
  const project = createProject({ id: "cutout-project", assets: { athlete: asset("athlete-original", "athlete", "upload") } });
  assert.strictEqual(applyAthleteCutout(project, cutout("wrong-source", "another-athlete")), project);
  assert.strictEqual(applyAthleteCutout(project, cutout("pending", project.assets.athlete.id, "pending")), project);
});

test("restoring the original athlete keeps cutout candidates and restores the cover fit", () => {
  const originalAthlete = asset("athlete-original", "athlete", "upload");
  const project = createProject({ id: "cutout-project", assets: { athlete: originalAthlete } });
  const first = applyAthleteCutout(project, cutout("athlete-cutout-1", originalAthlete.id));
  const second = applyAthleteCutout(first, cutout("athlete-cutout-2", originalAthlete.id));
  const withHistory = updateProject(second, { athleteCutoutCandidates: [cutout("athlete-cutout-1", originalAthlete.id), cutout("athlete-cutout-2", originalAthlete.id)] });
  const restored = restoreOriginalAthlete(withHistory, "2026-09-19T00:06:00.000Z");

  assert.equal(restored.assets.athlete.id, originalAthlete.id);
  assert.equal(restored.athleteOriginal.id, originalAthlete.id);
  assert.equal(restored.layouts.card.athlete.fit, "cover");
  assert.equal(restored.layouts.banner.athlete.fit, "cover");
  assert.equal(restored.athleteCutoutCandidates.length, 2);
  assert.equal(restored.revision, withHistory.revision + 1);
});

test("projects written before athlete cutouts remain valid and load without optional fields", async () => {
  const oldProject = createProject({ id: "old-project" });
  delete oldProject.athleteOriginal;
  delete oldProject.athleteCutoutCandidates;
  assert.equal(isCreativeProject(oldProject), true);
  const persistence = createMemoryCreativePersistence();
  await persistence.saveProject(oldProject);
  const restored = await persistence.loadProject(oldProject.id);
  assert.equal(restored.athleteOriginal, undefined);
  assert.equal(restored.athleteCutoutCandidates, undefined);
});

test("deleting a project removes retained originals and cutout blobs", async () => {
  const originalAthlete = asset("athlete-original", "athlete", "upload");
  const candidate = cutout("athlete-cutout", originalAthlete.id);
  const project = createProject({
    id: "cutout-delete",
    assets: { athlete: candidate.asset },
    athleteOriginal: originalAthlete,
    athleteCutoutCandidates: [candidate],
  });
  const persistence = createMemoryCreativePersistence();
  await persistence.saveProject(project, {
    [originalAthlete.blobKey]: new Blob(["original"], { type: "image/jpeg" }),
    [candidate.asset.blobKey]: new Blob(["cutout"], { type: "image/png" }),
  });
  await persistence.deleteProject(project.id);
  assert.equal(await persistence.loadAssetBlob(originalAthlete.blobKey), null);
  assert.equal(await persistence.loadAssetBlob(candidate.asset.blobKey), null);
});
