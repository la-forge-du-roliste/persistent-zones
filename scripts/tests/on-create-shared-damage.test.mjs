import assert from "node:assert/strict";
import test from "node:test";

globalThis.CONST = { TOKEN_DISPOSITIONS: { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1 } };
globalThis.game = {
  settings: { settings: new Map(), get: () => "native" },
  i18n: { localize: (key) => key, format: (key) => key }
};
globalThis.canvas = { scene: null };
globalThis.ChatMessage = { getSpeaker: () => ({}) };
let rollEvaluations = 0;
let rollMessages = 0;
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; this.total = 27; }
  async evaluate() { rollEvaluations += 1; return this; }
  async toMessage() { rollMessages += 1; return this; }
};

const { applyConfiguredTriggerEffectsBatch } = await import("../runtime/entry-effects.mjs");

test("one OnCreate occurrence rolls damage once and applies the same total to every target", async () => {
  rollEvaluations = 0;
  rollMessages = 0;
  const runtime = {
    groupId: "cast",
    castLevel: 6,
    dc: 15,
    normalizedDefinition: { enabled: true, targeting: { mode: "all" }, triggers: {} }
  };
  const region = {
    id: "region", uuid: "Scene.scene.Region.region",
    flags: { "persistent-zones": { runtime } },
    getFlag: () => runtime,
    async update() {}
  };
  const applied = [];
  const tokens = ["a", "b"].map((id, index) => ({
    id, uuid: `Scene.scene.Token.${id}`, disposition: -1,
    actor: {
      uuid: `Actor.${id}`,
      statuses: new Set(),
      async rollSavingThrow() { return { total: index === 0 ? 10 : 20 }; },
      async applyDamage(entries) { applied.push({ id, value: entries[0]?.value }); }
    }
  }));
  const triggerConfig = {
    enabled: true,
    mode: "simple-effect",
    targetFilter: { mode: "all" },
    frequency: "unlimited",
    damage: {
      enabled: true, formula: "5d8", type: "force",
      scaling: { mode: "per-level", baseLevelMode: "fixed", baseLevel: 4, perLevelFormula: "1d8" }
    },
    save: { enabled: true, ability: "dex", dcMode: "auto", dc: null, onSuccess: "half" },
    simpleEffect: { damage: { enabled: true, formula: "5d8", type: "force" } }
  };
  const results = await applyConfiguredTriggerEffectsBatch({
    regionDocument: region, tokenDocuments: tokens, triggerConfig, timing: "onCreate"
  });
  assert.equal(results.every((result) => result.applied), true, JSON.stringify(results));
  assert.equal(rollEvaluations, 1);
  assert.equal(rollMessages, 1);
  assert.deepEqual(applied, [{ id: "a", value: 27 }, { id: "b", value: 13 }]);
});

test("grouped Midi OnCreate uses one multi-target workflow and lets Midi own the scaled roll", async () => {
  rollEvaluations = 0;
  rollMessages = 0;
  game.settings.get = () => "midi-qol";
  const hooks = new Map();
  globalThis.Hooks = {
    on: (name, callback) => { hooks.set(name, callback); return name; },
    off: (name) => hooks.delete(name)
  };
  let workflowCount = 0;
  let receivedTargets = [];
  let receivedFormula = null;
  globalThis.CONFIG = {
    Item: { documentClass: class {
      constructor(data) {
        receivedFormula = Object.values(data.system.activities)[0].damage.parts[0].custom.formula;
        this.system = { activities: { contents: Object.values(data.system.activities), get: (id) => data.system.activities[id] } };
      }
      prepareData() {}
      prepareFinalAttributes() {}
    } }
  };
  globalThis.foundry = { utils: { randomID: () => "batch-midi" } };
  const completeActivityUse = async (activity, usage) => {
      workflowCount += 1;
      assert.equal(usage.midiOptions.ignoreUserTargets, true);
      receivedTargets = usage.midiOptions.targetUuids;
      return { aborted: false, saves: new Set(), damageTotal: 31 };
  };
  globalThis.MidiQOL = { completeActivityUse, DamageOnlyWorkflow: class {} };
  const runtime = {
    groupId: "cast-midi", castLevel: 6, dc: 15,
    normalizedDefinition: { enabled: true, targeting: { mode: "all" }, triggers: {} }
  };
  const region = {
    id: "region-midi", uuid: "Scene.scene.Region.region-midi",
    flags: { "persistent-zones": { runtime } }, getFlag: () => runtime, async update() {}
  };
  const targets = ["a", "b", "c"].map((id) => ({
    id, uuid: `Scene.scene.Token.${id}`, disposition: -1,
    actor: { uuid: `Actor.${id}`, statuses: new Set() }
  }));
  const triggerConfig = {
    enabled: true, mode: "simple-effect", targetFilter: { mode: "all" }, frequency: "unlimited",
    damage: { enabled: true, formula: "5d8", type: "force", scaling: { mode: "per-level", baseLevelMode: "fixed", baseLevel: 4, perLevelFormula: "1d8" } },
    save: { enabled: true, ability: "dex", dcMode: "auto", dc: null, onSuccess: "half" },
    simpleEffect: { damage: { enabled: true, formula: "5d8", type: "force" } }
  };
  const results = await applyConfiguredTriggerEffectsBatch({
    regionDocument: region, tokenDocuments: targets, triggerConfig, timing: "onCreate"
  });
  assert.equal(workflowCount, 1);
  assert.deepEqual(receivedTargets, targets.map(({ uuid }) => uuid));
  assert.equal(receivedFormula, "5d8 + 1d8 + 1d8");
  assert.equal(rollEvaluations, 0);
  assert.equal(rollMessages, 0);
  assert.equal(results.length, 3);
  assert.equal(results.every((result) => result.applied), true);
  game.settings.get = () => "native";
});
