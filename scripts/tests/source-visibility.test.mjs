import assert from "node:assert/strict";
import test from "node:test";

let closedDoor = false;
let gmVisibilityCalls = 0;
let testedSource = null;
let temporarySourceCount = 0;

class SightMode {
  static DETECTION_TYPES = { SIGHT: 1 };
}
const basicSight = Object.assign(new SightMode(), {
  id: "basicSight",
  type: 1,
  testVisibility(source, mode, config) {
    testedSource = source.object.document.uuid;
    return mode.enabled && !closedDoor && config.object.document.id === "target";
  }
});
globalThis.CONFIG = { Canvas: { detectionModes: { basicSight } } };
globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY: 1, HOSTILE: -1 } };
globalThis.game = { settings: { settings: new Map() } };
globalThis.foundry = { canvas: { sources: { PointVisionSource: class {
  constructor({ object }) { this.object = object; temporarySourceCount += 1; }
  initialize(data) { this.data = data; }
  destroy() {}
} } } };

const { evaluateTriggerTargetFilter } = await import("../runtime/utils.mjs");

function fixture() {
  const level = { id: "level" };
  const scene = { tokens: { contents: [] }, levels: { get: () => level } };
  const makeToken = (id, disposition) => {
    const document = {
      id, uuid: `Scene.scene.Token.${id}`, actor: { uuid: `Actor.${id}` },
      disposition, parent: scene, level: "level", elevation: 0,
      detectionModes: { basicSight: { enabled: true, range: 100 } },
      getMovementOrigin: () => ({ elevation: 0 })
    };
    document.object = {
      document, hasSight: true,
      bounds: { width: 100, height: 100 }, center: { x: 150, y: 150 },
      _getVisionSourceData: () => ({ x: 100, y: 100, radius: 1000 })
    };
    return document;
  };
  const source = makeToken("source", 1);
  const target = makeToken("target", -1);
  scene.tokens.contents = [source, target];
  globalThis.canvas = {
    scene,
    visibility: { testVisibility: () => { gmVisibilityCalls += 1; return true; } }
  };
  const runtime = { sourceTokenUuid: source.uuid, normalizedDefinition: { targeting: { mode: "all" } } };
  const region = { parent: scene, flags: { "persistent-zones": { runtime } } };
  const evaluate = (guard = true) => evaluateTriggerTargetFilter({
    regionDocument: region, runtime, tokenDocument: target,
    triggerConfig: { targetFilter: { mode: "enemies" }, requireSourceVisibility: guard }
  });
  return { source, target, runtime, evaluate };
}

test("guard uses the cast token's source even when GM canvas sees the target", () => {
  const context = fixture();
  closedDoor = false;
  gmVisibilityCalls = 0;
  testedSource = null;
  assert.equal(context.evaluate().allowed, true);
  assert.equal(testedSource, context.source.uuid);
  assert.equal(gmVisibilityCalls, 0);
  assert.ok(temporarySourceCount > 0, "GM's uncontrolled caster receives an isolated vision source");

  closedDoor = true;
  assert.equal(context.evaluate().allowed, false);
  assert.equal(context.evaluate().reason, "source-cannot-see-target");
  closedDoor = false;
  assert.equal(context.evaluate().allowed, true);
});

test("legacy triggers and existing target categories remain unchanged", () => {
  const context = fixture();
  closedDoor = true;
  assert.equal(context.evaluate(false).allowed, true);
  context.target.disposition = 1;
  assert.equal(context.evaluate(true).allowed, false);
  assert.equal(context.evaluate(true).reason, "same-disposition");
});

test("visibility-required trigger fails closed when recorded source token is missing", () => {
  const context = fixture();
  context.runtime.sourceTokenUuid = "Scene.scene.Token.missing";
  const result = evaluateTriggerTargetFilter({
    regionDocument: { parent: globalThis.canvas.scene, flags: { "persistent-zones": { runtime: context.runtime } } },
    runtime: context.runtime,
    tokenDocument: context.target,
    triggerConfig: { targetFilter: { mode: "all" }, requireSourceVisibility: true }
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "source-token-unavailable-for-visibility");
});
