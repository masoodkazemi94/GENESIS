/** Bounded, cloned Model 1 developmental screen; development sidecar is not a product save. */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SimulationEngine } from '../src/simulation/engine.js';
import type { OrganismState, ResourcePatch } from '../src/types/simulation.js';

const seeds = [691153, 260679, 10101];
const reserves = { single: 58, twin: 29, triplet: 20 } as const;
const settings = ['abundant', 'moderate', 'none', 'competition', 'predator'] as const;
const horizon = 1400;
const round = (n: number) => Number(n.toFixed(3));
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
type Scenario = 'A_single' | 'B_development' | 'C_litter' | 'D_combined';

function controlled(scenario: Scenario) {
  const trials = [];
  for (const seed of seeds) {
    const saved = new SimulationEngine(seed, { behaviorModel: 1 }).serializeForStorage();
    const herbivore = saved.organisms.find(o => o.genome.diet === 'herbivore')!;
    const competitor = saved.organisms.find(o => o.genome.diet === 'herbivore' && o.speciesId !== herbivore.speciesId)!;
    const carnivore = saved.organisms.find(o => o.genome.diet === 'carnivore')!;
    for (const setting of settings) for (const [reserve, initialEnergy] of Object.entries(reserves)) {
      const engine = new SimulationEngine(structuredClone(saved));
      engine.experimentalJuvenileDevelopment = scenario === 'B_development' || scenario === 'D_combined';
      engine.experimentalReproductionVersion = scenario === 'C_litter' || scenario === 'D_combined' ? 1 : 0;
      const focal: OrganismState = { ...structuredClone(herbivore), id: 'focal', age: 0, isMature: false,
        energy: initialEnergy, health: 100, hydration: 85, reproductiveCooldown: 100,
        offspringCount: 0, bornTick: 0, vx: 0, vy: 0, ax: 0, ay: 0 };
      const patch = (id: string, x: number, y: number, amount: number, growthRate: number): ResourcePatch =>
        ({ id, x, y, type: 'plant', amount, maxAmount: 90, radius: 20, growthRate });
      engine.organisms = [focal];
      engine.resources = [{ id: 'water', x: focal.x, y: focal.y, type: 'water_spring',
        amount: 140, maxAmount: 140, radius: 18, growthRate: .85 }];
      if (setting === 'abundant') {
        for (let i = 0; i < 6; i++) engine.resources.push(patch(`plant_${i}`, focal.x + (i % 3 - 1) * 14,
          focal.y + (Math.floor(i / 3) - .5) * 14, 90, .4));
      } else if (setting === 'moderate') engine.resources.push(patch('plant', focal.x + 12, focal.y, 25, .08));
      else if (setting === 'competition') {
        engine.resources.push(patch('plant', focal.x + 12, focal.y, 65, .12));
        for (let i = 0; i < 12; i++) engine.organisms.push({ ...structuredClone(competitor),
          id: `competitor_${i}`, x: focal.x + (i % 4 - 1.5) * 7, y: focal.y + (Math.floor(i / 4) - 1) * 7,
          reproductiveCooldown: 2000, vx: 0, vy: 0, ax: 0, ay: 0 });
      } else if (setting === 'predator') {
        engine.resources.push(patch('plant', focal.x + 12, focal.y, 65, .12));
        // Natural detection and pursuit: predator starts outside immediate contact.
        engine.organisms.push({ ...structuredClone(carnivore), id: 'predator', x: focal.x + 70, y: focal.y + 20,
          energy: 85, reproductiveCooldown: 2000, vx: 0, vy: 0, ax: 0, ay: 0 });
      }
      const plantIds = new Set(engine.resources.filter(r => r.type === 'plant').map(r => r.id));
      let foodGain = 0, foodConsumed = 0, foodEvents = 0, maturityTick: number | null = null;
      let energyAtMaturity: number | null = null, healthAtMaturity: number | null = null;
      let intakeAtMaturity: number | null = null, deathCause: string | null = null, deathTick: number | null = null;
      let firstReproduction: number | null = null, predatorDetections = 0, predatorPursuits = 0;
      let predatorKills = 0, predatorEscape = false, mateAdded = false;
      const children = new Set<string>();
      const reproductiveDescendants = new Set<string>();
      const birthEvents = new Map<string, { size: number; newbornReserve: number; parentCost: number }>();
      const childRecords = new Map<string, { birthTick: number; maturityTick: number | null;
        deathTick: number | null; firstReproduction: number | null }>();
      engine.observer = {
        onFeeding(o, food, success, gain, consumed) {
          if (o.id === 'focal' && success) { foodGain += gain; foodConsumed += consumed ?? 0; foodEvents++; }
          if (o.id === 'predator' && food === 'prey' && success) predatorKills++;
        },
        onDecision(o, d) {
          if (o.id === 'predator') {
            if (d.foodType === 'prey' && d.foodTargetId === 'focal') predatorDetections++;
            if (d.action === 'food' && d.foodTargetId === 'focal' &&
              d.foodDistance !== null && d.foodContactRange !== null &&
              d.foodDistance > d.foodContactRange) predatorPursuits++;
          }
        },
        onMetabolism(o) {
          const child = childRecords.get(o.id);
          if (child && o.isMature && child.maturityTick === null) child.maturityTick = engine.tick;
          if (o.id === 'focal' && o.isMature && maturityTick === null) {
            maturityTick = engine.tick; energyAtMaturity = o.energy; healthAtMaturity = o.health;
            intakeAtMaturity = foodGain;
          }
        },
        onBirth(child) {
          const parentA = engine.organisms.find(o => o.id === child.parentAId)!;
          const parentB = engine.organisms.find(o => o.id === child.parentBId)!;
          const eventKey = `${engine.tick}:${parentA.id}:${parentB.id}`;
          const event = birthEvents.get(eventKey) ?? { size: 0, newbornReserve: 0,
            parentCost: Math.round(26 + 10 *
              (parentA.genome.reproductiveInvestment + parentB.genome.reproductiveInvestment)) };
          event.size++;
          event.newbornReserve += child.energy;
          birthEvents.set(eventKey, event);
          if (child.parentAId === 'focal' || child.parentBId === 'focal') {
            children.add(child.id);
            childRecords.set(child.id, { birthTick: engine.tick, maturityTick: null,
              deathTick: null, firstReproduction: null });
            if (firstReproduction === null) firstReproduction = engine.tick;
          }
          for (const parentId of [child.parentAId, child.parentBId]) {
            if (parentId && children.has(parentId)) {
              reproductiveDescendants.add(parentId);
              const record = childRecords.get(parentId)!;
              if (record.firstReproduction === null) record.firstReproduction = engine.tick;
            }
          }
        },
        onDeath(o, cause) {
          if (o.id === 'focal') { deathCause = cause; deathTick = engine.tick; }
          const child = childRecords.get(o.id);
          if (child) child.deathTick = engine.tick;
        },
      };
      for (let t = 0; t < horizon; t++) {
        engine.resources = engine.resources.filter(r => r.type !== 'plant' || plantIds.has(r.id));
        if (!mateAdded && focal.isMature && focal.state !== 'dead') {
          engine.organisms.push({ ...structuredClone(herbivore), id: 'mate', x: focal.x + 4, y: focal.y + 4,
            energy: 95, hydration: 95, reproductiveCooldown: 0, vx: 0, vy: 0, ax: 0, ay: 0 });
          mateAdded = true;
        }
        engine.step();
        if (!engine.organisms.some(o => o.id === 'focal')) break;
      }
      if (setting === 'predator' && predatorDetections > 0 && deathCause !== 'predation') predatorEscape = true;
      const parentCharges = [...birthEvents.values()].reduce((sum, e) =>
        sum + 2 * e.parentCost + 12 * (e.size - 1), 0);
      const newbornReserve = [...birthEvents.values()].reduce((sum, e) => sum + e.newbornReserve, 0);
      const overhead = parentCharges - newbornReserve;
      if (Math.abs(overhead - engine.energyLedger.dissipatedReproductionTax) > 1e-6)
        throw new Error(`Reproduction energy mismatch: ${scenario} ${seed} ${setting} ${reserve}`);
      trials.push({ scenario, seed, setting, reserve, initialEnergy, maturityAge: focal.maturityAge,
        maturityTick, energyAtMaturity: energyAtMaturity === null ? null : round(energyAtMaturity),
        healthAtMaturity: healthAtMaturity === null ? null : round(healthAtMaturity),
        intakeAtMaturity: intakeAtMaturity === null ? null : round(intakeAtMaturity),
        totalIntake: round(foodGain), biomassConsumed: round(foodConsumed), feedingEvents: foodEvents,
        firstReproduction, offspring: children.size, reproductiveDescendants: reproductiveDescendants.size,
        offspringSurvivedToMaturity: [...childRecords.values()].filter(x => x.maturityTick !== null).length,
        offspringCensoredImmature: [...childRecords.values()].filter(x => x.maturityTick === null && x.deathTick === null).length,
        offspringDiedImmature: [...childRecords.values()].filter(x => x.maturityTick === null && x.deathTick !== null).length,
        offspringReproduced: [...childRecords.values()].filter(x => x.firstReproduction !== null).length,
        deathCause, deathTick, adultSurvivalAtHorizon: maturityTick !== null && deathTick === null,
        censoredAlive: deathTick === null, censoredImmature: maturityTick === null && deathTick === null,
        predatorDetections, predatorPursuits, predatorKills, predatorEscape,
        reproductionEnergy: {
        parentCharges, newbornReserve, overhead: round(overhead),
        ledgerTax: round(engine.energyLedger.dissipatedReproductionTax), residual: round(parentCharges - newbornReserve - overhead) } });
    }
  }
  return trials;
}

// Gate the combined treatment on a measured condition effect beyond merely relabelling maturity.
const a = controlled('A_single');
const b = controlled('B_development');
const meaningful = b.some((trial, i) => trial.setting !== 'none' &&
  (trial.firstReproduction !== a[i].firstReproduction || trial.deathTick !== a[i].deathTick));
const c = controlled('C_litter');
const d = meaningful ? controlled('D_combined') : [];
const replayInitial = new SimulationEngine(691153, { behaviorModel: 1 }).serializeForStorage();
function developmentEngine() {
  const engine = new SimulationEngine(structuredClone(replayInitial));
  engine.experimentalJuvenileDevelopment = true;
  return engine;
}
const uninterrupted = developmentEngine();
for (let tick = 0; tick < 600; tick++) uninterrupted.step();
const repeat = developmentEngine();
for (let tick = 0; tick < 600; tick++) repeat.step();
const partial = developmentEngine();
for (let tick = 0; tick < 300; tick++) partial.step();
const restored = new SimulationEngine(structuredClone(partial.serializeForStorage()));
restored.experimentalJuvenileDevelopment = true;
restored.experimentalJuvenileIntake = new Map(partial.experimentalJuvenileIntake);
for (let tick = 300; tick < 600; tick++) restored.step();
const stateHash = (engine: SimulationEngine) => {
  const save = engine.serializeForStorage();
  delete (save as Partial<typeof save>).createdTimestamp;
  delete (save as Partial<typeof save>).lastSavedTimestamp;
  return hash({ save, intake: [...engine.experimentalJuvenileIntake].sort(([a], [b]) => a.localeCompare(b)) });
};
const determinism = { seed: 691153, ticks: 600, restoreTick: 300,
  sameSeedRepeat: stateHash(uninterrupted) === stateHash(repeat),
  sidecarRestore: stateHash(uninterrupted) === stateHash(restored),
  finalHash: stateHash(uninterrupted), intakeEntries: uninterrupted.experimentalJuvenileIntake.size };
if (!determinism.sameSeedRepeat || !determinism.sidecarRestore) {
  console.error(determinism, { repeatHash: stateHash(repeat), restoredHash: stateHash(restored) });
  throw new Error('Development replay failed');
}
const results = { schemaVersion: 1, seeds, model: 1, horizon, reserves, settings,
  method: 'Cloned full initial Model 1 saves with identical terrain, resources, founders, RNG; focal reserve varies by branch. Mate added only after maturity. Plant reseeding removed from controlled treatments. Natural predator starts 72.8 units away. Development sidecar is unsaved.',
  combinedGate: { meaningful, criterion: 'A versus B changes first successful reproduction or death time in at least one fed controlled branch', ranCombined: meaningful },
  determinism, trials: [...a, ...b, ...c, ...d] };
writeFileSync('docs/audits/data/juvenile_investment_results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify({ meaningful, trials: results.trials.length, sha256: hash(results),
  summary: [a, b, c, d].map(group => ({ scenario: group[0]?.scenario,
    mature: group.filter(x => x.maturityTick !== null).length,
    reproduced: group.filter(x => x.firstReproduction !== null).length,
    offspring: group.reduce((s, x) => s + x.offspring, 0),
    deaths: group.filter(x => x.deathTick !== null).length })) }));
