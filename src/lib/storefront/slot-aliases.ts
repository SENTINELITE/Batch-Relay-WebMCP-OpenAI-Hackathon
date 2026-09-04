import type { BrowserPreviewCanvas } from "./browser-preview";

/**
 * Memory-mate style templates publish opaque slot keys such as `image_122qlv9`
 * next to labels a shopper never says out loud. An agent asked to "replace the
 * team image" has no vocabulary to aim at. These aliases are derived, in the
 * browser, from what the visible artwork already shows — never guessed — and
 * are published in visible state so the agent can see the words it may use.
 */
export type AliasImageSlot = { key: string; suggested_label?: string | null };

export type SlotBox = { width: number; height: number };

const teamAliases = ["team", "group"];
const individualAspectAliases = ["individual", "athlete", "portrait"];
const individualAreaAliases = ["individual", "athlete"];
const singleSlotAliases = ["photo", "main"];

/**
 * A label such as "Athlete portrait (5x7)" carries the slot's shape. It is a
 * weaker signal than the rendered box, so it is only consulted when the loaded
 * browser preview has no geometry for that slot.
 */
export function slotBoxFromLabel(label: string | null | undefined): SlotBox | null {
  if (typeof label !== "string") return null;
  const match = label.toLowerCase().match(/\b(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\b/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

/** Exact API-owned slot keys only: layers without a published mapping are skipped. */
export function imageSlotBoxesFromCanvases(
  canvases: readonly Pick<BrowserPreviewCanvas, "layers">[],
): Record<string, SlotBox> {
  const boxes: Record<string, SlotBox> = {};
  for (const canvas of canvases) {
    for (const layer of canvas.layers) {
      if (layer.kind !== "image" || !layer.inputSlotKey || boxes[layer.inputSlotKey]) continue;
      boxes[layer.inputSlotKey] = { width: layer.sizeIn.width, height: layer.sizeIn.height };
    }
  }
  return boxes;
}

type Measured = { key: string; box: SlotBox | null };

function orientationOf(box: SlotBox | null): "landscape" | "portrait" | null {
  if (!box) return null;
  if (box.width > box.height) return "landscape";
  if (box.height > box.width) return "portrait";
  return null;
}

function onlyMember<T>(items: readonly T[]): T | null {
  return items.length === 1 ? items[0]! : null;
}

function byAspect(measured: readonly Measured[]): Record<string, string[]> | null {
  const landscape = onlyMember(measured.filter((slot) => orientationOf(slot.box) === "landscape"));
  const portraits = measured.filter((slot) => orientationOf(slot.box) === "portrait");
  if (!landscape || portraits.length === 0) return null;
  const portrait = onlyMember(portraits);
  const aliases: Record<string, string[]> = { [landscape.key]: [...teamAliases] };
  if (portrait) aliases[portrait.key] = [...individualAspectAliases];
  return aliases;
}

function byArea(measured: readonly Measured[]): Record<string, string[]> | null {
  if (measured.some((slot) => !slot.box)) return null;
  const areas = measured.map((slot) => ({ key: slot.key, area: slot.box!.width * slot.box!.height }));
  const largest = Math.max(...areas.map(({ area }) => area));
  const smallest = Math.min(...areas.map(({ area }) => area));
  if (largest === smallest) return null;
  const team = onlyMember(areas.filter(({ area }) => area === largest));
  const individual = onlyMember(areas.filter(({ area }) => area === smallest));
  const aliases: Record<string, string[]> = {};
  if (team) aliases[team.key] = [...teamAliases];
  if (individual) aliases[individual.key] = [...individualAreaAliases];
  return Object.keys(aliases).length > 0 ? aliases : null;
}

/** An alias is only spoken when exactly one slot earns it. */
function uniqueOnly(aliases: Record<string, string[]>): Record<string, string[]> {
  const counts = new Map<string, number>();
  for (const words of Object.values(aliases)) {
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const unique: Record<string, string[]> = {};
  for (const [key, words] of Object.entries(aliases)) {
    const kept = words.filter((word) => counts.get(word) === 1);
    if (kept.length > 0) unique[key] = kept;
  }
  return unique;
}

/**
 * Derivation order: the rendered box's aspect, then its area, then nothing.
 * Memory mates put the hero/team photograph in the larger box, so a strictly
 * larger area is the team image and a strictly smaller one is the individual.
 * Slots that cannot be told apart deliberately receive no aliases.
 */
export function deriveImageSlotAliases(
  slots: readonly AliasImageSlot[],
  boxesBySlotKey: Readonly<Record<string, SlotBox>> = {},
): Record<string, string[]> {
  if (slots.length === 0) return {};
  if (slots.length === 1) return { [slots[0]!.key]: [...singleSlotAliases] };
  const measured: Measured[] = slots.map((slot) => ({
    key: slot.key,
    box: boxesBySlotKey[slot.key] ?? slotBoxFromLabel(slot.suggested_label),
  }));
  const derived = byAspect(measured) ?? byArea(measured);
  return derived ? uniqueOnly(derived) : {};
}

/**
 * A text slot publishes a human label ("Print Name") and often a semantic key
 * ("athlete_print_name"). Both are words the template itself already speaks, so
 * the shopper's own vocabulary — "name", "jersey", "team" — is read out of them
 * rather than invented for one particular template.
 */
export type AliasTextSlot = {
  key: string;
  suggested_label?: string | null;
  suggested_semantic_key?: string | null;
};

/** Words that carry no aim of their own and would collide across slots. */
const textAliasStopWords = new Set(["a", "an", "and", "for", "of", "or", "the", "to", "your"]);

function aliasWords(source: string | null | undefined): string[] {
  if (typeof source !== "string") return [];
  return source
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !textAliasStopWords.has(word) && !/^\d+$/.test(word));
}

function aliasPhrase(source: string | null | undefined): string | null {
  const words = aliasWords(source);
  return words.length > 1 ? words.join(" ") : null;
}

/**
 * Text slot vocabulary, derived only from what the contract publishes: the
 * label as one phrase, its own words, then the same two readings of the
 * semantic key. A word two slots would both answer to (the "athlete" in
 * athlete_team and athlete_year) is dropped, exactly as for image slots.
 */
export function deriveTextSlotAliases(slots: readonly AliasTextSlot[]): Record<string, string[]> {
  const derived: Record<string, string[]> = {};
  for (const slot of slots) {
    const words = [
      aliasPhrase(slot.suggested_label),
      ...aliasWords(slot.suggested_label),
      aliasPhrase(slot.suggested_semantic_key),
      ...aliasWords(slot.suggested_semantic_key),
    ].filter((word): word is string => Boolean(word));
    const unique = [...new Set(words)].filter((word) => word !== slot.key.toLowerCase());
    if (unique.length > 0) derived[slot.key] = unique;
  }
  return uniqueOnly(derived);
}

export type SlotKind = "image" | "text";

export type SlotPatchReference = { slotKey?: unknown; label?: unknown };

export type SlotPatchResolution<Slot> =
  | { kind: "resolved"; slot: Slot; matchedBy: "key" | "label" | "alias" }
  | { kind: "unresolved"; reason: "no_match" | "ambiguous_label" | "ambiguous_alias" };

function uniqueMatch<Slot>(
  matches: readonly Slot[],
  matchedBy: "key" | "label" | "alias",
  ambiguous: "ambiguous_label" | "ambiguous_alias",
): SlotPatchResolution<Slot> | null {
  if (matches.length === 1) return { kind: "resolved", slot: matches[0]!, matchedBy };
  if (matches.length > 1) return { kind: "unresolved", reason: ambiguous };
  return null;
}

/**
 * Exact published facts win absolutely: a slot key, then a published label —
 * exact case first, then trimmed and case-folded. Derived aliases are the last
 * resort and only resolve when one slot owns them.
 *
 * Every tier is scoped to the kind the operation needs before anything is
 * matched, because "team" is a word this artwork uses twice: once for the
 * landscape team photograph and once for the printed team line. A set_text can
 * only ever mean the text slot, and an assign only ever the image slot.
 */
export function resolveSlotPatchTarget<Slot extends AliasImageSlot & { kind?: unknown }>(
  slots: readonly Slot[],
  patch: SlotPatchReference,
  aliasesBySlotKey: Readonly<Record<string, string[]>> = {},
  requiredKind: SlotKind | null = null,
): SlotPatchResolution<Slot> {
  // A slot that publishes no kind cannot be excluded by kind: the caller that
  // knows every candidate is an image (revise_prints) says so explicitly.
  const candidates = requiredKind
    ? slots.filter((slot) => typeof slot.kind !== "string" || slot.kind === requiredKind)
    : slots;
  const slotKey = typeof patch.slotKey === "string" ? patch.slotKey : null;
  const label = typeof patch.label === "string" ? patch.label : null;
  if (slotKey) {
    const exact = candidates.find((slot) => slot.key === slotKey);
    if (exact) return { kind: "resolved", slot: exact, matchedBy: "key" };
  }
  if (label) {
    const wanted = label.trim();
    const folded = wanted.toLowerCase();
    const exactKey = candidates.find((slot) => slot.key === label || slot.key === wanted);
    if (exactKey) return { kind: "resolved", slot: exactKey, matchedBy: "key" };
    const exactLabel = uniqueMatch(
      candidates.filter((slot) => slot.suggested_label === label),
      "label",
      "ambiguous_label",
    );
    if (exactLabel) return exactLabel;
    const foldedLabel = uniqueMatch(
      candidates.filter((slot) => (slot.suggested_label ?? "").trim().toLowerCase() === folded),
      "label",
      "ambiguous_label",
    );
    if (foldedLabel) return foldedLabel;
    const aliased = uniqueMatch(
      candidates.filter((slot) =>
        (aliasesBySlotKey[slot.key] ?? []).some((alias) => alias.trim().toLowerCase() === folded)),
      "alias",
      "ambiguous_alias",
    );
    if (aliased) return aliased;
  }
  return { kind: "unresolved", reason: "no_match" };
}

/**
 * A template that publishes max_length owns the limit. When it publishes none,
 * the storefront still refuses a 300-character jersey number: silently printing
 * text no proof can carry is worse than a clear error.
 */
export const unpublishedTextSlotMaxLength = 200;

export function textSlotLengthLimit(
  slot: { max_length?: number | null },
): { limit: number; published: boolean } {
  const published = typeof slot.max_length === "number" && Number.isFinite(slot.max_length) && slot.max_length > 0;
  return published
    ? { limit: Math.floor(slot.max_length as number), published: true }
    : { limit: unpublishedTextSlotMaxLength, published: false };
}
