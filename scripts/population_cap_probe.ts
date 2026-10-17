/** Observational population-cap and local-resource audit. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';
import { createSpatialGrid } from '../src/simulation/physics/physics.js';
import { directRouteOpen } from '../src/simulation/behavior/foraging.js';
import type { EcologyObserver } from '../src/simulation/ecology/observer.js';

const seeds = [166064, 497022, 875922];
const ticks = Number(process.env.CAP_TICKS || 10000);
const sampleEvery = 500;
const round = (x: number) => Number(x.toFixed(3));
const results = [];
for (const model of [0, 1, 2] as const) for (const seed of seeds) {
  const engine = new SimulationEngine(seed, resolveEcologyConfig({ behaviorModel: model }));
  const metrics = { capTicks: 0, firstCapTick: null as number | null, blockedBirths: 0,
    births: 0, birthsAtCap: 0, juvenileDeaths: 0, totalDeaths: 0, deathsAtCap: 0,
    deathCauses: {} as Record<string, number>, deathCausesAtCap: {} as Record<string, number>,
    plantFeedings: 0, carrionFeedings: 0, activeMateDecisionsAtCap: 0,
    mateReadyAtCap: 0, mateNearbyAtCap: 0, decisionCountAtCap: 0,
    populationIntegral: 0, peakPopulation: 0, roleTicksAtCap: {} as Record<string, number>,
    sampleSeries: [] as Array<Record<string, unknown>> };
  let atCap = false;
  const observer: EcologyObserver = {
    onDecision(org, item) {
      if (!atCap) return;
      metrics.decisionCountAtCap++;
      if (item.canMate) metrics.mateReadyAtCap++;
      if (item.mateDistance !== null) metrics.mateNearbyAtCap++;
      if (item.action === 'mate') metrics.activeMateDecisionsAtCap++;
    },
    onBirth() { metrics.births++; if (atCap) metrics.birthsAtCap++; },
    onBirthBlocked(reason) { if (reason === 'population_cap') metrics.blockedBirths++; },
    onDeath(org, cause) {
      metrics.totalDeaths++;
      metrics.deathCauses[cause] = (metrics.deathCauses[cause] || 0) + 1;
      if (!org.isMature) metrics.juvenileDeaths++;
      if (atCap) {
        metrics.deathsAtCap++;
        metrics.deathCausesAtCap[cause] = (metrics.deathCausesAtCap[cause] || 0) + 1;
      }
    },
    onFeeding(_org, type, success) {
      if (!success) return;
      if (type === 'plant') metrics.plantFeedings++;
      if (type === 'carrion') metrics.carrionFeedings++;
    },
  };
  engine.observer = observer;
  const grid = createSpatialGrid(engine.terrain.worldWidth, engine.terrain.worldHeight);
  let previousPlantBiomass = engine.resources.reduce((s, r) => s + (r.type === 'plant' ? r.amount : 0), 0);
  let previousPlantInput = engine.energyLedger.solarEnergyInflow;
  const start = performance.now();
  for (let tick = 1; tick <= ticks; tick++) {
    atCap = engine.organisms.length >= 220;
    engine.step();
    const population = engine.organisms.length;
    metrics.populationIntegral += population;
    metrics.peakPopulation = Math.max(metrics.peakPopulation, population);
    if (population >= 220) {
      metrics.capTicks++;
      metrics.firstCapTick ??= tick;
      for (const org of engine.organisms)
        metrics.roleTicksAtCap[org.genome.diet] = (metrics.roleTicksAtCap[org.genome.diet] || 0) + 1;
    }
    if (tick % sampleEvery !== 0) continue;
    grid.populateFood(engine.resources);
    grid.populateOrganisms(engine.organisms);
    const roles: Record<string, number> = {};
    let accessiblePlantPerConsumerSum = 0;
    let consumerSamples = 0;
    let consumersWithoutFood = 0;
    for (const org of engine.organisms) {
      roles[org.genome.diet] = (roles[org.genome.diet] || 0) + 1;
      if (org.genome.diet === 'carnivore') continue;
      consumerSamples++;
      const neighbors = grid.queryRadius(org.x, org.y, org.genome.sensoryRadius);
      const competingConsumers = Math.max(1, neighbors.filter(o => o.genome.diet !== 'carnivore').length);
      const available = grid.queryFoodRadius(org.x, org.y, org.genome.sensoryRadius)
        .filter(p => p.amount > 1.5 && directRouteOpen(engine.terrain, org.x, org.y, p.x, p.y))
        .reduce((sum, p) => sum + p.amount, 0);
      accessiblePlantPerConsumerSum += available / competingConsumers;
      if (!available) consumersWithoutFood++;
    }
    const plantBiomass = engine.resources.reduce((s, r) => s + (r.type === 'plant' ? r.amount : 0), 0);
    const plantInputSincePreviousSample = engine.energyLedger.solarEnergyInflow - previousPlantInput;
    const plantLossSincePreviousSample = previousPlantBiomass + plantInputSincePreviousSample - plantBiomass;
    previousPlantBiomass = plantBiomass;
    previousPlantInput = engine.energyLedger.solarEnergyInflow;
    metrics.sampleSeries.push({ tick, population, roles,
      plantPatches: engine.resources.filter(r => r.type === 'plant').length,
      plantBiomass: round(plantBiomass),
      plantInputSincePreviousSample: round(plantInputSincePreviousSample),
      plantLossSincePreviousSample: round(plantLossSincePreviousSample),
      accessiblePlantPerConsumer: consumerSamples ? round(accessiblePlantPerConsumerSum / consumerSamples) : null,
      consumersWithoutFood, consumerSamples,
      blockedBirthsCumulative: metrics.blockedBirths, birthsCumulative: metrics.births,
      juvenileDeathsCumulative: metrics.juvenileDeaths });
  }
  results.push({ model, seed, ticks, elapsedMs: round(performance.now() - start),
    ...metrics, meanPopulation: round(metrics.populationIntegral / ticks) });
  writeFileSync('population_cap_diagnostics.json', JSON.stringify({ schemaVersion: 1,
    experiment: 'matched fixed seeds, unchanged ecology parameters, observational samples',
    sampleEvery, ticks, results }, null, 2));
  console.log(`cap ${model} ${seed}`);
}
