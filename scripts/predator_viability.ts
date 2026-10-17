/** One-factor, deterministic predator viability probes. Run from the repository root. */
import { writeFileSync } from 'node:fs';
import { SimulationEngine } from '../src/simulation/engine.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';
import { directRouteOpen } from '../src/simulation/behavior/foraging.js';
import { checkMatingCompatibility } from '../src/simulation/genetics/genetics.js';
import type { EcologyObserver } from '../src/simulation/ecology/observer.js';
import { getCellAt } from '../src/simulation/terrain/terrain.js';
import type { OrganismState } from '../src/types/simulation.js';

const seeds = [691153, 260679, 10101];
const ticks = 5000;
const sampleEvery = 100;
const scenarios = ['natural', 'encounter', 'hunt_return', 'basal_cost', 'pursuit_cost',
  'mate_range', 'founder_cluster'] as const;
type Scenario = typeof scenarios[number];
type Life = { id: string; generation: number; bornTick: number; initialEnergy: number;
  food: number; basal: number; movement: number; thermal: number; flood: number;
  reproductionCost: number; children: number; kills: number; strikes: number;
  matureTick: number | null; deathTick: number | null; deathCause: string | null;
  finalEnergy: number | null };
const round = (n: number) => Number(n.toFixed(3));
const results = [];

for (const model of [0, 1, 2] as const) for (const scenario of scenarios) {
  if (model === 0 && scenario !== 'natural') continue;
  for (const seed of seeds) {
    const config = resolveEcologyConfig({ behaviorModel: model,
      ...(scenario === 'basal_cost' ? { metabolicCost: .7 } : {}),
      ...(scenario === 'pursuit_cost' ? { predatorPursuitCost: .7 } : {}),
      ...(scenario === 'mate_range' ? { mateDetectionRange: 2 } : {}) });
    const engine = new SimulationEngine(seed, config);
    const founders = engine.organisms.filter(o => o.genome.diet === 'carnivore');
    const founderIds = new Set(founders.map(o => o.id));
    const prey = engine.organisms.filter(o => o.genome.diet !== 'carnivore');
    const initialPrey = prey.length;
    if (scenario === 'hunt_return') {
      // Predator-only assimilation trait; no prey or resource parameter is changed.
      for (const predator of founders) predator.genome = { ...predator.genome,
        foodProcessingEfficiency: predator.genome.foodProcessingEfficiency * 1.3 };
    }
    if (scenario === 'encounter') {
      // Move three existing prey near each founder without creating food or changing traits.
      let index = 0;
      for (const predator of founders) for (let n = 0; n < 3 && index < prey.length; n++) {
        const candidate = prey[index++];
        for (const [dx, dy] of [[18, 0], [0, 18], [-18, 0], [0, -18]]) {
          const x = predator.x + dx, y = predator.y + dy;
          const cell = getCellAt(engine.terrain, x, y);
          if (cell?.isWalkable && !cell.isLake && !cell.isFlooded &&
              directRouteOpen(engine.terrain, predator.x, predator.y, x, y)) {
            candidate.x = x; candidate.y = y; break;
          }
        }
      }
    }
    if (scenario === 'founder_cluster') {
      // Place existing founders around one valid founder location, preserving prey positions.
      const anchor = founders[0];
      for (let i = 1; i < founders.length; i++) {
        const angle = 2 * Math.PI * i / founders.length;
        for (const radius of [18, 12, 6]) {
          const x = anchor.x + Math.cos(angle) * radius;
          const y = anchor.y + Math.sin(angle) * radius;
          const cell = getCellAt(engine.terrain, x, y);
          if (cell?.isWalkable && !cell.isLake && !cell.isFlooded &&
              directRouteOpen(engine.terrain, anchor.x, anchor.y, x, y)) {
            founders[i].x = x; founders[i].y = y; break;
          }
        }
      }
    }

    const lives = new Map<string, Life>();
    const register = (o: OrganismState) => {
      const life: Life = { id: o.id, generation: o.generation, bornTick: o.bornTick,
        initialEnergy: o.energy, food: 0, basal: 0, movement: 0, thermal: 0, flood: 0,
        reproductionCost: 0, children: 0, kills: 0, strikes: 0,
        matureTick: o.isMature ? 0 : null, deathTick: null, deathCause: null,
        finalEnergy: null };
      lives.set(o.id, life);
      return life;
    };
    for (const founder of founders) register(founder);
    const decisions = { visiblePrey: 0, accessiblePrey: 0, predatorSamples: 0,
      compatibleMate: 0, reachableMate: 0, eligibleMateDecisions: 0,
      preyTargets: 0, preyPursuits: 0, mateActions: 0 };
    const observer: EcologyObserver = {
      onDecision(o, d) {
        if (o.genome.diet !== 'carnivore') return;
        if (d.canMate) decisions.eligibleMateDecisions++;
        if (d.foodType === 'prey') decisions.preyTargets++;
        if (d.action === 'food' && d.foodType === 'prey') decisions.preyPursuits++;
        if (d.action === 'mate') decisions.mateActions++;
      },
      onFeeding(o, type, success, gain) {
        if (o.genome.diet !== 'carnivore') return;
        const life = lives.get(o.id)!;
        life.food += gain;
        if (type === 'prey') { life.strikes++; if (success) life.kills++; }
      },
      onMetabolism(o, _spent, costs) {
        if (o.genome.diet !== 'carnivore') return;
        const life = lives.get(o.id)!;
        life.basal += costs.basal; life.movement += costs.movement;
        life.thermal += costs.thermal; life.flood += costs.flood;
        if (life.matureTick === null && o.isMature) life.matureTick = engine.tick;
      },
      onBirth(child) {
        if (child.genome.diet !== 'carnivore') return;
        register(child);
        for (const parentId of [child.parentAId, child.parentBId]) {
          const parent = parentId && lives.get(parentId);
          if (!parent) continue;
          parent.children++;
          const mate = engine.organisms.find(o => o.id === (parentId === child.parentAId
            ? child.parentBId : child.parentAId));
          const self = engine.organisms.find(o => o.id === parentId);
          if (self && mate) parent.reproductionCost += Math.round(26 +
            (self.genome.reproductiveInvestment + mate.genome.reproductiveInvestment) * 10);
        }
      },
      onDeath(o, cause) {
        if (o.genome.diet !== 'carnivore') return;
        const life = lives.get(o.id)!;
        life.deathTick = engine.tick; life.deathCause = cause; life.finalEnergy = o.energy;
      },
    };
    engine.observer = observer;
    for (let tick = 1; tick <= ticks; tick++) {
      engine.step();
      if (tick % sampleEvery !== 0) continue;
      const predators = engine.organisms.filter(o => o.genome.diet === 'carnivore');
      const availablePrey = engine.organisms.filter(o => o.genome.diet !== 'carnivore');
      for (const predator of predators) {
        decisions.predatorSamples++;
        const visible = availablePrey.filter(o => Math.hypot(o.x - predator.x, o.y - predator.y) <=
          predator.genome.sensoryRadius * Math.max(.25, 1 - o.genome.camouflage * .65));
        if (visible.length) decisions.visiblePrey++;
        if (visible.some(o => directRouteOpen(engine.terrain, predator.x, predator.y, o.x, o.y)))
          decisions.accessiblePrey++;
        const mates = predators.filter(o => o.id !== predator.id &&
          checkMatingCompatibility(predator, o).compatible);
        if (mates.length) decisions.compatibleMate++;
        if (mates.some(o => Math.hypot(o.x - predator.x, o.y - predator.y) <=
          predator.genome.sensoryRadius * config.mateDetectionRange * (model ? 1.5 : 1) &&
          directRouteOpen(engine.terrain, predator.x, predator.y, o.x, o.y))) decisions.reachableMate++;
      }
    }
    const predators = engine.organisms.filter(o => o.genome.diet === 'carnivore');
    for (const o of predators) lives.get(o.id)!.finalEnergy = o.energy;
    const all = [...lives.values()];
    const sum = (key: keyof Life) => round(all.reduce((n, life) => n + Number(life[key] || 0), 0));
    const births = all.filter(life => !founderIds.has(life.id));
    results.push({ model, scenario, seed, ticks, initialPredators: founders.length, initialPrey,
      finalPredators: predators.length, finalPrey: engine.organisms.length - predators.length,
      births: births.length, matureOffspring: births.filter(life => life.matureTick !== null).length,
      survivingOffspring: births.filter(life => life.deathTick === null).length,
      generation2Births: births.filter(life => life.generation >= 3).length,
      kills: sum('kills'), strikes: sum('strikes'), foodEnergy: sum('food'), basalSpent: sum('basal'),
      movementSpent: sum('movement'), thermalSpent: sum('thermal'), floodSpent: sum('flood'),
      reproductionCost: sum('reproductionCost'), deaths: all.filter(l => l.deathTick !== null).length,
      deathsByCause: Object.fromEntries([...new Set(all.map(l => l.deathCause).filter(Boolean))].map(c =>
        [c, all.filter(l => l.deathCause === c).length])),
      decisions, lives: all.map(l => ({ ...l, food: round(l.food), basal: round(l.basal),
        movement: round(l.movement), thermal: round(l.thermal), flood: round(l.flood),
        energyResidual: round(l.initialEnergy + l.food - l.basal - l.movement - l.thermal -
          l.flood - l.reproductionCost - (l.finalEnergy ?? 0)) })) });
  }
}
writeFileSync('docs/audits/data/predator_viability_experiments.json', JSON.stringify({
  schemaVersion: 1, seeds, ticks, sampleEvery,
  scenarios: { natural: 'unmodified', encounter: 'three existing prey moved near each founder',
    hunt_return: 'founder predator food processing efficiency x1.3',
    basal_cost: 'metabolicCost x0.7 for all organisms',
    pursuit_cost: 'predatorPursuitCost x0.7 for hunting movement',
    mate_range: 'mateDetectionRange x2 for all organisms',
    founder_cluster: 'existing founder predators placed around first founder' }, results
}, null, 2));
console.log(`Completed ${results.length} deterministic runs.`);
