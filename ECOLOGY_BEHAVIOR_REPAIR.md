# GENESIS behavioral ecology repair

## Status

The revised behavior is an **opt-in experimental model** (`ecologyConfig.behaviorModel = 1`). New worlds and existing saves use model 0 unless the model is explicitly selected. This preserves the completed production-baseline audit and prevents an unverified behavior change from being silently adopted. Extinction remains possible; there is no rescue or forced hunt, birth, or speciation.

## Confirmed mechanisms in the prior code

1. Scavengers selected carrion first and inspected plants only when no carrion existed. The seed 691153 diagnostic measured a fall in completed carrion pursuits from 56.4% at historical reach to 31.9% with longer scent reach, with one organism left versus 29 at tick 10,000. This was a decision-order problem, not evidence that carrion should be hidden.
2. Other diets generally chose the nearest visible target. The choice did not estimate energy return, likely pursuit cost, prey escape, depletion, competition, or intervening flooded or unwalkable terrain. The physics layer repelled creatures from obstacles but the decision layer could keep selecting a target behind them.
3. Mating was opportunistic inside the ordinary sensory radius and did not check local future food supply. A stored energy reserve alone could support repeated births around a depleted habitat until the global cap was reached.
4. Plant reseeding counted all resource objects, including springs and carrion, against a plant-patch threshold. Plant-only reseeding in the earlier calibration improved survival but produced cap saturation when used by itself.

## Experimental implementation

`src/simulation/behavior/foraging.ts` scores edible targets by bounded near-term energy gain, travel distance and metabolic estimate, prey speed and strike count, resource depletion, local competitors, predators near a resource, hunger, and a small carrion preference. It rejects a direct route crossing blocked or flooded terrain. A current target receives a 15% hysteresis preference while it remains valid; danger, thirst, starvation, or a materially better target can interrupt it. The route check does not find a detour around an obstacle: creatures must wander to discover another approach.

The experimental mating decision senses compatible partners at 1.5 times the normal radius, keeps a nearly equivalent current mate, and requires local food per consumer before attempting a birth. For carnivores, nearby prey is the local food proxy. Both parents still need inherited fertility traits, maturity, hydration, cooldown, and stored energy, and the existing cap guard still prevents charging a blocked birth. Experimental plant reseeding counts viable plant patches and avoids placing a new patch within 35 world units of another plant; the existing local plant suitability, flood, and drought checks still apply.

The model uses no random draws in target scoring. It keeps existing target state fields, so no new organism state is required in saves. `behaviorModel` is an optional versioned ecology setting; missing values resolve to model 0. Old version-2 saves validate and retain their historical effective carrion reach. A world saved with model 1 restores model 1.

Files changed for this trial: `src/simulation/ecology/config.ts` (behavior version), `src/simulation/behavior/foraging.ts` (scored targets and direct-route check), `src/simulation/behavior/behavior.ts` (model selection, predator rest, mate search, and local food gate), `src/simulation/ecosystem/ecosystem.ts` (plant-only, spatially separated reseeding), `src/simulation/engine.ts` (experimental reseeding wiring), `src/behavior_repair.test.ts` (focused regressions), and `scripts/ecology_behavior_benchmark.ts` (headless comparison). No rendering or HUD file changed.

## Focused deterministic scenarios

`src/behavior_repair.test.ts` covers nearby plant versus distant carrion, the converse profitable carrion case, target hysteresis, an unprofitable chase, a viable predator kill, predator reproduction with prey and a compatible mate, blocked-route rejection, birth suppression during local scarcity, reproduction after plant recovery, no cap charge, saved-state replay, and old-save compatibility. These scenarios validate mechanisms, not whole-ecosystem balance.

## Paired development benchmark

`ecology_behavior_baseline.json` and `ecology_behavior_experiments.json` use the same first 30 original audit seeds for 10,000 and 50,000 ticks each. Both configurations completed all **30 seeds × 50,000 ticks = 1,500,000 ticks** each, with checkpoints at 10,000 ticks. Per-seed records include population, cap occupancy, trophic roles, species, births, prey strikes and kills, predator food gain and metabolic spending, local edible food visibility and direct-route reachability, target switches, pursuit completion, plant biomass, and wall-clock runtime. The separate `ecology_behavior_short.json` repeats the experimental 10,000-tick run; its state metrics matched the first checkpoint of all 30 longer runs. The two runtime sums differed because of ordinary execution conditions, so the table uses the paired longer runs.

| At 10,000 ticks, 30 paired seeds | Audited baseline | Experimental model |
|---|---:|---:|
| Worlds with organisms | 18 | 24 |
| Worlds with two or more roles | 1 | 10 |
| Worlds with carnivores | 0 | 0 |
| Mean final population | 11.23 | 28.60 |
| Worlds that reached 220 organisms | 0 | 1 |
| Carnivore births | 35 | 21 |
| Predator kills / strikes | 1,037 / 2,139 | 592 / 1,240 |
| Predator food energy / measured metabolic energy | 55,523 / 75,647 | 38,720 / 58,330 |
| Food target switches / starts | 68,322 / 223,202 | 44,369 / 198,164 |
| Completed food pursuits / starts | 112,802 / 223,202 | 129,706 / 198,164 |
| Direct-route edible food observations / sampled organism observations | 7,680 / 11,865 | 20,369 / 22,103 |
| Sum of measured per-seed runtime | 32.8 s | 199.9 s |

The repeated decision and food-access observations are not independent animals. The higher reachability rate and lower target-switch rate show changed behavior and population composition together; they do not isolate a causal survival mechanism. Predator intake is still below metabolic spending and predator birth count fell. No carnivores remained at tick 10,000 under either model. On selected seed 691153, the experimental model ended with 74 scavengers rather than one under the audited baseline, but this is not a diverse ecosystem.

| At 50,000 ticks, same 30 seeds | Audited baseline | Experimental model |
|---|---:|---:|
| Worlds with organisms | 4 | 11 |
| Worlds with two or more roles | 1 | 8 |
| Worlds with carnivores | 0 | 0 |
| Mean / median final population | 6.10 / 0 | 53.70 / 0 |
| Worlds that reached 220 organisms | 1 | 13 |
| Cumulative ticks at cap | 143 | 44,626 |
| Carnivore births | 35 | 21 |
| Predator kills / strikes | 1,037 / 2,139 | 636 / 1,324 |
| Predator food energy / measured metabolic energy | 55,523 / 75,647 | 38,720 / 58,330 |
| Food target switches / starts | 193,836 / 495,642 | 240,644 / 849,724 |
| Completed food pursuits / starts | 217,215 / 495,642 | 512,143 / 849,724 |
| Mean final plant biomass | 8,411 | 10,261 |
| Sum of measured per-seed runtime | 108.2 s | 1,333.2 s |

All **11** experimental survivors reached the cap at least once. Eight retained at least two roles, but the minority roles were only **0.46%–3.01%** of their final populations (median **1.16%**). Most survivors were overwhelmingly scavengers; one was 220 herbivores. Seed 691153 ended at the cap with 217 scavengers, two herbivores, and one omnivore. The global cap therefore still influences population outcomes, even though the local food gate prevented some individual births. The experimental model used about **12.3 times** the baseline measured runtime at 50,000 ticks. This combines higher population load with more expensive target scoring; the benchmark does not isolate their shares.

Pairing by seed, at 50,000 ticks three worlds survived in both models, one only in baseline, and eight only in the experimental model. For two-role worlds, one survived in both and seven only in the experimental model. The 95% Wilson survival intervals are **5.3–29.7%** for baseline (4/30) and **21.9–54.5%** for the experiment (11/30). These small development samples do not establish an independent generalization. A seed fixes the initial world, but changed decisions consume the shared simulation RNG at different times, so later shocks are not identical across models.

## Production decision and limitations

**Do not adopt model 1 as the production default.** The development benchmark failed predator viability and population-regulation goals, so a 100-original-seed plus 50-holdout-seed 100,000-tick run was not justified. No `ecology_behavior_holdout.json` was created, and no independent holdout claim is made. The next mechanism work should test predator search during scarcity, spatial overlap of predators and prey, and why herbivore/scavenger reproduction still drives some worlds into the cap. These should be changed and screened independently before another large run.

A direct-route test may reject a reachable food patch requiring a detour. The expected-return estimate simplifies prey behavior and does not replace a measured capture probability. Local food per consumer is a short-range reproduction gate, not a calibrated biological carrying-capacity model. Scored food choices improved pursuit completion in the development seeds but did not close the predator energy deficit; by 10,000 ticks carnivores were extinct in every tested world. The model is also much slower under high population load. No mutation or speciation threshold was changed; no new species formed in either configuration.

## Reproduce

```sh
npx vitest run src/behavior_repair.test.ts
npx tsx scripts/ecology_behavior_benchmark.ts baseline
npx tsx scripts/ecology_behavior_benchmark.ts repair
BEHAVIOR_MAX_TICKS=10000 BEHAVIOR_OUTPUT=ecology_behavior_short.json npx tsx scripts/ecology_behavior_benchmark.ts repair
npm test
npm run lint
npm run build
```

Each benchmark command overwrites its corresponding JSON file and prints completed seed counts. Environment and exact seeds are stored in the results. The benchmark uses headless Node execution, not browser rendering.

The final run passed `npm test` (**92 tests**), `npm run lint`, and `npm run build`. The build retained existing Vite warnings about `__dirname` and bundle size.
