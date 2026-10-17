/** V8 sampled CPU profile of a naturally dense Model 1 world. */
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';
import { SimulationEngine } from '../src/simulation/engine.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';

const seed = 166064;
const warmupTicks = 3500;
const measuredTicks = 2000;
const engine = new SimulationEngine(seed, resolveEcologyConfig({ behaviorModel: 1 }));
for (let i=0; i<warmupTicks; i++) engine.step();
const session = new Session();
session.connect();
const post = <T>(method: string): Promise<T> => new Promise((resolve,reject) =>
  session.post(method, (error, result) => error ? reject(error) : resolve(result as T)));
await post('Profiler.enable');
await post('Profiler.start');
let populationSum = 0;
for (let i=0; i<measuredTicks; i++) {
  engine.step();
  populationSum += engine.organisms.length;
}
const { profile } = await post<{ profile: {
  nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>;
  samples?: number[]; timeDeltas?: number[]; startTime: number; endTime: number;
} }>('Profiler.stop');
session.disconnect();
writeFileSync('simulation_cpu_profile.cpuprofile', JSON.stringify(profile));
const frames = new Map(profile.nodes.map(node=>[node.id,node.callFrame]));
const byFrame = new Map<string,{samples:number;sampledMs:number}>();
for (let i=0; i<(profile.samples?.length || 0); i++) {
  const frame = frames.get(profile.samples![i]);
  if (!frame) continue;
  const key = `${frame.functionName || '(anonymous)'} @ ${frame.url}:${frame.lineNumber + 1}`;
  const entry = byFrame.get(key) || {samples:0,sampledMs:0};
  entry.samples++;
  entry.sampledMs += (profile.timeDeltas?.[i] || 0)/1000;
  byFrame.set(key,entry);
}
const topSelfFrames = [...byFrame].map(([frame,value])=>({frame,...value}))
  .sort((a,b)=>b.sampledMs-a.sampledMs).slice(0,60);
const output = {schemaVersion:1,seed,model:1,warmupTicks,measuredTicks,
  meanPopulation:populationSum/measuredTicks,
  profileDurationMs:(profile.endTime-profile.startTime)/1000,
  sampleCount:profile.samples?.length || 0,topSelfFrames};
writeFileSync('simulation_cpu_profile_summary.json',JSON.stringify(output,null,2));
console.log('simulation_cpu_profile_summary.json',output.sampleCount);
