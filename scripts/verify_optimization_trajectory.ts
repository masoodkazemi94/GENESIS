import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { SimulationEngine } from '../src/simulation/engine.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';

const output = process.env.TRAJECTORY_OUTPUT || 'docs/audits/data/optimization_trajectory.json';
const results = [];
for (const model of [0,1] as const) for (const seed of [10101,691153,260679]) {
  const engine = new SimulationEngine(seed, resolveEcologyConfig({ behaviorModel: model }));
  for (let i=0;i<2000;i++) engine.step();
  const save = engine.serializeForStorage();
  delete (save as Partial<typeof save>).lastSavedTimestamp;
  delete (save as Partial<typeof save>).createdTimestamp;
  const canonical = JSON.stringify(save);
  results.push({ model, seed, tick: engine.tick, population: engine.organisms.length,
    sha256: createHash('sha256').update(canonical).digest('hex') });
}
writeFileSync(output, JSON.stringify({ schemaVersion:1, results }, null, 2));
console.log(output, results.map(r=>`${r.model}:${r.seed}:${r.population}`).join(' '));
