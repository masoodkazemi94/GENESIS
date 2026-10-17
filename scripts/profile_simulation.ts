/** Matched synthetic-load profile. Run with node --expose-gc --import tsx scripts/profile_simulation.ts. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { SimulationEngine } from '../src/simulation/engine.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';
import { SimulationProbe } from '../src/simulation/performance/probe.js';
import { PRNG } from '../src/simulation/math/prng.js';
import { findValidSpawnLocation } from '../src/simulation/terrain/terrain.js';

const repeats = Number(process.env.PROFILE_REPEATS || 3);
const measuredTicks = Number(process.env.PROFILE_TICKS || 200);
const warmupTicks = 20;
const round = (n: number) => Number(n.toFixed(4));
const percentile = (xs: number[], p: number) => [...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];

function run(model: 0 | 1, population: number, resourceCount: number, repeat: number) {
  const engine = new SimulationEngine(260617, resolveEcologyConfig({ behaviorModel: model }));
  const rng = new PRNG(7000 + repeat);
  const founders = structuredClone(engine.organisms);
  engine.organisms = Array.from({ length: population }, (_, index) => {
    const source = structuredClone(founders[index % founders.length]);
    const position = findValidSpawnLocation(engine.terrain, rng);
    return { ...source, id: `synthetic_${index}`, x: position.x, y: position.y,
      energy: 90, hydration: 90, health: 100, age: 0, maxAge: 100000,
      reproductiveCooldown: 1000000 };
  });
  const base = engine.resources.filter(r => r.type === 'plant');
  engine.resources = Array.from({ length: resourceCount }, (_, index) => ({
    ...structuredClone(base[index % base.length]), id: `synthetic_resource_${index}`,
    ...findValidSpawnLocation(engine.terrain, rng),
  }));
  for (let i=0; i<warmupTicks; i++) engine.step();
  const probe = new SimulationProbe();
  engine.probe = probe;
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const durations: number[] = [];
  let heapPeak = heapBefore;
  let populationIntegral = 0;
  let resourcesIntegral = 0;
  let decisions = 0;
  for (let i=0; i<measuredTicks; i++) {
    const start = performance.now();
    engine.step();
    durations.push(performance.now()-start);
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    populationIntegral += engine.organisms.length;
    resourcesIntegral += engine.resources.length;
    decisions += engine.organisms.length;
  }
  const cpu = process.cpuUsage(cpuBefore);
  const serializeStarted = performance.now();
  const json = JSON.stringify(engine.serializeForStorage());
  const snapshotMs = performance.now()-serializeStarted;
  const heapAfter = process.memoryUsage().heapUsed;
  return { model, requestedPopulation: population, requestedResources: resourceCount, repeat,
    ticks: measuredTicks, meanActualPopulation: round(populationIntegral/measuredTicks),
    meanActualResources: round(resourcesIntegral/measuredTicks), decisions,
    tickMeanMs: round(durations.reduce((a,b)=>a+b,0)/durations.length),
    tickP95Ms: round(percentile(durations,.95)), tickMaxMs: round(Math.max(...durations)),
    cpuUserMs: round(cpu.user/1000), cpuSystemMs: round(cpu.system/1000),
    heapBeforeMiB: round(heapBefore/1048576), heapAfterMiB: round(heapAfter/1048576),
    heapPeakMiB: round(heapPeak/1048576), heapDeltaMiB: round((heapAfter-heapBefore)/1048576),
    snapshotBytes: Buffer.byteLength(json), snapshotMs: round(snapshotMs),
    entries: Object.fromEntries(Object.entries(probe.entries).map(([key, value]) =>
      [key, { calls: value.calls, milliseconds: round(value.milliseconds) }])),
  };
}

const scenarios = [20,65,150,220].flatMap(population => [0,1].map(model =>
  ({ model: model as 0 | 1, population, resources: 250 })));
for (const resources of [50,500]) for (const model of [0,1] as const)
  scenarios.push({ model, population: 150, resources });
const output = { schemaVersion: 1, environment: { node: process.version, platform: process.platform,
  arch: process.arch, cpus: cpus().length, gcAvailable: !!global.gc },
  warmupTicks, measuredTicks, repeats, scenarios, results: [] as ReturnType<typeof run>[] };
for (const scenario of scenarios) {
  for (let repeat=0; repeat<repeats; repeat++) {
    output.results.push(run(scenario.model, scenario.population, scenario.resources, repeat));
    writeFileSync('docs/audits/data/simulation_profile_results.json', JSON.stringify(output,null,2));
  }
  console.log(`profile model=${scenario.model} organisms=${scenario.population} resources=${scenario.resources}`);
}
