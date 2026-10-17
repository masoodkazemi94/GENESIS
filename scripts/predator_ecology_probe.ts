/** Controlled, observational predator experiments. No ecological parameter changes. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';
import { directRouteOpen } from '../src/simulation/behavior/foraging.js';
import { checkMatingCompatibility } from '../src/simulation/genetics/genetics.js';
import { SimulationProbe } from '../src/simulation/performance/probe.js';
import type { EcologyObserver } from '../src/simulation/ecology/observer.js';

const seeds = [691153, 260679, 10101];
const ticks = Number(process.env.PREDATOR_TICKS || 5000);
const sampleEvery = 100;
const profileDecisions = process.env.PREDATOR_PROFILE === '1';
const outputPath = process.env.PREDATOR_OUTPUT || 'predator_ecology_diagnostics.json';
const models = process.env.PREDATOR_MODEL1_ONLY === '1' ? [1] as const : [0, 1] as const;
const scenarios = process.env.PREDATOR_NATURAL_ONLY === '1'
  ? ['natural'] as const : ['natural', 'prey_nearby', 'no_prey'] as const;
const round = (x: number) => Number(x.toFixed(3));
const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] || 0) + 1; };
const results = [];

for (const model of models) for (const scenario of scenarios)
  for (const seed of seeds) {
    const engine = new SimulationEngine(seed, resolveEcologyConfig({ behaviorModel: model }));
    const probe = profileDecisions ? new SimulationProbe() : undefined;
    engine.probe = probe;
    const initialPredators = engine.organisms.filter(o => o.genome.diet === 'carnivore');
    if (scenario === 'prey_nearby') {
      const herbivores = engine.organisms.filter(o => o.genome.diet === 'herbivore');
      for (let i = 0; i < Math.min(initialPredators.length, herbivores.length); i++) {
        herbivores[i].x = initialPredators[i].x;
        herbivores[i].y = initialPredators[i].y;
      }
    } else if (scenario === 'no_prey') {
      engine.organisms = initialPredators;
    }
    const metrics = {
      initialPredators: initialPredators.length, initialPrey: engine.organisms.length - initialPredators.length,
      predatorDecisions: 0, preyTargets: 0, pursuits: 0, restDecisions: 0,
      strikeAttempts: 0, kills: 0, killEnergy: 0, foodEnergy: 0,
      births: 0, deaths: {} as Record<string, number>, deathAgeSum: 0,
      energySpent: { basal: 0, movement: 0, thermal: 0, flood: 0 },
      energyByState: {} as Record<string, number>,
      preyEncounterSamples: 0, predatorSamples: 0, accessiblePreySamples: 0,
      compatibleMateSamples: 0, nearbyCompatibleMateSamples: 0,
      preyDensitySum: 0, predatorCountSum: 0,
    };
    const observer: EcologyObserver = {
      onDecision(org, item) {
        if (org.genome.diet !== 'carnivore') return;
        metrics.predatorDecisions++;
        if (item.foodType === 'prey') metrics.preyTargets++;
        if (item.action === 'food' && item.foodType === 'prey') metrics.pursuits++;
        if (item.action === 'rest') metrics.restDecisions++;
      },
      onFeeding(org, type, success, gain) {
        if (org.genome.diet !== 'carnivore') return;
        if (type === 'prey') {
          metrics.strikeAttempts++;
          if (success) { metrics.kills++; metrics.killEnergy += gain; }
        }
        metrics.foodEnergy += gain;
      },
      onMetabolism(org, spent, costs) {
        if (org.genome.diet !== 'carnivore') return;
        metrics.energySpent.basal += costs.basal;
        metrics.energySpent.movement += costs.movement;
        metrics.energySpent.thermal += costs.thermal;
        metrics.energySpent.flood += costs.flood;
        metrics.energyByState[org.state] = (metrics.energyByState[org.state] || 0) + spent;
      },
      onBirth(child) { if (child.genome.diet === 'carnivore') metrics.births++; },
      onDeath(org, cause) {
        if (org.genome.diet !== 'carnivore') return;
        bump(metrics.deaths, cause);
        metrics.deathAgeSum += org.age;
      },
    };
    engine.observer = observer;
    const start = performance.now();
    for (let tick = 1; tick <= ticks; tick++) {
      engine.step();
      if (tick % sampleEvery !== 0) continue;
      const predators = engine.organisms.filter(o => o.genome.diet === 'carnivore');
      const prey = engine.organisms.filter(o => o.genome.diet !== 'carnivore');
      metrics.predatorCountSum += predators.length;
      metrics.preyDensitySum += prey.length;
      for (const predator of predators) {
        metrics.predatorSamples++;
        const visiblePrey = prey.filter(o => Math.hypot(o.x - predator.x, o.y - predator.y) <=
          predator.genome.sensoryRadius * Math.max(.25, 1 - o.genome.camouflage * .65));
        if (visiblePrey.length) metrics.preyEncounterSamples++;
        if (visiblePrey.some(o => directRouteOpen(engine.terrain, predator.x, predator.y, o.x, o.y)))
          metrics.accessiblePreySamples++;
        const mates = predators.filter(o => o.id !== predator.id && checkMatingCompatibility(predator, o).compatible);
        if (mates.length) metrics.compatibleMateSamples++;
        if (mates.some(o => Math.hypot(o.x - predator.x, o.y - predator.y) <=
          predator.genome.sensoryRadius * engine.ecologyConfig.mateDetectionRange * (model ? 1.5 : 1) &&
          directRouteOpen(engine.terrain, predator.x, predator.y, o.x, o.y)))
          metrics.nearbyCompatibleMateSamples++;
      }
    }
    results.push({ model, scenario, seed, ticks, elapsedMs: round(performance.now() - start),
      finalPredators: engine.organisms.filter(o => o.genome.diet === 'carnivore').length,
      finalPrey: engine.organisms.filter(o => o.genome.diet !== 'carnivore').length,
      ...metrics, captureSuccessRate: metrics.strikeAttempts ? round(metrics.kills / metrics.strikeAttempts) : null,
      energyPerKill: metrics.kills ? round(metrics.killEnergy / metrics.kills) : null,
      meanDeathAge: Object.values(metrics.deaths).reduce((a,b)=>a+b,0)
        ? round(metrics.deathAgeSum / Object.values(metrics.deaths).reduce((a,b)=>a+b,0)) : null,
      rejectionCounts: probe ? Object.fromEntries(Object.entries(probe.entries)
        .filter(([key]) => key.startsWith('predator.')).map(([key, value]) => [key, value.calls])) : undefined });
    writeFileSync(outputPath, JSON.stringify({ schemaVersion: 1,
      experiment: 'fixed seeds; natural, colocated prey, and prey removal; no parameter retune',
      sampleEvery, ticks, results }, null, 2));
    console.log(`predator ${model} ${scenario} ${seed}`);
  }
