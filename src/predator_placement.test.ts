import { describe, expect, it } from 'vitest';
import { SimulationEngine } from './simulation/engine.js';
import { generateNewWorld, placePredatorFounders } from './simulation/generation/worldGenerator.js';
import { directRouteOpen } from './simulation/behavior/foraging.js';
import { checkMatingCompatibility } from './simulation/genetics/genetics.js';
import { getCellAt, isValidSpawnCell } from './simulation/terrain/terrain.js';

const seeds = [691153, 260679, 10101];
const development = { predatorEncounterPlacement: true };
const predators = (engine: SimulationEngine) => engine.organisms.filter(o => o.genome.diet === 'carnivore');

describe('development predator encounter placement', () => {
  it.each(seeds)('preserves generation state and makes valid, separated encounters for %i', seed => {
    const baseline = new SimulationEngine(seed, { behaviorModel: 1 });
    const candidate = new SimulationEngine(seed, { behaviorModel: 1 }, development);
    const before = baseline.serializeForStorage();
    const after = candidate.serializeForStorage();
    expect(after.prngState).toBe(before.prngState);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect('predatorEncounterPlacement' in after).toBe(false);
    expect(after.resources).toEqual(before.resources);
    expect(after.species).toEqual(before.species);
    expect(after.organisms).toHaveLength(before.organisms.length);
    const baselineById = new Map(before.organisms.map(o => [o.id, o]));
    for (const animal of after.organisms) {
      const original = baselineById.get(animal.id)!;
      const { x: _x, y: _y, ...other } = animal;
      const { x: _ox, y: _oy, ...originalOther } = original;
      expect(other).toEqual(originalOther);
      if (animal.genome.diet !== 'carnivore') expect([animal.x, animal.y]).toEqual([original.x, original.y]);
    }
    const hunters = predators(candidate);
    const prey = candidate.organisms.filter(o => o.genome.diet !== 'carnivore');
    expect(hunters).toHaveLength(9);
    for (const hunter of hunters) {
      const cell = getCellAt(candidate.terrain, hunter.x, hunter.y)!;
      expect(isValidSpawnCell(cell) && !cell.isFlooded).toBe(true);
      expect([[20, 0], [-20, 0], [0, 20], [0, -20]].filter(([dx, dy]) =>
        directRouteOpen(candidate.terrain, hunter.x, hunter.y, hunter.x + dx, hunter.y + dy)).length)
        .toBeGreaterThanOrEqual(3);
      expect(candidate.organisms.filter(o => o.id !== hunter.id)
        .every(o => Math.hypot(o.x - hunter.x, o.y - hunter.y) >= 20)).toBe(true);
      expect(prey.some(o => Math.hypot(o.x - hunter.x, o.y - hunter.y) <=
        hunter.genome.sensoryRadius * Math.max(.25, 1 - o.genome.camouflage * .65) &&
        directRouteOpen(candidate.terrain, hunter.x, hunter.y, o.x, o.y))).toBe(true);
      expect(hunters.some(o => o.id !== hunter.id && checkMatingCompatibility(
        { ...hunter, reproductiveCooldown: 0, energy: 100 },
        { ...o, reproductiveCooldown: 0, energy: 100 }).compatible &&
        Math.hypot(o.x - hunter.x, o.y - hunter.y) <= hunter.genome.sensoryRadius * 1.5 &&
        directRouteOpen(candidate.terrain, hunter.x, hunter.y, o.x, o.y))).toBe(true);
    }
    const repeated = new SimulationEngine(seed, { behaviorModel: 1 }, development);
    expect(predators(repeated).map(o => [o.x, o.y])).toEqual(hunters.map(o => [o.x, o.y]));
  });

  it('keeps original coordinates if there is no prey or compatible partner', () => {
    const world = generateNewWorld(10101);
    const original = world.organisms.map(o => [o.x, o.y]);
    world.organisms = world.organisms.filter(o => o.genome.diet === 'carnivore');
    expect(placePredatorFounders(world, 10101)).toBe(false);
    expect(world.organisms.map(o => [o.x, o.y])).toEqual(original.slice(-9));
    const noPartner = generateNewWorld(10101);
    const onlyPredator = noPartner.organisms.find(o => o.genome.diet === 'carnivore')!;
    noPartner.organisms = noPartner.organisms.filter(o => o.genome.diet !== 'carnivore');
    noPartner.organisms.push(onlyPredator);
    const coordinates = [onlyPredator.x, onlyPredator.y];
    expect(placePredatorFounders(noPartner, 10101)).toBe(false);
    expect([onlyPredator.x, onlyPredator.y]).toEqual(coordinates);
  });

  it('leaves Model 0 and Model 2 generation unchanged', () => {
    for (const behaviorModel of [0, 2] as const) {
      const a = new SimulationEngine(10101, { behaviorModel });
      const b = new SimulationEngine(10101, { behaviorModel }, development);
      expect(b.serializeForStorage().organisms).toEqual(a.serializeForStorage().organisms);
      expect(b.serializeForStorage().prngState).toBe(a.serializeForStorage().prngState);
    }
  });

  it('ignores the generation switch on restored Model 0, 1, and 2 worlds', () => {
    for (const behaviorModel of [0, 1, 2] as const) {
      const source = new SimulationEngine(10101, { behaviorModel });
      for (let i = 0; i < 25; i++) source.step();
      const saved = source.serializeForStorage();
      const ordinary = new SimulationEngine(structuredClone(saved));
      const withSwitch = new SimulationEngine(structuredClone(saved), undefined, development);
      for (let i = 0; i < 30; i++) { ordinary.step(); withSwitch.step(); }
      const a = ordinary.serializeForStorage(), b = withSwitch.serializeForStorage();
      b.lastSavedTimestamp = a.lastSavedTimestamp;
      expect(b).toEqual(a);
    }
  });

  it('replays exactly from a save after an actual predator birth', () => {
    const engine = new SimulationEngine(691153, { behaviorModel: 1 }, development);
    const [a, b] = predators(engine);
    const prey = engine.organisms.find(o => o.genome.diet !== 'carnivore' &&
      Math.hypot(o.x - a.x, o.y - a.y) < a.genome.sensoryRadius &&
      directRouteOpen(engine.terrain, a.x, a.y, o.x, o.y))!;
    engine.organisms = [a, b, prey];
    b.x = a.x + 2; b.y = a.y;
    for (const parent of [a, b]) {
      parent.energy = 100;
      parent.hydration = 100;
      parent.reproductiveCooldown = 0;
    }
    let births = 0;
    engine.observer = { onBirth(child) { if (child.genome.diet === 'carnivore') births++; } };
    for (let i = 0; i < 100 && births === 0; i++) engine.step();
    expect(births).toBeGreaterThan(0);
    const restored = new SimulationEngine(structuredClone(engine.serializeForStorage()), undefined, development);
    engine.observer = undefined;
    for (let i = 0; i < 30; i++) { engine.step(); restored.step(); }
    const original = engine.serializeForStorage();
    const replay = restored.serializeForStorage();
    replay.lastSavedTimestamp = original.lastSavedTimestamp;
    expect(replay).toEqual(original);
  });
});
