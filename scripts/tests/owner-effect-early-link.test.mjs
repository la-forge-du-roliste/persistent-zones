import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry = { utils: { deepClone: structuredClone, randomID: () => "id" } };
globalThis.canvas = { scene: null };
globalThis.CONFIG = { RegionBehavior: { dataModels: {} } };
globalThis.CONST = { REGION_EVENTS: {} };
globalThis.game = {
  user: { id: "gm", isGM: true, active: true },
  users: { activeGM: { id: "gm" } },
  settings: { settings: new Map() },
  actors: { get: () => null },
  scenes: { contents: [] }
};

const { resolveExistingConcentrationOwnerEffect } = await import("../runtime/region-factory.mjs");
const { handleDeletedOwnerEffect } = await import("../runtime/concentration-cleanup.mjs");

test("a concentration owner is resolved before OnCreate from structured cast identity", () => {
  const actorUuid = "Actor.caster";
  const itemUuid = `${actorUuid}.Item.spell`;
  const effect = {
    id: "concentration", uuid: `${actorUuid}.ActiveEffect.concentration`, disabled: false,
    parent: { uuid: actorUuid }, origin: itemUuid, statuses: new Set(["concentrating"]),
    flags: { dnd5e: { activityId: "activity" } },
    toObject() { return { origin: itemUuid, statuses: ["concentrating"], flags: this.flags }; }
  };
  const actor = { uuid: actorUuid, documentName: "Actor", effects: [effect] };
  globalThis.fromUuidSync = (uuid) => uuid === actorUuid ? actor : null;
  const result = resolveExistingConcentrationOwnerEffect({
    normalizedDefinition: { concentration: { required: true }, itemUuid, activityId: "activity" },
    sourceContext: { actor, item: { uuid: itemUuid }, activity: { id: "activity" } }
  });
  assert.equal(result.selectedOwnerEffectUuid, effect.uuid);
  assert.equal(result.resolutionMode, "unique-structured-concentration-owner");
});

test("deleting the early-linked concentration owner removes its managed Region even after resolver failure", async () => {
  const ownerEffectUuid = "Actor.caster.ActiveEffect.concentration";
  const runtime = {
    itemUuid: "Actor.caster.Item.spell",
    ownerEffectUuid,
    activeEffectUuid: ownerEffectUuid,
    concentrationEffectUuid: ownerEffectUuid,
    normalizedDefinition: { concentration: { required: true } },
    linkedDocuments: {}
  };
  const region = {
    id: "region", uuid: "Scene.scene.Region.region", flags: { "persistent-zones": { runtime } },
    getFlag: () => runtime,
    toObject: () => ({ flags: { "persistent-zones": { runtime } } })
  };
  const deleted = [];
  const scene = {
    id: "scene", regions: { contents: [region] },
    async deleteEmbeddedDocuments(type, ids) { deleted.push({ type, ids }); }
  };
  region.parent = scene;
  game.scenes.contents = [scene];
  const effect = {
    id: "concentration", uuid: ownerEffectUuid, flags: {},
    toObject: () => ({ flags: {} })
  };
  await handleDeletedOwnerEffect(effect);
  assert.deepEqual(deleted, [{ type: "Region", ids: ["region"] }]);
});
