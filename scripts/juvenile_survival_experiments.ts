/** Deterministic, unsaved lifecycle and density diagnostics. */
import { writeFileSync } from 'node:fs';
import { SimulationEngine } from '../src/simulation/engine.js';
import type { OrganismState, ResourcePatch } from '../src/types/simulation.js';

const seeds = [691153, 260679, 10101];
const reserves = { single: 58, twin: 29, triplet: 20 } as const;
const settings = ['high_food', 'moderate_food', 'low_food', 'competition', 'predator'] as const;
const round = (value: number) => Number(value.toFixed(3));
const trials = [];
for (const seed of seeds) {
  const saved = new SimulationEngine(seed, { behaviorModel: 1 }).serializeForStorage();
  const herbivore = saved.organisms.find(o => o.genome.diet === 'herbivore')!;
  const otherHerbivore = saved.organisms.find(o => o.genome.diet === 'herbivore' && o.speciesId !== herbivore.speciesId)!;
  const carnivore = saved.organisms.find(o => o.genome.diet === 'carnivore')!;
  for (const setting of settings) for (const [reserveName, initialEnergy] of Object.entries(reserves)) {
    const engine = new SimulationEngine(structuredClone(saved));
    const focal: OrganismState = { ...structuredClone(herbivore), id: 'focal', age: 0, isMature: false,
      energy: initialEnergy, health: 100, hydration: 85, reproductiveCooldown: 100,
      offspringCount: 0, bornTick: 0, vx: 0, vy: 0, ax: 0, ay: 0 };
    const patch = (id: string, x: number, y: number, amount: number, growthRate: number): ResourcePatch =>
      ({ id, x, y, type: 'plant', amount, maxAmount: 90, radius: 20, growthRate });
    engine.organisms = [focal];
    engine.resources = [{ id: 'water', x: focal.x, y: focal.y, type: 'water_spring',
      amount: 140, maxAmount: 140, radius: 18, growthRate: .85 }];
    if (setting === 'high_food') {
      for (let i = 0; i < 6; i++) engine.resources.push(patch(`plant_${i}`, focal.x + (i % 3 - 1) * 14,
        focal.y + (Math.floor(i / 3) - .5) * 14, 90, .4));
    } else if (setting === 'moderate_food') {
      engine.resources.push(patch('plant', focal.x + 12, focal.y, 25, .08));
    } else if (setting === 'competition') {
      engine.resources.push(patch('plant', focal.x + 12, focal.y, 65, .12));
      for (let i = 0; i < 12; i++) engine.organisms.push({ ...structuredClone(otherHerbivore),
        id: `competitor_${i}`, x: focal.x + (i % 4 - 1.5) * 7, y: focal.y + (Math.floor(i / 4) - 1) * 7,
        reproductiveCooldown: 2000, vx: 0, vy: 0, ax: 0, ay: 0 });
    } else if (setting === 'predator') {
      engine.resources.push(patch('plant', focal.x + 12, focal.y, 65, .12));
      engine.organisms.push({ ...structuredClone(carnivore), id: 'predator', x: focal.x + 8, y: focal.y + 8,
        energy: 25, reproductiveCooldown: 2000, vx: 0, vy: 0, ax: 0, ay: 0 });
    }
    const initialPlantIds = new Set(engine.resources.filter(r => r.type === 'plant').map(r => r.id));
    let foodGain = 0, foodConsumed = 0, foodEvents = 0, deathCause: string | null = null, maturityTick: number | null = null;
    let energyAtMaturity: number | null = null, foodConsumedAtMaturity: number | null = null;
    let lastAliveTick = 0, mateAdded = false;
    engine.observer = {
      onFeeding(o, type, success, gain, consumed) { if (o.id === 'focal' && success) {
        foodGain += gain; foodConsumed += consumed ?? 0; foodEvents++;
      } },
      onDeath(o, cause) { if (o.id === 'focal') deathCause = cause; },
      onMetabolism(o) {
        if (o.id === 'focal' && o.isMature && maturityTick === null) {
          maturityTick = engine.tick; energyAtMaturity = o.energy; foodConsumedAtMaturity = foodConsumed;
        }
      },
    };
    const horizon = 1400;
    for (let t = 0; t < horizon; t++) {
      // Remove spontaneous reseeding so each food treatment stays controlled.
      engine.resources = engine.resources.filter(r => r.type !== 'plant' || initialPlantIds.has(r.id));
      // Supply one compatible mate only after maturation to observe adult reproduction.
      if (!mateAdded && focal.isMature && focal.state !== 'dead') {
        engine.organisms.push({ ...structuredClone(herbivore), id: 'mate', x: focal.x + 4, y: focal.y + 4,
          energy: 95, hydration: 95, reproductiveCooldown: 0, vx: 0, vy: 0, ax: 0, ay: 0 });
        mateAdded = true;
      }
      engine.step();
      if (engine.organisms.some(o => o.id === 'focal')) lastAliveTick = engine.tick;
      else break;
    }
    trials.push({ seed, setting, reserveName, initialEnergy, maturityAge: focal.maturityAge,
      maturityTick, survivedToMaturity: maturityTick !== null, energyAtMaturity: energyAtMaturity === null ? null : round(energyAtMaturity),
      foodGain: round(foodGain), foodConsumed: round(foodConsumed),
      foodConsumedAtMaturity: foodConsumedAtMaturity === null ? null : round(foodConsumedAtMaturity),
      foodEvents, deathCause, lastAliveTick,
      adultOffspring: focal.offspringCount, censoredAlive: deathCause === null,
      observationLimit: horizon });
  }
}

const density = [];
for (const scenario of ['single', 'litter_v1'] as const) {
  const engine = new SimulationEngine(260679, { behaviorModel: 1 });
  engine.experimentalReproductionVersion = scenario === 'litter_v1' ? 1 : 0;
  const windows = [];
  let births = 0, deaths = 0, juvenileDeaths = 0, capBlocks = 0, mateEligible = 0, decisions = 0;
  engine.observer = {
    onBirth() { births++; },
    onDeath(o) { deaths++; if (!o.isMature) juvenileDeaths++; },
    onBirthBlocked(reason) { if (reason === 'population_cap') capBlocks++; },
    onDecision(_o, d) { decisions++; if (d.canMate) mateEligible++; },
  };
  let capTicks = 0, peakPopulation = engine.organisms.length;
  const capEpisodes: Array<{ tick: number; population: number; plantBiomass: number }> = [];
  for (let t = 1; t <= 5000; t++) {
    const solarBefore = engine.energyLedger.solarEnergyInflow;
    engine.step();
    peakPopulation = Math.max(peakPopulation, engine.organisms.length);
    if (engine.organisms.length >= 220) {
      capTicks++;
      capEpisodes.push({ tick: t, population: engine.organisms.length,
        plantBiomass: round(engine.resources.filter(r => r.type === 'plant').reduce((sum, r) => sum + r.amount, 0)) });
    }
    if (t % 100 === 0) {
      const consumers = engine.organisms.filter(o => o.genome.diet !== 'carnivore');
      const plants = engine.resources.filter(r => r.type === 'plant');
      const sample = consumers.map(o => {
        const radiusSq = o.genome.sensoryRadius ** 2;
        const food = plants.filter(p => (p.x - o.x) ** 2 + (p.y - o.y) ** 2 <= radiusSq)
          .reduce((sum, p) => sum + p.amount, 0);
        const nearby = consumers.filter(c => (c.x - o.x) ** 2 + (c.y - o.y) ** 2 <= radiusSq).length;
        return food / Math.max(1, nearby);
      });
      windows.push({ tick: t, population: engine.organisms.length,
        juvenile: engine.organisms.filter(o => !o.isMature).length,
        carnivore: engine.organisms.filter(o => o.genome.diet === 'carnivore').length,
        plantBiomass: round(plants.reduce((sum, p) => sum + p.amount, 0)),
        localPlantPerConsumerMean: sample.length ? round(sample.reduce((a, b) => a + b, 0) / sample.length) : null,
        localPlantPerConsumerBelow16: sample.filter(x => x < 16).length,
        births, deaths, adultDeaths: deaths - juvenileDeaths, juvenileDeaths, capBlocks, mateEligible, decisions,
        solarRegrowthLastTick: round(engine.energyLedger.solarEnergyInflow - solarBefore) });
      births = deaths = juvenileDeaths = capBlocks = mateEligible = decisions = 0;
    }
  }
  density.push({ scenario, seed: 260679, ticks: 5000, capTicks, peakPopulation, capEpisodes, windows });
}
writeFileSync('docs/audits/data/juvenile_survival_experiments.json', JSON.stringify({
  schemaVersion: 1, controlledSeeds: seeds, controlledModel: 1,
  controlledMethod: 'Cloned initial engine states; focal same genome, PRNG, location and environment within reserve triplets. Mate supplied after maturation. 1400-tick observation limit.',
  trials, density }, null, 2));
console.log(JSON.stringify({ trials: trials.length, density: density.map(d => ({ scenario: d.scenario, capTicks: d.capTicks,
  births: d.windows.reduce((n, w) => n + w.births, 0), capBlocks: d.windows.reduce((n, w) => n + w.capBlocks, 0) })) }));
