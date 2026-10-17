/** Profile a naturally populated high-density seed without synthetic cooldowns. */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';
import { SimulationProbe } from '../src/simulation/performance/probe.js';

const seed = 166064;
const warmupTicks = 3500;
const measuredTicks = 500;
const round = (x: number) => Number(x.toFixed(4));
const results = [];
for (const model of [1, 2] as const) {
  const engine = new SimulationEngine(seed, resolveEcologyConfig({ behaviorModel: model }));
  for (let i=0; i<warmupTicks; i++) engine.step();
  const probe = new SimulationProbe();
  engine.probe = probe;
  const durations = [];
  let populationSum = 0;
  const cpuBefore = process.cpuUsage();
  const heapBefore = process.memoryUsage().heapUsed;
  for (let i=0; i<measuredTicks; i++) {
    const started = performance.now();
    engine.step();
    durations.push(performance.now()-started);
    populationSum += engine.organisms.length;
  }
  const cpu = process.cpuUsage(cpuBefore);
  results.push({ model, seed, warmupTicks, measuredTicks,
    meanPopulation: round(populationSum/measuredTicks),
    tickMeanMs: round(durations.reduce((a,b)=>a+b,0)/measuredTicks),
    tickP95Ms: round([...durations].sort((a,b)=>a-b)[Math.ceil(measuredTicks*.95)-1]),
    cpuUserMs: round(cpu.user/1000), cpuSystemMs: round(cpu.system/1000),
    heapDeltaMiB: round((process.memoryUsage().heapUsed-heapBefore)/1048576),
    entries: Object.fromEntries(Object.entries(probe.entries)
      .map(([key,value])=>[key,{calls:value.calls,milliseconds:round(value.milliseconds)}])) });
  writeFileSync('docs/audits/data/simulation_natural_profile.json', JSON.stringify({schemaVersion:1,results},null,2));
  console.log(`natural profile model=${model}`);
}
