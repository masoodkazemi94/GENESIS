/** Small paired Model 1 litter screen. The development switch is never saved. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';

const seeds = [691153, 260679, 10101];
const ticks = 5000;
const round = (x: number) => Number(x.toFixed(3));
const results = [];
for (const scenario of ['A_single', 'C_litter_v1'] as const) for (const seed of seeds) {
  const engine = new SimulationEngine(seed, { behaviorModel: 1 });
  engine.experimentalReproductionVersion = scenario === 'C_litter_v1' ? 1 : 0;
  const founders = new Set(engine.organisms.map(o => o.id));
  const born = new Map<string, { diet: string; generation: number; energy: number; parentInvestment: number;
    parentPotential: number; localFood: number; mature: boolean; died: boolean }>();
  const events = new Map<string, { tick: number; parentA: string; parentB: string; diet: string;
    investment: number; offspring: number; newbornEnergy: number; parentCharges: number; overhead: number }>();
  const predator = { gained: 0, spent: 0, movement: 0, parentCharges: 0, kills: 0 };
  let capTicks = 0, peakPopulation = engine.organisms.length, minimumPrey = Infinity;
  let blockedAtCap = 0;
  engine.observer = {
    onFeeding(o, type, success, gain) {
      if (o.genome.diet !== 'carnivore') return;
      predator.gained += gain;
      if (type === 'prey' && success) predator.kills++;
    },
    onMetabolism(o, spent, costs) {
      if (o.genome.diet === 'carnivore') {
        predator.spent += spent;
        predator.movement += costs.movement;
      }
      const child = born.get(o.id);
      if (child && o.isMature) child.mature = true;
    },
    onBirth(child) {
      const a = engine.organisms.find(o => o.id === child.parentAId)!;
      const b = engine.organisms.find(o => o.id === child.parentBId)!;
      const key = `${engine.tick}:${a.id}:${b.id}`;
      let event = events.get(key);
      if (!event) {
        event = { tick: engine.tick, parentA: a.id, parentB: b.id, diet: a.genome.diet,
          investment: (a.genome.reproductiveInvestment + b.genome.reproductiveInvestment) / 2,
          offspring: 0, newbornEnergy: 0, parentCharges: 0, overhead: 0 };
        events.set(key, event);
      }
      event.offspring++;
      event.newbornEnergy += child.energy;
      const localFood = child.genome.diet === 'carnivore'
        ? engine.organisms.filter(o => o.id !== child.id && o.genome.diet !== 'carnivore' &&
          Math.hypot(o.x - child.x, o.y - child.y) <= child.genome.sensoryRadius).length * 35
        : engine.resources.filter(r => (r.type === 'plant' ||
          (child.genome.diet === 'scavenger' && r.type === 'carrion')) &&
          Math.hypot(r.x - child.x, r.y - child.y) <= child.genome.sensoryRadius)
          .reduce((sum, r) => sum + r.amount, 0);
      born.set(child.id, { diet: child.genome.diet, generation: child.generation,
        energy: child.energy, parentInvestment: (a.genome.reproductiveInvestment + b.genome.reproductiveInvestment) / 2,
        parentPotential: ((a.genome.litterPotential ?? (a.genome.reproductiveInvestment - .22) / .56) +
          (b.genome.litterPotential ?? (b.genome.reproductiveInvestment - .22) / .56)) / 2,
        localFood, mature: false, died: false });
    },
    onBirthBlocked(reason) { if (reason === 'population_cap') blockedAtCap++; },
    onDeath(o) { const child = born.get(o.id); if (child) child.died = true; },
  };
  const started = performance.now();
  for (let i = 0; i < ticks; i++) {
    engine.step();
    if (engine.organisms.length >= 220) capTicks++;
    peakPopulation = Math.max(peakPopulation, engine.organisms.length);
    minimumPrey = Math.min(minimumPrey, engine.organisms.filter(o => o.genome.diet !== 'carnivore').length);
  }
  // The transaction rule is C per parent plus six per parent per extra offspring.
  for (const event of events.values()) {
    const base = Math.round(26 + event.investment * 20);
    event.parentCharges = 2 * (base + 6 * (event.offspring - 1));
    event.overhead = event.parentCharges - event.newbornEnergy;
    if (event.diet === 'carnivore') predator.parentCharges += event.parentCharges;
  }
  const offspring = [...born.values()];
  const mature = offspring.filter(x => x.mature);
  const survivors = engine.organisms.filter(o => o.genome.diet === 'carnivore');
  const finalByDiet = Object.fromEntries(['herbivore', 'carnivore', 'scavenger', 'omnivore']
    .map(diet => [diet, engine.organisms.filter(o => o.genome.diet === diet).length]));
  const eventList = [...events.values()];
  const totalCharges = eventList.reduce((sum, x) => sum + x.parentCharges, 0);
  const newbornEnergy = eventList.reduce((sum, x) => sum + x.newbornEnergy, 0);
  const overhead = eventList.reduce((sum, x) => sum + x.overhead, 0);
  results.push({ seed, scenario, ticks, elapsedMs: round(performance.now() - started),
    predator: { ...Object.fromEntries(Object.entries(predator).map(([k, v]) => [k, round(v)])),
      netEnergy: round(predator.gained - predator.spent - predator.parentCharges),
      final: survivors.length, descendantSurvivors: survivors.filter(o => !founders.has(o.id)).length },
    matingEvents: eventList.length, offspring: offspring.length,
    offspringPerEvent: eventList.length ? round(offspring.length / eventList.length) : 0,
    matureOffspring: mature.length, survivalToMaturity: offspring.length ? round(mature.length / offspring.length) : 0,
    generation3PlusBirths: offspring.filter(x => x.generation >= 3).length,
    lowFoodOffspring: offspring.filter(x => x.localFood < 50).length,
    lowFoodMature: offspring.filter(x => x.localFood < 50 && x.mature).length,
    finalByDiet, speciesDiversity: new Set(engine.organisms.map(o => o.speciesId)).size,
    minimumPrey, capTicks, peakPopulation, blockedAtCap,
    reproductionEnergy: { parentCharges: round(totalCharges), newbornEnergy: round(newbornEnergy),
      overhead: round(overhead), ledgerTax: round(engine.energyLedger.dissipatedReproductionTax),
      ledgerDifference: round(engine.energyLedger.dissipatedReproductionTax - overhead),
      residual: round(totalCharges - newbornEnergy - overhead) },
    eventSizes: eventList.map(x => x.offspring),
    events: eventList, offspringRecords: offspring });
  console.log(scenario, seed, 'events', eventList.length, 'offspring', offspring.length,
    'mature', mature.length, 'predators', survivors.length);
}
writeFileSync('docs/audits/data/reproductive_strategy_experiments.json', JSON.stringify({
  schemaVersion: 1, seeds, ticks, scenarios: ['A_single', 'C_litter_v1'],
  method: 'Real SimulationEngine, paired Model 1 development seeds; C enables unsaved experimental reproduction version 1 only.',
  results }, null, 2));
