/** Headless, reproducible simulation audit. Run with: npx tsx scripts/benchmark_simulation.ts */
import { SimulationEngine } from '../src/simulation/engine.js';
import { PRNG } from '../src/simulation/math/prng.js';
import { queryNeighbors } from '../src/simulation/physics/physics.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem } from 'node:os';

const round = (n: number, digits = 2) => Number(n.toFixed(digits));
const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};
const water = (engine: SimulationEngine) => engine.resources.filter(r => r.type === 'water_spring').reduce((sum, r) => sum + r.amount, 0);
const population = (engine: SimulationEngine) => {
  const counts = { herbivore: 0, carnivore: 0, scavenger: 0, omnivore: 0 };
  for (const organism of engine.organisms) counts[organism.genome.diet]++;
  return counts;
};
const resourceState = (engine: SimulationEngine) => ({
  plantBiomass: round(engine.resources.filter(r => r.type === 'plant').reduce((sum, r) => sum + r.amount, 0)),
  availableWater: round(water(engine)),
});
const traitNames = ['speed', 'bodySize', 'visionRange', 'metabolicEfficiency', 'heatTolerance', 'coldTolerance'] as const;
function genomeDistribution(engine: SimulationEngine) {
  if (engine.organisms.length === 0) return null;
  return Object.fromEntries(traitNames.map(name => {
    const values = engine.organisms.map(organism => organism.genome[name]);
    return [name, { min: round(Math.min(...values), 3), median: round(percentile(values, .5), 3),
      p95: round(percentile(values, .95), 3), max: round(Math.max(...values), 3),
      mean: round(values.reduce((a,b)=>a+b,0)/values.length,3) }];
  }));
}

function runSeed(seed: number, ticks: number, sampleEvery = 1000) {
  const engine = new SimulationEngine(seed);
  const initialPopulation = engine.organisms.length;
  const initialSpecies = engine.speciesMap.size;
  const initialTraits = engine.getStats().traitAverages;
  const initialGeneticDistance = engine.getStats().diversity?.averagePairwiseDistance ?? null;
  const initialGenomeDistribution = genomeDistribution(engine);
  const history = [{ tick: 0, total: initialPopulation, ...population(engine), ...resourceState(engine) }];
  let peakPopulation = initialPopulation;
  let populationSum = 0;
  let firstZeroTick: number | null = null;
  const seenDisasters = new Set<string>();
  const disasterSeverity: number[] = [];
  const start = performance.now();
  for (let tick = 1; tick <= ticks; tick++) {
    engine.step();
    const count = engine.organisms.length;
    populationSum += count;
    peakPopulation = Math.max(peakPopulation, count);
    if (count === 0 && firstZeroTick === null) firstZeroTick = tick;
    for (const disaster of engine.climate.activeDisasters) {
      if (!seenDisasters.has(disaster.id)) {
        seenDisasters.add(disaster.id);
        disasterSeverity.push(disaster.severity);
      }
    }
    if (tick % sampleEvery === 0 || tick === ticks) history.push({ tick, total: count, ...population(engine), ...resourceState(engine) });
  }
  const durationSeconds = round((performance.now() - start) / 1000);
  const stats = engine.getStats();
  const traits = stats.traitAverages;
  const organisms = engine.organisms;
  const finite = organisms.every(o => Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.energy) && Number.isFinite(o.hydration)) &&
    engine.resources.every(r => Number.isFinite(r.amount) && r.amount >= 0);
  return {
    seed, ticks, durationSeconds, initialPopulation, finalPopulation: organisms.length,
    peakPopulation, meanPopulation: round(populationSum / ticks),
    births: engine.totalBirths, deaths: engine.totalDeaths,
    extinctSpecies: [...engine.speciesMap.values()].filter(s => s.extinct).length,
    newSpecies: engine.speciesMap.size - initialSpecies,
    finalTrophic: population(engine),
    ...resourceState(engine),
    averageLifespanOfDeadTicks: engine.totalDeaths ? round(engine.totalDeathAgeTicks / engine.totalDeaths) : null,
    averageLivingGeneration: organisms.length ? round(organisms.reduce((sum, o) => sum + o.generation, 0) / organisms.length) : null,
    maximumGenerationEver: Math.max(0, ...[...engine.speciesMap.values()].map(s => s.generationPeak)),
    initialTraits, finalTraits: organisms.length ? traits : null,
    initialGenomeDistribution, finalGenomeDistribution: genomeDistribution(engine),
    initialGeneticDistance,
    finalGeneticDistance: stats.diversity?.averagePairwiseDistance ?? null,
    disasters: engine.climate.disasterHistoryCount,
    observedDisasterCount: disasterSeverity.length,
    meanDisasterSeverity: disasterSeverity.length ? round(disasterSeverity.reduce((a, b) => a + b, 0) / disasterSeverity.length, 3) : null,
    maxDisasterSeverity: disasterSeverity.length ? round(Math.max(...disasterSeverity), 3) : null,
    firstZeroTick, causesOfDeath: { ...engine.causesOfDeath }, finite,
    history,
  };
}

type SeedResult = ReturnType<typeof runSeed>;
function summary(results: SeedResult[]) {
  const n = results.length;
  const vals = (key: 'finalPopulation' | 'peakPopulation' | 'meanPopulation') => results.map(r => r[key]);
  const sum = (key: 'births' | 'deaths' | 'newSpecies' | 'extinctSpecies') => results.reduce((a, r) => a + r[key], 0);
  return {
    seeds: n, ticks: results.reduce((a, r) => a + r.ticks, 0),
    durationSeconds: round(results.reduce((a, r) => a + r.durationSeconds, 0)),
    firstZeroPercent: round(100 * results.filter(r => r.firstZeroTick !== null).length / n),
    finalZeroPercent: round(100 * results.filter(r => r.finalPopulation === 0).length / n),
    finalPopulation: { min: Math.min(...vals('finalPopulation')), median: percentile(vals('finalPopulation'), .5), p95: percentile(vals('finalPopulation'), .95), max: Math.max(...vals('finalPopulation')), mean: round(vals('finalPopulation').reduce((a,b)=>a+b,0)/n) },
    peakPopulation: { median: percentile(vals('peakPopulation'), .5), max: Math.max(...vals('peakPopulation')) },
    births: sum('births'), deaths: sum('deaths'), extinctSpecies: sum('extinctSpecies'), newSpecies: sum('newSpecies'),
    seedsWithSpeciation: results.filter(r => r.newSpecies > 0).length,
    trophicSurvivalPercent: Object.fromEntries((['herbivore','carnivore','scavenger','omnivore'] as const).map(diet => [diet, round(100 * results.filter(r => r.finalTrophic[diet] > 0).length / n)])),
    deathsByCause: Object.fromEntries((['starvation','dehydration','predation','senescence','thermal','disaster'] as const).map(cause => [cause, results.reduce((a,r)=>a+(r.causesOfDeath[cause] || 0),0)])),
    invalidNumericSeeds: results.filter(r => !r.finite).map(r => r.seed),
  };
}

function canonical(engine: SimulationEngine) {
  const data = engine.serializeForStorage();
  // This field records the actual save time, not simulation state.
  delete (data as Partial<typeof data>).lastSavedTimestamp;
  return JSON.stringify(data);
}
function firstDifference(a: string, b: string) {
  let i = 0;
  while (i < Math.min(a.length,b.length) && a[i] === b[i]) i++;
  return i === Math.max(a.length,b.length) ? null : { offset: i, uninterrupted: a.slice(i,i+100), restored: b.slice(i,i+100) };
}
function determinism(seed: number) {
  const uninterrupted = new SimulationEngine(seed);
  for (let i = 0; i < 2000; i++) uninterrupted.step();
  const saved = structuredClone(uninterrupted.serializeForStorage());
  const restored = new SimulationEngine(saved);
  const startMatches = firstDifference(canonical(uninterrupted), canonical(restored));
  for (let i = 0; i < 10000; i++) { uninterrupted.step(); restored.step(); }
  const difference = firstDifference(canonical(uninterrupted), canonical(restored));
  return { seed, beforeSaveTicks: 2000, afterRestoreTicks: 10000, pass: difference === null && startMatches === null,
    initialDifference: startMatches, difference,
    rngMatches: uninterrupted.serializeForStorage().prngState === restored.serializeForStorage().prngState,
    finalPopulation: uninterrupted.organisms.length };
}

function performanceBench(target: number) {
  const engine = new SimulationEngine(888999);
  const prng = new PRNG(101 + target);
  const founders = structuredClone(engine.organisms);
  engine.organisms = Array.from({ length: target }, (_, i) => {
    const founder = founders[i % founders.length];
    return { ...structuredClone(founder), id: `load_${target}_${i}`,
      x: prng.range(0, engine.terrain.worldWidth), y: prng.range(0, engine.terrain.worldHeight) };
  });
  for (let i = 0; i < 20; i++) engine.step();
  const durations: number[] = [];
  let peak = engine.organisms.length;
  let heapPeak = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200; i++) {
    const start = performance.now(); engine.step(); durations.push(performance.now() - start);
    peak = Math.max(peak, engine.organisms.length);
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
  }
  const grid = (engine as unknown as { spatialGrid: Parameters<typeof queryNeighbors>[0] }).spatialGrid;
  const queryCount = 1000;
  const queryStart = performance.now();
  for (let i = 0; i < queryCount; i++) {
    const o = engine.organisms[i % engine.organisms.length];
    queryNeighbors(grid, o.x, o.y, 80);
  }
  const spatialQueryMicroseconds = round((performance.now() - queryStart) * 1000 / queryCount, 3);
  const snapshotStart = performance.now();
  const snapshot = engine.getSnapshot();
  const snapshotMs = performance.now() - snapshotStart;
  const json = JSON.stringify(snapshot);
  const transferStart = performance.now();
  for (let i = 0; i < 20; i++) structuredClone(snapshot);
  const cloneMs = (performance.now() - transferStart) / 20;
  const storageStart = performance.now();
  const storage = JSON.stringify(engine.serializeForStorage());
  const storageMs = performance.now() - storageStart;
  return { requestedPopulation: target, measuredPopulationStart: target, measuredPopulationEnd: engine.organisms.length,
    peakPopulation: peak, ticksMeasured: durations.length,
    meanTickMs: round(durations.reduce((a,b)=>a+b,0)/durations.length,3), p95TickMs: round(percentile(durations,.95),3),
    maxTickMs: round(Math.max(...durations),3), spatialQueryMicroseconds,
    rendererSnapshotBytes: Buffer.byteLength(json), rendererSnapshotBuildMs: round(snapshotMs,3),
    structuredCloneMs: round(cloneMs,3), storageSnapshotBytes: Buffer.byteLength(storage),
    storageSerializationMs: round(storageMs,3), heapPeakMiB: round(heapPeak/1048576), rssMiB: round(process.memoryUsage().rss/1048576) };
}

async function main() {
  if (process.argv.includes('--very-deep-survivor')) {
    const baseline = JSON.parse(readFileSync('docs/audits/data/benchmark_results.json', 'utf8'));
    const survivors: SeedResult[] = baseline.all100k.results.filter((row: SeedResult) => row.finalPopulation > 0);
    if (survivors.length === 0) throw new Error('No 100,000-tick survivor exists to extend');
    const seed = survivors.sort((a,b)=>b.finalPopulation-a.finalPopulation)[0].seed;
    console.log(`500,000 ticks on surviving seed ${seed}`);
    const result = runSeed(seed,500000,25000);
    baseline.survivor500k = { summary: summary([result]), result };
    baseline.totalTicksExecuted += 500000;
    writeFileSync('docs/audits/data/benchmark_results.json', JSON.stringify(baseline,null,2));
    console.log(JSON.stringify({ seed, finalPopulation: result.finalPopulation, firstZeroTick: result.firstZeroTick,
      births: result.births, newSpecies: result.newSpecies, durationSeconds: result.durationSeconds },null,2));
    return;
  }
  if (process.argv.includes('--refresh-deep')) {
    const baseline = JSON.parse(readFileSync('docs/audits/data/benchmark_results.json', 'utf8'));
    const deepSeeds: number[] = baseline.deep.map((entry: { result: SeedResult }) => entry.result.seed);
    baseline.deep = deepSeeds.map(seed => { const result = runSeed(seed,100000,10000); return { summary: summary([result]), result }; });
    const veryDeepSeed: number = baseline.veryDeep.result.seed;
    const veryDeepResult = runSeed(veryDeepSeed,500000,25000);
    baseline.veryDeep = { summary: summary([veryDeepResult]), result: veryDeepResult };
    writeFileSync('docs/audits/data/benchmark_results.json', JSON.stringify(baseline,null,2));
    console.log('Refreshed two 100,000-tick runs and one 500,000-tick run.');
    return;
  }
  if (process.argv.includes('--refresh-short')) {
    const baseline = JSON.parse(readFileSync('docs/audits/data/benchmark_results.json', 'utf8'));
    const seeds: number[] = baseline.results.map((result: SeedResult) => result.seed);
    if (seeds.length !== 100 || new Set(seeds).size !== 100) throw new Error('A completed, unique 100-seed baseline is required');
    const results: SeedResult[] = [];
    for (const seed of seeds) {
      results.push(runSeed(seed, 10000));
      if (results.length % 10 === 0) console.log(`${results.length}/100 refreshed short runs`);
    }
    baseline.results = results;
    baseline.summary100x10k = summary(results);
    writeFileSync('docs/audits/data/benchmark_results.json', JSON.stringify(baseline,null,2));
    return;
  }
  if (process.argv.includes('--extended')) {
    const baseline = JSON.parse(readFileSync('docs/audits/data/benchmark_results.json', 'utf8'));
    const seeds: number[] = baseline.results.map((result: SeedResult) => result.seed);
    if (seeds.length !== 100 || new Set(seeds).size !== 100) throw new Error('A completed, unique 100-seed baseline is required');
    const results: SeedResult[] = [];
    const start = performance.now();
    for (const seed of seeds) {
      results.push(runSeed(seed, 100000, 10000));
      if (results.length % 10 === 0) {
        console.log(`${results.length}/100 at 100,000 ticks; elapsed ${round((performance.now()-start)/1000)} s`);
        writeFileSync('docs/audits/data/benchmark_100k_partial.json', JSON.stringify({ completedSeeds: results.length, results }, null, 2));
      }
    }
    baseline.all100k = { summary: summary(results), results };
    baseline.totalTicksExecuted += 10000000;
    baseline.extendedWallSeconds = round((performance.now()-start)/1000);
    writeFileSync('docs/audits/data/benchmark_results.json', JSON.stringify(baseline,null,2));
    console.log(JSON.stringify({ durationSeconds: baseline.extendedWallSeconds, summary: baseline.all100k.summary },null,2));
    return;
  }
  const start = performance.now();
  const master = new PRNG(99988877);
  const seeds = new Set<number>();
  while (seeds.size < 100) seeds.add(master.rangeInt(100000, 999999));
  const results: SeedResult[] = [];
  console.log('100 unique seeds × 10,000 ticks');
  for (const seed of seeds) {
    results.push(runSeed(seed, 10000));
    if (results.length % 10 === 0) console.log(`${results.length}/100; elapsed ${round((performance.now()-start)/1000)} s`);
  }
  const deepSeeds = [results.find(r => r.finalPopulation >= 15)?.seed ?? results[0].seed, results.find(r => r.finalPopulation === 0)?.seed ?? results[1].seed];
  const deep = deepSeeds.map(seed => { console.log(`100,000 ticks seed ${seed}`); return runSeed(seed,100000,10000); });
  console.log(`500,000 ticks seed ${deepSeeds[0]}`);
  const veryDeep = runSeed(deepSeeds[0],500000,25000);
  console.log('Determinism: 3 seeds × 2,000 + 10,000 ticks × 2 branches');
  const determinismResults = [10101,20202,30303].map(determinism);
  console.log('Performance: 20, 65, 150 organism load');
  const performanceResults = [20,65,150].map(performanceBench);
  const report = { generatedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch,
    cpu: cpus()[0]?.model, logicalCores: cpus().length, totalMemoryGiB: round(totalmem()/1073741824) },
    wallSeconds: round((performance.now() - start)/1000), totalTicksExecuted: 1000000 + 200000 + 500000 + 3*22000 + 3*220,
    summary100x10k: summary(results), deep: deep.map(r => ({ summary: summary([r]), result: r })),
    veryDeep: { summary: summary([veryDeep]), result: veryDeep }, determinism: determinismResults,
    performance: performanceResults, results };
  writeFileSync('docs/audits/data/benchmark_results.json', JSON.stringify(report,null,2));
  console.log(JSON.stringify({ wallSeconds: report.wallSeconds, summary: report.summary100x10k,
    deep: deep.map(r=>({seed:r.seed, final:r.finalPopulation})), veryDeep:{seed:veryDeep.seed,final:veryDeep.finalPopulation},
    determinism: determinismResults.map(r=>({seed:r.seed,pass:r.pass,difference:r.difference})), performance: performanceResults },null,2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
