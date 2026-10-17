/** Paired headless ecology comparison. Usage: npx tsx scripts/ecology_behavior_benchmark.ts baseline|repair|shared_food */
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';
import { createSpatialGrid } from '../src/simulation/physics/physics.js';
import { directRouteOpen } from '../src/simulation/behavior/foraging.js';
import type { EcologyObserver } from '../src/simulation/ecology/observer.js';

const mode = process.argv[2];
if (mode !== 'baseline' && mode !== 'repair' && mode !== 'shared_food')
  throw new Error('Expected baseline, repair, or shared_food');
const outputPath = process.env.BEHAVIOR_OUTPUT ||
  (mode === 'baseline' ? 'ecology_behavior_baseline.json'
    : mode === 'repair' ? 'ecology_behavior_experiments.json' : 'ecology_shared_food_experiments.json');
const original = JSON.parse(readFileSync('benchmark_results.json', 'utf8'));
const seedCount = Number(process.env.BEHAVIOR_SEEDS || 30);
const seeds: number[] = original.all100k.results.slice(0, seedCount).map((item: { seed: number }) => item.seed);
const maxTicks = Number(process.env.BEHAVIOR_MAX_TICKS || 50000);
const checkpoints = [10000, 50000].filter(tick => tick <= maxTicks);
if (!checkpoints.length || checkpoints.at(-1) !== maxTicks) throw new Error('Use 10000 or 50000 ticks');
const config = resolveEcologyConfig({ behaviorModel: mode === 'repair' ? 1 : mode === 'shared_food' ? 2 : 0 });
const round = (n: number) => Number(n.toFixed(3));

function run(seed: number) {
  const engine = new SimulationEngine(seed, config);
  const metrics = { foodTargetStarts: 0, foodTargetSwitches: 0, foodPursuitsCompleted: 0,
    foodPursuitsAbandoned: 0, predatorStrikes: 0, predatorKills: 0, carnivoreFoodEnergy: 0,
    carnivoreMetabolicEnergy: 0, carnivoreBirths: 0, herbivoreBirths: 0, scavengerBirths: 0,
    localFoodSamples: 0, localFoodVisible: 0, localFoodReachable: 0, localFoodPatches: 0,
    plantFeedings: 0, carrionFeedings: 0, capTicks: 0, populationIntegral: 0,
    peakPopulation: engine.organisms.length };
  const pending = new Map<string, string>();
  const observer: EcologyObserver = {
    onDecision(org, item) {
      const prior = pending.get(org.id);
      if (item.action === 'food' && item.foodTargetId) {
        if (prior !== item.foodTargetId) {
          if (prior) { metrics.foodTargetSwitches++; metrics.foodPursuitsAbandoned++; }
          metrics.foodTargetStarts++;
          pending.set(org.id, item.foodTargetId);
        }
      } else if (prior) { metrics.foodPursuitsAbandoned++; pending.delete(org.id); }
    },
    onFeeding(org, type, success, gain) {
      if (type === 'prey') { metrics.predatorStrikes++; if (success) metrics.predatorKills++; }
      if (!success) return;
      if (type === 'plant') metrics.plantFeedings++;
      if (type === 'carrion') metrics.carrionFeedings++;
      if (org.genome.diet === 'carnivore') metrics.carnivoreFoodEnergy += gain;
      if (pending.delete(org.id)) metrics.foodPursuitsCompleted++;
    },
    onMetabolism(org, spent) {
      if (org.genome.diet === 'carnivore') metrics.carnivoreMetabolicEnergy += spent;
    },
    onBirth(child) {
      if (child.genome.diet === 'carnivore') metrics.carnivoreBirths++;
      if (child.genome.diet === 'herbivore') metrics.herbivoreBirths++;
      if (child.genome.diet === 'scavenger') metrics.scavengerBirths++;
    },
    onDeath(org) { pending.delete(org.id); },
  };
  engine.observer = observer;
  const grid = createSpatialGrid(engine.terrain.worldWidth, engine.terrain.worldHeight);
  const results = [];
  const start = performance.now();
  for (let tick = 1; tick <= checkpoints.at(-1)!; tick++) {
    engine.step();
    const population = engine.organisms.length;
    metrics.populationIntegral += population;
    metrics.peakPopulation = Math.max(metrics.peakPopulation, population);
    if (population >= 220) metrics.capTicks++;
    if (tick % 1000 === 0) {
      grid.populateFood(engine.resources);
      grid.populateOrganisms(engine.organisms);
      for (const org of engine.organisms) {
        metrics.localFoodSamples++;
        const plants = grid.queryFoodRadius(org.x, org.y, org.genome.sensoryRadius).filter(p => p.amount > 1.5);
        const carrion = org.genome.diet === 'scavenger'
          ? grid.queryCarrionRadius(org.x, org.y, org.genome.sensoryRadius * 1.8).filter(p => p.amount > .5) : [];
        const prey = org.genome.diet === 'carnivore'
          ? grid.queryRadius(org.x, org.y, org.genome.sensoryRadius).filter(other => other.id !== org.id &&
            other.genome.diet !== 'carnivore' && other.state !== 'dead') : [];
        const edible = org.genome.diet === 'carnivore' ? prey : [...plants, ...carrion];
        metrics.localFoodPatches += edible.length;
        if (edible.length > 0) metrics.localFoodVisible++;
        if (edible.some(target => directRouteOpen(engine.terrain, org.x, org.y, target.x, target.y)))
          metrics.localFoodReachable++;
      }
    }
    if (checkpoints.includes(tick)) {
      const roles: Record<string, number> = {};
      const species: Record<string, number> = {};
      for (const org of engine.organisms) {
        roles[org.genome.diet] = (roles[org.genome.diet] || 0) + 1;
        species[org.speciesId] = (species[org.speciesId] || 0) + 1;
      }
      results.push({ tick, elapsedSeconds: round((performance.now() - start) / 1000),
        population, meanPopulation: round(metrics.populationIntegral / tick), peakPopulation: metrics.peakPopulation,
        roles, roleCount: Object.keys(roles).length, species,
        newSpecies: engine.speciesMap.size - 4, totalBirths: engine.totalBirths, totalDeaths: engine.totalDeaths,
        plantBiomass: round(engine.resources.reduce((sum, p) => sum + (p.type === 'plant' ? p.amount : 0), 0)),
        metrics: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, round(value)])) });
    }
  }
  return { seed, checkpoints: results };
}

const fresh = { schemaVersion: 1, mode, config, environment: { node: process.version, platform: process.platform,
  arch: process.arch }, seeds, checkpoints, results: [] as ReturnType<typeof run>[] };
const output: typeof fresh = process.env.BEHAVIOR_RESUME === '1'
  ? JSON.parse(readFileSync(outputPath, 'utf8')) : fresh;
if (JSON.stringify(output.config) !== JSON.stringify(config) || JSON.stringify(output.seeds) !== JSON.stringify(seeds))
  throw new Error('Cannot resume a different configuration or seed set');
for (const seed of seeds.slice(output.results.length)) {
  output.results.push(run(seed));
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`${mode}: ${output.results.length}/${seeds.length}`);
}
