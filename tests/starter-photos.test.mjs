import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { starterPhotoManifest } from "../src/lib/storefront/starter-photos.ts";

test("the bundled starter tray has the complete, deterministic demo set", () => {
  assert.deepEqual(starterPhotoManifest, [
    "team.jpg", "J.jpg", "Sabrina.jpg", "Chermiti.jpg", "Idriss.jpg",
    "Ryan.jpg", "Nguyen.jpg", "tommy.jpg", "Rishab.jpg", "logan.jpg",
    "Mahdi.jpg", "julian.jpg", "kareem.jpg", "Devin.jpg", "alexy.jpg",
    "logan-2.jpg", "Thomas.jpg",
  ]);
});

test("every starter-tray entry is shipped as a public image", async () => {
  const sizes = await Promise.all(starterPhotoManifest.map(async (filename) => {
    const file = await stat(new URL(`../public/starter-photos/${filename}`, import.meta.url));
    return file.size;
  }));

  assert.ok(sizes.every((size) => size > 0));
});

test("a fresh tray loads the bundled photographs unless a shopper has already replaced it", async () => {
  const source = await readFile(new URL("../src/components/storefront/photo-tray.tsx", import.meta.url), "utf8");

  assert.match(source, /fetchStarterPhotoFiles/);
  assert.match(source, /importFiles\(files, "starter"\)/);
  assert.match(source, /shopperReplacedTray\.current/);
  assert.match(source, /importFiles\(files, "remembered-folder"\)/);
});
