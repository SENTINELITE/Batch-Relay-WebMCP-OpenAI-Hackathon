import { renderTemplateSpecFromRequest, type RenderTemplateSpec } from "../preview-spec";
import modernVintage from "./specs/tpl_9ede6ad441b647cdae32e781e16d39f5.render-request.json";
import neonLights from "./specs/tpl_aeb0232b10d34460bc8d8672513db126.render-request.json";

/**
 * Local copies of published template documents, used only as a preview
 * fallback while the API's browser-preview endpoint is unavailable. Nothing
 * here is ever sent back to the API or used to render a fulfilled order.
 *
 * To register a template: drop its `*.render-request.json` into `./specs/` and
 * add one import line below. Turbopack has no native directory-enumeration
 * primitive (`require.context` and `import.meta.glob` are not available here),
 * so the list is explicit — and `tests/preview-fallback.test.mjs` fails with
 * the exact missing import if a spec file is left unregistered.
 */
const registeredSpecFiles: readonly unknown[] = [modernVintage, neonLights];

/** One malformed file is skipped; the rest of the registry still loads. */
const bundledTemplateSpecs: readonly RenderTemplateSpec[] = registeredSpecFiles.flatMap((file) => {
  const spec = renderTemplateSpecFromRequest(file);
  if (!spec) {
    console.warn("[template-specs] skipping an unreadable bundled render-request spec");
    return [];
  }
  return [spec];
});

export function bundledTemplateSpec(templateID: string): RenderTemplateSpec | null {
  return bundledTemplateSpecs.find((spec) => spec.templateId === templateID) ?? null;
}

/** A frozen copy is usable only for the exact revision it was captured from. */
export function bundledTemplateSpecMatchesRevision(spec: RenderTemplateSpec, revisionID: string): boolean {
  return spec.revisionId === revisionID;
}
