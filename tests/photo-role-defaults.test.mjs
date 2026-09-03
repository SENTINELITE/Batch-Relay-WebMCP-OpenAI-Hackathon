import assert from "node:assert/strict";
import test from "node:test";

import { deriveImageSlotAliases } from "../src/lib/storefront/slot-aliases.ts";
import {
  directPhotoDefault,
  emptyPhotoRoleMemory,
  photoForRole,
  photoRoleFromAliases,
  photoRolesBySlotKey,
  prefillProvenance,
  prefillSlotAssignments,
  rememberDirectPhoto,
  rememberPhotoRole,
  rememberSlotAssignments,
} from "../src/lib/storefront/photo-role-defaults.ts";

const memoryMateSlots = [
  { key: "image_hero", suggested_label: "Team photo" },
  { key: "image_face", suggested_label: "Athlete portrait" },
];
const memoryMateBoxes = {
  image_hero: { width: 7.5, height: 5 },
  image_face: { width: 2.5, height: 3.5 },
};

test("reads roles from the same alias vocabulary the artwork publishes", () => {
  const aliases = deriveImageSlotAliases(memoryMateSlots, memoryMateBoxes);
  const roles = photoRolesBySlotKey(memoryMateSlots.map((slot) => ({
    key: slot.key,
    aliases: aliases[slot.key],
    box: memoryMateBoxes[slot.key],
  })));
  assert.deepEqual(roles, { image_hero: "team", image_face: "individual" });
});

test("a single image slot falls back to its printed shape, and ambiguous slots stay silent", () => {
  assert.deepEqual(photoRolesBySlotKey([{ key: "photo", aliases: ["photo", "main"], box: { width: 5, height: 7 } }]), { photo: "individual" });
  assert.deepEqual(photoRolesBySlotKey([{ key: "photo", aliases: ["photo"], box: { width: 10, height: 8 } }]), { photo: "team" });
  assert.deepEqual(photoRolesBySlotKey([{ key: "photo", aliases: [], box: { width: 8, height: 8 } }]), {});
  // Geometry alone is not trusted once more than one slot could claim the role.
  assert.deepEqual(photoRolesBySlotKey([
    { key: "left", aliases: [], box: { width: 5, height: 7 } },
    { key: "right", aliases: [], box: { width: 5, height: 7 } },
  ]), {});
  assert.equal(photoRoleFromAliases(["team", "individual"]), null);
  assert.equal(photoRoleFromAliases(undefined), null);
});

test("records the latest assignment for each role and re-records on override", () => {
  const roles = { image_hero: "team", image_face: "individual" };
  let memory = rememberSlotAssignments(emptyPhotoRoleMemory, { image_face: "photo_a" }, roles);
  assert.deepEqual(memory, { individual: "photo_a" });
  memory = rememberSlotAssignments(memory, { image_face: "photo_b", image_hero: "photo_c" }, roles);
  assert.deepEqual(memory, { individual: "photo_b", team: "photo_c" });
  // A slot with no derived role never writes to the memory.
  assert.deepEqual(rememberSlotAssignments(memory, { image_logo: "photo_d" }, roles), memory);
  assert.equal(rememberPhotoRole(memory, null, "photo_e"), memory);
  assert.equal(rememberPhotoRole(memory, "team", null), memory);
});

test("a direct print records its selected photo from the printed orientation", () => {
  const portrait = rememberDirectPhoto(emptyPhotoRoleMemory, { width: 5, height: 7 }, "photo_a");
  assert.deepEqual(portrait, { individual: "photo_a" });
  const landscape = rememberDirectPhoto(portrait, { width: 10, height: 8 }, "photo_b");
  assert.deepEqual(landscape, { individual: "photo_a", team: "photo_b" });
  assert.deepEqual(rememberDirectPhoto(landscape, null, "photo_c"), landscape);
});

test("prefills only empty slots and reports where each default came from", () => {
  const memory = { individual: "photo_a", team: "photo_b" };
  const roles = { image_hero: "team", image_face: "individual" };
  const { assignments, prefills } = prefillSlotAssignments({
    assignments: { image_hero: "photo_z" },
    memory,
    rolesBySlotKey: roles,
    availablePhotoIds: ["photo_a", "photo_b", "photo_z"],
  });
  assert.deepEqual(assignments, { image_hero: "photo_z", image_face: "photo_a" });
  assert.deepEqual(prefills, [{ slotKey: "image_face", photoId: "photo_a", role: "individual" }]);
  assert.equal(prefillProvenance("individual"), "individual default");
  assert.equal(prefillProvenance("team"), "team default");
});

test("a remembered photograph that left the tray is no longer offered", () => {
  const memory = { individual: "photo_a", team: "photo_b" };
  const { assignments, prefills } = prefillSlotAssignments({
    assignments: {},
    memory,
    rolesBySlotKey: { image_hero: "team", image_face: "individual" },
    availablePhotoIds: ["photo_b"],
  });
  assert.deepEqual(assignments, { image_hero: "photo_b" });
  assert.deepEqual(prefills, [{ slotKey: "image_hero", photoId: "photo_b", role: "team" }]);
  assert.equal(photoForRole(memory, "individual", ["photo_b"]), null);
  assert.equal(photoForRole(memory, null, ["photo_a"]), null);
});

test("the user's cross-product flows carry the photograph forward", () => {
  // (a) A 5x7 direct print, then a memory mate: the individual slot is prefilled.
  const afterFivebySeven = rememberDirectPhoto(emptyPhotoRoleMemory, { width: 5, height: 7 }, "photo_a");
  const aliases = deriveImageSlotAliases(memoryMateSlots, memoryMateBoxes);
  const memoryMateRoles = photoRolesBySlotKey(memoryMateSlots.map((slot) => ({
    key: slot.key,
    aliases: aliases[slot.key],
    box: memoryMateBoxes[slot.key],
  })));
  const mate = prefillSlotAssignments({
    assignments: {},
    memory: afterFivebySeven,
    rolesBySlotKey: memoryMateRoles,
    availablePhotoIds: ["photo_a", "photo_b"],
  });
  assert.equal(mate.assignments.image_face, "photo_a");
  assert.equal(mate.assignments.image_hero, undefined);

  // (b) The team image assigned on that memory mate defaults a landscape 8x10.
  const afterTeam = rememberSlotAssignments(afterFivebySeven, { image_hero: "photo_b" }, memoryMateRoles);
  assert.deepEqual(
    directPhotoDefault(afterTeam, { width: 10, height: 8 }, ["photo_a", "photo_b"]),
    { photoId: "photo_b", role: "team" },
  );
  assert.deepEqual(
    directPhotoDefault(afterTeam, { width: 8, height: 10 }, ["photo_a", "photo_b"]),
    { photoId: "photo_a", role: "individual" },
  );
  assert.equal(directPhotoDefault(afterTeam, { width: 10, height: 8 }, ["photo_a"]), null);
});
