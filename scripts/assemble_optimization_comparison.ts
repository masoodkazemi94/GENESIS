import { existsSync, readFileSync, writeFileSync } from 'node:fs';

type Benchmark = { results: Array<{ seed: number; checkpoints: Array<{
  tick: number; elapsedSeconds: number; population: number;
  metrics: { populationIntegral: number }; [key: string]: unknown }> }> };
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const original = read<Benchmark>('ecology_behavior_experiments.json');
const originalModel0 = read<Benchmark>('ecology_behavior_baseline.json');
const optimized10k = read<Benchmark>('optimization_20seed_10k.json');
const optimized50k = existsSync('optimization_20seed_50k.json')
  ? read<Benchmark>('optimization_20seed_50k.json') : null;
const optimizedModel0 = existsSync('optimization_model0_20seed_50k.json')
  ? read<Benchmark>('optimization_model0_20seed_50k.json') : null;
const optimizedModel0Repeat = existsSync('optimization_model0_repeat_20seed_50k.json')
  ? read<Benchmark>('optimization_model0_repeat_20seed_50k.json') : null;
const profileBefore = read<{ results: Array<Record<string, any>> }>('simulation_profile_results_before.json');
const profileAfter = read<{ results: Array<Record<string, any>> }>('simulation_profile_results_after_reuse.json');
const profileAfterIndex = read<typeof profileBefore>('simulation_profile_results_after_index.json');
const profileAfterDiscovery = read<typeof profileBefore>('simulation_profile_results_after_discovery.json');
const hashesBefore = read<{ results: Array<{ model: number; seed: number; sha256: string }> }>('optimization_trajectory_before.json');
const hashesAfter = read<typeof hashesBefore>('optimization_trajectory_final.json');
const round = (x: number) => Number(x.toFixed(4));
const mean = (xs: number[]) => xs.reduce((a,b)=>a+b,0)/xs.length;
const stageSummary = (name: string, data: typeof profileBefore) => {
  const runs = data.results.filter(r=>r.model===1 && r.requestedPopulation===220 && r.requestedResources===250);
  return { name, repeats: runs.length, tickMeanMs: round(mean(runs.map(r=>r.tickMeanMs))),
    foodIndexCalls: mean(runs.map(r=>r.entries['spatial.populateFood']?.calls || 0)),
    organismQueryCalls: mean(runs.map(r=>r.entries['spatial.queryOrganisms']?.calls || 0)),
    foodDiscoveryMs: round(mean(runs.map(r=>r.entries['behavior.foodDiscovery']?.milliseconds || 0))) };
};

const profiles = [];
for (let i=0; i<profileBefore.results.length; i+=3) {
  const before = profileBefore.results.slice(i,i+3);
  const after = profileAfter.results.slice(i,i+3);
  const first = before[0];
  const avg = (xs: typeof before, key: string) => mean(xs.map(r=>r[key] as number));
  const entry = (xs: typeof before, key: string, metric: 'calls' | 'milliseconds') =>
    mean(xs.map(r=>r.entries[key]?.[metric] || 0));
  profiles.push({ model: first.model, requestedPopulation: first.requestedPopulation,
    requestedResources: first.requestedResources, repeats: before.length,
    meanActualPopulationBefore: round(avg(before,'meanActualPopulation')),
    meanActualPopulationAfter: round(avg(after,'meanActualPopulation')),
    before: { tickMeanMs: round(avg(before,'tickMeanMs')), tickP95Ms: round(avg(before,'tickP95Ms')),
      tickMaxMs: round(avg(before,'tickMaxMs')), cpuUserMs: round(avg(before,'cpuUserMs')),
      foodIndexCalls: entry(before,'spatial.populateFood','calls'),
      organismQueryCalls: entry(before,'spatial.queryOrganisms','calls') },
    after: { tickMeanMs: round(avg(after,'tickMeanMs')), tickP95Ms: round(avg(after,'tickP95Ms')),
      tickMaxMs: round(avg(after,'tickMaxMs')), cpuUserMs: round(avg(after,'cpuUserMs')),
      foodIndexCalls: entry(after,'spatial.populateFood','calls'),
      organismQueryCalls: entry(after,'spatial.queryOrganisms','calls') } });
}
function pair(tick: number, newer: Benchmark | null, priorRun = original) {
  if (!newer) return null;
  const paired = newer.results.map(item => {
    const prior = priorRun.results.find(r => r.seed === item.seed)?.checkpoints.find(c => c.tick === tick);
    const current = item.checkpoints.find(c => c.tick === tick);
    if (!prior || !current) throw new Error(`Missing checkpoint ${item.seed}:${tick}`);
    const stripTime = (x: typeof prior) => ({ ...x, elapsedSeconds: 0 });
    return { seed: item.seed, sameRecordedState: JSON.stringify(stripTime(prior)) === JSON.stringify(stripTime(current)),
      priorWallSeconds: prior.elapsedSeconds, currentWallSeconds: current.elapsedSeconds,
      priorOrganismTicks: prior.metrics.populationIntegral, currentOrganismTicks: current.metrics.populationIntegral,
      priorPopulation: prior.population, currentPopulation: current.population };
  });
  return { tick, seedsCompleted: paired.length, totalTicks: tick * paired.length,
    allRecordedStateMetricsMatch: paired.every(p=>p.sameRecordedState),
    priorWallSeconds: round(paired.reduce((s,p)=>s+p.priorWallSeconds,0)),
    currentWallSeconds: round(paired.reduce((s,p)=>s+p.currentWallSeconds,0)),
    priorMicrosecondsPerOrganismTick: round(1e6 * paired.reduce((s,p)=>s+p.priorWallSeconds,0) /
      paired.reduce((s,p)=>s+p.priorOrganismTicks,0)),
    currentMicrosecondsPerOrganismTick: round(1e6 * paired.reduce((s,p)=>s+p.currentWallSeconds,0) /
      paired.reduce((s,p)=>s+p.currentOrganismTicks,0)),
    paired };
}
const output = { schemaVersion: 1, profileBeforeFile: 'simulation_profile_results_before.json',
  profileAfterFile: 'simulation_profile_results_after_reuse.json', profiles,
  individualStagesAt220: [stageSummary('before',profileBefore),
    stageSummary('after_index_rebuild_removal',profileAfterIndex),
    stageSummary('after_legacy_food_scan_removal',profileAfterDiscovery),
    stageSummary('after_neighbor_query_reuse',profileAfter)],
  trajectory: { cases: hashesBefore.results.length,
    allHashesMatch: hashesBefore.results.every((x,i)=>x.sha256 === hashesAfter.results[i]?.sha256),
    beforeFile: 'optimization_trajectory_before.json', afterFile: 'optimization_trajectory_final.json' },
  benchmark10k: pair(10000, optimized10k), benchmark50k: pair(50000, optimized50k),
  model0Benchmark10k: pair(10000, optimizedModel0, originalModel0),
  model0Benchmark50k: pair(50000, optimizedModel0, originalModel0),
  model0Repeat10k: pair(10000, optimizedModel0Repeat, originalModel0),
  model0Repeat50k: pair(50000, optimizedModel0Repeat, originalModel0) };
writeFileSync('optimization_comparison.json', JSON.stringify(output,null,2));
console.log('optimization_comparison.json', output.benchmark10k?.seedsCompleted, output.benchmark50k?.seedsCompleted);
