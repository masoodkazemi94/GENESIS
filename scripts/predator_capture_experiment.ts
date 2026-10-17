/** Matched, naturally occurring post-strike Model 1 capture probe. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { SimulationEngine } from '../src/simulation/engine.js';

const seeds = [691153, 260679, 10101];
const horizon = 120;
const round = (n: number) => Number(n.toFixed(3));
type Branch = { scenario: string; contacts: number; strikes: number; kills: number;
  foodGain: number; metabolism: number; preyDeaths: number; predatorDeaths: number;
  targetKilled: boolean; huntDuration: number; netEnergy: number };
const trials: Array<{ seed: number; branches: Branch[]; sourceTick: number;
  predatorId: string; preyId: string; initialDistance: number; preyHealth: number }> = [];
for (const seed of seeds) {
  const source = new SimulationEngine(seed, { behaviorModel: 1 });
  const seen = new Set<string>();
  let selected: { predatorId: string; preyId: string } | null = null;
  let strike: { predatorId: string; preyId: string } | null = null;
  source.observer = {
    onDecision(org, decision) {
      if (org.genome.diet === 'carnivore' && decision.action === 'food' && decision.foodType === 'prey')
        selected = { predatorId: org.id, preyId: decision.foodTargetId! };
    },
    onFeeding(org, food, success) {
      if (org.genome.diet === 'carnivore' && food === 'prey' && !success && selected?.predatorId === org.id)
        strike = selected;
    },
  };
  let collected = 0;
  for (let tick = 0; tick < 5000 && collected < 8; tick++) {
    strike = null;
    source.step();
    if (!strike) continue;
    const { predatorId, preyId } = strike;
    const prey = source.organisms.find(o => o.id === preyId);
    const predator = source.organisms.find(o => o.id === predatorId);
    const key = `${predatorId}:${preyId}`;
    if (!prey || !predator || prey.state === 'dead' || seen.has(key)) continue;
    seen.add(key);
    collected++;
    const saved = structuredClone(source.serializeForStorage());
    assert.equal('woundedPreyFollowThrough' in saved, false);
    if (collected === 1) {
      const a = new SimulationEngine(structuredClone(saved), undefined, { woundedPreyFollowThrough: true });
      const b = new SimulationEngine(structuredClone(saved), undefined, { woundedPreyFollowThrough: true });
      for (let i = 0; i < 30; i++) { a.step(); b.step(); }
      const aState = a.serializeForStorage(), bState = b.serializeForStorage();
      bState.createdTimestamp = aState.createdTimestamp;
      bState.lastSavedTimestamp = aState.lastSavedTimestamp;
      assert.deepEqual(aState, bState);
    }
    const branches: Branch[] = [];
    for (const candidate of [false, true]) {
      const engine = new SimulationEngine(structuredClone(saved), undefined,
        { woundedPreyFollowThrough: candidate });
      const metric = { contacts: 0, strikes: 0, kills: 0, foodGain: 0, metabolism: 0,
        preyDeaths: 0, predatorDeaths: 0, targetKilled: false, huntDuration: horizon };
      engine.observer = {
        onDecision(org, d) {
          if (org.id === predatorId && d.action === 'food' && d.foodType === 'prey' &&
            d.foodDistance !== null && d.foodContactRange !== null && d.foodDistance <= d.foodContactRange)
            metric.contacts++;
        },
        onFeeding(org, food, success, gain) {
          if (org.id !== predatorId || food !== 'prey') return;
          metric.strikes++;
          metric.foodGain += gain;
          if (success) metric.kills++;
        },
        onMetabolism(org, spent) { if (org.id === predatorId) metric.metabolism += spent; },
        onDeath(org, cause) {
          if (org.id === predatorId) metric.predatorDeaths++;
          if (org.id === preyId) metric.targetKilled = cause === 'predation';
          if (org.genome.diet !== 'carnivore' && cause === 'predation') metric.preyDeaths++;
        },
      };
      for (let i = 1; i <= horizon; i++) {
        engine.step();
        if (metric.targetKilled || metric.predatorDeaths) { metric.huntDuration = i; break; }
      }
      branches.push({ scenario: candidate ? 'candidate' : 'baseline', ...metric,
        netEnergy: round(metric.foodGain - metric.metabolism),
        foodGain: round(metric.foodGain), metabolism: round(metric.metabolism) });
    }
    assert.equal(saved.prngState, source.serializeForStorage().prngState);
    trials.push({ seed, sourceTick: source.tick, predatorId, preyId,
      initialDistance: round(Math.hypot(predator.x - prey.x, predator.y - prey.y)),
      preyHealth: round(prey.health), branches });
  }
}
const aggregate = (scenario: string, seed?: number) => {
  const b = trials.filter(t => seed === undefined || t.seed === seed)
    .map(t => t.branches.find(x => x.scenario === scenario)!);
  return { encounters: b.length, successfulContact: b.filter(x => x.contacts > 0).length,
    contactTicks: b.reduce((n, x) => n + x.contacts, 0),
    strikes: b.reduce((n, x) => n + x.strikes, 0),
    kills: b.reduce((n, x) => n + x.kills, 0),
    targetCaptures: b.filter(x => x.targetKilled).length,
    captureProbability: round(b.filter(x => x.targetKilled).length / Math.max(1, b.length)),
    strikesPerKill: round(b.reduce((n, x) => n + x.strikes, 0) / Math.max(1, b.reduce((n, x) => n + x.kills, 0))),
    netEnergy: round(b.reduce((n, x) => n + x.netEnergy, 0)),
    meanHuntDuration: round(b.reduce((n, x) => n + x.huntDuration, 0) / Math.max(1, b.length)),
    preyDeaths: b.reduce((n, x) => n + x.preyDeaths, 0),
    predatorDeaths: b.reduce((n, x) => n + x.predatorDeaths, 0) };
};
const result = { schemaVersion: 1, mechanism: 'wounded-prey follow-through, 1.5x versus 1.15x retained target score within two contact radii',
  developmentOnly: true, seeds, horizon, baseline: aggregate('baseline'), candidate: aggregate('candidate'),
  bySeed: seeds.map(seed => ({ seed, baseline: aggregate('baseline', seed), candidate: aggregate('candidate', seed) })), trials };
for (const trial of trials) assert.deepEqual(trial.branches[0].netEnergy, trial.branches[1].netEnergy);
writeFileSync('docs/audits/data/predator_capture_results.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ baseline: result.baseline, candidate: result.candidate }));
