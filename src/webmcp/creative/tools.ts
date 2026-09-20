import { defineTool } from "@nekuda/webmcp-sdk";

import { requestCreativeWebMcpAction } from "./bridge";

type InspectCreativeInput = {
  projectId?: string;
};

type UpdateEventInput = {
  projectId: string;
  revision: number;
  event: {
    name?: string;
    date?: string;
    location?: string;
    callToAction?: string;
  };
};

type ProposeBackgroundInput = {
  projectId: string;
  revision: number;
  prompt: string;
  palette: { primary: string; accent: string };
};

type CheckGenerationInput = {
  jobId: string;
};

type ApplyBackgroundInput = {
  projectId: string;
  revision: number;
  candidateId: string;
};

type SwitchLayoutInput = {
  projectId: string;
  revision: number;
  layout: "card" | "banner";
};

type ExportArtworkInput = {
  projectId: string;
  revision: number;
  format: "card" | "banner";
};

type HistoryInput = {
  steps?: number;
};

const eventSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    date: { type: "string", maxLength: 80 },
    location: { type: "string", maxLength: 160 },
    callToAction: { type: "string", maxLength: 120 },
  },
  minProperties: 1,
  additionalProperties: false,
} as const;

export const inspectCreativeProject = defineTool<InspectCreativeInput>({
  stableKey: "creative.inspect_project",
  name: "inspect_creative_project",
  source: "merchant_authored",
  title: "Inspect creative project",
  description:
    "Inspect the visible sports event creative project when you need its event details, active layout, editable layers, background candidates, generation jobs, and revision. Returns the same project summary shown in the workbench and makes no changes.",
  inputSchema: {
    type: "object",
    properties: { projectId: { type: "string", minLength: 1, description: "Optional project ID to verify." } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  async execute(input) {
    return requestCreativeWebMcpAction("inspect_project", input);
  },
});

export const updateCreativeEvent = defineTool<UpdateEventInput>({
  stableKey: "creative.update_event",
  name: "update_creative_event",
  source: "merchant_authored",
  title: "Update event details",
  description:
    "Update editable event text in the visible creative project when a person asks to correct the event name, date, location, or call to action. Returns the updated project and revision; text changes use deterministic local composition and never call the image generator.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", minLength: 1 },
      revision: { type: "integer", minimum: 0 },
      event: eventSchema,
    },
    required: ["projectId", "revision", "event"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  async execute(input) {
    return requestCreativeWebMcpAction("update_event_details", input);
  },
});

export const proposeCreativeBackground = defineTool<ProposeBackgroundInput>({
  stableKey: "creative.propose_background",
  name: "propose_creative_background",
  source: "merchant_authored",
  title: "Propose a generated background",
  description:
    "Propose a new Livepeer background when a person asks for a different visual direction. Returns a bounded estimate or pending job reference for the exact project revision and prompt; it never confirms spend, applies a candidate, replaces the supplied athlete or logo, or waits for generation to finish. A visible human approval control must confirm the quoted render.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", minLength: 1 },
      revision: { type: "integer", minimum: 0 },
      prompt: { type: "string", minLength: 1, maxLength: 1000 },
      palette: {
        type: "object",
        properties: {
          primary: { type: "string", minLength: 1, maxLength: 32 },
          accent: { type: "string", minLength: 1, maxLength: 32 },
        },
        required: ["primary", "accent"],
        additionalProperties: false,
      },
    },
    required: ["projectId", "revision", "prompt", "palette"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  async execute(input) {
    return requestCreativeWebMcpAction("propose_background", input);
  },
});

export const checkCreativeGeneration = defineTool<CheckGenerationInput>({
  stableKey: "creative.check_generation",
  name: "check_creative_generation",
  source: "merchant_authored",
  title: "Check background generation",
  description:
    "Check a previously proposed creative background job when a person asks whether it is ready. Returns queued, running, succeeded, or failed status plus estimate, actual cost when available, warnings, and candidate metadata; it does not start another job or spend money.",
  inputSchema: {
    type: "object",
    properties: { jobId: { type: "string", minLength: 1 } },
    required: ["jobId"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  async execute(input) {
    return requestCreativeWebMcpAction("check_generation", input);
  },
});

export const applyCreativeBackground = defineTool<ApplyBackgroundInput>({
  stableKey: "creative.apply_background",
  name: "apply_creative_background",
  source: "merchant_authored",
  title: "Apply a reviewed background",
  description:
    "Apply a completed background candidate after a person has reviewed and chosen it in the visible creative workbench. Returns the revised project and preserves athlete, logo, text, and foreground transforms; it cannot create a candidate or confirm a provider charge.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", minLength: 1 },
      revision: { type: "integer", minimum: 0 },
      candidateId: { type: "string", minLength: 1 },
    },
    required: ["projectId", "revision", "candidateId"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  async execute(input) {
    return requestCreativeWebMcpAction("apply_background_candidate", input);
  },
});

export const switchCreativeLayout = defineTool<SwitchLayoutInput>({
  stableKey: "creative.switch_layout",
  name: "switch_creative_layout",
  source: "merchant_authored",
  title: "Switch creative layout",
  description:
    "Switch the visible project between its coordinated card and banner layouts when a person asks to preview the other format. Returns the updated composition and exact target dimensions; it reuses the approved background and costs nothing.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", minLength: 1 },
      revision: { type: "integer", minimum: 0 },
      layout: { type: "string", enum: ["card", "banner"] },
    },
    required: ["projectId", "revision", "layout"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: true },
  async execute(input) {
    return requestCreativeWebMcpAction("switch_layout", input);
  },
});

export const exportCreativeArtwork = defineTool<ExportArtworkInput>({
  stableKey: "creative.export_artwork",
  name: "export_creative_artwork",
  source: "merchant_authored",
  title: "Export creative artwork",
  description:
    "Export the visible approved creative project as a real PNG when a person asks to download the card or banner. Returns a download filename, dimensions, and local download URL after deterministic rendering; it never generates an image, confirms spend, or publishes the artwork.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", minLength: 1 },
      revision: { type: "integer", minimum: 0 },
      format: { type: "string", enum: ["card", "banner"] },
    },
    required: ["projectId", "revision", "format"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
  async execute(input) {
    return requestCreativeWebMcpAction("export_artwork", input);
  },
});

export const undoCreativeChange = defineTool<HistoryInput>({
  stableKey: "creative.undo",
  name: "undo_creative_change",
  source: "merchant_authored",
  title: "Undo creative change",
  description:
    "Undo the last visible creative edit when a person asks to restore the prior project state. Returns the restored revision and a description of what changed; undo does not reverse an already incurred provider cost.",
  inputSchema: {
    type: "object",
    properties: { steps: { type: "integer", minimum: 1, maximum: 5, default: 1 } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
  async execute(input) {
    return requestCreativeWebMcpAction("undo", input);
  },
});

export const redoCreativeChange = defineTool<HistoryInput>({
  stableKey: "creative.redo",
  name: "redo_creative_change",
  source: "merchant_authored",
  title: "Redo creative change",
  description:
    "Redo a successful undo when a person asks to put the undone creative edit back. Returns the restored revision and a description of what changed; redo does not generate or spend money.",
  inputSchema: {
    type: "object",
    properties: { steps: { type: "integer", minimum: 1, maximum: 5, default: 1 } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
  async execute(input) {
    return requestCreativeWebMcpAction("redo", input);
  },
});

export const creativeWebMcpTools = [
  inspectCreativeProject,
  updateCreativeEvent,
  proposeCreativeBackground,
  checkCreativeGeneration,
  applyCreativeBackground,
  switchCreativeLayout,
  exportCreativeArtwork,
  undoCreativeChange,
  redoCreativeChange,
] as const;
