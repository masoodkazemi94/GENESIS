/** Replay and population-load checks for the experimental ecology configuration. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { PRNG } from '../src/simulation/math/prng.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';

const configurations = [
  { name: 'baseline', config: resolveEcologyConfig() },
  { name: 'candidate', config: resolveEcologyConfig({ plantReseedingPlantOnly: true, disasterSeverity: .9 }) },
];
const round = (n: number) => Number(n.toFixed(3));
const percentile = (values: number[], q: number) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];

function canonical(engine: SimulationEngine) {
  const data = engine.serializeForStorage();
  delete (data as Partial<typeof data>).lastSavedTimestamp;
  return JSON.stringify(data);
}
function replay(config: typeof configurations[number]['config'], seed: number) {
  const original = new SimulationEngine(seed, config);
  for (let i=0; i<2000; i++) original.step();
  const restored = new SimulationEngine(structuredClone(original.serializeForStorage()));
  const equalAtRestore = canonical(original) === canonical(restored);
  for (let i=0; i<10000; i++) { original.step(); restored.step(); }
  return { seed, ticksBeforeSave: 2000, ticksAfterSave: 10000,
    equalAtRestore, equalAfterReplay: canonical(original) === canonical(restored),
    rngEqual: original.serializeForStorage().prngState === restored.serializeForStorage().prngState };
}
function load(config: typeof configurations[number]['config'], target: number) {
  const engine = new SimulationEngine(888999, config);
  const founders = structuredClone(engine.organisms);
  const prng = new PRNG(101+target);
  engine.organisms = Array.from({length:target},(_,i)=>({ ...structuredClone(founders[i%founders.length]),
    id:`load_${target}_${i}`,x:prng.range(0,engine.terrain.worldWidth),y:prng.range(0,engine.terrain.worldHeight) }));
  for (let i=0;i<20;i++) engine.step();
  const durations:number[]=[];
  let peak=engine.organisms.length;
  let heapPeak=process.memoryUsage().heapUsed;
  for (let i=0;i<200;i++) {
    const start=performance.now();engine.step();durations.push(performance.now()-start);
    peak=Math.max(peak,engine.organisms.length);
    heapPeak=Math.max(heapPeak,process.memoryUsage().heapUsed);
  }
  return {requestedPopulation:target,peakPopulation:peak,ticksMeasured:200,
    meanTickMs:round(durations.reduce((a,b)=>a+b,0)/durations.length),
    p95TickMs:round(percentile(durations,.95)),maxTickMs:round(Math.max(...durations)),
    peakHeapMiB:round(heapPeak/1048576)};
}
const results = configurations.map(({name,config})=>({name,config,
  replay:[10101,20202,30303].map(seed=>replay(config,seed)),
  load:[20,65,150].map(target=>load(config,target)) }));
writeFileSync('docs/audits/data/ecology_verification_checks.json',JSON.stringify({schemaVersion:1,results},null,2));
console.log(JSON.stringify(results.map(r=>({name:r.name,replayPass:r.replay.every(x=>x.equalAtRestore&&x.equalAfterReplay&&x.rngEqual),load:r.load})),null,2));
