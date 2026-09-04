import type { BrowserPreviewDocument } from "../browser-preview";
import type { PublishedTemplate, TemplateContract, TemplateOutput, TemplateOutputs } from "../client";
import { specBrowserPreviewDocument } from "../preview-spec";
import { bundledTemplateSpec, bundledTemplateSpecMatchesRevision } from ".";

/**
 * Intentional hackathon lock. These curated templates are fixed to explicit
 * published revisions for the judging window; they never follow a studio's
 * live "latest" revision. Refresh each pin explicitly after 2026-09-24.
 */
type FrozenDemoTemplate = {
  templateID: string;
  revisionID: string;
  revisionNumber: number;
  outputID: string;
  name: string;
  snapshotSHA256: string;
  frozenAt: string;
  reviewAfter: string;
  contract: TemplateContract;
};

export const frozenDemoTemplate = {
  templateID: "tpl_aeb0232b10d34460bc8d8672513db126",
  revisionID: "rev_398677279733464cafb253d610f0e891",
  revisionNumber: 3,
  outputID: "memory-mate-8x10-portrait-a",
  name: "Neon Lights",
  snapshotSHA256: "5218a247a26ee7fcbc62f0fba68e5b035984d83c1550cc435ea5c51e33efcaa2",
  frozenAt: "2026-09-03T19:21:28.043Z",
  reviewAfter: "2026-09-24",
} as const;

export const frozenModernVintageTemplate = {
  templateID: "tpl_9ede6ad441b647cdae32e781e16d39f5",
  revisionID: "rev_c926b893f2a144afa968b868bba503ca",
  revisionNumber: 2,
  outputID: "memory-mate-8x10-portrait-a",
  name: "Modern Vintage",
  snapshotSHA256: "af79f269b8fa09b1ed2d1fbc6f94bf124c892a905792600df8d42384506a1ca8",
  frozenAt: "2026-09-03T06:00:23.570Z",
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

function memoryMateContract(template: Pick<FrozenDemoTemplate, "templateID" | "revisionID" | "revisionNumber">, slots: TemplateContract["slots"]): TemplateContract {
  return {
    template: {
      id: template.templateID,
      revision_id: template.revisionID,
      revision_number: template.revisionNumber,
    },
    output: {
      id: frozenOutput.id,
      label: frozenOutput.label,
      ordinal: frozenOutput.ordinal,
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
    slots,
  };
}

const frozenNeonLightsContract = memoryMateContract(frozenDemoTemplate, [
  { key: "image_122qlv9", kind: "image", ordinal: 1, required: false, suggested_label: "Athlete portrait (5x7)", suggested_semantic_key: "athlete.portrait", expected_aspect_ratio: { width: 5, height: 7 } },
  { key: "text_5106920550f5", kind: "text", ordinal: 2, required: false, suggested_label: "Print Name", suggested_semantic_key: "athlete_print_name" },
  { key: "text_171cff5dcfde", kind: "text", ordinal: 3, required: false, suggested_label: "Jersey Number", suggested_semantic_key: "athlete_jersey_number" },
  { key: "text_746edef46a4a", kind: "text", ordinal: 4, required: false, suggested_label: "Team", suggested_semantic_key: "athlete_team" },
  { key: "text_1e6560b98c6e", kind: "text", ordinal: 5, required: false, suggested_label: "Year", suggested_semantic_key: "athlete_year" },
  { key: "image_12rkfks", kind: "image", ordinal: 10, required: false, suggested_label: "athlete.portrait", suggested_semantic_key: "athlete.portrait", expected_aspect_ratio: { width: 10, height: 8 } },
]);

const frozenModernVintageContract = memoryMateContract(frozenModernVintageTemplate, [
  { key: "athlete.portrait.5x7", kind: "image", ordinal: 1, required: false, suggested_label: "Athlete portrait (5x7)", suggested_semantic_key: "athlete.portrait", expected_aspect_ratio: { width: 5, height: 7 } },
  { key: "athlete.portrait.10x8", kind: "image", ordinal: 2, required: false, suggested_label: "athlete.portrait", suggested_semantic_key: "athlete.portrait", expected_aspect_ratio: { width: 10, height: 8 } },
]);

const frozenTemplates: readonly FrozenDemoTemplate[] = [
  { ...frozenDemoTemplate, contract: frozenNeonLightsContract },
  { ...frozenModernVintageTemplate, contract: frozenModernVintageContract },
];

export function frozenDemoTemplateForID(templateID: string): FrozenDemoTemplate | null {
  return frozenTemplates.find((template) => template.templateID === templateID) ?? null;
}

export function frozenDemoTemplateCatalog(): { items: PublishedTemplate[]; demo_freeze: readonly Omit<FrozenDemoTemplate, "contract">[] } {
  return {
    items: frozenTemplates.map(({ templateID, name }) => ({ id: templateID, name, status: "active" })),
    demo_freeze: frozenTemplates.map((template) => ({
      templateID: template.templateID,
      revisionID: template.revisionID,
      revisionNumber: template.revisionNumber,
      outputID: template.outputID,
      name: template.name,
      snapshotSHA256: template.snapshotSHA256,
      frozenAt: template.frozenAt,
      reviewAfter: template.reviewAfter,
    })),
  };
}

export function frozenDemoRevisionMatches(templateID: string, revisionID: string | null | undefined): boolean {
  const template = frozenDemoTemplateForID(templateID);
  return Boolean(template && (!revisionID || revisionID === template.revisionID));
}

export function frozenDemoTemplateOutputs(templateID: string, revisionID?: string | null): TemplateOutputs | null {
  const template = frozenDemoTemplateForID(templateID);
  if (!template || !frozenDemoRevisionMatches(templateID, revisionID)) return null;
  return {
    template_id: template.templateID,
    revision_id: template.revisionID,
    revision_number: template.revisionNumber,
    outputs: [frozenOutput],
  };
}

export function frozenDemoTemplateContract(templateID: string, outputID: string, revisionID?: string | null): TemplateContract | null {
  const template = frozenDemoTemplateForID(templateID);
  if (!template || outputID !== template.outputID || !frozenDemoRevisionMatches(templateID, revisionID)) return null;
  return template.contract;
}

export function frozenDemoBrowserPreview(templateID: string, outputID: string, revisionID?: string | null): BrowserPreviewDocument | null {
  const template = frozenDemoTemplateForID(templateID);
  const contract = frozenDemoTemplateContract(templateID, outputID, revisionID);
  const spec = bundledTemplateSpec(templateID);
  if (!template || !contract || !spec || !bundledTemplateSpecMatchesRevision(spec, template.revisionID)) return null;
  return specBrowserPreviewDocument({ spec, contract, output: frozenOutput });
}
