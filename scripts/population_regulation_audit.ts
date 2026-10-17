/** Bounded observational density audit using the real engine and observer hooks. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { createSpatialGrid } from '../src/simulation/physics/physics.js';
import { directRouteOpen } from '../src/simulation/behavior/foraging.js';

const seeds = [691153, 260679, 10101];
const conditions = [
  { name: 'A_model1_single', model: 1, litter: false },
  { name: 'B_model2_single', model: 2, litter: false },
  { name: 'C_model1_litter', model: 1, litter: true },
] as const;
const horizon = Number(process.env.POP_TICKS || 10000);
const selectedConditions = process.env.POP_CONDITIONS?.split(',');
const selectedSeeds = process.env.POP_SEEDS?.split(',').map(Number);
const selectedPairs = process.env.POP_PAIRS?.split(',');
const output = process.env.POP_OUTPUT || 'docs/audits/data/population_regulation_results.json';
const windowSize = 250;
const round = (n: number) => Math.round(n * 1000) / 1000;
const quantiles = (values: number[]) => {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const at = (q: number) => values[Math.floor(q * (values.length - 1))];
  return { min: round(at(0)), p10: round(at(.1)), median: round(at(.5)), p90: round(at(.9)), max: round(at(1)), mean: round(values.reduce((a, b) => a + b, 0) / values.length) };
};
const runs = [];
for (const condition of conditions) for (const seed of seeds) {
  if (selectedConditions && !selectedConditions.includes(condition.name)) continue;
  if (selectedSeeds && !selectedSeeds.includes(seed)) continue;
  if (selectedPairs && !selectedPairs.includes(`${condition.name}:${seed}`)) continue;
  const engine = new SimulationEngine(seed, { behaviorModel: condition.model });
  engine.experimentalReproductionVersion = condition.litter ? 1 : 0;
  const grid = createSpatialGrid(engine.terrain.worldWidth, engine.terrain.worldHeight);
  const born = new Map<string, { tick: number; matureTick: number | null; deathTick: number | null }>();
  const windows: Array<{ population: number; capBlocks: number; [key: string]: unknown }> = [];
  let window = { births: 0, deaths: 0, juvenileDeaths: 0, matureBirthCohort: 0, capBlocks: 0,
    eligibleDecisions: 0, decisions: 0, plantConsumed: 0, plantEnergyGained: 0, capTicks: 0,
    deathCauses: {} as Record<string, number> };
  let capTicks = 0, capStreak = 0, longestCapStreak = 0, capEpisodes = 0, peak = engine.organisms.length;
  let priorSolar = engine.energyLedger.solarEnergyInflow;
  const initialPopulation = engine.organisms.length;
  const started = performance.now();
  engine.observer = {
    onDecision(_org, d) { window.decisions++; if (d.canMate) window.eligibleDecisions++; },
    onFeeding(_org, type, success, gain, consumed) {
      if (type === 'plant' && success) { window.plantConsumed += consumed || 0; window.plantEnergyGained += gain; }
    },
    onBirth(child) { window.births++; born.set(child.id, { tick: engine.tick, matureTick: null, deathTick: null }); },
    onBirthBlocked(reason) { if (reason === 'population_cap') window.capBlocks++; },
    onDeath(org, cause) {
      window.deaths++;
      window.deathCauses[cause] = (window.deathCauses[cause] || 0) + 1;
      if (!org.isMature) window.juvenileDeaths++;
      const child = born.get(org.id); if (child) child.deathTick = engine.tick;
    },
    onMetabolism(org) {
      const child = born.get(org.id);
      if (child && child.matureTick === null && org.isMature) { child.matureTick = engine.tick; window.matureBirthCohort++; }
    },
  };
  for (let tick = 1; tick <= horizon; tick++) {
    engine.step();
    const population = engine.organisms.length;
    peak = Math.max(peak, population);
    if (population >= 220) {
      capTicks++; window.capTicks++; capStreak++;
      if (capStreak === 1) capEpisodes++;
      longestCapStreak = Math.max(longestCapStreak, capStreak);
    } else capStreak = 0;
    if (tick % windowSize) continue;
    grid.populateFood(engine.resources);
    grid.populateOrganisms(engine.organisms);
    const roles: Record<string, number> = {};
    const food: number[] = [];
    for (const org of engine.organisms) {
      roles[org.genome.diet] = (roles[org.genome.diet] || 0) + 1;
      if (org.genome.diet === 'carnivore') continue;
      const nearby = grid.queryRadius(org.x, org.y, org.genome.sensoryRadius);
      const competitors = Math.max(1, nearby.filter(o => condition.model === 2 ? o.genome.diet !== 'carnivore' : o.genome.diet === org.genome.diet).length);
      const available = grid.queryFoodRadius(org.x, org.y, org.genome.sensoryRadius)
        .filter(p => p.amount > 1.5 && directRouteOpen(engine.terrain, org.x, org.y, p.x, p.y))
        .reduce((sum, p) => sum + p.amount, 0);
      food.push(available / competitors);
    }
    const biomass = engine.resources.reduce((sum, r) => sum + (r.type === 'plant' ? r.amount : 0), 0);
    const solar = engine.energyLedger.solarEnergyInflow - priorSolar;
    priorSolar = engine.energyLedger.solarEnergyInflow;
    const priorPopulation: number = windows.length ? windows[windows.length - 1].population : initialPopulation;
    windows.push({ ...window, endTick: tick, population, populationChange: population - priorPopulation,
      growthRate: round((population - priorPopulation) / Math.max(1, priorPopulation)), roles,
      plantBiomass: round(biomass), plantProduction: round(solar), plantConsumption: round(window.plantConsumed),
      plantEnergyGained: round(window.plantEnergyGained), localFoodPerConsumer: quantiles(food),
      consumersBelow16: food.filter(x => x < 16).length, consumersSampled: food.length });
    window = { births: 0, deaths: 0, juvenileDeaths: 0, matureBirthCohort: 0, capBlocks: 0,
      eligibleDecisions: 0, decisions: 0, plantConsumed: 0, plantEnergyGained: 0, capTicks: 0, deathCauses: {} };
  }
  const offspring = [...born.values()];
  const matureObserved = offspring.filter(o => o.matureTick !== null).length;
  const diedBeforeMaturity = offspring.filter(o => o.deathTick !== null && o.matureTick === null).length;
  const censoredJuveniles = offspring.length - matureObserved - diedBeforeMaturity;
  runs.push({ condition: condition.name, seed, horizon, initialPopulation, finalPopulation: engine.organisms.length,
    peakPopulation: peak, capTicks, capEpisodes, longestCapStreak, totalBirths: offspring.length,
    matureObserved, diedBeforeMaturity, censoredJuveniles,
    juvenileSurvivalResolved: matureObserved + diedBeforeMaturity ? round(matureObserved / (matureObserved + diedBeforeMaturity)) : null,
    elapsedMs: round(performance.now() - started), windows });
  writeFileSync(output, JSON.stringify({ schemaVersion: 1,
    seeds, horizon, windowSize, method: 'Actual SimulationEngine, observer hooks; sampled food uses route-open plant biomass divided by nearby consumers; Model 2 denominator shares noncarnivores. Window production is solar ledger inflow and consumption is observed plant biomass consumed.', runs }, null, 2));
  console.log(condition.name, seed, 'final', engine.organisms.length, 'peak', peak, 'cap', capTicks,
    'blocks', windows.reduce((n, w) => n + w.capBlocks, 0), 'ms', round(performance.now() - started));
}
