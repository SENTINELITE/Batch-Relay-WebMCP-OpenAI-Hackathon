export type ArtworkPath = "direct" | "template";
export type TemplateState = "idle" | "loading" | "error" | "ready";

/**
 * Template discovery is optional for products that allow direct artwork. Keep
 * a previous template failure from leaking into that independent workflow.
 */
export function selectArtworkPath(path: ArtworkPath, templateState: TemplateState) {
  if (path === "direct") {
    return {
      customization: path,
      templateState: "idle" as const,
      clearTemplateNotice: true,
    };
  }

  return {
    customization: path,
    templateState: templateState === "error" ? "idle" as const : templateState,
    clearTemplateNotice: true,
  };
}
