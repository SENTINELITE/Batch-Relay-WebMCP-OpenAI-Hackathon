import assert from "node:assert/strict";
import test from "node:test";

import {
  assignPhotoStableKeys,
  createBrowserPhotos,
  photoIdsByStableKey,
  photoStableKey,
} from "../src/lib/storefront/photo-library.ts";
import { missingTemplateDraftRequirements } from "../src/lib/storefront/print-drafts.ts";
import {
  WORKBENCH_SCHEMA_VERSION,
  WORKBENCH_STORAGE_KEY,
  clearWorkbenchSnapshot,
  createWorkbenchWriter,
  readWorkbenchSnapshot,
  relinkWorkbenchSnapshot,
  restoreNotice,
  workbenchState,
  writeWorkbenchSnapshot,
} from "../src/lib/storefront/workbench-persistence.ts";

/** An injected storage stub, so every rule below is a fact rather than a comment. */
function storageStub(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const file = (name, size = 1200, lastModified = 1700000000000, relativePath = "") =>
  ({ name, size, lastModified, type: "image/jpeg", webkitRelativePath: relativePath });

const photo = (id, name, options = {}) => ({
  id,
  filename: name,
  file: file(name, options.size, options.lastModified),
  relativePath: options.relativePath,
  previewURL: `blob:${id}`,
  mimeType: "image/jpeg",
  byteSize: options.size ?? 1200,
  stableKey: options.stableKey ?? photoStableKey(file(name, options.size, options.lastModified)),
});

const draft = (id, fields = {}) => ({
  id,
  productId: "memory-mate-8x10",
  productRevision: 3,
  photoIds: [],
  templateContractKnown: true,
  requiredSlotKeys: [],
  slotAssignments: {},
  textValues: {},
  slotTransforms: {},
  directCrop: { zoom: 1, focusX: 50, focusY: 50, offsetX: 0, offsetY: 0 },
  proofState: "idle",
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
  ...fields,
});

const emptyStateFields = {
  backgroundDraftIds: [],
  selectedDraftId: null,
  selectedProductKey: null,
  step: "catalog",
  directCrop: { zoom: 1, focusX: 50, focusY: 50 },
};

test("a saved workbench comes back re-linked to a fresh import of the same photographs", () => {
  const storage = storageStub();
  const before = [photo("photo_a", "athlete.jpg"), photo("photo_b", "team.jpg", { size: 4400 })];
  const staged = draft("draft_1", {
    photoIds: ["photo_a"],
    requiredSlotKeys: ["individual_image", "team_image"],
    slotAssignments: { individual_image: "photo_a", team_image: "photo_b" },
    slotTransforms: { individual_image: { zoom: 1.6, offsetX: -12, offsetY: 4 } },
    template: { id: "tpl_1", outputId: "out_1", revisionId: "rev_1" },
  });

  writeWorkbenchSnapshot(storage, workbenchState({
    ...emptyStateFields,
    photos: before,
    drafts: [staged],
    cart: [{ id: "item_1", draftId: "draft_1", productId: "memory-mate-8x10", productName: "Memory Mate", quantity: 2, thumbnailURL: "blob:photo_a", source: "template", draft: staged, addedAt: "2026-09-03T00:01:00.000Z" }],
    proposals: [{ id: "proposal_1", draftId: "draft_1", productId: "memory-mate-8x10", productName: "Memory Mate", quantity: 1, thumbnailURL: "blob:photo_b", source: "template", draft: staged, createdAt: "2026-09-03T00:02:00.000Z" }],
    roleMemory: { individual: "photo_a", team: "photo_b" },
    backgroundDraftIds: ["draft_1"],
    selectedDraftId: "draft_1",
    selectedProductKey: JSON.stringify(["memory-mate-8x10", 3]),
    step: "prepare",
    directCrop: { zoom: 1.25, focusX: 40, focusY: 30 },
  }));

  // The same two files, imported again, with the random ids a new page gives them.
  const after = [photo("photo_x", "athlete.jpg"), photo("photo_y", "team.jpg", { size: 4400 })];
  const snapshot = readWorkbenchSnapshot(storage);
  assert.equal(snapshot.version, WORKBENCH_SCHEMA_VERSION);
  const restore = relinkWorkbenchSnapshot(snapshot, after);

  assert.equal(restore.restoredDraftCount, 1);
  assert.equal(restore.unlinkedPhotoCount, 0);
  assert.deepEqual(restore.drafts[0].photoIds, ["photo_x"]);
  assert.deepEqual(restore.drafts[0].slotAssignments, { individual_image: "photo_x", team_image: "photo_y" });
  assert.deepEqual(restore.drafts[0].slotTransforms, { individual_image: { zoom: 1.6, offsetX: -12, offsetY: 4 } });
  assert.deepEqual(restore.roleMemory, { individual: "photo_x", team: "photo_y" });
  assert.deepEqual(restore.backgroundDraftIds, ["draft_1"]);
  assert.equal(restore.selectedDraftId, "draft_1");
  assert.equal(restore.step, "prepare");
  assert.deepEqual(restore.directCrop, { zoom: 1.25, focusX: 40, focusY: 30 });
  // Thumbnails are re-derived from the re-linked photographs, never stored.
  assert.equal(restore.cart[0].thumbnailURL, "blob:photo_x");
  assert.equal(restore.cart[0].quantity, 2);
  assert.deepEqual(restore.cart[0].draft.slotAssignments, { individual_image: "photo_x", team_image: "photo_y" });
  assert.equal(restore.proposals[0].thumbnailURL, "blob:photo_x");
  assert.equal(restore.proposals[0].draftId, "draft_1");
  assert.equal(restoreNotice(restore), "Restored 1 draft.");
});

test("no image bytes, object URLs or file handles are ever written down", () => {
  const storage = storageStub();
  const staged = draft("draft_1", { photoIds: ["photo_a"] });
  writeWorkbenchSnapshot(storage, workbenchState({
    ...emptyStateFields,
    photos: [photo("photo_a", "athlete.jpg")],
    drafts: [staged],
    cart: [{ id: "item_1", draftId: "draft_1", productId: "p", productName: "P", quantity: 1, thumbnailURL: "blob:photo_a", source: "direct", draft: staged, addedAt: "2026-09-03T00:01:00.000Z" }],
    proposals: [{ id: "proposal_1", draftId: "draft_1", productId: "p", productName: "P", quantity: 1, thumbnailURL: "blob:photo_a", source: "direct", draft: staged, createdAt: "2026-09-03T00:02:00.000Z" }],
    roleMemory: {},
  }));
  const raw = storage.getItem(WORKBENCH_STORAGE_KEY);
  assert.doesNotMatch(raw, /blob:/);
  assert.doesNotMatch(raw, /data:image/);
  assert.doesNotMatch(raw, /thumbnailURL/);
  assert.doesNotMatch(raw, /previewURL/);
});

test("a snapshot from another schema version is discarded rather than migrated", () => {
  const storage = storageStub({
    [WORKBENCH_STORAGE_KEY]: JSON.stringify({
      version: WORKBENCH_SCHEMA_VERSION + 1,
      savedAt: "2026-09-03T00:00:00.000Z",
      photoKeys: {}, drafts: [], cart: [], proposals: [], roleMemory: {},
      backgroundDraftIds: [], selectedDraftId: null, selectedProductKey: null,
      step: "catalog", directCrop: { zoom: 1, focusX: 50, focusY: 50 },
    }),
  });
  assert.equal(readWorkbenchSnapshot(storage), null);
  assert.equal(storage.getItem(WORKBENCH_STORAGE_KEY), null, "the unusable snapshot is not left behind");
});

test("unreadable and malformed snapshots read as nothing saved", () => {
  assert.equal(readWorkbenchSnapshot(storageStub()), null);
  assert.equal(readWorkbenchSnapshot(storageStub({ [WORKBENCH_STORAGE_KEY]: "{not json" })), null);
  for (const broken of [
    { version: WORKBENCH_SCHEMA_VERSION, drafts: "many" },
    { version: WORKBENCH_SCHEMA_VERSION, drafts: [], cart: [], proposals: [], photoKeys: {}, roleMemory: {}, backgroundDraftIds: [], step: "wherever" },
    { version: WORKBENCH_SCHEMA_VERSION, drafts: [], cart: [], proposals: [], photoKeys: null, roleMemory: {}, backgroundDraftIds: [], step: "catalog" },
  ]) {
    assert.equal(readWorkbenchSnapshot(storageStub({ [WORKBENCH_STORAGE_KEY]: JSON.stringify(broken) })), null);
  }
  const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => {}, removeItem: () => {} };
  assert.equal(readWorkbenchSnapshot(throwing), null);
});

test("a write that cannot be stored degrades to an in-memory workbench", () => {
  const full = {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => {},
  };
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(writeWorkbenchSnapshot(full, workbenchState({ ...emptyStateFields, photos: [], drafts: [], cart: [], proposals: [], roleMemory: {} })), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1);
});

test("a photograph that never comes back leaves its slot unassigned and its requirement listed", () => {
  const storage = storageStub();
  const staged = draft("draft_1", {
    photoIds: ["photo_a", "photo_b"],
    requiredSlotKeys: ["individual_image", "team_image"],
    slotAssignments: { individual_image: "photo_a", team_image: "photo_b" },
    slotTransforms: { team_image: { zoom: 2, offsetX: 0, offsetY: 10 } },
    template: { id: "tpl_1", outputId: "out_1", revisionId: "rev_1" },
  });
  writeWorkbenchSnapshot(storage, workbenchState({
    ...emptyStateFields,
    photos: [photo("photo_a", "athlete.jpg"), photo("photo_b", "team.jpg", { size: 4400 })],
    drafts: [staged],
    cart: [],
    proposals: [],
    roleMemory: { individual: "photo_a", team: "photo_b" },
    selectedDraftId: "draft_1",
  }));

  // Only the athlete is back: the team photograph was added from a file picker
  // that the remembered folder does not cover.
  const restore = relinkWorkbenchSnapshot(readWorkbenchSnapshot(storage), [photo("photo_new", "athlete.jpg")]);
  assert.equal(restore.restoredDraftCount, 1);
  assert.equal(restore.unlinkedPhotoCount, 1);
  assert.deepEqual(restore.drafts[0].photoIds, ["photo_new"]);
  assert.deepEqual(restore.drafts[0].slotAssignments, { individual_image: "photo_new" });
  // Framing survives an absent photograph, so re-dropping it lands where it was.
  assert.deepEqual(restore.drafts[0].slotTransforms, { team_image: { zoom: 2, offsetX: 0, offsetY: 10 } });
  assert.deepEqual(missingTemplateDraftRequirements(restore.drafts[0]), ["team_image"]);
  assert.deepEqual(restore.roleMemory, { individual: "photo_new" });
  assert.equal(restoreNotice(restore), "Restored 1 draft; 1 photograph could not be re-linked.");
  assert.equal(restore.unlinkedPhotoKeys.length, 1);

  // The same snapshot, re-linked again once the folder is finally granted.
  const late = relinkWorkbenchSnapshot(readWorkbenchSnapshot(storage), [
    photo("photo_new", "athlete.jpg"),
    photo("photo_later", "team.jpg", { size: 4400 }),
  ]);
  assert.deepEqual(late.drafts[0].slotAssignments, { individual_image: "photo_new", team_image: "photo_later" });
  assert.equal(late.unlinkedPhotoCount, 0);
});

test("an empty tray restores everything that does not depend on a photograph", () => {
  const storage = storageStub();
  const staged = draft("draft_1", { photoIds: ["photo_a"], slotAssignments: { individual_image: "photo_a" } });
  writeWorkbenchSnapshot(storage, workbenchState({
    ...emptyStateFields,
    photos: [photo("photo_a", "athlete.jpg")],
    drafts: [staged],
    cart: [{ id: "item_1", draftId: "draft_1", productId: "p", productName: "P", quantity: 3, thumbnailURL: "blob:photo_a", source: "direct", draft: staged, addedAt: "x" }],
    proposals: [],
    roleMemory: { individual: "photo_a" },
    step: "prepare",
    selectedDraftId: "draft_1",
    selectedProductKey: JSON.stringify(["p", 1]),
  }));
  const restore = relinkWorkbenchSnapshot(readWorkbenchSnapshot(storage), []);
  assert.equal(restore.restoredDraftCount, 1);
  assert.equal(restore.unlinkedPhotoCount, 1);
  assert.deepEqual(restore.drafts[0].photoIds, []);
  assert.deepEqual(restore.drafts[0].slotAssignments, {});
  assert.equal(restore.cart[0].quantity, 3);
  assert.equal(restore.cart[0].thumbnailURL, null);
  assert.deepEqual(restore.roleMemory, {});
  assert.equal(restore.step, "prepare");
  assert.equal(restore.selectedProductKey, JSON.stringify(["p", 1]));
});

test("a selected draft that did not survive does not leave a dangling selection", () => {
  const storage = storageStub();
  writeWorkbenchSnapshot(storage, workbenchState({
    ...emptyStateFields, photos: [], drafts: [], cart: [], proposals: [], roleMemory: {},
    backgroundDraftIds: ["draft_gone"], selectedDraftId: "draft_gone",
  }));
  const restore = relinkWorkbenchSnapshot(readWorkbenchSnapshot(storage), []);
  assert.equal(restore.selectedDraftId, null);
  assert.deepEqual(restore.backgroundDraftIds, []);
  assert.equal(restoreNotice(restore), null, "an empty workbench says nothing at all");
});

test("stable keys name the file rather than the import, and duplicates fail closed", () => {
  const one = photoStableKey(file("athlete.jpg", 1200, 999));
  assert.equal(one, photoStableKey(file("athlete.jpg", 1200, 999)));
  assert.notEqual(one, photoStableKey(file("athlete.jpg", 1201, 999)));
  assert.notEqual(one, photoStableKey(file("athlete.jpg", 1200, 1000)));
  assert.notEqual(one, photoStableKey(file("team.jpg", 1200, 999)));

  // Two identical files in different folders are told apart by their paths.
  const separable = createBrowserPhotos(
    [file("IMG_01.jpg", 900, 42, "game/IMG_01.jpg"), file("IMG_01.jpg", 900, 42, "portraits/IMG_01.jpg")],
    { idFactory: (() => { let n = 0; return () => `photo_${++n}`; })(), createObjectURL: (entry) => `blob:${entry.name}` },
  ).photos;
  assert.equal(separable.every((entry) => typeof entry.stableKey === "string"), true);
  assert.notEqual(separable[0].stableKey, separable[1].stableKey);

  // Two indistinguishable files get no key at all rather than a shared one.
  const identical = createBrowserPhotos(
    [file("IMG_01.jpg", 900, 42), file("IMG_01.jpg", 900, 42)],
    { idFactory: (() => { let n = 0; return () => `photo_${++n}`; })(), createObjectURL: (entry) => `blob:${entry.name}` },
  ).photos;
  assert.deepEqual(identical.map((entry) => entry.stableKey), [undefined, undefined]);
  assert.equal(identical.length, 2, "an unkeyed photograph is still a usable photograph");

  // Assignment does not depend on the order files arrive in.
  const forward = assignPhotoStableKeys([
    { file: file("a.jpg", 10, 1), relativePath: "x/a.jpg" },
    { file: file("a.jpg", 10, 1), relativePath: "y/a.jpg" },
    { file: file("b.jpg", 20, 2) },
  ]).map((entry) => entry.stableKey);
  const backward = assignPhotoStableKeys([
    { file: file("b.jpg", 20, 2) },
    { file: file("a.jpg", 10, 1), relativePath: "y/a.jpg" },
    { file: file("a.jpg", 10, 1), relativePath: "x/a.jpg" },
  ]).map((entry) => entry.stableKey);
  assert.deepEqual([...forward].sort(), [...backward].sort());
});

test("a stable key held by two tray photographs resolves to neither", () => {
  const shared = photoStableKey(file("IMG_01.jpg", 900, 42));
  const ids = photoIdsByStableKey([
    { id: "photo_1", stableKey: shared },
    { id: "photo_2", stableKey: shared },
    { id: "photo_3", stableKey: photoStableKey(file("team.jpg", 900, 42)) },
    { id: "photo_4", stableKey: undefined },
  ]);
  assert.deepEqual(Object.keys(ids), [photoStableKey(file("team.jpg", 900, 42))]);
  assert.equal(ids[shared], undefined);

  // A draft naming an unkeyable photograph survives with that slot empty.
  const storage = storageStub();
  writeWorkbenchSnapshot(storage, workbenchState({
    ...emptyStateFields,
    photos: [{ id: "photo_1", stableKey: undefined }, { id: "photo_3", stableKey: photoStableKey(file("team.jpg", 900, 42)) }],
    drafts: [draft("draft_1", { photoIds: ["photo_1", "photo_3"], slotAssignments: { a: "photo_1", b: "photo_3" } })],
    cart: [], proposals: [], roleMemory: { individual: "photo_1" },
  }));
  const snapshot = readWorkbenchSnapshot(storage);
  assert.deepEqual(Object.keys(snapshot.photoKeys), ["photo_3"], "an unkeyable photograph is not recorded");
  const restore = relinkWorkbenchSnapshot(snapshot, [
    { id: "new_1", stableKey: shared, previewURL: "blob:new_1" },
    { id: "new_3", stableKey: photoStableKey(file("team.jpg", 900, 42)), previewURL: "blob:new_3" },
  ]);
  assert.deepEqual(restore.drafts[0].slotAssignments, { b: "new_3" });
  assert.equal(restore.unlinkedPhotoCount, 1);
  assert.deepEqual(restore.roleMemory, {});
});

test("the write-through coalesces, flushes and cancels", () => {
  const storage = storageStub();
  const scheduled = new Map();
  let nextHandle = 0;
  const writer = createWorkbenchWriter(storage, {
    delayMs: 300,
    schedule: (callback) => { const handle = ++nextHandle; scheduled.set(handle, callback); return handle; },
    unschedule: (handle) => { scheduled.delete(handle); },
    now: () => "2026-09-03T00:00:00.000Z",
  });
  const state = (step) => workbenchState({ ...emptyStateFields, step, photos: [], drafts: [], cart: [], proposals: [], roleMemory: {} });

  writer.save(state("catalog"));
  writer.save(state("prepare"));
  assert.equal(storage.getItem(WORKBENCH_STORAGE_KEY), null, "nothing is written before the debounce elapses");
  assert.equal(scheduled.size, 1, "a second save replaces the write still waiting");
  [...scheduled.values()][0]();
  assert.equal(readWorkbenchSnapshot(storage).step, "prepare");

  writer.save(state("catalog"));
  writer.flush();
  assert.equal(readWorkbenchSnapshot(storage).step, "catalog");
  writer.flush();
  assert.equal(readWorkbenchSnapshot(storage).step, "catalog", "an empty flush writes nothing new");

  writer.save(state("prepare"));
  writer.cancel();
  writer.flush();
  assert.equal(readWorkbenchSnapshot(storage).step, "catalog");

  clearWorkbenchSnapshot(storage);
  assert.equal(readWorkbenchSnapshot(storage), null);
});
