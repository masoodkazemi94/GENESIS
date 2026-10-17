/** Paired, short-horizon counterfactuals for rejected Model 1 prey. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { directRouteOpen } from '../src/simulation/behavior/foraging.js';
import type { OrganismState, SavedWorldData } from '../src/types/simulation.js';

const seeds = [691153, 260679, 10101];
const horizon = 120;
const round = (n: number) => Number(n.toFixed(3));
type Rejection = 'too_fast' | 'negative_value';
type Pair = { predator: OrganismState; prey: OrganismState; reason: Rejection; score: number; distance: number };

function candidate(engine: SimulationEngine, requested: Rejection): Pair | undefined {
  for (const predator of engine.organisms) {
    if (predator.genome.diet !== 'carnivore' || predator.energy > 74) continue;
    for (const prey of engine.organisms) {
      if (prey.id === predator.id || prey.state === 'dead' ||
        (prey.genome.diet === 'carnivore' && prey.genome.bodySize >= predator.genome.bodySize * .72)) continue;
      const distance = Math.hypot(prey.x - predator.x, prey.y - predator.y);
      const sensor = predator.genome.sensoryRadius;
      if (distance > sensor * Math.max(.25, 1 - prey.genome.camouflage * .65) ||
        !directRouteOpen(engine.terrain, predator.x, predator.y, prey.x, prey.y)) continue;
      const contact = predator.collisionRadius + prey.collisionRadius + 3.5;
      const speedRatio = predator.genome.maxSpeed / Math.max(.1, prey.genome.maxSpeed);
      if (distance > contact * 2 && speedRatio < .95) {
        if (requested === 'too_fast') return { predator, prey, reason: 'too_fast', score: NaN, distance };
        continue;
      }
      const chance = Math.min(.85, Math.max(.12, .45 + (speedRatio - 1) * .55 -
        Math.max(0, distance - contact) / (sensor * 2)));
      const damage = 36 * predator.genome.bodySize / Math.max(.1, prey.genome.bodySize) *
        (1 + predator.genome.aggression * .35);
      const strikes = Math.ceil(Math.max(1, prey.health) / Math.max(1, damage));
      const gain = Math.min(100 - predator.energy, Math.min(prey.energy * .75 + prey.genome.bodySize * 20,
        55 * prey.genome.bodySize) * predator.genome.foodProcessingEfficiency) * chance / Math.sqrt(strikes);
      const travelTicks = Math.max(0, distance - contact) / Math.max(.3, predator.genome.maxSpeed * .65);
      const travelCost = travelTicks * (.022 * Math.pow(predator.genome.bodySize, 1.25) +
        .042 * predator.genome.speed * predator.genome.bodySize) / Math.max(.3, predator.genome.metabolicEfficiency);
      const hunger = Math.max(0, (100 - predator.energy) / 100);
      const score = gain * (.35 + .65 * hunger) - travelCost - travelTicks * .12;
      if (score <= 0 && requested === 'negative_value')
        return { predator, prey, reason: 'negative_value', score, distance };
    }
  }
}

function branch(saved: SavedWorldData, predatorId: string, preyId: string, force: boolean) {
  const engine = new SimulationEngine(structuredClone(saved));
  const metrics = { gained: 0, spent: 0, movement: 0, strikes: 0, kills: 0 };
  if (force) engine.experimentalFoodOverride = (org, choice) => {
    if (org.id !== predatorId) return choice;
    const prey = engine.organisms.find(o => o.id === preyId);
    if (!prey || prey.state === 'dead') return choice;
    const distance = Math.hypot(org.x - prey.x, org.y - prey.y);
    return { x: prey.x, y: prey.y, id: prey.id, type: 'prey', entity: prey, score: 8, distance };
  };
  engine.observer = {
    onFeeding(org, type, success, gain) {
      if (org.id !== predatorId) return;
      metrics.gained += gain;
      if (type === 'prey') { metrics.strikes++; if (success) metrics.kills++; }
    },
    onMetabolism(org, spent, costs) {
      if (org.id !== predatorId) return;
      metrics.spent += spent;
      metrics.movement += costs.movement;
    },
  };
  const start = performance.now();
  for (let i = 0; i < horizon; i++) engine.step();
  return { gained: round(metrics.gained), spent: round(metrics.spent),
    movement: round(metrics.movement), strikes: metrics.strikes, kills: metrics.kills,
    net: round(metrics.gained - metrics.spent),
    predatorSurvived: engine.organisms.some(o => o.id === predatorId),
    preySurvived: engine.organisms.some(o => o.id === preyId),
    elapsedMs: round(performance.now() - start) };
}

const results = [];
for (const seed of seeds) {
  const engine = new SimulationEngine(seed, { behaviorModel: 1 });
  const counts: Record<Rejection, number> = { too_fast: 0, negative_value: 0 };
  for (let tick = 0; tick < 5000; tick++) {
    if (tick % 80 === 0) {
      for (const reason of ['too_fast', 'negative_value'] as const) {
      const pair = counts[reason] < 4 ? candidate(engine, reason) : undefined;
      if (pair) {
        const saved = engine.serializeForStorage();
        const baseline = branch(saved, pair.predator.id, pair.prey.id, false);
        const forced = branch(saved, pair.predator.id, pair.prey.id, true);
        results.push({ seed, tick, reason: pair.reason, predatorId: pair.predator.id,
          preyId: pair.prey.id, distance: round(pair.distance),
          score: Number.isNaN(pair.score) ? null : round(pair.score), baseline, forced,
          incrementalNetEnergy: round(Number(forced.net) - Number(baseline.net)),
          incrementalMovementCost: round(Number(forced.movement) - Number(baseline.movement)) });
        counts[pair.reason]++;
      }
      }
    }
    engine.step();
  }
  console.log(seed, counts);
}
writeFileSync('docs/audits/data/predator_scoring_validation.json', JSON.stringify({ schemaVersion: 1,
  seeds, baselineTicks: 5000, branchTicks: horizon, sampleEvery: 80,
  method: 'Cloned serialized Model 1 states, identical PRNG state, paired 120-tick real-engine branches; forced branch substitutes one prey target and food utility for one predator only.',
  results }, null, 2));
