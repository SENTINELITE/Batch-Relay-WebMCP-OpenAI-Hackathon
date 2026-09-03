import type { SlotBox } from "./slot-aliases";

/**
 * A shopper who has already said which photograph is the athlete and which is
 * the team should not have to say it again on the next print. This session
 * memory is keyed by the same semantic vocabulary the slot aliases publish, so
 * a default is only ever offered for a role the artwork itself named.
 *
 * Nothing here is silent: every applied default is returned as an explicit
 * prefill record so the UI and the WebMCP response can say where it came from.
 */
export type PhotoRole = "individual" | "team";

export type PhotoRoleMemory = Readonly<Partial<Record<PhotoRole, string>>>;

export const emptyPhotoRoleMemory: PhotoRoleMemory = {};

/** Kept in step with the alias words derived in slot-aliases.ts. */
const roleAliases: Record<PhotoRole, readonly string[]> = {
  individual: ["individual", "athlete", "portrait"],
  team: ["team", "group"],
};

const roles: readonly PhotoRole[] = ["individual", "team"];

/** A slot only names a role when exactly one role's vocabulary matches. */
export function photoRoleFromAliases(aliases: readonly string[] | undefined): PhotoRole | null {
  const words = new Set((aliases ?? []).map((alias) => alias.trim().toLowerCase()));
  const matched = roles.filter((role) => roleAliases[role].some((alias) => words.has(alias)));
  return matched.length === 1 ? matched[0]! : null;
}

/** Portrait shapes hold one person; landscape shapes hold the whole team. */
export function photoRoleFromOrientation(box: SlotBox | null | undefined): PhotoRole | null {
  if (!box || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
  if (box.height > box.width) return "individual";
  if (box.width > box.height) return "team";
  return null;
}

export type RoleSlot = { key: string; aliases?: readonly string[]; box?: SlotBox | null };

/**
 * Derived aliases are the primary signal. Bare geometry is trusted only when
 * the template has a single image slot, where "the portrait one" is unambiguous.
 */
export function photoRolesBySlotKey(slots: readonly RoleSlot[]): Record<string, PhotoRole> {
  const bySlotKey: Record<string, PhotoRole> = {};
  for (const slot of slots) {
    const role = photoRoleFromAliases(slot.aliases)
      ?? (slots.length === 1 ? photoRoleFromOrientation(slot.box) : null);
    if (role) bySlotKey[slot.key] = role;
  }
  return bySlotKey;
}

export function rememberPhotoRole(
  memory: PhotoRoleMemory,
  role: PhotoRole | null,
  photoId: string | null | undefined,
): PhotoRoleMemory {
  if (!role || !photoId) return memory;
  if (memory[role] === photoId) return memory;
  return { ...memory, [role]: photoId };
}

/** Latest assignment wins, so re-assigning a slot re-records that role. */
export function rememberSlotAssignments(
  memory: PhotoRoleMemory,
  assignments: Readonly<Record<string, string>>,
  rolesBySlotKey: Readonly<Record<string, PhotoRole>>,
): PhotoRoleMemory {
  let next = memory;
  for (const [slotKey, photoId] of Object.entries(assignments)) {
    next = rememberPhotoRole(next, rolesBySlotKey[slotKey] ?? null, photoId);
  }
  return next;
}

type PhysicalOutput = { width: number; height: number } | null | undefined;

/** A direct print has no slots, so the printed shape names the role. */
export function photoRoleForDirectPrint(physicalOutput: PhysicalOutput): PhotoRole | null {
  return photoRoleFromOrientation(physicalOutput ?? null);
}

export function rememberDirectPhoto(
  memory: PhotoRoleMemory,
  physicalOutput: PhysicalOutput,
  photoId: string | null | undefined,
): PhotoRoleMemory {
  return rememberPhotoRole(memory, photoRoleForDirectPrint(physicalOutput), photoId);
}

/** A remembered photograph that has left the tray is no longer a default. */
export function photoForRole(
  memory: PhotoRoleMemory,
  role: PhotoRole | null,
  availablePhotoIds: readonly string[],
): string | null {
  if (!role) return null;
  const photoId = memory[role];
  return photoId && availablePhotoIds.includes(photoId) ? photoId : null;
}

export type SlotPrefill = { slotKey: string; photoId: string; role: PhotoRole };

/** Honest provenance wording shared by the UI hint and the tool response. */
export function prefillProvenance(role: PhotoRole): string {
  return `${role} default`;
}

/**
 * Only unassigned image slots are filled, and only from a role the shopper has
 * already chosen a photograph for. An explicit assignment is never replaced.
 */
export function prefillSlotAssignments({
  assignments,
  memory,
  rolesBySlotKey,
  availablePhotoIds,
}: {
  assignments: Readonly<Record<string, string>>;
  memory: PhotoRoleMemory;
  rolesBySlotKey: Readonly<Record<string, PhotoRole>>;
  availablePhotoIds: readonly string[];
}): { assignments: Record<string, string>; prefills: SlotPrefill[] } {
  const next = { ...assignments };
  const prefills: SlotPrefill[] = [];
  for (const [slotKey, role] of Object.entries(rolesBySlotKey)) {
    if (next[slotKey]) continue;
    const photoId = photoForRole(memory, role, availablePhotoIds);
    if (!photoId) continue;
    next[slotKey] = photoId;
    prefills.push({ slotKey, photoId, role });
  }
  return { assignments: next, prefills };
}

/** The direct-print counterpart: a default selection, never a replacement. */
export function directPhotoDefault(
  memory: PhotoRoleMemory,
  physicalOutput: PhysicalOutput,
  availablePhotoIds: readonly string[],
): { photoId: string; role: PhotoRole } | null {
  const role = photoRoleForDirectPrint(physicalOutput);
  const photoId = photoForRole(memory, role, availablePhotoIds);
  return photoId && role ? { photoId, role } : null;
}
