import assert from "node:assert/strict";
import test from "node:test";

globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
globalThis.game = { version: "14.367", settings: { settings: new Map(), get: () => "off" } };
globalThis.canvas = {
  scene: { id: "scene", grid: { type: 1, size: 100, distance: 5, units: "ft" } },
  grid: { type: 1, size: 100 }
};
const { collectRegionEvaluations, applyRegionEvaluation } = await import("../runtime/entry-runtime.mjs");

let serial = 0;
function fixture(mode, shape, size = 2) {
  const id = `execution-${++serial}`;
  const trigger = { enabled: true, mode: "simple", movementMode: "any", save: { enabled: true, ability: "dex", dc: 12 } };
  const runtime = { normalizedDefinition: {
    enabled: true, placement: { mode: "fixed" }, geometry: { type: shape.type },
    obstacles: { mode }, targeting: { mode: "all" },
    triggers: { onEnter: trigger, onExit: { ...trigger }, onMove: { enabled: false, mode: "none", distanceStep: 5 } }
  } };
  const region = { id, uuid: `Scene.scene.Region.${id}`, parent: canvas.scene, shapes: [shape],
    flags: { "persistent-zones": { runtime } },
    toObject() { return { shapes: this.shapes, flags: this.flags }; } };
  const token = { id, uuid: `Scene.scene.Token.${id}`, actor: { effects: [] }, width: size, height: size,
    testInsideRegion: () => true };
  const state = (x, y = 100) => ({ position: { x, y }, width: size, height: size, elevation: 0,
    center: { x: x + size * 50, y: y + size * 50 } });
  const calls = [];
  async function move(from, to, { stopped = false } = {}) {
    const options = { scene: canvas.scene, moveSource: "updateToken", movementSequenceId: `${id}-${++serial}`,
      movementMode: "voluntary", fromState: from, toState: to, pathStates: [from, to] };
    const [evaluation] = collectRegionEvaluations(token, [region], options);
    await applyRegionEvaluation(token, evaluation, { ...options,
      movementInterrupted: stopped,
      stopDecision: stopped ? { regionId: region.id, trigger: "onEnter", stopState: to } : null,
      applyEffect: async (request) => { calls.push(request); return { applied: true }; }
    });
    return evaluation;
  }
  return { move, state, calls };
}

for (const mode of ["unrestricted", "wall-restricted"]) {
  test(`${mode}: centered rectangle executes Large enter at 50%, including a consumed stop`, async () => {
    const f = fixture(mode, { type: "rectangle", x: 300, y: 200, width: 400, height: 400, anchorX: 0.5, anchorY: 0.5 });
    assert.equal((await f.move(f.state(-100), f.state(-50))).enterDetected, false);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.move(f.state(-50), f.state(0), { stopped: true })).enterDetected, true);
    assert.deepEqual(f.calls.map(c => c.timing), ["onEnter"]);
    assert.equal(f.calls[0].triggerConfig.save.enabled, true);
    await f.move(f.state(0), f.state(50));
    assert.equal(f.calls.length, 1);
    assert.equal((await f.move(f.state(50), f.state(-50))).exitDetected, true);
    assert.deepEqual(f.calls.map(c => c.timing), ["onEnter", "onExit"]);
    // An independent later movement must remain eligible beyond the existing
    // short duplicate-hook window; this test does not change its policy.
    const now = Date.now;
    Date.now = () => now() + 10000;
    try { await f.move(f.state(-50), f.state(0)); }
    finally { Date.now = now; }
    assert.deepEqual(f.calls.map(c => c.timing), ["onEnter", "onExit", "onEnter"]);
  });

  test(`${mode}: Medium circle entry executes the effect exactly once`, async () => {
    const f = fixture(mode, { type: "circle", x: 300, y: 150, radius: 150 }, 1);
    await f.move(f.state(0), f.state(250));
    await f.move(f.state(250), f.state(275));
    assert.deepEqual(f.calls.map(c => c.timing), ["onEnter"]);
  });
}
