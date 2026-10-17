import { describe, expect, it } from 'vitest';
import type { OrganismState, ResourcePatch, TerrainMap } from './types/simulation.js';
import { generateNewWorld } from './simulation/generation/worldGenerator.js';
import { PRNG } from './simulation/math/prng.js';
import { createSpatialGrid, populateSpatialGrid } from './simulation/physics/physics.js';
import { updateCreatureBehavior } from './simulation/behavior/behavior.js';
import { directRouteOpen } from './simulation/behavior/foraging.js';
import { resolveEcologyConfig } from './simulation/ecology/config.js';
import { SimulationEngine } from './simulation/engine.js';
import { isValidSavedWorld } from './persistence/idb.js';
import { updateResourceEcosystem } from './simulation/ecosystem/ecosystem.js';
import { createInitialClimate } from './simulation/terrain/climate.js';
import { SimulationProbe } from './simulation/performance/probe.js';

const config = resolveEcologyConfig({ behaviorModel: 1 });
function terrain(): TerrainMap {
  const width = 40;
  return { width, height: width, worldWidth: width * 10, worldHeight: width * 10, cellSize: 10,
    cells: Array.from({ length: width * width }, (_, index) => ({ x: index % width, y: Math.floor(index / width),
      height: .5, moisture: .8, temperature: 20, rainfall: .7, fertility: .8, plantSuitability: .8,
      biome: 'grassland' as const, isWater: false, isWalkable: true, isRiver: false, isLake: false })) };
}
function creature(diet: OrganismState['genome']['diet'], id: string, x = 100, y = 100): OrganismState {
  const world = generateNewWorld(422);
  const source = world.organisms.find(o => o.genome.diet === diet)!;
  return { ...structuredClone(source), id, x, y, energy: 35, hydration: 95, vx: 0, vy: 0, ax: 0, ay: 0,
    genome: { ...source.genome, diet, visionRange: 120, sensoryRadius: 120, speed: 2.4, maxSpeed: 2.4,
      camouflage: 0, metabolicEfficiency: 1, foodProcessingEfficiency: 1 } };
}
function patch(id: string, type: ResourcePatch['type'], x: number, y: number, amount = 50): ResourcePatch {
  return { id, type, x, y, amount, maxAmount: 80, radius: 15, growthRate: .5 };
}
function decide(organisms: OrganismState[], resources: ResourcePatch[], map: TerrainMap) {
  const grid = createSpatialGrid(map.worldWidth, map.worldHeight, 40);
  populateSpatialGrid(grid, organisms, resources);
  return updateCreatureBehavior(organisms, resources, map, grid, new PRNG(25), undefined, config);
}

describe('experimental ecological behavior', () => {
  it('indexes food once per engine tick while direct behavior calls still index it', () => {
    const engine = new SimulationEngine(691153, config);
    const probe = new SimulationProbe();
    engine.probe = probe;
    engine.step();
    expect(probe.entries['spatial.populateFood'].calls).toBe(1);

    const map = terrain();
    const org = creature('herbivore', 'direct');
    const resources = [patch('plant', 'plant', 112, 100)];
    const grid = createSpatialGrid(map.worldWidth, map.worldHeight, 40);
    grid.populateOrganisms([org]);
    updateCreatureBehavior([org], resources, map, grid, new PRNG(25), undefined, config);
    expect(org.targetId).toBe('plant');
  });
  it('A: scavenger chooses nearby plant over distant carrion and retains a profitable target', () => {
    const org = creature('scavenger', 's'); const map = terrain();
    const plant = patch('p', 'plant', 116, 100); const carrion = patch('c', 'carrion', 230, 100);
    decide([org], [plant, carrion], map);
    expect(org.targetId).toBe('p');
    decide([org], [plant, carrion], map);
    expect(org.targetId).toBe('p');
  });
  it('keeps a current food target when a slightly closer patch appears', () => {
    const org = creature('herbivore', 'h'); const map = terrain();
    const current = patch('current', 'plant', 132, 100);
    decide([org], [current], map);
    expect(org.targetId).toBe('current');
    decide([org], [current, patch('new', 'plant', 129, 100)], map);
    expect(org.targetId).toBe('current');
  });
  it('B: scavenger chooses profitable nearby carrion over a distant plant', () => {
    const org = creature('scavenger', 's'); const map = terrain();
    decide([org], [patch('p', 'plant', 185, 100), patch('c', 'carrion', 116, 100)], map);
    expect(org.targetId).toBe('c');
  });
  it('C: predator rejects a distant faster prey with negative expected return', () => {
    const predator = creature('carnivore', 'hunter'); const prey = creature('herbivore', 'fast', 185, 100);
    prey.genome.maxSpeed = 3.5; prey.genome.speed = 3.5;
    decide([predator, prey], [], terrain());
    expect(predator.targetId).not.toBe('fast');
    expect(predator.state).toBe('resting');
  });
  it('D: predator can strike and consume a nearby viable prey', () => {
    const predator = creature('carnivore', 'hunter'); const prey = creature('herbivore', 'prey', 104, 100);
    prey.health = 15; predator.energy = 25;
    const result = decide([predator, prey], [], terrain());
    expect(result.kills).toHaveLength(1);
    expect(predator.energy).toBeGreaterThan(25);
  });
  it('E: compatible predators can reproduce with local prey and stored energy', () => {
    const a = creature('carnivore', 'a'); const b = creature('carnivore', 'b', 104, 100);
    const prey = creature('herbivore', 'prey', 140, 100);
    b.speciesId = a.speciesId; a.energy = b.energy = 95;
    a.isMature = b.isMature = true; a.reproductiveCooldown = b.reproductiveCooldown = 0;
    const result = decide([a, b, prey], [], terrain());
    expect(result.reproducedParents.length).toBeGreaterThan(0);
  });
  it('well-fed predators can mate using stored energy after nearby prey leave', () => {
    const a = creature('carnivore', 'a'); const b = creature('carnivore', 'b', 104, 100);
    b.speciesId = a.speciesId; a.energy = b.energy = 95;
    a.isMature = b.isMature = true; a.reproductiveCooldown = b.reproductiveCooldown = 0;
    expect(decide([a, b], [], terrain()).reproducedParents.length).toBeGreaterThan(0);
  });
  it('F: food across unwalkable terrain is not repeatedly targeted', () => {
    const map = terrain();
    for (let y = 0; y < map.height; y++) map.cells[y * map.width + 15].isWalkable = false;
    const org = creature('herbivore', 'h'); const food = patch('blocked', 'plant', 200, 100);
    expect(directRouteOpen(map, org.x, org.y, food.x, food.y)).toBe(false);
    for (let i = 0; i < 5; i++) { decide([org], [food], map); expect(org.targetId).not.toBe(food.id); }
  });
  it('G: local resource scarcity stops reproduction despite abundant stored energy', () => {
    const a = creature('herbivore', 'a'); const b = creature('herbivore', 'b', 104, 100);
    b.speciesId = a.speciesId; a.energy = b.energy = 95;
    a.isMature = b.isMature = true; a.reproductiveCooldown = b.reproductiveCooldown = 0;
    const result = decide([a, b], [patch('poor', 'plant', 110, 100, 2)], terrain());
    expect(result.reproducedParents).toHaveLength(0);
    expect(a.energy).toBe(95);
  });
  it('H: recovered local plant biomass can permit reproduction again', () => {
    const map = terrain(); const food = patch('recovering', 'plant', 110, 100, 2);
    const climate = { ...createInitialClimate(), temperature: 20, rainfall: .8, solarRadiation: 1,
      dayCycle: .25, season: 'spring' as const };
    const rng = new PRNG(7);
    for (let i = 0; i < 900; i++) updateResourceEcosystem([food], map, climate, 120, rng);
    expect(food.amount).toBeGreaterThan(32);
    const a = creature('herbivore', 'a'); const b = creature('herbivore', 'b', 104, 100);
    b.speciesId = a.speciesId; a.energy = b.energy = 95;
    a.isMature = b.isMature = true; a.reproductiveCooldown = b.reproductiveCooldown = 0;
    expect(decide([a, b], [food], map).reproducedParents.length).toBeGreaterThan(0);
  });
  it('I: the cap blocks a birth without charging parents', () => {
    const a = creature('herbivore', 'a'); const b = creature('herbivore', 'b', 104, 100);
    b.speciesId = a.speciesId; a.energy = b.energy = 95;
    a.isMature = b.isMature = true; a.reproductiveCooldown = b.reproductiveCooldown = 0;
    const fillers = Array.from({ length: 218 }, (_, i) => ({ ...a, id: `dead_${i}`, state: 'dead' as const }));
    expect(decide([a, b, ...fillers], [patch('p', 'plant', 110, 100, 80)], terrain()).reproducedParents).toHaveLength(0);
    expect(a.energy).toBe(95); expect(b.energy).toBe(95);
  });
  it('Model 2 counts scavengers competing with herbivores for the same plants', () => {
    const run = (behaviorModel: 1 | 2) => {
      const a = creature('herbivore', 'a');
      const b = creature('herbivore', 'b', 104, 100);
      const competitor = creature('scavenger', 's', 108, 100);
      b.speciesId = a.speciesId;
      a.energy = b.energy = competitor.energy = 95;
      a.isMature = b.isMature = true;
      a.reproductiveCooldown = b.reproductiveCooldown = 0;
      const map = terrain();
      const resources = [patch('shared', 'plant', 115, 100, 40)];
      const grid = createSpatialGrid(map.worldWidth, map.worldHeight, 40);
      populateSpatialGrid(grid, [a, b, competitor], resources);
      let eligible = false;
      updateCreatureBehavior([a, b, competitor], resources, map, grid, new PRNG(25), {
        onDecision(org, observation) { if (org.id === 'a') eligible = observation.canMate; },
      }, resolveEcologyConfig({ behaviorModel }));
      return eligible;
    };
    expect(run(1)).toBe(true);
    expect(run(2)).toBe(false);
  });
  it('J: experimental behavior replays exactly after save and restore', () => {
    const original = new SimulationEngine(81234, config);
    for (let i = 0; i < 1000; i++) original.step();
    const restored = new SimulationEngine(structuredClone(original.serializeForStorage()));
    for (let i = 0; i < 1000; i++) { original.step(); restored.step(); }
    const canonical = (engine: SimulationEngine) => {
      const save = engine.serializeForStorage(); delete (save as Partial<typeof save>).lastSavedTimestamp;
      return JSON.stringify(save);
    };
    expect(canonical(restored)).toBe(canonical(original));
  });
  it('loads old version-2 ecology settings into the audited behavior model', () => {
    const save = new SimulationEngine(42).serializeForStorage();
    delete save.ecologyConfig?.behaviorModel;
    expect(isValidSavedWorld(save)).toBe(true);
    const restored = new SimulationEngine(save);
    expect(restored.ecologyConfig.behaviorModel).toBe(0);
    expect(() => resolveEcologyConfig({ behaviorModel: 3 as 2 })).toThrow();
  });
  it('persists the opt-in Model 2 setting across save and restore', () => {
    const world = new SimulationEngine(81234, resolveEcologyConfig({ behaviorModel: 2 }));
    for (let i = 0; i < 100; i++) world.step();
    const saved = structuredClone(world.serializeForStorage());
    expect(isValidSavedWorld(saved)).toBe(true);
    const restored = new SimulationEngine(saved);
    expect(restored.ecologyConfig.behaviorModel).toBe(2);
    for (let i = 0; i < 100; i++) { world.step(); restored.step(); }
    const canonical = (engine: SimulationEngine) => {
      const save = engine.serializeForStorage(); delete (save as Partial<typeof save>).lastSavedTimestamp;
      return JSON.stringify(save);
    };
    expect(canonical(restored)).toBe(canonical(world));
  });
});
