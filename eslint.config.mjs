import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // public/mediapipe is vendored, not written here: the wasm loader glue is
  // generated Emscripten output and linting it says nothing about this codebase.
  globalIgnores([".next/**", "node_modules/**", "public/mediapipe/**"]),
]);
