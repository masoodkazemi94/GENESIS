/** Headless, observational ecology audit; does not change the world. */
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SimulationEngine } from '../src/simulation/engine.js';
import { calculateGeneticDistance, checkMatingCompatibility,
  SPECIATION_DIVERGENCE_THRESHOLD } from '../src/simulation/genetics/genetics.js';
import type { EcologyObserver } from '../src/simulation/ecology/observer.js';
import type { OrganismState } from '../src/types/simulation.js';
import { resolveEcologyConfig } from '../src/simulation/ecology/config.js';

const baseline = JSON.parse(readFileSync('benchmark_results.json', 'utf8'));
const seeds: number[] = process.env.ECOLOGY_SEED
  ? [Number(process.env.ECOLOGY_SEED)]
  : baseline.all100k.results.slice(0, Number(process.env.ECOLOGY_SEEDS || 10)).map((r: {seed:number}) => r.seed);
const ticks = Number(process.env.ECOLOGY_TICKS || 10000);
const sampleEvery = Number(process.env.ECOLOGY_SAMPLE_EVERY || 100);
const outputPath = process.env.ECOLOGY_OUTPUT || 'ecology_diagnostics.json';
const config = resolveEcologyConfig(process.env.ECOLOGY_CONFIG ? JSON.parse(process.env.ECOLOGY_CONFIG) : {});
const round = (x: number) => Number(x.toFixed(3));
const inc = (record: Record<string, number>, key: string, by = 1) => { record[key] = (record[key] || 0) + by; };

function run(seed: number) {
  const engine = new SimulationEngine(seed, config);
  const actions: Record<string, number> = {};
  const feeding: Record<string, number> = {};
  const reproductionFailures: Record<string, number> = {};
  const mutationTraits: Record<string, { count: number; absoluteDeltaSum: number }> = {};
  const deaths: Record<string, number> = {};
  const deathGenerations: Record<string, number> = {};
  const birthsByDiet: Record<string, number> = {};
  const foodEnergyByDiet: Record<string, number> = {};
  const metabolicEnergyByDiet: Record<string, number> = {};
  const mateSamplesByDiet: Record<string, { eligible: number; compatibleAnywhere: number; withinSensor: number; nearestDistanceSum: number }> = {};
  const decisionsByDiet: Record<string, { total: number; visibleFood: number; foodSelected: number; mateReady: number; mateFound: number }> = {};
  const pursuit = new Map<string, { target: string; type: 'plant' | 'prey' | 'carrion'; tick: number; distance: number; beyondContact: boolean }>();
  const travel = { started: 0, reached: 0, abandoned: 0, elapsedTicks: 0, initialDistance: 0,
    beyondContactStarted: 0, beyondContactReached: 0, beyondContactAbandoned: 0,
    beyondContactElapsedTicks: 0 };
  const travelByType: Record<string, { started: number; reached: number; abandoned: number; startingDistanceSum: number }> = {};
  const travelGroup = (type: string) => travelByType[type] ||= { started: 0, reached: 0, abandoned: 0, startingDistanceSum: 0 };
  let energyGained = 0;
  let metabolicSpent = 0;
  const energyCosts = { basal: 0, movement: 0, thermal: 0, flood: 0 };
  let birthBlockedAtCap = 0;
  let births = 0;
  let mutationEvents = 0;
  let maxChildDivergence = 0;
  let nearSpeciation = 0;
  let predatorDetections = 0;
  let predatorPursuitDecisions = 0;
  let foodVisible = 0;
  let foodDecisions = 0;
  let waterVisible = 0;
  let waterDecisions = 0;
  let plantBiomassSum = 0;
  let localPlantCountSum = 0;
  let localPlantBiomassSum = 0;
  let localCarrionCountSum = 0;
  let localWaterCountSum = 0;
  let sampledOrganisms = 0;
  let matesWithinSensor = 0;
  let compatibleMatesAnyDistance = 0;
  let nearestMateDistanceSum = 0;
  let pairDistances = 0;
  let maxWithinSpeciesDistance = 0;
  let isolatedPairs = 0;
  const divergenceBins = [0,0,0,0,0,0,0,0];
  const pairDistanceBins = [0,0,0,0,0,0,0,0];
  const binEdges = [.05,.10,.15,.20,.25,.28,.32];
  const bin = (value: number) => binEdges.findIndex(edge => value < edge) < 0
    ? 7 : binEdges.findIndex(edge => value < edge);
  let divergenceSum = 0;
  let pairDistanceSum = 0;
  let maxIsolationDurationTicks = 0;
  const isolatedPairSince = new Map<string, number>();
  let resourceNearestNeighborSum = 0;
  let resourceNearestNeighborCount = 0;
  let patchCountSum = 0;
  let samples = 0;
  let firstZeroTick: number | null = null;
  let peakPopulation = engine.organisms.length;
  const populationCheckpoints: Array<{tick:number;population:number;roles:Record<string,number>}> = [];

  const observer: EcologyObserver = {
    onDecision(org, o) {
      inc(actions, o.action);
      const diet = org.genome.diet;
      const d = decisionsByDiet[diet] ||= { total: 0, visibleFood: 0, foodSelected: 0, mateReady: 0, mateFound: 0 };
      d.total++;
      if (o.foodType) { d.visibleFood++; foodVisible++; }
      if (o.action === 'food') { d.foodSelected++; foodDecisions++; }
      if (o.waterType) waterVisible++;
      if (o.action === 'water') waterDecisions++;
      if (o.canMate) { d.mateReady++; if (o.mateDistance !== null) d.mateFound++; }
      if (!o.canMate) {
        const reason = !org.isMature ? 'immature' : org.reproductiveCooldown > 0 ? 'cooldown'
          : org.energy < org.genome.fertilityThreshold ? 'energy'
          : org.hydration < 35 ? 'hydration' : 'age';
        inc(reproductionFailures, reason);
      } else if (o.mateDistance === null) inc(reproductionFailures, 'no_mate_within_sense');
      else if (o.action !== 'mate') inc(reproductionFailures, 'other_utility_won');
      if (diet === 'carnivore' && o.foodType === 'prey') {
        predatorDetections++;
        if (o.action === 'food') predatorPursuitDecisions++;
      }

      const previous = pursuit.get(org.id);
      if (o.action === 'food' && o.foodTargetId) {
        if (!previous || previous.target !== o.foodTargetId) {
          if (previous) {
            travel.abandoned++;
            travelGroup(previous.type).abandoned++;
            if (previous.beyondContact) travel.beyondContactAbandoned++;
            pursuit.delete(org.id);
          }
          const beyondContact = (o.foodDistance || 0) > (o.foodContactRange || 0) + 1;
          pursuit.set(org.id, { target: o.foodTargetId, type: o.foodType!, tick: engine.tick,
            distance: o.foodDistance || 0, beyondContact });
          travel.started++;
          travelGroup(o.foodType!).started++;
          travelGroup(o.foodType!).startingDistanceSum += o.foodDistance || 0;
          if (beyondContact) travel.beyondContactStarted++;
          travel.initialDistance += o.foodDistance || 0;
        }
      } else if (previous) {
        travel.abandoned++;
        travelGroup(previous.type).abandoned++;
        if (previous.beyondContact) travel.beyondContactAbandoned++;
        pursuit.delete(org.id);
      }
    },
    onFeeding(org, type, success, gain) {
      inc(feeding, `${type}_${success ? 'success' : 'failed'}`);
      energyGained += gain;
      inc(foodEnergyByDiet, org.genome.diet, gain);
      if (success) {
        const p = pursuit.get(org.id);
        if (p) {
          travel.reached++;
          travelGroup(p.type).reached++;
          travel.elapsedTicks += engine.tick - p.tick;
          if (p.beyondContact) {
            travel.beyondContactReached++;
            travel.beyondContactElapsedTicks += engine.tick - p.tick;
          }
          pursuit.delete(org.id);
        }
      }
    },
    onBirth(child, divergence, mutations) {
      births++;
      inc(birthsByDiet, child.genome.diet);
      mutationEvents += mutations.length;
      for (const mutation of mutations) {
        const entry = mutationTraits[mutation.traitName] ||= { count: 0, absoluteDeltaSum: 0 };
        entry.count++;
        entry.absoluteDeltaSum += Math.abs(mutation.delta);
      }
      maxChildDivergence = Math.max(maxChildDivergence, divergence);
      divergenceBins[bin(divergence)]++;
      divergenceSum += divergence;
      if (divergence >= SPECIATION_DIVERGENCE_THRESHOLD * .8) nearSpeciation++;
    },
    onBirthBlocked(reason) { if (reason === 'population_cap') birthBlockedAtCap++; },
    onDeath(org, cause) {
      inc(deaths, `${org.speciesId}:${cause}`);
      inc(deathGenerations, `${org.generation}:${cause}`);
      const p = pursuit.get(org.id);
      if (pursuit.delete(org.id)) {
        travel.abandoned++;
        travelGroup(p!.type).abandoned++;
        if (p?.beyondContact) travel.beyondContactAbandoned++;
      }
    },
    onMetabolism(org, spent, costs) {
      metabolicSpent += spent;
      inc(metabolicEnergyByDiet, org.genome.diet, spent);
      energyCosts.basal += costs.basal;
      energyCosts.movement += costs.movement;
      energyCosts.thermal += costs.thermal;
      energyCosts.flood += costs.flood;
    },
  };
  engine.observer = observer;
  const started = performance.now();
  for (let t = 1; t <= ticks; t++) {
    engine.step();
    peakPopulation = Math.max(peakPopulation, engine.organisms.length);
    if (engine.organisms.length === 0 && firstZeroTick === null) firstZeroTick = t;
    if (t === 10000 || t === 100000 || t === 250000 || t === ticks) {
      const roles: Record<string, number> = {};
      for (const org of engine.organisms) inc(roles, org.genome.diet);
      populationCheckpoints.push({ tick: t, population: engine.organisms.length, roles });
    }
    if (t % sampleEvery !== 0) continue;
    samples++;
    const plants = engine.resources.filter(r => r.type === 'plant' && r.amount > 1.5);
    const isolatedThisSample = new Set<string>();
    patchCountSum += plants.length;
    plantBiomassSum += plants.reduce((s, r) => s + r.amount, 0);
    for (const org of engine.organisms) {
      sampledOrganisms++;
      const radiusSq = org.genome.sensoryRadius ** 2;
      for (const res of engine.resources) {
        const ds = (res.x - org.x) ** 2 + (res.y - org.y) ** 2;
        if (res.type === 'plant' && res.amount > 1.5 && ds < radiusSq) {
          localPlantCountSum++;
          localPlantBiomassSum += res.amount;
        }
        if (res.type === 'carrion' && res.amount > .5 && ds < radiusSq) localCarrionCountSum++;
        if (res.type === 'water_spring' && res.amount > .5 && ds < radiusSq) localWaterCountSum++;
      }
      let nearest = Infinity;
      for (const other of engine.organisms) {
        if (other.id === org.id || other.speciesId !== org.speciesId) continue;
        const distance = Math.hypot(other.x - org.x, other.y - org.y);
        const genetic = calculateGeneticDistance(org.genome, other.genome);
        maxWithinSpeciesDistance = Math.max(maxWithinSpeciesDistance, genetic);
        pairDistanceBins[bin(genetic)]++;
        pairDistanceSum += genetic;
        if (genetic > .28) {
          isolatedPairs++;
          const pairKey = org.id < other.id ? `${org.id}|${other.id}` : `${other.id}|${org.id}`;
          isolatedThisSample.add(pairKey);
          if (!isolatedPairSince.has(pairKey)) isolatedPairSince.set(pairKey, t);
          maxIsolationDurationTicks = Math.max(maxIsolationDurationTicks, t - isolatedPairSince.get(pairKey)!);
        }
        pairDistances++;
        if (checkMatingCompatibility(org, other).compatible && distance < nearest) nearest = distance;
      }
      if (Number.isFinite(nearest)) {
        const group = mateSamplesByDiet[org.genome.diet] ||= { eligible: 0, compatibleAnywhere: 0, withinSensor: 0, nearestDistanceSum: 0 };
        group.compatibleAnywhere++;
        group.nearestDistanceSum += nearest;
        compatibleMatesAnyDistance++;
        nearestMateDistanceSum += nearest;
        if (nearest <= org.genome.sensoryRadius) { matesWithinSensor++; group.withinSensor++; }
      }
      if (org.isMature && org.reproductiveCooldown === 0 && org.energy >= org.genome.fertilityThreshold && org.hydration >= 35) {
        const group = mateSamplesByDiet[org.genome.diet] ||= { eligible: 0, compatibleAnywhere: 0, withinSensor: 0, nearestDistanceSum: 0 };
        group.eligible++;
      }
    }
    for (const pairKey of isolatedPairSince.keys()) {
      if (!isolatedThisSample.has(pairKey)) isolatedPairSince.delete(pairKey);
    }
    // Sample nearest-neighbor spacing among viable plant patches (density/clustering).
    for (const plant of plants) {
      let nearestSq = Infinity;
      for (const other of plants) {
        if (other.id === plant.id) continue;
        const ds = (other.x - plant.x) ** 2 + (other.y - plant.y) ** 2;
        if (ds < nearestSq) nearestSq = ds;
      }
      if (Number.isFinite(nearestSq)) { resourceNearestNeighborSum += Math.sqrt(nearestSq); resourceNearestNeighborCount++; }
    }
  }
  return {
    seed, ticks, elapsedSeconds: round((performance.now() - started) / 1000),
    finalPopulation: engine.organisms.length, firstZeroTick, peakPopulation, populationCheckpoints,
    births, deathsTotal: engine.totalDeaths,
    newSpecies: engine.speciesMap.size - 4, actions, feeding, deaths, deathGenerations,
    decisionsByDiet, foodVisible, foodDecisions, waterVisible, waterDecisions,
    predatorDetections, predatorPursuitDecisions,
    travel: { ...travel, byType: travelByType,
      successRate: travel.started ? round(travel.reached / travel.started) : null,
      meanTimeToFeedTicks: travel.reached ? round(travel.elapsedTicks / travel.reached) : null,
      beyondContactSuccessRate: travel.beyondContactStarted ? round(travel.beyondContactReached / travel.beyondContactStarted) : null,
      meanTravelTicksBeyondContact: travel.beyondContactReached ? round(travel.beyondContactElapsedTicks / travel.beyondContactReached) : null,
      meanStartingDistance: travel.started ? round(travel.initialDistance / travel.started) : null },
    energy: { gainedFromFood: round(energyGained), metabolicSpent: round(metabolicSpent),
      costs: Object.fromEntries(Object.entries(energyCosts).map(([name, value]) => [name, round(value)])),
      ratio: metabolicSpent ? round(energyGained / metabolicSpent) : null,
      byDiet: Object.fromEntries(Object.keys(decisionsByDiet).map(diet => [diet, { gained: round(foodEnergyByDiet[diet] || 0), spent: round(metabolicEnergyByDiet[diet] || 0) }])) },
    reproduction: { births, birthsByDiet, birthBlockedAtCap, reproductionFailures, mutationEvents,
      mutationTraits: Object.fromEntries(Object.entries(mutationTraits).map(([name, x]) => [name,
        { count: x.count, meanAbsoluteDelta: round(x.absoluteDeltaSum / x.count) }])),
      mutationsPerBirth: births ? round(mutationEvents / births) : null },
    resources: { samples, meanGlobalPlantPatches: samples ? round(patchCountSum / samples) : null,
      meanGlobalPlantBiomass: samples ? round(plantBiomassSum / samples) : null,
      sampledOrganisms, meanLocalPlantPatches: sampledOrganisms ? round(localPlantCountSum / sampledOrganisms) : null,
      meanLocalPlantBiomass: sampledOrganisms ? round(localPlantBiomassSum / sampledOrganisms) : null,
      meanLocalCarrionPatches: sampledOrganisms ? round(localCarrionCountSum / sampledOrganisms) : null,
      meanLocalSpringPatches: sampledOrganisms ? round(localWaterCountSum / sampledOrganisms) : null,
      meanPlantNearestNeighborDistance: resourceNearestNeighborCount ? round(resourceNearestNeighborSum / resourceNearestNeighborCount) : null },
    mating: { compatibleMatesAnyDistance, matesWithinSensor, byDiet: mateSamplesByDiet,
      meanNearestCompatibleMateDistance: compatibleMatesAnyDistance ? round(nearestMateDistanceSum / compatibleMatesAnyDistance) : null },
    genetics: { maxChildDivergence: round(maxChildDivergence), meanChildDivergence: births ? round(divergenceSum / births) : null,
      childDivergenceBins: divergenceBins, distanceBinUpperBounds: [...binEdges, 1], nearSpeciationBirths: nearSpeciation,
      maxWithinSpeciesDistance: round(maxWithinSpeciesDistance), meanWithinSpeciesDistance: pairDistances ? round(pairDistanceSum / pairDistances) : null,
      withinSpeciesDistanceBins: pairDistanceBins, isolatedPairSamples: isolatedPairs,
      maxObservedIsolationDurationTicks: maxIsolationDurationTicks, pairSamples: pairDistances },
  };
}

const results = seeds.map((seed, i) => { const result = run(seed); console.log(`${i + 1}/${seeds.length}: ${seed} final=${result.finalPopulation}`); return result; });
writeFileSync(outputPath, JSON.stringify({ schemaVersion: 1, method: `observer hooks plus ${sampleEvery}-tick spatial samples`, config, seeds, ticksPerSeed: ticks,
  totalTicks: results.reduce((s,r) => s + r.ticks, 0), results }, null, 2));
