/** Controlled, headless ecology experiments. Commands in docs/audits/ECOLOGY_CALIBRATION.md. */
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { PRNG } from '../src/simulation/math/prng.js';
import { LEGACY_ECOLOGY_CONFIG, resolveEcologyConfig, type EcologyConfig } from '../src/simulation/ecology/config.js';

const baseline = JSON.parse(readFileSync('docs/audits/data/benchmark_results.json', 'utf8'));
const originalSeeds: number[] = baseline.all100k.results.map((r: {seed:number}) => r.seed);
const holdoutGenerator = new PRNG(20261014);
const holdoutSeeds: number[] = [];
while (holdoutSeeds.length < 50) {
  const seed = holdoutGenerator.rangeInt(100000, 999999);
  if (!originalSeeds.includes(seed) && !holdoutSeeds.includes(seed)) holdoutSeeds.push(seed);
}
const round = (value: number) => Number(value.toFixed(3));

function run(seed: number, ticks: number, config: EcologyConfig) {
  const engine = new SimulationEngine(seed, config);
  let populationIntegral = 0;
  let capTicks = 0;
  let peakPopulation = engine.organisms.length;
  let firstZeroTick: number | null = null;
  let biomassIntegral = 0;
  let biomassSamples = 0;
  let carnivoresAt10k = 0;
  const start = performance.now();
  for (let tick = 1; tick <= ticks; tick++) {
    engine.step();
    const n = engine.organisms.length;
    populationIntegral += n;
    peakPopulation = Math.max(peakPopulation, n);
    if (n >= 220) capTicks++;
    if (n === 0 && firstZeroTick === null) firstZeroTick = tick;
    if (tick === 10000) carnivoresAt10k = engine.organisms.filter(o => o.genome.diet === 'carnivore').length;
    if (tick % 1000 === 0) {
      biomassIntegral += engine.resources.reduce((s, r) => s + (r.type === 'plant' ? r.amount : 0), 0);
      biomassSamples++;
    }
  }
  const trophic: Record<string, number> = {};
  for (const organism of engine.organisms) trophic[organism.genome.diet] = (trophic[organism.genome.diet] || 0) + 1;
  return { seed, ticks, elapsedSeconds: round((performance.now() - start) / 1000),
    finalPopulation: engine.organisms.length, firstZeroTick,
    meanPopulation: round(populationIntegral / ticks), peakPopulation, capTicks,
    births: engine.totalBirths, deaths: engine.totalDeaths,
    carnivoresAt10k, trophic, roles: Object.keys(trophic).length,
    species: [...engine.speciesMap.values()].filter(s => !s.extinct).length,
    newSpecies: engine.speciesMap.size - 4,
    maxGeneration: Math.max(0, ...[...engine.speciesMap.values()].map(s => s.generationPeak)),
    meanPlantBiomass: biomassSamples ? round(biomassIntegral / biomassSamples) : null,
    disasters: engine.climate.disasterHistoryCount,
    causesOfDeath: { ...engine.causesOfDeath } };
}
type Result = ReturnType<typeof run>;
function summary(results: Result[]) {
  const n = results.length;
  const count = (fn: (r: Result) => boolean) => results.filter(fn).length;
  return { seeds: n, totalTicks: results.reduce((s,r) => s+r.ticks,0),
    elapsedSeconds: round(results.reduce((s,r) => s+r.elapsedSeconds,0)),
    surviving: count(r=>r.finalPopulation>0), twoOrMoreRoles: count(r=>r.roles>=2),
    carnivoresAt10k: count(r=>r.carnivoresAt10k>0), carnivoresAtEnd: count(r=>(r.trophic.carnivore||0)>0),
    speciation: count(r=>r.newSpecies>0), capReached: count(r=>r.capTicks>0),
    meanFinalPopulation: round(results.reduce((s,r)=>s+r.finalPopulation,0)/n),
    meanPlantBiomass: round(results.reduce((s,r)=>s+(r.meanPlantBiomass||0),0)/n),
    totalBirths: results.reduce((s,r)=>s+r.births,0),
    totalDeaths: results.reduce((s,r)=>s+r.deaths,0),
    totalNewSpecies: results.reduce((s,r)=>s+r.newSpecies,0),
  };
}

const mode = process.argv[2] || 'screen';
if (mode === 'screen') {
  const n = Number(process.env.ECOLOGY_SCREEN_SEEDS || 20);
  const ticks = Number(process.env.ECOLOGY_SCREEN_TICKS || 10000);
  const seeds = originalSeeds.slice(0, n);
  const variants: Array<[string, Partial<EcologyConfig>]> = [
    ['baseline', {}],
    ['plant_growth_1_2', { plantGrowth: 1.2 }],
    ['plant_capacity_1_2', { plantCapacity: 1.2 }],
    ['initial_plants_250', { initialPlantCount: 250 }],
    ['feeding_1_1', { feedingEfficiency: 1.1 }],
    ['metabolic_0_9', { metabolicCost: .9 }],
    ['movement_0_9', { movementCost: .9 }],
    ['predator_damage_1_1', { predatorDamage: 1.1 }],
    ['pursuit_cost_0_9', { predatorPursuitCost: .9 }],
    ['herbivore_fertility_0_9', { herbivoreFertilityThreshold: .9 }],
    ['carrion_range_1_2', { scavengerCarrionRange: 1.2 }],
    ['mate_range_1_2', { mateDetectionRange: 1.2 }],
    ['disaster_frequency_0_8', { disasterFrequency: .8 }],
    ['disaster_severity_0_9', { disasterSeverity: .9 }],
  ];
  const output = { schemaVersion: 1, mode, seeds, ticksPerSeed: ticks, variants: [] as Array<{name:string;config:EcologyConfig;summary:ReturnType<typeof summary>;results:Result[]}> };
  for (const [name, overrides] of variants) {
    const config = resolveEcologyConfig(overrides);
    const results: Result[] = [];
    for (const seed of seeds) results.push(run(seed, ticks, config));
    output.variants.push({ name, config, summary: summary(results), results });
    writeFileSync('docs/audits/data/ecology_experiments.json', JSON.stringify(output, null, 2));
    console.log(`${name}: ${JSON.stringify(output.variants.at(-1)?.summary)}`);
  }
} else if (mode === 'followup') {
  const output = JSON.parse(readFileSync('docs/audits/data/ecology_experiments.json', 'utf8'));
  const seeds: number[] = output.seeds;
  const ticks: number = output.ticksPerSeed;
  const variants: Array<[string, Partial<EcologyConfig>]> = [
    ['plant_reseeding_plant_only', { plantReseedingPlantOnly: true }],
    ['plant_reseeding_plus_milder_disasters', { plantReseedingPlantOnly: true, disasterSeverity: .9 }],
    ['initial_plants_plus_milder_disasters', { initialPlantCount: 250, disasterSeverity: .9 }],
    ['plant_reseeding_plus_initial_plants', { plantReseedingPlantOnly: true, initialPlantCount: 250 }],
    ['herbivore_fertility_0_9_corrected', { herbivoreFertilityThreshold: .9 }],
  ];
  for (const [name, overrides] of variants) {
    const config = resolveEcologyConfig(overrides);
    const results = seeds.map(seed => run(seed, ticks, config));
    output.variants.push({ name, config, summary: summary(results), results });
    writeFileSync('docs/audits/data/ecology_experiments.json', JSON.stringify(output, null, 2));
    console.log(`${name}: ${JSON.stringify(output.variants.at(-1)?.summary)}`);
  }
} else if (mode === 'legacy-holdout') {
  const ticks = Number(process.env.ECOLOGY_VERIFY_TICKS || 100000);
  const config = resolveEcologyConfig({ scavengerCarrionRange: 1 / 1.8 });
  const output = { schemaVersion: 1, mode, config, ticksPerSeed: ticks, holdoutSeeds,
    results: [] as Result[], summary: null as ReturnType<typeof summary> | null };
  for (const seed of holdoutSeeds) {
    output.results.push(run(seed, ticks, config));
    writeFileSync('docs/audits/data/ecology_legacy_holdout.json', JSON.stringify(output, null, 2));
    if (output.results.length % 10 === 0) console.log(`legacy-holdout: ${output.results.length}/50`);
  }
  output.summary = summary(output.results);
  writeFileSync('docs/audits/data/ecology_legacy_holdout.json', JSON.stringify(output, null, 2));
} else if (mode === 'verify') {
  const ticks = Number(process.env.ECOLOGY_VERIFY_TICKS || 100000);
  const candidate = resolveEcologyConfig(process.env.ECOLOGY_CONFIG ? JSON.parse(process.env.ECOLOGY_CONFIG) : {});
  const outputPath = process.env.ECOLOGY_OUTPUT || 'docs/audits/data/ecology_holdout_results.json';
  const output = { schemaVersion: 1, mode, ticksPerSeed: ticks, originalSeeds, holdoutSeeds,
    configurations: [
      { name: 'baseline', config: LEGACY_ECOLOGY_CONFIG, results: [] as Result[] },
      { name: 'candidate', config: candidate, results: [] as Result[] },
    ], summaries: {} as Record<string, unknown> };
  for (const group of output.configurations) {
    for (const seed of [...originalSeeds, ...holdoutSeeds]) {
      group.results.push(run(seed, ticks, group.config));
      writeFileSync(outputPath, JSON.stringify(output, null, 2));
      if (group.results.length % 10 === 0) console.log(`${group.name}: ${group.results.length}/150`);
    }
    output.summaries[group.name] = {
      original: summary(group.results.slice(0,100)), holdout: summary(group.results.slice(100)),
    };
    writeFileSync(outputPath, JSON.stringify(output, null, 2));
  }
} else throw new Error(`Unknown experiment mode ${mode}`);
