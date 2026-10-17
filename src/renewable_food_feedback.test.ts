import { describe, expect, it } from 'vitest';
import { SimulationEngine } from './simulation/engine.js';
import { estimateRenewableFood, updateCreatureBehavior } from './simulation/behavior/behavior.js';
import { createSpatialGrid } from './simulation/physics/physics.js';
import { createInitialClimate } from './simulation/terrain/climate.js';
import { PRNG } from './simulation/math/prng.js';
import { updateResourceEcosystem } from './simulation/ecosystem/ecosystem.js';
import type { OrganismState, ResourcePatch, TerrainCell, TerrainMap } from './types/simulation.js';

const cells: TerrainCell[] = Array.from({ length: 400 }, (_, index) => ({
  x: index % 20, y: Math.floor(index / 20), height: .5, moisture: .8,
  temperature: 22, rainfall: .5, fertility: 1, plantSuitability: 1,
  biome: 'grassland', isWater: false, isWalkable: true, isRiver: false, isLake: false,
}));
const terrain: TerrainMap = { width: 20, height: 20, worldWidth: 200, worldHeight: 200,
  cellSize: 10, cells };
const climate = createInitialClimate();
const source = new SimulationEngine(691153, { behaviorModel: 2 });
const founder = (diet: 'herbivore' | 'scavenger', id: string, x = 50): OrganismState => {
  const found = source.organisms.find(o => o.genome.diet === diet)!;
  return { ...structuredClone(found), id, x, y: 55, vx: 0, vy: 0, ax: 0, ay: 0,
    state: 'resting', age: 200, isMature: true, energy: 100, hydration: 100,
    reproductiveCooldown: 0, genome: { ...found.genome, sensoryRadius: 100, fertilityThreshold: 50 } };
};
const patch = (id: string, x: number, amount: number, growthRate: number,
  type: 'plant' | 'carrion' = 'plant'): ResourcePatch =>
  ({ id, x, y: 55, type, amount, maxAmount: 100, radius: 20, growthRate });

function evaluate(org: OrganismState, others: OrganismState[], patches: ResourcePatch[], map = terrain) {
  const grid = createSpatialGrid(200, 200);
  const organisms = [org, ...others];
  grid.populateOrganisms(organisms);
  grid.populateFood(patches);
  const estimate = estimateRenewableFood(org, organisms, map, grid, climate, 0, 1);
  const decisions: boolean[] = [];
  const baseline = structuredClone(organisms);
  updateCreatureBehavior(baseline, structuredClone(patches), map, grid, new PRNG(1),
    { onDecision(o, d) { if (o.id === org.id) decisions.push(d.canMate); } },
    { ...source.ecologyConfig }, undefined, true);
  const ordinary = decisions[0];
  decisions.length = 0;
  updateCreatureBehavior(structuredClone(organisms), structuredClone(patches), map, grid, new PRNG(1),
    { onDecision(o, d) { if (o.id === org.id) decisions.push(d.canMate); } },
    { ...source.ecologyConfig }, undefined, true, undefined, false,
    { climate, soilNutrients: 0, growthMultiplier: 1 });
  return { ordinary, candidate: decisions[0], ...estimate };
}

describe('renewable food mating candidate controlled layouts', () => {
  it('A: high stock with low regeneration keeps eligible food', () => {
    const result = evaluate(founder('herbivore', 'h'), [], [patch('p', 65, 70, .001)]);
    expect(result.ordinary).toBe(true);
    expect(result.candidate).toBe(true);
    expect(result.plantProduction).toBeLessThan(1);
  });
  it('B: low stock with high regeneration adds bounded production once', () => {
    const result = evaluate(founder('herbivore', 'h'), [], [patch('p', 65, 5, 2)]);
    expect(result.ordinary).toBe(false);
    expect(result.candidate).toBe(true);
    expect(result.perConsumer).toBeCloseTo(result.plantStock + result.plantProduction);
    const plant = patch('p', 65, 5, 2);
    const resources = [plant];
    let realizedGrowth = 0;
    for (let tick = 0; tick < 180; tick++) {
      const before = plant.amount;
      updateResourceEcosystem(resources, terrain, climate, 0, new PRNG(tick), 1);
      realizedGrowth += plant.amount - before;
      plant.amount = Math.max(.8, plant.amount - .2);
    }
    expect(realizedGrowth).toBeGreaterThan(16);
  });
  it('C: herbivores and scavengers share reachable plants without duplicate consumers', () => {
    const result = evaluate(founder('herbivore', 'h'), [founder('scavenger', 's')],
      [patch('p', 65, 20, 0)]);
    expect(result.plantConsumers).toBe(2);
    expect(result.ordinary).toBe(false);
    expect(result.candidate).toBe(false);
  });
  it('D: accessible carrion supports scavengers separately from scarce plants', () => {
    const result = evaluate(founder('scavenger', 's'), [founder('herbivore', 'h')],
      [patch('p', 65, 2, 0), patch('c', 65, 30, 0, 'carrion')]);
    expect(result.candidate).toBe(true);
    expect(result.carrionStock).toBe(30);
    expect(result.scavengers).toBe(1);
  });
  it('E: blocked plants and consumers do not contribute', () => {
    const blocked = { ...terrain, cells: terrain.cells.map((cell, i) =>
      i % 20 === 7 ? { ...cell, isWalkable: false, isWater: true } : cell) };
    const result = evaluate(founder('herbivore', 'h'), [founder('scavenger', 's', 95)],
      [patch('p', 95, 90, 3)], blocked);
    expect(result.plantStock).toBe(0);
    expect(result.plantProduction).toBe(0);
    expect(result.plantConsumers).toBe(1);
    expect(result.candidate).toBe(false);
  });
  it('repeats from the same seed and replays after an explicitly re-enabled save', () => {
    const a = new SimulationEngine(691153, { behaviorModel: 2 }, { renewableFoodFeedback: true });
    const b = new SimulationEngine(691153, { behaviorModel: 2 }, { renewableFoodFeedback: true });
    const canonical = (engine: SimulationEngine) => {
      const save = engine.serializeForStorage();
      delete (save as Partial<typeof save>).createdTimestamp;
      delete (save as Partial<typeof save>).lastSavedTimestamp;
      return save;
    };
    for (let tick = 0; tick < 2000; tick++) {
      a.step(); b.step();
    }
    expect(canonical(b)).toEqual(canonical(a));
    const saved = structuredClone(a.serializeForStorage());
    expect('experimentalRenewableFoodFeedback' in saved).toBe(false);
    const restored = new SimulationEngine(saved, undefined, { renewableFoodFeedback: true });
    for (let tick = 0; tick < 20; tick++) { a.step(); restored.step(); }
    expect(canonical(restored)).toEqual(canonical(a));
  }, 20000);
});
