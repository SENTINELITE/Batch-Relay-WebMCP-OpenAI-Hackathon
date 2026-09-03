import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  coverOverlayRect,
  faceDebugBadge,
  faceDebugEnabled,
  faceDebugRequested,
  isDebugHost,
} from "../src/lib/storefront/debug-flags.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the face overlay needs a loopback host and an explicit request", () => {
  assert.equal(faceDebugEnabled({ hostname: "localhost", search: "?debug=faces" }), true);
  assert.equal(faceDebugEnabled({ hostname: "127.0.0.1", search: "?debug=faces" }), true);
  // The parameter alone is never enough, whatever the build says.
  assert.equal(faceDebugEnabled({ hostname: "prints.example.com", search: "?debug=faces" }), false);
  assert.equal(faceDebugEnabled({ hostname: "batch-relay.vercel.app", search: "?debug=faces" }), false);
  // A host that merely contains "localhost" is a different host.
  assert.equal(faceDebugEnabled({ hostname: "localhost.evil.example", search: "?debug=faces" }), false);
  // The host alone is never enough either.
  assert.equal(faceDebugEnabled({ hostname: "localhost", search: "" }), false);
  assert.equal(faceDebugEnabled({ hostname: "localhost", search: "?debug=slots" }), false);
  assert.equal(faceDebugEnabled(null), false);
});

test("the flag is accepted from the query string or the hash", () => {
  assert.equal(faceDebugRequested({ search: "?debug=faces" }), true);
  assert.equal(faceDebugRequested({ hash: "#debug=faces" }), true);
  assert.equal(faceDebugRequested({ search: "?step=catalog&debug=faces" }), true);
  assert.equal(faceDebugRequested({ search: "?debug=slots,faces" }), true);
  assert.equal(faceDebugRequested({ search: "?debug=facesish" }), false);
  assert.equal(faceDebugRequested({}), false);
  assert.equal(faceDebugEnabled({ hostname: "localhost", hash: "#debug=faces" }), true);
});

test("only the loopback names are debug hosts", () => {
  assert.equal(isDebugHost("localhost"), true);
  assert.equal(isDebugHost("LOCALHOST"), true);
  assert.equal(isDebugHost("127.0.0.1"), true);
  assert.equal(isDebugHost("0.0.0.0"), false);
  assert.equal(isDebugHost("192.168.1.20"), false);
  assert.equal(isDebugHost(undefined), false);
});

test("boxes are mapped through the thumbnail's object-cover crop", () => {
  const frame = 4 / 5;
  const centre = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
  // Same aspect as the frame: cover is a plain scale, so nothing moves.
  const same = coverOverlayRect(centre, frame, frame);
  assert.deepEqual(same, { left: 40, top: 40, width: 20, height: 20 });

  // A landscape photograph in a portrait frame spills left and right, so the
  // horizontal axis stretches and shifts while the vertical is untouched.
  const wide = coverOverlayRect(centre, 3 / 2, frame);
  assert.ok(wide.width > 20 && wide.top === 40 && wide.height === 20);
  // The centre of the photograph is still the centre of the thumbnail.
  assert.ok(Math.abs(wide.left + wide.width / 2 - 50) < 1e-9);

  // A taller-than-frame photograph spills top and bottom instead.
  const tall = coverOverlayRect(centre, 2 / 3, frame);
  assert.ok(tall.height > 20 && tall.left === 40 && tall.width === 20);
  assert.ok(Math.abs(tall.top + tall.height / 2 - 50) < 1e-9);

  // A face the crop cuts off maps outside the box rather than being clamped
  // into a lie about where it is.
  const edge = coverOverlayRect({ x: 0, y: 0.4, width: 0.1, height: 0.1 }, 3 / 1, frame);
  assert.ok(edge.left < 0);

  assert.equal(coverOverlayRect(centre, 0, frame), null);
  assert.equal(coverOverlayRect(centre, Number.NaN, frame), null);
  assert.equal(coverOverlayRect({ x: Number.NaN, y: 0, width: 1, height: 1 }, 1, 1), null);
});

test("the badge tells found-none apart from not-looked-yet", () => {
  assert.equal(faceDebugBadge({ faces: [], state: "pending" }), "…");
  assert.equal(faceDebugBadge({ faces: [], state: "none" }), "0");
  assert.equal(faceDebugBadge({ faces: [], state: "unavailable" }), "×");
  assert.equal(faceDebugBadge({ faces: [{ x: 0, y: 0, width: 1, height: 1, confidence: 1 }], state: "faces" }), "1");
  assert.equal(faceDebugBadge(undefined), "…");
});

test("the tray draws no debug chrome unless it is handed the data", async () => {
  const [source, preview] = await Promise.all([
    read("src/components/storefront/photo-tray.tsx"),
    read("src/components/storefront/browser-template-preview.tsx"),
  ]);
  // Every debug element in the tray hangs off the optional prop, so a tray
  // rendered without it is the tray as it always was.
  assert.match(source, /faceDebug\?: FaceDebugMap/);
  assert.match(source, /\{faceDebug \? <FaceDebugLayer/);
  assert.match(source, /pointer-events-none absolute inset-0/);
  // The overlay visualizes; it never asks for detection.
  assert.doesNotMatch(source, /detectFaces/);
  // The same gated result is projected through the live crop in a template slot.
  assert.match(preview, /faceDebug\?: FaceDebugMap/);
  assert.match(preview, /browserPreviewCropRect/);
  assert.match(preview, /<TemplateFaceDebugLayer/);
});

test("the overlay is gated in the storefront by the shared helper alone", async () => {
  const source = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(source, /faceDebugEnabled\(window\.location\)/);
  assert.match(source, /faceDebug=\{faceDebugOn \? buildFaceDebugMap\(\) : undefined\}/);
  // No second, weaker gate anywhere near the overlay.
  assert.doesNotMatch(source, /faceDebug[A-Za-z]*\s*=\s*true/);
});

test("the workbench reset flag answers anywhere the demo is given, unlike the debug overlays", async () => {
  const { workbenchResetRequested } = await import("../src/lib/storefront/debug-flags.ts");
  for (const location of [
    { hostname: "localhost", search: "?reset=workbench" },
    { hostname: "demo.example.com", search: "?reset=workbench" },
    { hostname: "demo.example.com", search: "?debug=faces&reset=workbench" },
    { hostname: "demo.example.com", hash: "#reset=workbench" },
  ]) assert.equal(workbenchResetRequested(location), true, JSON.stringify(location));
  for (const location of [
    null,
    { hostname: "localhost" },
    { hostname: "localhost", search: "?reset=faces" },
    { hostname: "localhost", search: "?debug=workbench" },
    { hostname: "localhost", search: "?workbench=reset" },
  ]) assert.equal(workbenchResetRequested(location), false, JSON.stringify(location));
  // A reset request is not a debug request, and vice versa.
  assert.equal(faceDebugEnabled({ hostname: "localhost", search: "?reset=workbench" }), false);
  assert.equal(workbenchResetRequested({ hostname: "localhost", search: "?debug=faces" }), false);
});

test("the storefront wipes only its own namespace and tidies the URL behind it", async () => {
  const source = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(source, /workbenchResetRequested\(window\.location\)/);
  assert.match(source, /clearWorkbenchSnapshot\(savedWorkbench\.storage\)/);
  assert.match(source, /history\.replaceState\(null, "", urlWithoutWorkbenchReset\(window\.location\.href\)\)/);
  // The remembered photo folder is a separate, deliberate convenience: a reset
  // must not cost the presenter the folder permission they already granted.
  assert.doesNotMatch(source, /reset[\s\S]{0,400}rememberPhotoFolderHandle/);
});
