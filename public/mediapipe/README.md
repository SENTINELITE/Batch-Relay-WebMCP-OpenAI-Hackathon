# Self-hosted MediaPipe face-detection assets

Everything the optional in-browser face detector needs is served from this
folder. Nothing here is fetched from a CDN at runtime: the storefront asks for
`/mediapipe/wasm` and `/mediapipe/blaze_face_short_range.tflite` and nothing
else, so the feature works offline and leaks no shopper photograph — detection
happens entirely in the browser.

If this folder is missing or any file 404s, `src/lib/storefront/face-detection.ts`
resolves to zero faces and the print review falls back to its geometry-only
heuristics. That degradation is deliberate and is covered by tests.

## Contents

| Path | Source | Version |
| --- | --- | --- |
| `wasm/` | `node_modules/@mediapipe/tasks-vision/wasm` (npm `@mediapipe/tasks-vision`) | 1.0.1 |
| `blaze_face_short_range.tflite` | <https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite> | float16 / revision 1 |

`blaze_face_short_range.tflite` sha256:
`b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`

## Licence

Both the `@mediapipe/tasks-vision` runtime and the BlazeFace short-range model
are published by Google under the Apache License 2.0, which permits
redistribution provided the licence and attribution are carried along. This file
is that attribution; the licence text is at
<https://www.apache.org/licenses/LICENSE-2.0>.

Model card: <https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector>

## Refreshing

`node scripts/sync-mediapipe-assets.mjs` re-copies the wasm fileset from the
installed package and re-downloads the model if it is absent. It also filters
MediaPipe's known, informational XNNPACK CPU-delegate startup line, which its
loader otherwise emits through `console.error` and Next treats as an app error.
All other WASM diagnostics are preserved. Run it after bumping
`@mediapipe/tasks-vision` so the runtime and the loader stay in step.
