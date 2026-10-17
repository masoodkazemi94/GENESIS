# GENESIS simulation performance and ecology audit

## Decision

Model 0 remains the production default. Model 1 remains opt-in. A separately versioned Model 2 changes only the local shared-food competition formula and also remains opt-in. This audit changes no ecological constants, predator statistics, saved-world fields, or rendering code. The implemented optimizations remove redundant work from Models 0 and 1 and preserve the tested deterministic trajectories. They reduce runtime but do not resolve carnivore extinction or the global-cap dependence of Model 1.

## Profiling method and bottleneck

`scripts/profile_simulation.ts` created matched synthetic worlds with 20, 65, 150, and 220 organisms, each with 250 resource patches. It also varied patches from 50 to 500 at 150 organisms. Each model/scenario had three placement repeats from the same world seed, 20 warmup ticks, and 200 measured ticks. The input organisms had long reproductive cooldowns to hold the population near the requested load. The raw per-tick mean, p95, maximum, CPU process usage, sampled heap change, snapshot size, and instrumented subsystem timings are in `simulation_profile_results_before.json` and `simulation_profile_results.json` (final). These are headless Node measurements, not browser frame times. Instrumented nested timings overlap and must not be added together. Process CPU usage includes runtime and garbage-collector work and is not a precise per-function CPU attribution.

The run environment was Node v22.17.0 on macOS arm64 with 10 logical CPUs; the matched profile used exposed V8 GC. The probe itself adds calls to `performance.now()` at many hot-path sites, so its absolute tick times are higher than uninstrumented play. The separate headless benchmark measures uninstrumented wall time.

| Organisms, 250 patches | Model 0 before, mean/p95 ms | Model 1 before, mean/p95 ms | Model 1 after, mean/p95 ms |
|---|---:|---:|---:|
| 20 | 0.083 / 0.138 | 0.101 / 0.131 | 0.086 / 0.109 |
| 65 | 0.190 / 0.266 | 0.355 / 0.532 | 0.348 / 0.444 |
| 150 | 0.296 / 0.418 | 0.659 / 0.977 | 0.613 / 0.870 |
| 220 | 0.396 / 0.561 | 1.015 / 1.547 | 0.925 / 1.359 |

At 220 organisms and 250 patches, the original Model 1 probe attributed a mean 180.26 ms of 203 ms total across 200 ticks to `engine.behavior`. The nested `chooseFoodTarget` timing was 117.12 ms, including 187,673 candidate scores and 168,522 direct-route checks. Route checks occupied 40.59 ms; organism spatial queries occupied 31.38 ms over 179,234 calls. Resource updates occupied only about 2.7 ms. The food index was rebuilt 400 times for 200 ticks because `engine.step()` and `updateCreatureBehavior()` both populated it. These are invocation averages across the three repeats. At 150 organisms, increasing patches from 50 to 500 increased Model 1 mean tick time from 0.388 to 0.993 ms, with target discovery increasing from 32.65 to 133.88 ms per 200 ticks. Thus population load, resource count, and repeated spatial queries all contribute; total wall time alone would hide those causes.

The original 220-organism profile used about 274.6 ms of process user CPU time per 200 Model 1 ticks, with 33.6 MiB observed heap growth since explicit GC. This heap delta is not total allocations. A serialized world at that load averaged about 370 KB and took about 1.14 ms to stringify; serialization is not part of the ordinary tick and was not the dominant cost. Terrain/climate, genetics/reproduction, and resource updates were minor relative to behavior in these synthetic scenarios. Maximum tick durations and all individual repetitions are retained in the JSON because means hide occasional runtime spikes.

The natural high-density probe of seed 166064, Model 1, instrumented ticks 3,501–4,000 at a mean 219.96 organisms. It measured 1,418.8 ms in behavior over 500 ticks, including 906.3 ms in food target selection, 261.2 ms in mate search, and 163.0 ms in the local food gate. It counted 1,939,350 route checks and 328,179 organism-radius queries. These timings overlap. The matching V8 sampled CPU profile of ticks 3,501–5,500 contained 2,850 samples over 3,589 ms at a mean 198.2 organisms. By self-time source module, about 2,611 sampled ms were in behavior/foraging code, 752 ms in spatial/physics code, 39 ms in organism metabolism, and 19 ms in resource ecology. The largest frame was the food-candidate scoring closure (1,689 sampled ms). `simulation_natural_profile.json`, `simulation_cpu_profile_summary.json`, and the raw `.cpuprofile` preserve these measurements. V8 samples are approximate CPU attribution; source line numbers in transpiled TypeScript are not reliable.

## Changes and trajectory checks

1. `src/simulation/engine.ts` now tells the behavior update that the engine already populated the food index. Direct callers still populate it themselves. This removes one index rebuild per engine tick in either model.
2. `src/simulation/behavior/behavior.ts` skips the nearest-food legacy scan when Model 1 will immediately replace its result with expected-value foraging. It retains the satiated-carnivore utility adjustment.
3. `src/simulation/behavior/foraging.ts` accepts the organism-neighbor list already queried by the behavior update, avoiding a second identical radius query. Direct callers retain their own query.
4. Optional `SimulationProbe` hooks were added to the engine, spatial grid, behavior, route checks, and foraging for reproducible headless profiling. They are absent during normal play and are not serialized.

Source and test files changed for this audit: `src/simulation/performance/probe.ts`, `src/simulation/engine.ts`, `src/simulation/physics/physics.ts`, `src/simulation/behavior/behavior.ts`, `src/simulation/behavior/foraging.ts`, `src/simulation/ecology/config.ts`, `src/behavior_repair.test.ts`, and `scripts/ecology_behavior_benchmark.ts`. New headless measurement scripts are `scripts/profile_simulation.ts`, `scripts/profile_natural_simulation.ts`, `scripts/cpu_profile_steady.ts`, `scripts/verify_optimization_trajectory.ts`, `scripts/predator_ecology_probe.ts`, `scripts/population_cap_probe.ts`, and `scripts/assemble_optimization_comparison.ts`. The regression tests added here cover one food-index build per engine tick, direct behavior-call indexing, shared plant competition, and Model 2 save/restore.

All six full saved-state hashes matched before and after the optimizations for Models 0 and 1 on seeds 10101, 691153, and 260679 after 2,000 ticks. Wall-clock save timestamps were excluded from the hash. The existing Model 1 save/restore regression also passed. The first 20 fixed-seed 10,000-tick benchmark checkpoints matched every recorded ecological field, including population, births, deaths, resources, and target statistics. `optimization_comparison.json` contains the hashes, raw profile comparison, and per-seed benchmark comparison.

The 20 paired Model 1 development seeds also completed 50,000 ticks each, for 1,000,000 ticks in the optimized run. Every recorded 50,000-tick ecological checkpoint matched the prior run. The 10,000-tick sum fell from 123.682 to 101.433 seconds (7.890 to 6.471 microseconds per organism tick). The 50,000-tick sum fell from 843.977 to 758.567 seconds (12.702 to 11.417 microseconds per organism tick). These are separate wall-clock runs rather than simultaneous A/B execution; individual stage profiles were noisy, so the call-count reductions and paired full-run result provide the stronger evidence. Population-normalized costs use the recorded sum of organism counts after each tick as the denominator.

Model 0 also completed the same 20 seeds for 50,000 ticks under the optimized code, with all ecological checkpoints unchanged. Its original run summed to 78.020 seconds; two optimized repeats summed to 85.015 and 76.402 seconds. This variation is larger than the likely food-index saving, so there is **no demonstrated Model 0 speedup or regression**. The synthetic 220-organism profile was essentially unchanged at 0.396 versus 0.399 ms mean tick time. `optimization_comparison.json` retains both optimized Model 0 runs.

| Model 1, 220 synthetic organisms | Mean tick ms, three repeats | Food-index builds / 200 ticks | Organism-radius queries / 200 ticks |
|---|---:|---:|---:|
| Before | 1.015 | 400 | 179,234 |
| After duplicate index removal | 1.013 | 200 | 179,234 |
| After unused legacy discovery removal | 1.000 | 200 | 179,234 |
| After neighbor-query reuse | 0.925 | 200 | 135,474 |

These stages were run separately, not interleaved; differences of a few microseconds per tick are within run noise. Index and query invocation reductions are exact structural effects. Only the combined implementation has a long-run runtime comparison.

## Predator failure experiment

`scripts/predator_ecology_probe.ts` ran three fixed seeds for 5,000 ticks under Models 0 and 1 in three controlled scenarios: natural starting positions, one founder herbivore placed at each founder predator's location, and prey removed. No predator parameter was changed. The metrics are repeated decision and 100-tick spatial observations, not independent animals or a population-level success estimate. Every scenario began with 27 founder predators across the three seeds.

| Scenario, three seeds | Model 1 natural | Model 1 prey colocated | Model 0 natural |
|---|---:|---:|---:|
| Predator samples with visible prey / predator samples | 294 / 585 | 300 / 598 | 261 / 578 |
| Prey pursuit decisions | 5,110 | 6,444 | 17,858 |
| Strike attempts / kills | 111 / 55 | 136 / 64 | 259 / 119 |
| Predator food energy | 3,384 | 3,898 | 6,033 |
| Basal + movement energy spent | 5,219 | 5,806 | 7,891 |
| Predator births / survivors at tick 5,000 | 0 / 0 | 1 / 0 | 4 / 0 |

Visible prey were present in roughly half the sampled predator observations, so complete habitat separation is not the only constraint. About half of actual strikes killed prey, and a successful Model 1 kill returned about 61.5 energy units on average. The larger loss occurs between seeing prey and securing enough kills over a lifetime. Even colocated founder prey did not close the measured energy deficit. Only 10 of 585 natural Model 1 predator samples had a compatible mate within the model's range and an open direct route. Predator loss therefore combines a weak lifetime energy budget with rare local mating opportunities. The three-seed manipulation does not isolate whether search, pursuit, prey depletion, or mate distribution is the dominant cause across worlds. No predator behavior or statistics were altered on this evidence alone.

At 100-tick samples, those natural Model 1 worlds averaged 117.3 prey and 3.9 predators per world; the mean recorded predator death age was 2,488 ticks. Measured energy spent while predator state was `wandering`, `hunting`, or `resting` was about 2,179, 1,162, and 1,710 units respectively. Each state bucket includes basal expenditure; `wandering` is only a proxy for search, and `hunting` includes both pursuit and strikes. Predator deaths were mainly starvation (17 of 27 founders) and senescence (9), with one thermal death. These totals include no lasting predator offspring in the natural Model 1 scenarios.

The separately instrumented natural Model 1 rerun counted 58,757 prey candidates after range and route screening. Of those, 38,016 were rejected for nonpositive expected return, 5,727 for insufficient predator speed, and 15,014 had positive expected value. Another 2,820 were rejected for blocked direct routes. These are repeated candidate evaluations, not unique encounters. The large negative-value group explains why many visible prey do not become pursuits, but a rejection can still be economically correct; the counters alone do not justify relaxing the chase threshold. The run is in `predator_rejection_probe.json`.

## Cap saturation experiment

`scripts/population_cap_probe.ts` compared Models 0, 1, and 2 on fixed seeds 166064, 497022, and 875922 for 10,000 ticks. Only Model 1 seed 166064 reached the cap: first at tick 3,448, for 573 ticks total. It blocked 2,130 birth attempts while recording 413 successful births overall. At capped ticks, accumulated role observations were about 85% scavenger, 15% herbivore, and less than 1% omnivore. At the two 500-tick samples that found the world capped, mean accessible plant biomass per nearby plant consumer was 18.59 and 7.97, while global plant biomass fell from 5,527 to 2,907. The gate nevertheless returned `canMate` on 11,508 decisions begun at cap, and 5,118 decisions selected mating. These are repeated observations, not distinct animals.

Only 22 deaths occurred on ticks that began at cap in that seed: 18 senescence, two dehydration, one thermal stress, and one starvation. There was no measured surge of starvation mortality at cap; blocked births were the immediate limiting mechanism. Model 1 recorded zero immature deaths among 403 total deaths in this seed's first 10,000 ticks. This does not prove juveniles are universally safe: the probe does not follow equal-age birth cohorts to adulthood.

The engine's energy ledger recorded 3,981.9 plant energy units entering via growth or reseeding during ticks 3,001–3,500, while plant biomass lost 4,823.5 units through consumption or environmental damage. During ticks 3,501–4,000, input fell to 364.6 and loss was 2,984.4. These 500-tick totals overlap the cap period; the loss measure is a residual and cannot separate feeding from drought, fire, or other plant damage. They show that resource production continued but did not keep pace with local demand and damage in those intervals.

The source-level cause is that Model 1's local food gate divides plant biomass by nearby consumers of the **same diet**, even though both herbivores and scavengers eat plants. It also treats nearby prey count as a coarse carnivore food proxy. The gate therefore does not reliably represent competition for shared plant biomass. Juvenile deaths were rare in these short worlds, so juveniles did not supply strong density feedback during the measured interval. The wider 30-seed, 50,000-tick behavior benchmark remains the stronger cap warning: every one of 11 Model 1 survivors had reached 220 at least once.

Model 2 corrects only the shared-food denominator: plant biomass is divided among nearby plant-eating diets, while carrion is divided among scavengers. A focused deterministic test shows that adding a scavenger can remove a herbivore's Model 2 mating eligibility when the shared plant supply is insufficient, whereas Model 1 still allows it. Model 2 keeps the same predator rule, constants, inheritance, and initial seed handling as Model 1. It persists through the existing `ecologyConfig.behaviorModel` field with value `2`; old saves retain their prior model. Older app builds may reject a new Model 2 save because they do not recognize that value, so this setting must remain opt-in.

| Paired development seeds | Model 1, 10k | Model 2, 10k | Model 1, 50k | Model 2, 50k |
|---|---:|---:|---:|---:|
| Worlds with organisms / 20 | 15 | 16 | 8 | 7 |
| Worlds with two or more roles / 20 | 8 | 6 | 5 | 4 |
| Worlds with carnivores / 20 | 0 | 0 | 0 | 0 |
| Worlds that reached cap / 20 | 1 | 0 | 10 | 5 |
| Cumulative ticks at cap | 573 | 0 | 36,640 | 19,252 |
| Mean final population | 29.25 | 30.80 | 52.25 | 42.60 |
| Total births | 4,667 | 4,755 | 20,691 | 15,741 |

The 50,000-tick Model 2 screen completed all 20 fixed seeds (1,000,000 ticks). It roughly halved cap occupancy but slightly reduced world and role survival; those one-world differences are uncertain in 20 development seeds. Its 603.4-second sum was lower than Model 1's 758.6 seconds because fewer organism ticks were simulated. Normalized cost was **11.84** versus **11.42 microseconds per organism tick**, so Model 2 is not a performance optimization. The cap still acted for 19,252 ticks. Seed 166064 illustrates delayed saturation: Model 2 never reached 220 by tick 10,000 but accumulated 5,890 capped ticks by 50,000, compared with 5,652 under Model 1. The corrected denominator is not sufficient to make the hard cap an emergency-only guard. `ecology_shared_food_20seed_10k.json` and `ecology_shared_food_20seed_50k.json` retain every seed and checkpoint. No independent holdout was run, and Model 2 remains an experimental option.

## Verification and limits

Final validation passed `npm test` (**95 tests in two files**), `npm run lint` (TypeScript), `npm run build`, and `git diff --check`. The build emitted only its existing Vite `__dirname` and large-chunk warnings. The final six Model 0/1 trajectory hashes still match the preoptimization hashes, and the Model 2 save/restore test passes. The profile confirms a behavioral CPU bottleneck and the paired benchmark supports a Model 1 runtime improvement, but neither experimental model is ecologically fit for promotion. Neither the three-seed predator manipulation nor the three-seed cap probe estimates broad survival rates. No 100-seed long-run holdout was run because predator viability and cap behavior remain unresolved.

## Reproduce

```sh
node --expose-gc --import tsx scripts/profile_simulation.ts
npx tsx scripts/profile_natural_simulation.ts
npx tsx scripts/cpu_profile_steady.ts
TRAJECTORY_OUTPUT=docs/audits/data/optimization_trajectory_final.json npx tsx scripts/verify_optimization_trajectory.ts
PREDATOR_TICKS=5000 npx tsx scripts/predator_ecology_probe.ts
PREDATOR_PROFILE=1 PREDATOR_MODEL1_ONLY=1 PREDATOR_NATURAL_ONLY=1 PREDATOR_OUTPUT=docs/audits/data/predator_rejection_probe.json PREDATOR_TICKS=5000 npx tsx scripts/predator_ecology_probe.ts
CAP_TICKS=10000 npx tsx scripts/population_cap_probe.ts
BEHAVIOR_SEEDS=20 BEHAVIOR_MAX_TICKS=10000 BEHAVIOR_OUTPUT=docs/audits/data/optimization_20seed_10k.json npx tsx scripts/ecology_behavior_benchmark.ts repair
BEHAVIOR_SEEDS=20 BEHAVIOR_MAX_TICKS=50000 BEHAVIOR_OUTPUT=docs/audits/data/optimization_20seed_50k.json npx tsx scripts/ecology_behavior_benchmark.ts repair
BEHAVIOR_SEEDS=20 BEHAVIOR_MAX_TICKS=10000 BEHAVIOR_OUTPUT=docs/audits/data/ecology_shared_food_20seed_10k.json npx tsx scripts/ecology_behavior_benchmark.ts shared_food
BEHAVIOR_SEEDS=20 BEHAVIOR_MAX_TICKS=50000 BEHAVIOR_OUTPUT=docs/audits/data/ecology_shared_food_20seed_50k.json npx tsx scripts/ecology_behavior_benchmark.ts shared_food
BEHAVIOR_SEEDS=20 BEHAVIOR_MAX_TICKS=50000 BEHAVIOR_OUTPUT=docs/audits/data/optimization_model0_20seed_50k.json npx tsx scripts/ecology_behavior_benchmark.ts baseline
BEHAVIOR_SEEDS=20 BEHAVIOR_MAX_TICKS=50000 BEHAVIOR_OUTPUT=docs/audits/data/optimization_model0_repeat_20seed_50k.json npx tsx scripts/ecology_behavior_benchmark.ts baseline
npx tsx scripts/assemble_optimization_comparison.ts
npx vitest run src/behavior_repair.test.ts
npm test
npm run lint
npm run build
```

The profile script overwrites `simulation_profile_results.json`; the before and intermediate profile files preserve the measurements used here. The older `ecology_behavior_experiments.json` supplies the original matched Model 1 per-seed results. Runtime comparisons can vary with machine load; saved-state and ecological metric matches are the behavior-preservation evidence.
