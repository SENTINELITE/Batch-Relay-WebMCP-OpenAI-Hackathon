/**
 * Re-materialises the self-hosted MediaPipe assets under public/mediapipe.
 *
 * The wasm fileset is copied from the installed @mediapipe/tasks-vision package
 * so the runtime can never drift from the version the app imports. The model is
 * downloaded only when it is missing, because it is versioned independently of
 * the npm package and pinned by the sha256 recorded in the folder's README.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmSource = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmTarget = path.join(root, "public", "mediapipe", "wasm");
const modelTarget = path.join(root, "public", "mediapipe", "blaze_face_short_range.tflite");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const MODEL_SHA256 = "b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f";
const WASM_ERROR_SINK = "var err = console.error.bind(console);";
const XNNPACK_STARTUP_MESSAGE = "Created TensorFlow Lite XNNPACK delegate for CPU.";
// MediaPipe's Emscripten loader writes this normal CPU-delegate startup line
// through console.error. Next's development overlay treats it as an app error,
// so silence that one known informational message while preserving every other
// WASM diagnostic verbatim.
const WASM_ERROR_SINK_WITH_XNNPACK_FILTER = `var err = function() {
  if (arguments.length === 1 && typeof arguments[0] === "string" && arguments[0].includes("${XNNPACK_STARTUP_MESSAGE}")) return;
  console.error.apply(console, arguments);
};`;

await mkdir(wasmTarget, { recursive: true });
const names = await readdir(wasmSource);
for (const name of names) {
  const target = path.join(wasmTarget, name);
  await copyFile(path.join(wasmSource, name), target);
  if (!name.endsWith(".js")) continue;
  const source = await readFile(target, "utf8");
  if (!source.includes(WASM_ERROR_SINK)) continue;
  await writeFile(target, source.replace(WASM_ERROR_SINK, WASM_ERROR_SINK_WITH_XNNPACK_FILTER));
}
console.log(`Copied ${names.length} wasm files from @mediapipe/tasks-vision.`);

const digest = await readFile(modelTarget)
  .then((bytes) => createHash("sha256").update(bytes).digest("hex"))
  .catch(() => null);

if (digest === MODEL_SHA256) {
  console.log("Model already present and matches the pinned digest.");
} else {
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const downloaded = createHash("sha256").update(bytes).digest("hex");
  if (downloaded !== MODEL_SHA256) {
    throw new Error(`Model digest ${downloaded} does not match the pinned ${MODEL_SHA256}.`);
  }
  await writeFile(modelTarget, bytes);
  console.log("Downloaded and verified the BlazeFace short-range model.");
}
