import type { BrowserPreviewDocument } from "../browser-preview";
import type { PublishedTemplate, TemplateContract, TemplateOutput, TemplateOutputs } from "../client";
import { specBrowserPreviewDocument } from "../preview-spec";
import { bundledTemplateSpec, bundledTemplateSpecMatchesRevision } from ".";

/**
 * Intentional hackathon lock. The storefront demo must not drift when a studio
 * publishes another template revision during the three-week judging window.
 * Refresh this snapshot explicitly after 2026-09-24; do not replace it with a
 * live "latest" lookup.
 */
export const frozenDemoTemplate = {
  templateID: "tpl_aeb0232b10d34460bc8d8672513db126",
  revisionID: "rev_398677279733464cafb253d610f0e891",
  revisionNumber: 3,
  outputID: "memory-mate-8x10-portrait-a",
  snapshotSHA256: "5218a247a26ee7fcbc62f0fba68e5b035984d83c1550cc435ea5c51e33efcaa2",
  frozenAt: "2026-09-03T19:21:28.043Z",
  reviewAfter: "2026-09-24",
} as const;

const frozenOutput: TemplateOutput = {
  id: frozenDemoTemplate.outputID,
  label: "8 × 10 Memory Mate (Portrait)",
  ordinal: 4,
  products: [{
    canonical_product_id: "memory-mate-8x10",
    canonical_product_revision: 1,
    width_in: 8,
    height_in: 10,
    orientation: "portrait",
  }],
};

const frozenContract: TemplateContract = {
  template: {
    id: frozenDemoTemplate.templateID,
    revision_id: frozenDemoTemplate.revisionID,
    revision_number: frozenDemoTemplate.revisionNumber,
  },
  output: {
    id: frozenDemoTemplate.outputID,
    label: "8 × 10 Memory Mate (Portrait)",
    ordinal: 4,
    surfaces: [{
      id: "memory-mate-8x10-portrait",
      variant_id: "a",
      label: "Memory Mate 8 × 10 Portrait",
      fulfillment_role: "artwork",
      ordinal: 0,
      width_in: 8,
      height_in: 10,
    }],
  },
  slots: [
    { key: "image_122qlv9", kind: "image", ordinal: 1, required: false, suggested_label: "Athlete portrait (5x7)", suggested_semantic_key: "athlete.portrait", expected_aspect_ratio: { width: 5, height: 7 } },
    { key: "text_5106920550f5", kind: "text", ordinal: 2, required: false, suggested_label: "Print Name", suggested_semantic_key: "athlete_print_name" },
    { key: "text_171cff5dcfde", kind: "text", ordinal: 3, required: false, suggested_label: "Jersey Number", suggested_semantic_key: "athlete_jersey_number" },
    { key: "text_746edef46a4a", kind: "text", ordinal: 4, required: false, suggested_label: "Team", suggested_semantic_key: "athlete_team" },
    { key: "text_1e6560b98c6e", kind: "text", ordinal: 5, required: false, suggested_label: "Year", suggested_semantic_key: "athlete_year" },
    { key: "image_12rkfks", kind: "image", ordinal: 10, required: false, suggested_label: "athlete.portrait", suggested_semantic_key: "athlete.portrait", expected_aspect_ratio: { width: 10, height: 8 } },
  ],
};

export function frozenDemoTemplateCatalog(): { items: PublishedTemplate[]; demo_freeze: typeof frozenDemoTemplate } {
  return {
    items: [{ id: frozenDemoTemplate.templateID, name: "Neon Lights", status: "active" }],
    demo_freeze: frozenDemoTemplate,
  };
}

export function frozenDemoRevisionMatches(revisionID: string | null | undefined): boolean {
  return !revisionID || revisionID === frozenDemoTemplate.revisionID;
}

export function frozenDemoTemplateOutputs(templateID: string, revisionID?: string | null): TemplateOutputs | null {
  if (templateID !== frozenDemoTemplate.templateID || !frozenDemoRevisionMatches(revisionID)) return null;
  return {
    template_id: frozenDemoTemplate.templateID,
    revision_id: frozenDemoTemplate.revisionID,
    revision_number: frozenDemoTemplate.revisionNumber,
    outputs: [frozenOutput],
  };
}

export function frozenDemoTemplateContract(templateID: string, outputID: string, revisionID?: string | null): TemplateContract | null {
  if (templateID !== frozenDemoTemplate.templateID || outputID !== frozenDemoTemplate.outputID || !frozenDemoRevisionMatches(revisionID)) return null;
  return frozenContract;
}

export function frozenDemoBrowserPreview(templateID: string, outputID: string, revisionID?: string | null): BrowserPreviewDocument | null {
  const contract = frozenDemoTemplateContract(templateID, outputID, revisionID);
  const spec = bundledTemplateSpec(templateID);
  if (!contract || !spec || !bundledTemplateSpecMatchesRevision(spec, frozenDemoTemplate.revisionID)) return null;
  const document = specBrowserPreviewDocument({ spec, contract, output: frozenOutput });
  return document;
}
