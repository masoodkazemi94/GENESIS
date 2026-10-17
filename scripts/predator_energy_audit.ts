/** Deterministic Model 1 hunt-stage audit on the three development seeds. */
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { directRouteOpen } from '../src/simulation/behavior/foraging.js';
import { SimulationProbe } from '../src/simulation/performance/probe.js';
import type { OrganismState } from '../src/types/simulation.js';

const seeds = [691153, 260679, 10101];
const ticks = 5000;
const round = (n: number) => Number(n.toFixed(3));
const viability = JSON.parse(readFileSync('docs/audits/data/predator_viability_experiments.json', 'utf8')) as {
  results: Array<Record<string, unknown>>;
};
const paired = viability.results.filter(r => seeds.includes(Number(r.seed)) && [0, 1, 2].includes(Number(r.model)) &&
  ['natural', 'encounter', 'hunt_return', 'basal_cost', 'pursuit_cost', 'mate_range', 'founder_cluster'].includes(String(r.scenario)))
  .map(({ lives, ...summary }) => summary);
const results = [];
for (const seed of seeds) {
  const engine = new SimulationEngine(seed, { behaviorModel: 1 });
  const probe = new SimulationProbe();
  engine.probe = probe;
  const stage = {
    predatorDecisions: 0, visible: 0, accessible: 0, visibleButBlocked: 0,
    accessibleButNoTarget: 0, selected: 0, pursued: 0, contact: 0,
    strikes: 0, missedStrikes: 0, kills: 0, abandoned: 0, targetSwitches: 0,
    hunts: 0, huntTicks: 0, startDistance: 0, lastDistance: 0, distanceClosed: 0,
    predictedCaptureEnergy: 0, predictedTravelCost: 0, predictedScore: 0,
    killEnergy: 0, theoreticalTransfer: 0, reserveLimitedEnergy: 0,
    searchingEnergySpent: 0, pursuitEnergySpent: 0, otherEnergySpent: 0,
    starvationDeaths: 0, starvationNearVisible: 0, starvationNearAccessible: 0,
    births: 0, maturedOffspring: 0, laterGenerationBirths: 0,
  };
  type Hunt = { target: string; ticks: number; start: number; last: number; predicted: number;
    cost: number; gain: number; killed: boolean };
  const active = new Map<string, Hunt>();
  const histories: Array<{ predatorId: string; targetId: string; ticks: number; startDistance: number;
    finalDistance: number; closed: number; predictedGain: number; spent: number; gained: number;
    outcome: 'kill' | 'abandoned' | 'switched' }> = [];
  const matured = new Set<string>();
  const lastVisible = new Map<string, { visible: boolean; accessible: boolean }>();
  const finish = (id: string, outcome: 'kill' | 'abandoned' | 'switched') => {
    const hunt = active.get(id);
    if (!hunt) return;
    stage.huntTicks += hunt.ticks;
    stage.startDistance += hunt.start;
    stage.lastDistance += hunt.last;
    stage.distanceClosed += hunt.start - hunt.last;
    if (outcome === 'abandoned') stage.abandoned++;
    if (outcome === 'switched') stage.targetSwitches++;
    histories.push({ predatorId: id, targetId: hunt.target, ticks: hunt.ticks,
      startDistance: round(hunt.start), finalDistance: round(hunt.last), closed: round(hunt.start - hunt.last),
      predictedGain: round(hunt.predicted), spent: round(hunt.cost), gained: round(hunt.gain), outcome });
    active.delete(id);
  };
  engine.observer = {
    onDecision(o, d) {
      if (o.genome.diet !== 'carnivore') return;
      stage.predatorDecisions++;
      const prey = engine.organisms.filter(p => p.state !== 'dead' && p.id !== o.id &&
        (p.genome.diet !== 'carnivore' || p.genome.bodySize < o.genome.bodySize * .72));
      const visible = prey.filter(p => Math.hypot(p.x - o.x, p.y - o.y) <=
        o.genome.sensoryRadius * Math.max(.25, 1 - p.genome.camouflage * .65));
      const accessible = visible.some(p => directRouteOpen(engine.terrain, o.x, o.y, p.x, p.y));
      lastVisible.set(o.id, { visible: visible.length > 0, accessible });
      if (visible.length) stage.visible++;
      if (accessible) stage.accessible++;
      if (visible.length && !accessible) stage.visibleButBlocked++;
      if (accessible && d.foodType !== 'prey') stage.accessibleButNoTarget++;
      if (d.foodType === 'prey') stage.selected++;
      const prior = active.get(o.id);
      if (d.action !== 'food' || d.foodType !== 'prey' || !d.foodTargetId) {
        if (prior) finish(o.id, 'abandoned');
        return;
      }
      const target = engine.organisms.find(p => p.id === d.foodTargetId);
      if (!target || d.foodDistance === null || d.foodContactRange === null) return;
      if (prior && prior.target !== target.id) finish(o.id, 'switched');
      let hunt = active.get(o.id);
      if (!hunt) {
        const ratio = o.genome.maxSpeed / Math.max(.1, target.genome.maxSpeed);
        const chance = Math.min(.85, Math.max(.12, .45 + (ratio - 1) * .55 -
          Math.max(0, d.foodDistance - d.foodContactRange) / (o.genome.sensoryRadius * 2)));
        const strikeDamage = 36 * o.genome.bodySize / Math.max(.1, target.genome.bodySize) *
          (1 + o.genome.aggression * .35);
        const strikesNeeded = Math.ceil(Math.max(1, target.health) / Math.max(1, strikeDamage));
        const transfer = Math.min(100 - o.energy, Math.min(target.energy * .75 + target.genome.bodySize * 20,
          55 * target.genome.bodySize) * o.genome.foodProcessingEfficiency);
        const predicted = transfer * chance / Math.sqrt(strikesNeeded);
        const travelTicks = Math.max(0, d.foodDistance - d.foodContactRange) /
          Math.max(.3, o.genome.maxSpeed * .65);
        const travelCost = travelTicks * (.022 * Math.pow(o.genome.bodySize, 1.25) +
          .042 * o.genome.speed * o.genome.bodySize) / Math.max(.3, o.genome.metabolicEfficiency);
        const hunger = Math.max(0, (100 - o.energy) / 100);
        stage.predictedCaptureEnergy += predicted;
        stage.predictedTravelCost += travelCost;
        stage.predictedScore += predicted * (.35 + .65 * hunger) - travelCost - travelTicks * .12;
        stage.hunts++;
        hunt = { target: target.id, ticks: 0, start: d.foodDistance, last: d.foodDistance,
          predicted, cost: 0, gain: 0, killed: false };
        active.set(o.id, hunt);
      }
      hunt.ticks++;
      hunt.last = d.foodDistance;
      if (d.foodDistance <= d.foodContactRange) stage.contact++;
      else stage.pursued++;
    },
    onFeeding(o, type, success, gain) {
      if (o.genome.diet !== 'carnivore' || type !== 'prey') return;
      stage.strikes++;
      if (!success) { stage.missedStrikes++; return; }
      stage.kills++;
      stage.killEnergy += gain;
      const prey = engine.organisms.find(p => p.id === active.get(o.id)?.target);
      if (prey) {
        const cap = Math.min(prey.energy * .75 + prey.genome.bodySize * 20,
          55 * prey.genome.bodySize) * o.genome.foodProcessingEfficiency;
        stage.theoreticalTransfer += cap;
        stage.reserveLimitedEnergy += Math.max(0, cap - gain);
      }
      const hunt = active.get(o.id);
      if (hunt) { hunt.gain += gain; hunt.killed = true; finish(o.id, 'kill'); }
    },
    onMetabolism(o, spent) {
      if (o.genome.diet !== 'carnivore') return;
      const hunt = active.get(o.id);
      if (hunt) { hunt.cost += spent; stage.pursuitEnergySpent += spent; }
      else if (o.state === 'wandering' || o.state === 'resting') stage.searchingEnergySpent += spent;
      else stage.otherEnergySpent += spent;
      if (o.isMature && o.generation > 1 && !matured.has(o.id)) {
        matured.add(o.id); stage.maturedOffspring++;
      }
    },
    onBirth(o) {
      if (o.genome.diet !== 'carnivore') return;
      stage.births++;
      if (o.generation >= 3) stage.laterGenerationBirths++;
    },
    onDeath(o, cause) {
      if (o.genome.diet !== 'carnivore') return;
      if (active.has(o.id)) finish(o.id, 'abandoned');
      if (cause === 'starvation') {
        stage.starvationDeaths++;
        const near = lastVisible.get(o.id);
        if (near?.visible) stage.starvationNearVisible++;
        if (near?.accessible) stage.starvationNearAccessible++;
      }
    },
  };
  const started = performance.now();
  for (let tick = 0; tick < ticks; tick++) engine.step();
  for (const id of active.keys()) finish(id, 'abandoned');
  const rejections = Object.fromEntries(Object.entries(probe.entries)
    .filter(([key]) => key.startsWith('predator.')).map(([key, value]) => [key, value.calls]));
  const initial = paired.find(r => r.seed === seed && r.model === 1 && r.scenario === 'natural')!;
  results.push({ seed, model: 1, ticks, elapsedMs: round(performance.now() - started),
    finalPredators: engine.organisms.filter(o => o.genome.diet === 'carnivore').length,
    finalPrey: engine.organisms.filter(o => o.genome.diet !== 'carnivore').length,
    stage: Object.fromEntries(Object.entries(stage).map(([key, value]) => [key, round(value)])),
    rejections, histories, viabilitySummary: initial });
  console.log(`Seed ${seed}: ${stage.hunts} hunts, ${stage.kills} kills, ${stage.births} births`);
}
writeFileSync('docs/audits/data/predator_energy_experiments.json', JSON.stringify({
  schemaVersion: 1, seeds, ticks, methods: 'Real SimulationEngine, Model 1, per-decision observation; paired intervention summaries from predator_viability_experiments.json',
  results, pairedInterventions: paired,
}, null, 2));
