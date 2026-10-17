/** Small parameter perturbations for ecological sensitivity; run with tsx. */
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';

const baseline = JSON.parse(readFileSync('benchmark_results.json','utf8'));
const seeds: number[] = baseline.results.slice(0,20).map((row: {seed:number}) => row.seed);
type ScenarioRow = { seed: number; final: number; peak: number; firstZero: number | null;
  herbivores: number; carnivores: number; scavengers: number; births: number;
  deaths: number; plantBiomass: number; invalid: boolean };
const scenarios = [
  { name: 'production', apply: (_engine: SimulationEngine) => {} },
  { name: 'no_disasters', apply: (engine: SimulationEngine) => {
    for (const type of Object.keys(engine.disasterCooldowns) as Array<keyof typeof engine.disasterCooldowns>) engine.disasterCooldowns[type] = 1000000;
  } },
  { name: 'half_initial_plant_growth', apply: (engine: SimulationEngine) => {
    for (const patch of engine.resources) if (patch.type === 'plant') patch.growthRate *= .5;
  } },
  { name: 'double_initial_plant_growth', apply: (engine: SimulationEngine) => {
    for (const patch of engine.resources) if (patch.type === 'plant') patch.growthRate *= 2;
  } },
  { name: 'double_spring_recharge', apply: (engine: SimulationEngine) => {
    for (const patch of engine.resources) if (patch.type === 'water_spring') patch.growthRate *= 2;
  } },
  { name: 'no_initial_carnivores', apply: (engine: SimulationEngine) => {
    engine.organisms = engine.organisms.filter(organism => organism.genome.diet !== 'carnivore');
  } },
];
const output = [];
for (const scenario of scenarios) {
  const start = performance.now();
  const rows: ScenarioRow[] = [];
  for (const seed of seeds) {
    const engine = new SimulationEngine(seed);
    scenario.apply(engine);
    let peak = engine.organisms.length;
    let firstZero: number | null = null;
    let invalid = false;
    for (let i = 1; i <= 10000; i++) {
      engine.step();
      peak = Math.max(peak, engine.organisms.length);
      if (engine.organisms.length === 0 && firstZero === null) firstZero = i;
      if (i % 1000 === 0) invalid ||= engine.organisms.some(o => !Number.isFinite(o.energy) || !Number.isFinite(o.x) || !Number.isFinite(o.y));
    }
    const stats = engine.getStats();
    rows.push({ seed, final: stats.totalOrganisms, peak, firstZero, herbivores: stats.herbivores,
      carnivores: stats.carnivores, scavengers: stats.scavengers, births: engine.totalBirths,
      deaths: engine.totalDeaths, plantBiomass: stats.plantBiomass, invalid });
  }
  const n = rows.length;
  const sum = (key: 'final'|'peak'|'births'|'deaths'|'plantBiomass') => rows.reduce((a,row)=>a+row[key],0);
  const result = { name: scenario.name, seeds: n, ticks: n*10000,
    durationSeconds: Number(((performance.now()-start)/1000).toFixed(2)),
    finalZeroPercent: 100*rows.filter(row=>row.final===0).length/n,
    meanFinalPopulation: Number((sum('final')/n).toFixed(2)),
    maxPeakPopulation: Math.max(...rows.map(row=>row.peak)),
    meanPlantBiomass: Number((sum('plantBiomass')/n).toFixed(2)),
    births: sum('births'), deaths: sum('deaths'), invalidNumericSeeds: rows.filter(row=>row.invalid).map(row=>row.seed), rows };
  output.push(result);
  console.log(`${scenario.name}: collapse ${result.finalZeroPercent}%, mean final ${result.meanFinalPopulation}; ${result.durationSeconds}s`);
  writeFileSync('benchmark_sensitivity.json', JSON.stringify({ note: '20 fixed seeds, 10,000 ticks per scenario; interventions only alter specified starting values.', scenarios: output },null,2));
}
