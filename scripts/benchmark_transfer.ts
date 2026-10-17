/** Measure headless Node worker-to-main snapshot delivery, not browser rendering. */
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { PRNG } from '../src/simulation/math/prng.js';

const round = (n: number) => Number(n.toFixed(3));
const percentile = (values: number[], fraction: number) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*fraction)-1];

async function measure(target: number) {
  const engine = new SimulationEngine(888999);
  const founders = structuredClone(engine.organisms);
  const rng = new PRNG(101 + target);
  engine.organisms = Array.from({ length: target }, (_, i) => ({
    ...structuredClone(founders[i % founders.length]), id: `load_${target}_${i}`,
    x: rng.range(0, engine.terrain.worldWidth), y: rng.range(0, engine.terrain.worldHeight),
  }));
  const snapshot = engine.getSnapshot();
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    parentPort.on('message', () => parentPort.postMessage(workerData));
    parentPort.postMessage('ready');
  `, { eval: true, workerData: snapshot });
  try {
    await once(worker, 'message');
    const times: number[] = [];
    for (let i = 0; i < 35; i++) {
      const received = once(worker, 'message');
      const start = performance.now();
      worker.postMessage('send');
      const [payload] = await received;
      if (payload.organisms.length !== target) throw new Error('Worker payload was incomplete');
      if (i >= 5) times.push(performance.now() - start);
    }
    return { population: target, snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
      trials: times.length, meanMs: round(times.reduce((a,b)=>a+b,0)/times.length),
      p95Ms: round(percentile(times,.95)), maxMs: round(Math.max(...times)) };
  } finally {
    await worker.terminate();
  }
}

const results = await Promise.all([20,65,150].map(measure));
writeFileSync('docs/audits/data/benchmark_transfer.json', JSON.stringify({
  method: 'Node worker thread -> main thread, 5 warmups and 30 measured round trips per population; small request plus snapshot payload.',
  results,
},null,2));
console.log(JSON.stringify(results,null,2));
