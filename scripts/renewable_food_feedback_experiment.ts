/** Paired, development-only Model 2 renewable food screen. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { SimulationProbe } from '../src/simulation/performance/probe.js';
import { createSpatialGrid } from '../src/simulation/physics/physics.js';
import { estimateRenewableFood } from '../src/simulation/behavior/behavior.js';
import type { SavedWorldData } from '../src/types/simulation.js';

const seeds = [691153, 260679, 10101, 166064];
const horizon = Number(process.env.FOOD_TICKS || 10000);
const output = process.env.FOOD_OUTPUT || 'docs/audits/data/renewable_food_feedback_results.json';
const round = (n: number) => Math.round(n * 1000) / 1000;
const canonical = (save: SavedWorldData) => {
  const copy = { ...save };
  delete (copy as Partial<SavedWorldData>).createdTimestamp;
  delete (copy as Partial<SavedWorldData>).lastSavedTimestamp;
  return JSON.stringify(copy);
};
const results = [];
for (const seed of seeds) {
  const source = new SimulationEngine(seed, { behaviorModel: 2 });
  const initial = structuredClone(source.serializeForStorage());
  const initialHash = createHash('sha256').update(canonical(initial)).digest('hex');
  for (const condition of ['model2', 'renewable'] as const) {
    const engine = new SimulationEngine(structuredClone(initial), undefined,
      { renewableFoodFeedback: condition === 'renewable' });
    if (canonical(engine.serializeForStorage()) !== canonical(initial)) throw new Error('Initial state mismatch');
    const probe = new SimulationProbe();
    engine.probe = probe;
    const grid = createSpatialGrid(engine.terrain.worldWidth, engine.terrain.worldHeight);
    const births: Record<string, number> = {};
    const reproductiveDescendantIds: Record<string, Set<string>> = {};
    const deaths: Record<string, number> = {};
    const eligible: Record<string, number> = {};
    const decisions: Record<string, number> = {};
    let plantConsumed = 0, carrionConsumed = 0, capBlocks = 0, capTicks = 0, peak = engine.organisms.length;
    let extinctionTick: number | null = null;
    let restored: SimulationEngine | null = null;
    const windows: unknown[] = [];
    let priorSolar = 0, priorPlant = 0, priorEligible = 0;
    engine.observer = {
      onDecision(org, d) {
        const role = org.genome.diet;
        decisions[role] = (decisions[role] || 0) + 1;
        if (d.canMate) eligible[role] = (eligible[role] || 0) + 1;
      },
      onBirth(child) { births[child.genome.diet] = (births[child.genome.diet] || 0) + 1; },
      onBirthBlocked(reason) { if (reason === 'population_cap') capBlocks++; },
      onDeath(org) { deaths[org.genome.diet] = (deaths[org.genome.diet] || 0) + 1; },
      onFeeding(_org, food, success, _gain, consumed) {
        if (!success) return;
        if (food === 'plant') plantConsumed += consumed || 0;
        if (food === 'carrion') carrionConsumed += consumed || 0;
      },
    };
    const started = performance.now();
    for (let tick = 1; tick <= horizon; tick++) {
      engine.step();
      if (tick === 1000) {
        const saved = structuredClone(engine.serializeForStorage());
        if ('experimentalRenewableFoodFeedback' in saved) throw new Error('Development option was saved');
        restored = new SimulationEngine(saved, undefined, { renewableFoodFeedback: condition === 'renewable' });
      } else if (tick > 1000 && tick <= 1020) {
        restored!.step();
        if (tick === 1020 && canonical(restored!.serializeForStorage()) !== canonical(engine.serializeForStorage())) {
          throw new Error(`Save/replay differs: ${seed} ${condition}`);
        }
      }
      peak = Math.max(peak, engine.organisms.length);
      if (engine.organisms.length >= 220) capTicks++;
      if (!engine.organisms.length && extinctionTick === null) extinctionTick = tick;
      for (const org of engine.organisms) {
        if (org.generation > 1 && org.offspringCount > 0) {
          (reproductiveDescendantIds[org.genome.diet] ??= new Set()).add(org.id);
        }
      }
      if (tick % 250) continue;
      grid.populateOrganisms(engine.organisms);
      grid.populateFood(engine.resources);
      const roles: Record<string, number> = {};
      let reachable = 0, sampled = 0, below16 = 0;
      for (const org of engine.organisms) {
        roles[org.genome.diet] = (roles[org.genome.diet] || 0) + 1;
        if (org.genome.diet === 'carnivore') continue;
        const neighbors = grid.queryRadius(org.x, org.y, org.genome.sensoryRadius);
        const estimate = estimateRenewableFood(org, neighbors, engine.terrain, grid, engine.climate,
          engine.energyLedger.soilNutrientEnergy, engine.ecologyConfig.plantGrowth);
        reachable += estimate.plantStock / estimate.plantConsumers;
        sampled++;
        if (estimate.perConsumer < 16) below16++;
      }
      const solar = engine.energyLedger.solarEnergyInflow;
      windows.push({ tick, roles, population: engine.organisms.length,
        plantBiomass: round(engine.resources.reduce((sum, r) => sum + (r.type === 'plant' ? r.amount : 0), 0)),
        plantProduction: round(solar - priorSolar), plantConsumption: round(plantConsumed - priorPlant),
        localReachablePlantPerConsumerMean: sampled ? round(reachable / sampled) : null,
        consumersBelow16: below16, consumersSampled: sampled,
        eligibleDecisions: Object.values(eligible).reduce((a, b) => a + b, 0) - priorEligible,
        capTicks });
      priorSolar = solar; priorPlant = plantConsumed;
      priorEligible = Object.values(eligible).reduce((a, b) => a + b, 0);
    }
    const elapsedMs = performance.now() - started;
    results.push({ seed, condition, horizon, initialHash, finalPopulation: engine.organisms.length,
      finalRoles: windows.length ? (windows[windows.length - 1] as { roles: Record<string, number> }).roles : {},
      peakPopulation: peak, capTicks, capBlocks, extinctionTick, births, deaths, eligible, decisions,
      reproductiveDescendants: Object.fromEntries(Object.entries(reproductiveDescendantIds)
        .map(([role, ids]) => [role, ids.size])),
      plantProduction: round(engine.energyLedger.solarEnergyInflow),
      plantConsumption: round(plantConsumed), carrionConsumption: round(carrionConsumed),
      elapsedMs: round(elapsedMs), spatialQueries: probe.entries['spatial.queryOrganisms']?.calls || 0,
      foodQueries: probe.entries['spatial.queryFood']?.calls || 0,
      routeChecks: probe.entries['terrain.routeCheck']?.calls || 0, windows });
    writeFileSync(output, JSON.stringify({ schemaVersion: 1, seeds, horizon,
      mechanism: 'Unsaved Model 2 renewable food mating gate, 180 plus gestation ticks; no litter or placement switch',
      results }, null, 2) + '\n');
    console.log(seed, condition, 'final', engine.organisms.length, 'peak', peak,
      'cap', capTicks, 'births', Object.values(births).reduce((a, b) => a + b, 0), 'ms', round(elapsedMs));
  }
}
