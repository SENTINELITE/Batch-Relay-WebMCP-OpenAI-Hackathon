import {
  type CreativeAssetReference,
  type CreativeBackgroundCandidate,
  type CreativeCutoutCandidate,
  type CreativeEvent,
  type CreativeFormat,
  type CreativeFormatLayout,
  type CreativeLayerTransform,
  type CreativePalette,
  type CreativeProject,
  type CreativeProjectUpdate,
  type CreativeTextLayer,
} from "./types.ts";

export type CreativeIdFactory = () => string;

const now = (): string => new Date().toISOString();

function defaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `creative_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function transform(values: CreativeLayerTransform): CreativeLayerTransform {
  return { fit: "contain", opacity: 1, ...values };
}

function textLayer(
  id: string,
  value: string,
  values: CreativeLayerTransform,
  options: Pick<CreativeTextLayer, "color" | "fontSizeRatio" | "fontWeight" | "align"> = {},
): CreativeTextLayer {
  return {
    id,
    value,
    transform: transform(values),
    color: options.color ?? "#fffaf1",
    fontFamily: "General Sans, system-ui, sans-serif",
    fontSizeRatio: options.fontSizeRatio ?? 0.055,
    fontWeight: options.fontWeight ?? 700,
    align: options.align ?? "left",
    maxLines: 2,
  };
}

export function defaultLayout(format: CreativeFormat, event: CreativeEvent, palette: CreativePalette): CreativeFormatLayout {
  const isCard = format === "card";
  const ink = palette.text ?? "#fffaf1";
  return {
    background: transform({ x: 0, y: 0, width: 1, height: 1, fit: "cover" }),
    athlete: transform(isCard
      ? { x: 0.04, y: 0.3, width: 0.92, height: 0.55, fit: "cover" }
      : { x: 0.42, y: 0.1, width: 0.58, height: 0.9, fit: "cover" }),
    logo: transform(isCard
      ? { x: 0.06, y: 0.055, width: 0.3, height: 0.12, fit: "contain" }
      : { x: 0.06, y: 0.1, width: 0.2, height: 0.15, fit: "contain" }),
    text: isCard
      ? [
        // The supplied portrait has eyes in its upper middle. Keep the
        // headline in the quiet space above the photo so the default card
        // never types across the subject's face.
        textLayer("event-name", event.name, { x: 0.06, y: 0.185, width: 0.88, height: 0.095 }, { color: ink, fontSizeRatio: 0.055, fontWeight: 800 }),
        textLayer("event-date", event.date, { x: 0.06, y: 0.865, width: 0.88, height: 0.045 }, { color: palette.accent, fontSizeRatio: 0.03, fontWeight: 700 }),
        textLayer("event-location", event.location, { x: 0.06, y: 0.915, width: 0.88, height: 0.035 }, { color: ink, fontSizeRatio: 0.022, fontWeight: 600 }),
        textLayer("event-cta", event.callToAction, { x: 0.06, y: 0.955, width: 0.88, height: 0.035 }, { color: ink, fontSizeRatio: 0.021, fontWeight: 600 }),
      ]
      : [
        textLayer("event-name", event.name, { x: 0.06, y: 0.43, width: 0.37, height: 0.18 }, { color: ink, fontSizeRatio: 0.06, fontWeight: 800 }),
        textLayer("event-date", event.date, { x: 0.06, y: 0.67, width: 0.33, height: 0.08 }, { color: palette.accent, fontSizeRatio: 0.031, fontWeight: 700 }),
        textLayer("event-location", event.location, { x: 0.06, y: 0.76, width: 0.33, height: 0.07 }, { color: ink, fontSizeRatio: 0.024, fontWeight: 600 }),
        textLayer("event-cta", event.callToAction, { x: 0.06, y: 0.86, width: 0.33, height: 0.06 }, { color: ink, fontSizeRatio: 0.022, fontWeight: 600 }),
      ],
  };
}

export type CreateProjectOptions = {
  id?: string;
  idFactory?: CreativeIdFactory;
  now?: () => string;
  event?: Partial<CreativeEvent>;
  palette?: Partial<CreativePalette>;
  brief?: string;
  format?: CreativeFormat;
  assets?: Partial<CreativeProject["assets"]>;
  athleteOriginal?: CreativeProject["athleteOriginal"];
  athleteCutoutCandidates?: CreativeProject["athleteCutoutCandidates"];
};

const DEFAULT_EVENT: CreativeEvent = {
  name: "Northwest Classic",
  date: "Saturday, June 14",
  location: "Seattle · Washington",
  callToAction: "Bring your best game",
};

const DEFAULT_PALETTE: CreativePalette = {
  primary: "#142b3a",
  accent: "#efb84b",
  text: "#fffaf1",
};

export function createProject(options: CreateProjectOptions = {}): CreativeProject {
  const event = { ...DEFAULT_EVENT, ...options.event };
  const palette = { ...DEFAULT_PALETTE, ...options.palette };
  const format = options.format ?? "card";
  const stamp = options.now?.() ?? now();
  const layouts = {
    card: defaultLayout("card", event, palette),
    banner: defaultLayout("banner", event, palette),
  } satisfies Record<CreativeFormat, CreativeFormatLayout>;
  return {
    id: options.id ?? (options.idFactory ?? defaultId)(),
    revision: 1,
    event,
    palette,
    brief: options.brief ?? "A confident, energetic sports event with room for the supplied athlete photo.",
    format,
    assets: { ...options.assets },
    layouts,
    backgroundCandidates: [],
    ...(options.athleteOriginal ? { athleteOriginal: copy(options.athleteOriginal) } : {}),
    ...(options.athleteCutoutCandidates ? { athleteCutoutCandidates: copy(options.athleteCutoutCandidates) } : {}),
    generationRefs: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function copy<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Applies a document update while preserving immutable snapshots for undo. */
export function updateProject(project: CreativeProject, update: CreativeProjectUpdate, updatedAt = now()): CreativeProject {
  const next = copy(project);
  if (update.event) next.event = { ...next.event, ...update.event };
  if (update.palette) next.palette = { ...next.palette, ...update.palette };
  if (update.brief !== undefined) next.brief = update.brief;
  if (update.format !== undefined) next.format = update.format;
  if (update.assets) next.assets = { ...next.assets, ...update.assets };
  if (update.layouts) next.layouts = { ...next.layouts, ...copy(update.layouts) };
  if (update.backgroundCandidates) next.backgroundCandidates = copy(update.backgroundCandidates);
  if (update.athleteOriginal !== undefined) next.athleteOriginal = copy(update.athleteOriginal);
  if (update.athleteCutoutCandidates) next.athleteCutoutCandidates = copy(update.athleteCutoutCandidates);
  if (update.generationRefs) next.generationRefs = copy(update.generationRefs);
  next.revision += 1;
  next.updatedAt = updatedAt;
  // Keep text content synchronized when callers update event fields only. A
  // hand-edited text layer remains authoritative if its value differs.
  const eventValues: Record<string, string> = {
    "event-name": next.event.name,
    "event-date": next.event.date,
    "event-location": next.event.location,
    "event-cta": next.event.callToAction,
  };
  for (const layout of Object.values(next.layouts)) {
    for (const layer of layout.text) {
      if (eventValues[layer.id] !== undefined) {
        const previous = project.layouts[next.format]?.text.find((candidate) => candidate.id === layer.id);
        const changedEventField = update.event && previous && layer.value === previous.value;
        if (changedEventField) layer.value = eventValues[layer.id];
      }
    }
  }
  return next;
}

/** Applies a reviewed candidate without touching athlete, logo, or text layers. */
export function applyBackground(
  project: CreativeProject,
  candidate: CreativeBackgroundCandidate | CreativeAssetReference,
  updatedAt = now(),
): CreativeProject {
  const reference = "asset" in candidate ? candidate.asset : candidate;
  const next = copy(project);
  next.assets = { ...next.assets, background: reference };
  next.revision += 1;
  next.updatedAt = updatedAt;
  return next;
}

/**
 * Applies a reviewed cutout only when it belongs to the exact athlete source
 * currently represented by the project. Invalid or stale candidates are a
 * no-op, which lets a reconnecting UI keep its last approved composition.
 */
export function applyAthleteCutout(
  project: CreativeProject,
  candidate: CreativeCutoutCandidate,
  updatedAt = now(),
): CreativeProject {
  const sourceAssetId = project.athleteOriginal?.id ?? project.assets.athlete?.id;
  if (candidate.status !== "ready" || candidate.sourceAssetId !== sourceAssetId || candidate.asset.slot !== "athlete") return project;
  const next = copy(project);
  if (!next.athleteOriginal && next.assets.athlete) next.athleteOriginal = copy(next.assets.athlete);
  next.assets = { ...next.assets, athlete: copy(candidate.asset) };
  // Transparent cutouts should fit inside the same editable frame. Position,
  // scale, rotation, and opacity remain exactly as the user set them.
  for (const format of ["card", "banner"] as const) {
    next.layouts[format] = {
      ...next.layouts[format],
      athlete: { ...next.layouts[format].athlete, fit: "contain" },
    };
  }
  next.revision += 1;
  next.updatedAt = updatedAt;
  return next;
}

/** Restores the retained supplied athlete while leaving cutout candidates available. */
export function restoreOriginalAthlete(project: CreativeProject, updatedAt = now()): CreativeProject {
  if (!project.athleteOriginal) return project;
  const next = copy(project);
  next.assets = { ...next.assets, athlete: copy(next.athleteOriginal) };
  for (const format of ["card", "banner"] as const) {
    next.layouts[format] = {
      ...next.layouts[format],
      athlete: { ...next.layouts[format].athlete, fit: "cover" },
    };
  }
  next.revision += 1;
  next.updatedAt = updatedAt;
  return next;
}

export function setFormat(project: CreativeProject, format: CreativeFormat, updatedAt = now()): CreativeProject {
  return updateProject(project, { format }, updatedAt);
}

export function addBackgroundCandidate(
  project: CreativeProject,
  candidate: CreativeBackgroundCandidate,
  updatedAt = now(),
): CreativeProject {
  return updateProject(project, {
    backgroundCandidates: [...project.backgroundCandidates, candidate],
  }, updatedAt);
}

export function projectTextValues(project: CreativeProject, format = project.format): Record<string, string> {
  return Object.fromEntries(project.layouts[format].text.map((layer) => [layer.id, layer.value]));
}

export function cloneProject(project: CreativeProject): CreativeProject {
  return copy(project);
}
