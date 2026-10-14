/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SimulationEngine } from '../src/simulation/engine.js';
import { PRNG } from '../src/simulation/math/prng.js';
import { queryNeighbors } from '../src/simulation/physics/physics.js';
import * as fs from 'fs';

export interface SeedResult {
  seed: number;
  initialPopulation: number;
  finalPopulation: number;
  peakPopulation: number;
  meanPopulation: number;
  totalBirths: number;
  totalDeaths: number;
  extinctSpecies: number;
  newSpeciesFormed: number;
  finalHerbivores: number;
  finalCarnivores: number;
  finalScavengers: number;
  finalOmnivores: number;
  plantBiomass: number;
  availableWaterSprings: number;
  avgLifespanTicks: number;
  maxGeneration: number;
  totalDisasters: number;
  collapsedAtTick: number | null; // null if sustained
  durationMs: number;
  causesOfDeath: {
    starvation: number;
    dehydration: number;
    predation: number;
    senescence: number;
  };
  traitAverages: {
    speed: number;
    bodySize: number;
    visionRange: number;
    metabolicEfficiency: number;
    heatTolerance: number;
    coldTolerance: number;
  };
}

export function simulateSeed(seed: number, targetTicks = 10000): SeedResult {
  const engine = new SimulationEngine(seed);
  const initialPop = engine.organisms.length;

  let peakPop = initialPop;
  let sumPop = 0;
  let sampleCount = 0;
  let collapsedAt: number | null = null;
  const start = performance.now();

  for (let t = 1; t <= targetTicks; t++) {
    engine.step();

    const curPop = engine.organisms.length;
    if (curPop > peakPop) peakPop = curPop;
    sumPop += curPop;
    sampleCount++;

    if (curPop === 0 && collapsedAt === null) {
      collapsedAt = t;
    }
  }

  const durationMs = performance.now() - start;
  const stats = engine.getStats();

  const totalDeceased = engine.totalDeaths;
  const avgLifespan = totalDeceased > 0 ? (stats.elapsedSeconds * 20) / (totalDeceased / Math.max(1, stats.totalOrganisms + totalDeceased)) : 0;
  const waterSprings = engine.resources.filter((r) => r.type === 'water_spring').reduce((acc, r) => acc + r.amount, 0);
  const extinctCount = Array.from(engine.speciesMap.values()).filter((sp) => sp.extinct).length;
  const newSpeciesCount = Math.max(0, engine.speciesMap.size - 4);

  return {
    seed,
    initialPopulation: initialPop,
    finalPopulation: stats.totalOrganisms,
    peakPopulation: peakPop,
    meanPopulation: Math.round((sumPop / sampleCount) * 10) / 10,
    totalBirths: engine.totalBirths,
    totalDeaths: engine.totalDeaths,
    extinctSpecies: extinctCount,
    newSpeciesFormed: newSpeciesCount,
    finalHerbivores: stats.herbivores,
    finalCarnivores: stats.carnivores,
    finalScavengers: stats.scavengers,
    finalOmnivores: stats.omnivores,
    plantBiomass: stats.plantBiomass,
    availableWaterSprings: Math.round(waterSprings),
    avgLifespanTicks: Math.round(avgLifespan),
    maxGeneration: stats.maxGeneration,
    totalDisasters: engine.climate.disasterHistoryCount || 0,
    collapsedAtTick: collapsedAt,
    durationMs,
    causesOfDeath: { ...engine.causesOfDeath },
    traitAverages: {
      speed: stats.traitAverages.speed,
      bodySize: stats.traitAverages.bodySize,
      visionRange: stats.traitAverages.visionRange,
      metabolicEfficiency: stats.traitAverages.metabolicEfficiency,
      heatTolerance: stats.traitAverages.heatTolerance,
      coldTolerance: stats.traitAverages.coldTolerance,
    },
  };
}

async function main() {
  console.log('================================================================');
  console.log('   GENESIS ADVANCED HEADLESS SIMULATION BENCHMARK & AUDIT   ');
  console.log('================================================================');
  console.log('Platform:', process.platform, process.arch, 'Node:', process.version);
  console.log('PID:', process.pid, 'Timestamp:', new Date().toISOString());

  // ---------------------------------------------------------------------------
  // PHASE 1: 100 INDEPENDENT SEEDS AT 10,000 TICKS
  // ---------------------------------------------------------------------------
  const NUM_SEEDS = 100;
  const TICKS_PER_SEED = 10000;
  console.log(`\n--- PHASE 1: Benchmarking ${NUM_SEEDS} Independent Seeds (${TICKS_PER_SEED} ticks each) ---`);

  const masterPrng = new PRNG(99988877);
  const results: SeedResult[] = [];
  const phase1Start = performance.now();
  let totalTicks = 0;

  for (let s = 1; s <= NUM_SEEDS; s++) {
    const seed = masterPrng.rangeInt(100000, 999999);
    const res = simulateSeed(seed, TICKS_PER_SEED);
    results.push(res);
    totalTicks += TICKS_PER_SEED;

    if (s % 10 === 0 || s === NUM_SEEDS) {
      console.log(
        `[Seed ${s.toString().padStart(3, ' ')}/${NUM_SEEDS}] Seed ${seed} | Final Pop: ${res.finalPopulation.toString().padStart(3, ' ')} ` +
        `(H:${res.finalHerbivores} C:${res.finalCarnivores} S:${res.finalScavengers}) | Peak: ${res.peakPopulation} | ` +
        `Speciated: ${res.newSpeciesFormed} | Time: ${(res.durationMs / 1000).toFixed(2)}s | ${res.collapsedAtTick ? `Collapsed @ ${res.collapsedAtTick}` : 'Sustained'}`
      );
      // Progressive backup
      fs.writeFileSync('benchmark_results.json', JSON.stringify({ inProgressSeedCount: s, results }, null, 2));
    }
  }

  const phase1Duration = performance.now() - phase1Start;
  console.log(`\nPhase 1 Completed: ${NUM_SEEDS} seeds executed in ${(phase1Duration / 1000).toFixed(1)}s (${totalTicks.toLocaleString()} ticks).`);

  // ---------------------------------------------------------------------------
  // PHASE 1 (EXTENDED): 100,000 TICKS DEEP EVOLUTION RUN
  // ---------------------------------------------------------------------------
  console.log('\n--- PHASE 1 (EXTENDED): 100,000 Ticks Deep Evolution Simulation ---');
  const sustained = results.filter((r) => r.finalPopulation >= 15);
  const targetDeepSeed = sustained.length > 0 ? sustained[0].seed : 12345;
  console.log(`Simulating continuous evolutionary deep run on Seed ${targetDeepSeed} for 100,000 ticks...`);

  const deepStart = performance.now();
  const deepEngine = new SimulationEngine(targetDeepSeed);
  let deepPeak = 0;

  for (let t = 1; t <= 100000; t++) {
    deepEngine.step();
    totalTicks++;
    if (deepEngine.organisms.length > deepPeak) deepPeak = deepEngine.organisms.length;

    if (t % 25000 === 0) {
      const s = deepEngine.getStats();
      console.log(
        `Deep Run Tick ${t.toLocaleString().padStart(7, ' ')} | Pop: ${s.totalOrganisms} (H:${s.herbivores} C:${s.carnivores} S:${s.scavengers}) | ` +
        `Active Species: ${s.speciesActiveCount} | Gen: ${s.maxGeneration} | Plants: ${s.plantBiomass} | Births: ${s.totalBirths} | Deaths: ${s.totalDeaths}`
      );
    }
  }
  const deepDuration = performance.now() - deepStart;
  const deepStats = deepEngine.getStats();
  console.log(`100,000 Ticks completed in ${(deepDuration / 1000).toFixed(1)}s. Final Pop: ${deepStats.totalOrganisms}, Peak: ${deepPeak}, Total Species in Tree: ${deepEngine.speciesMap.size}`);

  // ---------------------------------------------------------------------------
  // PHASE 3: PERFORMANCE BENCHMARKING
  // ---------------------------------------------------------------------------
  console.log('\n--- PHASE 3: Performance Benchmarking (Low / Medium / High Population) ---');

  interface PopBench {
    category: 'Low (1-30)' | 'Medium (31-80)' | 'High (81-220)';
    orgCount: number;
    avgTickMs: number;
    p95TickMs: number;
    p99TickMs: number;
    spatialQueryMs: number;
    snapshotSizeBytes: number;
    serializationMs: number;
  }

  const popBenches: PopBench[] = [];
  const configs: { label: 'Low (1-30)' | 'Medium (31-80)' | 'High (81-220)'; targetPop: number }[] = [
    { label: 'Low (1-30)', targetPop: 20 },
    { label: 'Medium (31-80)', targetPop: 65 },
    { label: 'High (81-220)', targetPop: 150 },
  ];

  for (const cfg of configs) {
    const testEngine = new SimulationEngine(888999);
    if (testEngine.organisms.length > cfg.targetPop) {
      testEngine.organisms = testEngine.organisms.slice(0, cfg.targetPop);
    } else {
      while (testEngine.organisms.length < cfg.targetPop) {
        testEngine.organisms.push({ ...testEngine.organisms[0], id: `clone_${testEngine.organisms.length}` });
      }
    }

    for (let i = 0; i < 20; i++) testEngine.step();

    const tickDurations: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      testEngine.step();
      tickDurations.push(performance.now() - t0);
    }

    tickDurations.sort((a, b) => a - b);
    const avg = tickDurations.reduce((a, b) => a + b, 0) / tickDurations.length;
    const p95 = tickDurations[Math.floor(tickDurations.length * 0.95)];
    const p99 = tickDurations[Math.floor(tickDurations.length * 0.99)];

    const sqT0 = performance.now();
    for (let i = 0; i < testEngine.organisms.length; i++) {
      const org = testEngine.organisms[i];
      queryNeighbors(testEngine['spatialGrid'], org.x, org.y, 80);
    }
    const spatialTime = (performance.now() - sqT0) / testEngine.organisms.length;

    const serT0 = performance.now();
    const snap = testEngine.serializeForStorage();
    const json = JSON.stringify(snap);
    const serTime = performance.now() - serT0;

    popBenches.push({
      category: cfg.label,
      orgCount: testEngine.organisms.length,
      avgTickMs: Math.round(avg * 1000) / 1000,
      p95TickMs: Math.round(p95 * 1000) / 1000,
      p99TickMs: Math.round(p99 * 1000) / 1000,
      spatialQueryMs: Math.round(spatialTime * 1000) / 1000,
      snapshotSizeBytes: json.length,
      serializationMs: Math.round(serTime * 100) / 100,
    });
  }

  console.table(popBenches);
  const mem = process.memoryUsage();
  console.log(`Memory: Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB | RSS: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);

  // ---------------------------------------------------------------------------
  // PHASE 4: MULTI-THOUSAND TICK DETERMINISM AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n--- PHASE 4: Multi-Thousand Tick Determinism Validation ---');
  const detSeeds = [10101, 20202, 30303];
  let determinismFailures = 0;

  for (const detSeed of detSeeds) {
    const uninterrupted = new SimulationEngine(detSeed);
    for (let t = 0; t < 10000; t++) uninterrupted.step();

    const forkEngine = new SimulationEngine(detSeed);
    for (let t = 0; t < 5000; t++) forkEngine.step();

    const savedSnapshot = forkEngine.serializeForStorage();
    const restoredEngine = new SimulationEngine(savedSnapshot);
    for (let t = 0; t < 5000; t++) restoredEngine.step();

    const tickMatches = uninterrupted.tick === restoredEngine.tick;
    const orgCountMatches = uninterrupted.organisms.length === restoredEngine.organisms.length;
    const rngStateMatches = uninterrupted['prng'].getState() === restoredEngine['prng'].getState();

    let posDiff = 0;
    for (let i = 0; i < uninterrupted.organisms.length; i++) {
      const u = uninterrupted.organisms[i];
      const r = restoredEngine.organisms[i];
      if (Math.abs(u.x - r.x) > 0.001 || Math.abs(u.y - r.y) > 0.001) posDiff++;
    }

    const isMatch = tickMatches && orgCountMatches && rngStateMatches && posDiff === 0;
    if (!isMatch) determinismFailures++;

    console.log(
      `Seed ${detSeed}: Ticks=${restoredEngine.tick}/${uninterrupted.tick} | Orgs=${restoredEngine.organisms.length}/${uninterrupted.organisms.length} | ` +
      `RNG=${rngStateMatches ? 'MATCH' : 'FAIL'} | Position Divergences: ${posDiff} | Result: ${isMatch ? 'PASSED (100% IDENTICAL)' : 'FAILED'}`
    );
  }

  // ---------------------------------------------------------------------------
  // STATISTICAL SYNTHESIS
  // ---------------------------------------------------------------------------
  const collapsedCount = results.filter((r) => r.collapsedAtTick !== null).length;
  const sustainedCount = NUM_SEEDS - collapsedCount;
  const extinctionRate = (collapsedCount / NUM_SEEDS) * 100;

  const totalBirthsAll = results.reduce((a, b) => a + b.totalBirths, 0);
  const totalDeathsAll = results.reduce((a, b) => a + b.totalDeaths, 0);
  const totalSpeciations = results.reduce((a, b) => a + b.newSpeciesFormed, 0);
  const seedsWithSpeciation = results.filter((r) => r.newSpeciesFormed > 0).length;

  const herbivoreSurv = results.filter((r) => r.finalHerbivores > 0).length;
  const carnivoreSurv = results.filter((r) => r.finalCarnivores > 0).length;
  const scavengerSurv = results.filter((r) => r.finalScavengers > 0).length;

  const causesAll = {
    starvation: results.reduce((a, b) => a + b.causesOfDeath.starvation, 0),
    dehydration: results.reduce((a, b) => a + b.causesOfDeath.dehydration, 0),
    predation: results.reduce((a, b) => a + b.causesOfDeath.predation, 0),
    senescence: results.reduce((a, b) => a + b.causesOfDeath.senescence, 0),
  };

  const traitAveragesAll = {
    speed: Math.round((results.reduce((a, b) => a + b.traitAverages.speed, 0) / NUM_SEEDS) * 100) / 100,
    bodySize: Math.round((results.reduce((a, b) => a + b.traitAverages.bodySize, 0) / NUM_SEEDS) * 100) / 100,
    visionRange: Math.round((results.reduce((a, b) => a + b.traitAverages.visionRange, 0) / NUM_SEEDS) * 10) / 10,
    metabolicEfficiency: Math.round((results.reduce((a, b) => a + b.traitAverages.metabolicEfficiency, 0) / NUM_SEEDS) * 100) / 100,
    heatTolerance: Math.round((results.reduce((a, b) => a + b.traitAverages.heatTolerance, 0) / NUM_SEEDS) * 10) / 10,
    coldTolerance: Math.round((results.reduce((a, b) => a + b.traitAverages.coldTolerance, 0) / NUM_SEEDS) * 10) / 10,
  };

  const finalSummary = {
    totalSeedsTested: NUM_SEEDS,
    totalTicksExecuted: totalTicks,
    sustainedCount,
    collapsedCount,
    extinctionRatePercent: extinctionRate,
    avgFinalPopulation: Math.round((results.reduce((a, b) => a + b.finalPopulation, 0) / NUM_SEEDS) * 10) / 10,
    avgPeakPopulation: Math.round((results.reduce((a, b) => a + b.peakPopulation, 0) / NUM_SEEDS) * 10) / 10,
    totalBirthsAcrossAllSeeds: totalBirthsAll,
    totalDeathsAcrossAllSeeds: totalDeathsAll,
    causesOfDeathAggregate: causesAll,
    speciationEventsTotal: totalSpeciations,
    seedsWithSpeciationRatePercent: (seedsWithSpeciation / NUM_SEEDS) * 100,
    trophicSurvivalRates: {
      herbivorePercent: (herbivoreSurv / NUM_SEEDS) * 100,
      carnivorePercent: (carnivoreSurv / NUM_SEEDS) * 100,
      scavengerPercent: (scavengerSurv / NUM_SEEDS) * 100,
    },
    traitMeans: traitAveragesAll,
    performanceTable: popBenches,
    determinismFailures,
    deepRun: {
      seed: targetDeepSeed,
      ticks: 100000,
      finalPopulation: deepStats.totalOrganisms,
      peakPopulation: deepPeak,
      maxGeneration: deepStats.maxGeneration,
      totalSpeciesEvolved: deepEngine.speciesMap.size,
      durationSeconds: Math.round(deepDuration / 1000),
    },
  };

  fs.writeFileSync('benchmark_results.json', JSON.stringify({ summary: finalSummary, results }, null, 2));
  console.log('\n================================================================');
  console.log('   BENCHMARK COMPLETED SUCCESSFULLY — RESULTS WRITTEN TO FILE   ');
  console.log('================================================================');
  console.log(JSON.stringify(finalSummary, null, 2));
}

main().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
