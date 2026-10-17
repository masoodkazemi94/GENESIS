/** Paired, bounded Model 1 founder-placement screen. Run from the repository root. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { directRouteOpen } from '../src/simulation/behavior/foraging.js';
import { checkMatingCompatibility } from '../src/simulation/genetics/genetics.js';
import type { OrganismState } from '../src/types/simulation.js';

const seeds = [691153, 260679, 10101];
const ticks = 5000;
const sampleEvery = 100;
const round = (n: number) => Number(n.toFixed(3));
const results = [];

for (const seed of seeds) {
  const baseline = new SimulationEngine(seed, { behaviorModel: 1 });
  const candidate = new SimulationEngine(seed, { behaviorModel: 1 }, { predatorEncounterPlacement: true });
  const initialA = baseline.serializeForStorage();
  const initialB = candidate.serializeForStorage();
  assert.deepEqual(initialA.resources, initialB.resources);
  assert.deepEqual(initialA.species, initialB.species);
  assert.equal(initialA.prngState, initialB.prngState);
  assert.equal(initialA.organisms.length, initialB.organisms.length);
  let moved = 0;
  for (let i = 0; i < initialA.organisms.length; i++) {
    const a = initialA.organisms[i], b = initialB.organisms[i];
    const { x: _ax, y: _ay, ...restA } = a;
    const { x: _bx, y: _by, ...restB } = b;
    assert.deepEqual(restA, restB);
    if (a.x !== b.x || a.y !== b.y) {
      assert.equal(a.genome.diet, 'carnivore');
      moved++;
    }
  }
  for (const [scenario, engine] of [['baseline', baseline], ['candidate', candidate]] as const) {
    const initialRoles = { herbivore: 42, scavenger: 15, carnivore: 9 };
    const founderIds = new Set(engine.organisms.map(o => o.id));
    const descendants = new Map<string, { generation: number; born: number; mature: boolean; alive: boolean; reproduced: boolean }>();
    const measurements = { predatorSamples: 0, accessiblePrey: 0, reachableCompatibleMate: 0,
      kills: 0, predatorFoodEnergy: 0, predatorMetabolicExpenditure: 0, predatorBirths: 0,
      generation3PlusBirths: 0, herbivoreDeaths: 0, scavengerDeaths: 0, preyPredationDeaths: 0,
      capTicks: 0, capBlockedBirths: 0, minimumPrey: 57 };
    let replay: { birthTick: number; identical: boolean } | null = null;
    engine.observer = {
      onFeeding(o, food, success, gain) {
        if (o.genome.diet !== 'carnivore') return;
        measurements.predatorFoodEnergy += gain;
        if (food === 'prey' && success) measurements.kills++;
      },
      onMetabolism(o, spent) {
        if (o.genome.diet !== 'carnivore') return;
        measurements.predatorMetabolicExpenditure += spent;
        const descendant = descendants.get(o.id);
        if (descendant && o.isMature) descendant.mature = true;
      },
      onBirth(o) {
        if (o.genome.diet !== 'carnivore') return;
        measurements.predatorBirths++;
        if (o.generation >= 3) measurements.generation3PlusBirths++;
        descendants.set(o.id, { generation: o.generation, born: engine.tick,
          mature: o.isMature, alive: true, reproduced: false });
        for (const parentId of [o.parentAId, o.parentBId]) {
          if (parentId && descendants.has(parentId)) descendants.get(parentId)!.reproduced = true;
        }
      },
      onDeath(o, cause) {
        if (o.genome.diet === 'herbivore') measurements.herbivoreDeaths++;
        if (o.genome.diet === 'scavenger') measurements.scavengerDeaths++;
        if (o.genome.diet !== 'carnivore' && cause === 'predation') measurements.preyPredationDeaths++;
        if (descendants.has(o.id)) descendants.get(o.id)!.alive = false;
      },
      onBirthBlocked(reason) { if (reason === 'population_cap') measurements.capBlockedBirths++; },
    };
    const snapshots: { tick: number; herbivore: number; scavenger: number; carnivore: number; prey: number }[] = [];
    const start = performance.now();
    for (let tick = 1; tick <= ticks; tick++) {
      engine.step();
      if (engine.organisms.length >= 220) measurements.capTicks++;
      if (scenario === 'candidate' && replay === null && measurements.predatorBirths > 0) {
        const saved = structuredClone(engine.serializeForStorage());
        const a = new SimulationEngine(structuredClone(saved));
        const b = new SimulationEngine(structuredClone(saved), undefined, { predatorEncounterPlacement: true });
        for (let i = 0; i < 20; i++) { a.step(); b.step(); }
        const stateA = a.serializeForStorage(), stateB = b.serializeForStorage();
        stateA.lastSavedTimestamp = stateB.lastSavedTimestamp;
        replay = { birthTick: tick, identical: JSON.stringify(stateA) === JSON.stringify(stateB) };
        assert.equal(replay.identical, true);
      }
      if (tick % sampleEvery !== 0) continue;
      const hunters = engine.organisms.filter(o => o.genome.diet === 'carnivore');
      const prey = engine.organisms.filter(o => o.genome.diet !== 'carnivore');
      measurements.minimumPrey = Math.min(measurements.minimumPrey, prey.length);
      for (const hunter of hunters) {
        measurements.predatorSamples++;
        if (prey.some(o => Math.hypot(o.x - hunter.x, o.y - hunter.y) <=
          hunter.genome.sensoryRadius * Math.max(.25, 1 - o.genome.camouflage * .65) &&
          directRouteOpen(engine.terrain, hunter.x, hunter.y, o.x, o.y))) measurements.accessiblePrey++;
        if (hunters.some(o => o.id !== hunter.id && checkMatingCompatibility(
          { ...hunter, reproductiveCooldown: 0, energy: 100 },
          { ...o, reproductiveCooldown: 0, energy: 100 }).compatible &&
          Math.hypot(o.x - hunter.x, o.y - hunter.y) <= hunter.genome.sensoryRadius * 1.5 &&
          directRouteOpen(engine.terrain, hunter.x, hunter.y, o.x, o.y)))
          measurements.reachableCompatibleMate++;
      }
      if (tick % 500 === 0) snapshots.push({ tick,
        herbivore: prey.filter(o => o.genome.diet === 'herbivore').length,
        scavenger: prey.filter(o => o.genome.diet === 'scavenger').length,
        carnivore: hunters.length, prey: prey.length });
    }
    const runtimeMs = round(performance.now() - start);
    const last = snapshots.at(-1)!;
    const offspring = [...descendants.values()];
    const founderSurvivors = { herbivore: 0, scavenger: 0, carnivore: 0 };
    for (const o of engine.organisms) {
      if (founderIds.has(o.id) && o.genome.diet in founderSurvivors) {
        founderSurvivors[o.genome.diet as keyof typeof founderSurvivors]++;
      }
    }
    results.push({ seed, scenario, movedPredators: scenario === 'candidate' ? moved : 0,
      initialRoles, initialPrngState: initialA.prngState,
      ...Object.fromEntries(Object.entries(measurements).map(([k, v]) => [k,
        k.includes('Energy') || k.includes('Expenditure') ? round(v) : v])),
      predatorNetEnergy: round(measurements.predatorFoodEnergy - measurements.predatorMetabolicExpenditure),
      accessiblePreyFraction: round(measurements.accessiblePrey / Math.max(1, measurements.predatorSamples)),
      reachableMateFraction: round(measurements.reachableCompatibleMate / Math.max(1, measurements.predatorSamples)),
      offspringMature: offspring.filter(o => o.mature).length,
      offspringReproduced: offspring.filter(o => o.reproduced).length,
      descendantsAlive: offspring.filter(o => o.alive).length,
      offspringCensoredBeforeMaturity: offspring.filter(o => o.alive && !o.mature).length,
      founderSurvivors,
      finalRoles: { herbivore: last.herbivore, scavenger: last.scavenger, carnivore: last.carnivore },
      finalPrey: last.prey, preyDepletionFromInitial: 57 - last.prey,
      snapshots, runtimeMs, postBirthReplay: replay });
    console.log(seed, scenario, `births=${measurements.predatorBirths}`, `net=${round(measurements.predatorFoodEnergy - measurements.predatorMetabolicExpenditure)}`, `runtime=${runtimeMs}ms`);
  }
}
writeFileSync('docs/audits/data/predator_placement_results.json', JSON.stringify({
  schemaVersion: 1, seeds, ticks, sampleEvery,
  comparison: 'Model 1 ordinary generation vs Model 1 predator-coordinate-only placement',
  measurementNotes: 'Accessible prey and reachable structurally compatible mates sampled every 100 ticks per living predator; transient cooldown and reserve normalized for mate compatibility. Net energy is feeding gain minus all predator metabolism. Offspring alive at 5000 include immature censored offspring. Runtime includes observer and sampling overhead; candidate runs with births also include a 20-tick replay check.',
  results,
}, null, 2));
