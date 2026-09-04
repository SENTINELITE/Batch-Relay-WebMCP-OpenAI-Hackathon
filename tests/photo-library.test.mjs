import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrowserPhotos,
  emptyPhotoLibrary,
  imageValidationError,
  photoLibraryReducer,
  photoPreparationKey,
  resolvePhotoReference,
  revokePhotoObjectURLs,
} from "../src/lib/storefront/photo-library.ts";

const file = (name, type = "image/jpeg", size = 12, relativePath = "") => ({ name, type, size, webkitRelativePath: relativePath });
const photo = (id, filename) => ({ id, filename, file: file(filename), previewURL: `blob:${id}`, mimeType: "image/jpeg", byteSize: 12 });

test("imports only browser-local JPEG and PNG files with opaque injected ids", () => {
  let count = 0;
  const result = createBrowserPhotos([
    file("1337.jpg"), file("team.png", "image/png", 20, "game/team.png"), file("notes.pdf", "application/pdf"), file("roster-preview.csv", "text/csv"),
  ], {
    idFactory: () => `photo_test_${++count}`,
    createObjectURL: (entry) => `blob:${entry.name}`,
  });
  assert.deepEqual(result.photos.map(({ id, filename, relativePath }) => ({ id, filename, relativePath })), [
    { id: "photo_test_1", filename: "1337.jpg", relativePath: undefined },
    { id: "photo_test_2", filename: "team.png", relativePath: "game/team.png" },
  ]);
  assert.equal(result.rejected.length, 0);
  assert.equal(imageValidationError(file("empty.png", "image/png", 0)), "empty.png is empty.");
});

test("skips macOS folder metadata instead of rejecting it", () => {
  let count = 0;
  const result = createBrowserPhotos([
    file(".DS_Store", "", 6),
    file("1337.jpg"),
    file("._1337.jpg", "", 4),
  ], {
    idFactory: () => `photo_test_${++count}`,
    createObjectURL: (entry) => `blob:${entry.name}`,
  });
  assert.deepEqual(result.photos.map(({ filename }) => filename), ["1337.jpg"]);
  assert.equal(result.rejected.length, 0);
});

test("keeps 1-based ordinals current through additive import, selection, and reordering", () => {
  const first = photo("photo_a", "1337.jpg");
  const second = photo("photo_b", "1448.jpg");
  let state = photoLibraryReducer(emptyPhotoLibrary(), { type: "add", photos: [first, second] });
  assert.equal(state.selectedPhotoId, "photo_a");
  state = photoLibraryReducer(state, { type: "select", photoId: "photo_b" });
  state = photoLibraryReducer(state, { type: "move", photoId: "photo_b", direction: "earlier" });
  assert.deepEqual(state.photos.map(({ id }) => id), ["photo_b", "photo_a"]);
  assert.equal(resolvePhotoReference(state.photos, "first image").photo.id, "photo_b");
  assert.equal(resolvePhotoReference(state.photos, 2).photo.id, "photo_a");
});

test("a later picker selection replaces the tray and discards prior preparations", () => {
  const first = photo("photo_a", "first.jpg");
  const second = photo("photo_b", "second.jpg");
  const replacement = photo("photo_c", "replacement.jpg");
  const target = { productId: "print-8x10", productRevision: 1 };
  let state = photoLibraryReducer(emptyPhotoLibrary(), { type: "add", photos: [first, second] });
  state = photoLibraryReducer(state, { type: "set-preparation", photoId: "photo_a", target, preparation: { status: "ready" } });
  state = photoLibraryReducer(state, { type: "replace", photos: [replacement] });
  assert.deepEqual(state.photos.map(({ id }) => id), ["photo_c"]);
  assert.equal(state.selectedPhotoId, "photo_c");
  assert.deepEqual(state.preparations, {});
  assert.equal(resolvePhotoReference(state.photos, 1).photo.filename, "replacement.jpg");
});

test("resolves exact opaque ids and fails closed when filenames are duplicated", () => {
  const photos = [photo("photo_a", "1337.jpg"), photo("photo_b", "1337.jpg"), photo("photo_c", "team.jpg")];
  assert.equal(resolvePhotoReference(photos, "photo_c").photo.filename, "team.jpg");
  const duplicate = resolvePhotoReference(photos, "1337.jpg");
  assert.equal(duplicate.kind, "ambiguous");
  assert.deepEqual(duplicate.matches.map(({ id }) => id), ["photo_a", "photo_b"]);
  assert.equal(resolvePhotoReference(photos, "missing.jpg").kind, "missing");
});

test("preparation keys are distinct for an individual and team template slot", () => {
  const base = { productId: "memory-mate-8x10", productRevision: 7, templateId: "template_123", templateRevisionId: "revision_9" };
  assert.notEqual(
    photoPreparationKey("photo_a", { ...base, slotKey: "individual.portrait" }),
    photoPreparationKey("photo_a", { ...base, slotKey: "team.photo" }),
  );
});

test("removing a photo removes only its preparations and exposes URL cleanup", () => {
  const first = photo("photo_a", "a.jpg");
  const second = photo("photo_b", "b.jpg");
  const target = { productId: "print-5x7", productRevision: 1 };
  let state = photoLibraryReducer(emptyPhotoLibrary(), { type: "add", photos: [first, second] });
  state = photoLibraryReducer(state, { type: "set-preparation", photoId: "photo_a", target, preparation: { status: "ready", managedAssetId: "asset_a" } });
  state = photoLibraryReducer(state, { type: "set-preparation", photoId: "photo_b", target, preparation: { status: "ready", managedAssetId: "asset_b" } });
  state = photoLibraryReducer(state, { type: "remove", photoId: "photo_a" });
  assert.equal(Object.values(state.preparations)[0].managedAssetId, "asset_b");
  const revoked = [];
  revokePhotoObjectURLs([first, second], (url) => revoked.push(url));
  assert.deepEqual(revoked, ["blob:photo_a", "blob:photo_b"]);
});

test("every imported photograph carries a key that names the file rather than the import", async () => {
  const { photoStableKey } = await import("../src/lib/storefront/photo-library.ts");
  const source = [
    { name: "athlete.jpg", type: "image/jpeg", size: 2048, lastModified: 1700000000000, webkitRelativePath: "game/athlete.jpg" },
    { name: "team.png", type: "image/png", size: 4096, lastModified: 1700000000001, webkitRelativePath: "game/team.png" },
  ];
  const first = createBrowserPhotos(source, { idFactory: () => `photo_${Math.random()}`, createObjectURL: () => "blob:x" });
  const second = createBrowserPhotos(source, { idFactory: () => `photo_${Math.random()}`, createObjectURL: () => "blob:x" });
  // New ids each import; the same keys each import. That gap is exactly what a
  // saved workbench crosses when the remembered folder re-imports after a reload.
  assert.notDeepEqual(first.photos.map((entry) => entry.id), second.photos.map((entry) => entry.id));
  assert.deepEqual(first.photos.map((entry) => entry.stableKey), second.photos.map((entry) => entry.stableKey));
  assert.equal(first.photos[0].stableKey, photoStableKey(source[0]));
});
