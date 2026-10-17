import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { SimulationEngine } from '../src/simulation/engine.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';
import { isValidSavedWorld } from '../src/persistence/idb.js';
import type { SavedWorldData } from '../src/types/simulation.js';

const baselinePath = 'docs/audits/data/determinism_baseline_v2.json';
const seeds = [10101, 691153, 260679] as const;
const models = [0, 1, 2] as const;

function canonical(save: SavedWorldData): string {
  const stable = { ...save };
  delete (stable as Partial<SavedWorldData>).createdTimestamp;
  delete (stable as Partial<SavedWorldData>).lastSavedTimestamp;
  return JSON.stringify(stable);
}

function assertSame(actual: SimulationEngine, expected: SimulationEngine, label: string): void {
  if (canonical(actual.serializeForStorage()) !== canonical(expected.serializeForStorage())) {
    throw new Error(`Full saved state differs: ${label}`);
  }
  if (JSON.stringify(actual.terrain.cells) !== JSON.stringify(expected.terrain.cells)) {
    throw new Error(`Terrain cells differ: ${label}`);
  }
}

const results = [];
for (const model of models) for (const seed of seeds) {
  const config = resolveEcologyConfig({ behaviorModel: model });
  const uninterrupted = new SimulationEngine(seed, config);
  const repeated = new SimulationEngine(seed, config);
  assertSame(repeated, uninterrupted, `fresh Model ${model}, seed ${seed}`);
  let restored: SimulationEngine | undefined;
  for (let tick = 1; tick <= 2000; tick++) {
    uninterrupted.step();
    repeated.step();
    if (tick === 1000) {
      const saved = structuredClone(uninterrupted.serializeForStorage());
      if (!isValidSavedWorld(saved)) throw new Error(`Invalid save: Model ${model}, seed ${seed}`);
      // The development option must be ignored when a world is restored.
      restored = new SimulationEngine(saved, undefined, { predatorEncounterPlacement: true });
      assertSame(restored, uninterrupted, `restore at tick ${tick}, Model ${model}, seed ${seed}`);
    } else if (tick > 1000) {
      restored!.step();
    }
    if (tick === 1000 || tick === 1500 || tick === 2000) {
      assertSame(repeated, uninterrupted, `fresh tick ${tick}, Model ${model}, seed ${seed}`);
      assertSame(restored!, uninterrupted, `restored tick ${tick}, Model ${model}, seed ${seed}`);
    }
  }
  const save = uninterrupted.serializeForStorage();
  results.push({ model, seed, tick: uninterrupted.tick, population: uninterrupted.organisms.length,
    sha256: createHash('sha256').update(canonical(save)).digest('hex') });
}

// Older version-2 saves can lack all ecology metadata, or just the model key.
const oldSave = new SimulationEngine(42).serializeForStorage();
const noConfig = structuredClone(oldSave);
delete noConfig.ecologyConfig;
const noModel = structuredClone(oldSave);
delete noModel.ecologyConfig?.behaviorModel;
for (const [label, save] of [['no ecology config', noConfig], ['no model key', noModel]] as const) {
  if (!isValidSavedWorld(save)) throw new Error(`Rejected old save: ${label}`);
  const restored = new SimulationEngine(save);
  if (restored.ecologyConfig.behaviorModel !== 0) throw new Error(`Wrong old save model: ${label}`);
  if (label === 'no ecology config' && restored.ecologyConfig.scavengerCarrionRange !== 1 / 1.8) {
    throw new Error('Wrong legacy carrion reach');
  }
  const explicit = structuredClone(save);
  explicit.ecologyConfig = resolveEcologyConfig(label === 'no ecology config'
    ? { behaviorModel: 0, scavengerCarrionRange: 1 / 1.8 } : { behaviorModel: 0 });
  const expected = new SimulationEngine(explicit);
  assertSame(restored, expected, `${label} initial`);
  for (let tick = 0; tick < 50; tick++) { restored.step(); expected.step(); }
  assertSame(restored, expected, `${label} continuation`);
}

const defaultWorld = new SimulationEngine(42);
const explicitModelZero = new SimulationEngine(42, { behaviorModel: 0 });
assertSame(defaultWorld, explicitModelZero, 'production default');
for (const model of [0, 2] as const) {
  const ordinary = new SimulationEngine(42, { behaviorModel: model });
  const withPlacementOption = new SimulationEngine(42, { behaviorModel: model },
    { predatorEncounterPlacement: true });
  assertSame(withPlacementOption, ordinary, `placement option Model ${model} initial`);
  for (let tick = 0; tick < 50; tick++) { ordinary.step(); withPlacementOption.step(); }
  assertSame(withPlacementOption, ordinary, `placement option Model ${model} continuation`);
}

const output = { schemaVersion: 2, sourceRevision: '054e9e1', ticks: 2000, results };
if (process.argv.includes('--generate')) {
  writeFileSync(baselinePath, `${JSON.stringify(output, null, 2)}\n`);
} else {
  const expected = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (JSON.stringify(output) !== JSON.stringify(expected)) throw new Error('Versioned baseline differs');
}
console.log(`Verified ${results.length} trajectories through 2,000 ticks, including fresh repeat and save/restore`);
