# GENESIS ecology calibration

## Decision state

The provisional spectator-game targets are **not met**. The completed one-factor and limited interaction screen did not preserve carnivores to tick 10,000 or produce speciation. The long-run candidate improved survival, but most surviving worlds spent tens of thousands of ticks at the hard population cap. Production defaults therefore retain the existing growth, feeding, metabolism, predation, reproduction, and disaster parameters. The confirmed behavior and death-attribution corrections are documented in `ECOLOGY_DIAGNOSTICS.md`.

## Controlled screen

All variants used the **same first 20 seeds** from the original fixed 100-seed audit for **10,000 ticks** each. The screen completed **19 configurations × 20 seeds × 10,000 ticks = 3,800,000 simulated ticks**. Baseline here means the corrected carrion-targeting and cap behavior with all optional ecology settings at their default values; it is distinct from the historical `benchmark_results.json` baseline.

| Configuration | Worlds alive / 20 | Worlds with ≥2 roles / 20 | Carnivores alive / 20 | Mean final population | Worlds at cap / 20 |
|---|---:|---:|---:|---:|---:|
| Corrected default | 14 | 1 | 0 | 12.75 | 0 |
| Plant growth ×1.2 | 11 | 2 | 0 | 14.85 | 0 |
| Initial plant capacity ×1.2 | 12 | 1 | 0 | 12.00 | 0 |
| Initial plants 250 | 13 | 1 | 0 | 19.10 | 0 |
| Feeding efficiency ×1.1 | 13 | 1 | 0 | 12.20 | 0 |
| Basal metabolism ×0.9 | 13 | 0 | 0 | 10.05 | 0 |
| Movement cost ×0.9 | 13 | 1 | 0 | 10.05 | 0 |
| Predator strike damage ×1.1 | 12 | 0 | 0 | 9.70 | 0 |
| Predator pursuit cost ×0.9 | 13 | 0 | 0 | 10.60 | 0 |
| Carrion scent radius ×1.2 | 9 | 0 | 0 | 5.20 | 0 |
| Mate detection radius ×1.2 | 10 | 1 | 0 | 5.40 | 0 |
| Disaster frequency ×0.8 | 14 | 1 | 0 | 12.75 | 0 |
| Disaster severity ×0.9 | 15 | 1 | 0 | 14.10 | 0 |
| Plant-only reseeding count | 13 | 1 | 0 | 26.15 | 1 |
| Plant-only reseeding + severity ×0.9 | 14 | 1 | 0 | 26.35 | 1 |
| Initial plants 250 + severity ×0.9 | 13 | 1 | 0 | 17.05 | 0 |
| Plant-only reseeding + initial plants 250 | 14 | 1 | 0 | 25.75 | 0 |
| Herbivore fertility threshold ×0.9, corrected control | 13 | 1 | 0 | 14.20 | 0 |

An earlier fertility-threshold run matched baseline exactly because the configurable gate changed while the mating utility still used the original threshold. It was retained in `ecology_experiments.json` for provenance but excluded from interpretation. The control was corrected and rerun as the final row. The 20-world screen is paired by seed and was used for hypothesis screening only. For example, 15/20 versus 14/20 surviving worlds is one world, far below a convincing improvement. None of the valid variants showed carnivore persistence or speciation by tick 10,000.

The same seed fixes initial geography and initial random state, but a changed birth, plant reseed, or disaster can consume a different number of random draws and alter later weather and behavior. Thus these are paired-world outcomes, not controlled trials with identical later random shocks. A future common-random-stream design would separate climate, reproduction, and resource RNG streams; introducing that change now would invalidate comparison with the retained historical baseline.

The plant-only reseeding experiment is motivated by a source-level defect: the original reseeding threshold counts springs and carrion as if they were plant patches. It roughly doubled mean final population in this screen but did not improve the number of surviving worlds and reached the 220-organism cap in one. Its ecological effect requires long-run and holdout checks before use as a default.

## Long-run verification

`ecology_holdout_results.json` contains **300 completed 100,000-tick runs**, comparing the corrected default with plant-only reseeding plus disaster severity ×0.9 on the same 100 original and 50 new holdout seeds. This is **30,000,000 executed ticks**. It records every seed's population, roles, new species, generations, plant biomass, disasters, cap occupancy, and wall-clock runtime. The historical 100-seed outcome remains in `benchmark_results.json` for regression context.

| Configuration and seed set | Alive at 100k | ≥2 roles at 100k | Carnivores at 10k | New species | Ever at cap | Mean final population | Total cap ticks |
|---|---:|---:|---:|---:|---:|---:|---:|
| Corrected default, original 100 | 1/100 (1%) | 0/100 | 0/100 | 0 | 1/100 | 2.20 | 5,122 |
| Candidate, original 100 | 33/100 (33%) | 6/100 (6%) | 0/100 | 0 | 43/100 | 69.89 | 1,996,947 |
| Corrected default, holdout 50 | 1/50 (2%) | 1/50 (2%) | 0/50 | 0 | 1/50 | 4.40 | 6,045 |
| Candidate, holdout 50 | 15/50 (30%) | 4/50 (8%) | 0/50 | 0 | 22/50 | 65.60 | 894,850 |

| Configuration and seed set | Median time to extinction among extinct worlds | Births / deaths | Mean plant biomass across time | Maximum generation observed |
|---|---:|---:|---:|---:|
| Corrected default, original 100 | 11,082 ticks | 25,335 / 31,715 | 9,438 | 188 |
| Candidate, original 100 | 9,984 ticks | 185,138 / 184,749 | 14,993 | 160 |
| Corrected default, holdout 50 | 12,247 ticks | 11,566 / 14,646 | 9,373 | 182 |
| Candidate, holdout 50 | 11,588 ticks | 93,991 / 94,011 | 15,625 | 191 |

Plant biomass is sampled every 1,000 ticks and averaged within each world, then across worlds. The extinction median excludes survivors. A larger maximum generation in a single world does not imply stronger population-wide evolution; the raw per-seed generation data is in the JSON.

The candidate's 95% Wilson intervals for survival are **24.6–42.7%** on original seeds and **19.1–43.8%** on holdouts. The corresponding corrected-default intervals are **0.2–5.4%** and **0.4–10.5%**. These intervals describe finite-seed sampling uncertainty, not model validity. Pairing shows 32 candidate-only survivors and no default-only survivors among original seeds; holdouts had 15 candidate-only survivors and one default-only survivor. Thus the survival effect is real within this experiment, though its ecological quality is poor.

Every candidate survivor had reached the 220-organism cap. Candidate survivors spent an average **58,219** cap ticks on original seeds and **54,488** on holdouts; 28/33 and 14/15 respectively finished at the cap. Across all candidate runs, cap occupancy totaled **20.0%** and **17.9%** of possible ticks in the two seed sets, despite most worlds becoming extinct. The median final population was zero in both sets. This violates the target that populations should not remain pinned to the cap; it also makes the survival percentage a misleading standalone quality metric. The candidate fails the 50% survival, 30% two-role, carnivore, and speciation targets. No candidate multiplier was adopted as a production default.

The 50-seed historical-carrion-reach holdout in `ecology_legacy_holdout.json` also finished: **1/50** survived at 100,000 ticks, **1/50** retained two roles, and **0/50** retained carnivores or speciated. The corrected-reach default likewise yielded 1/50 survivors, though on a different seed. This does not establish an aggregate survival benefit from wider carrion scent; the selected-seed diagnostic documents a downside. The reach correction remains a literal fix to the query-radius mismatch, with existing saves preserving old reach.

## Performance and replay

The corrected-default 100-seed set took **559 seconds** and the 50 holdouts **305 seconds**. The candidate took **3,049** and **1,451 seconds** respectively, about five times longer overall as more animals remained active. These are measured headless wall-clock times on the environment stated in `ECOLOGY_DIAGNOSTICS.md`; they are not browser frame rates. A separate 200-tick synthetic load check measured default mean/p95 tick time of **0.083/0.100 ms** at 20 organisms, **0.215/0.308 ms** at 65, and **0.186/0.206 ms** at 150. Candidate results were **0.049/0.067**, **0.096/0.105**, and **0.203/0.226 ms**. Short runs, JIT warm-up, and garbage collection limit cross-configuration comparison; the long-run runtime is the more relevant cost measurement. Peak Node heap measurements and raw timings are retained in `ecology_verification_checks.json` within the holdout artifact.

For each configuration, three fixed seeds were saved after 2,000 ticks, restored, and run for another **10,000 ticks** alongside uninterrupted copies. All **six** replays matched serialized organism, resource, event, ID, and RNG state immediately after restore and after continuation. This verifies replay for those seeds and configurations, not all possible save states.

## Why the provisional targets are difficult

The historical 100-world audit had only **2/100** surviving worlds at tick 100,000, no carnivores at tick 10,000, and no spontaneous speciation. The corrected ten-world diagnostics found a carnivore food-energy deficit, very sparse spatial mating opportunities, and newborn divergence well below the current threshold. Higher plant reseeding sustained herbivores but did not restore predators or diverse food webs. The current model's taxon splitting is triggered by a single newborn's distance from a founder genome; it does not yet measure sustained reproductive isolation of subpopulations. The target of 10% genuine speciation by 100,000 ticks is therefore not a suitable acceptance gate for this implementation without a population-level speciation design.

The pragmatic next design targets should separately track: (1) world survival, (2) roles present, (3) predator food-energy budget and mating opportunities, (4) local reachable food and water, (5) cap occupancy, and (6) persistent spatially isolated lineages. Their thresholds should be chosen only after broad holdout data. Extinction should remain possible; none of these measurements calls for a rescue mechanism or scheduled species creation.

## Save compatibility and determinism

`SavedWorldData` now carries optional `ecologyConfig`. An old save without that field loads with the historical effective scavenger carrion reach (ordinary sensory range), so the scent correction does not silently change its balance. New worlds use the corrected 1.8× scent reach. A resumed old world adopts the cap-charge and death-attribution fixes; its future trajectory can differ from an uninterrupted run of older code. Old death counters are retained and new `thermal` and `disaster` counters start at zero. The save version remains 2 because the new field is optional; the field is written on the next save and validated when present. No historical deaths are reclassified.

## Commands

```sh
npx tsx scripts/ecology_experiments.ts screen
npx tsx scripts/ecology_experiments.ts followup
npx tsx scripts/ecology_experiments.ts verify
npx tsx scripts/ecology_experiments.ts legacy-holdout
npx tsx scripts/ecology_verification_checks.ts
npx tsx scripts/assemble_ecology_holdout.ts
npm test
npm run lint
npm run build
```

The verify command executes 100 original seeds plus 50 holdout seeds at 100,000 ticks for **each** of the two configurations. It writes progress after each seed. Runtime varies by machine; the per-seed durations in JSON are measured wall-clock values. The legacy-holdout command adds 50 fixed-seed 100,000-tick runs with the historical effective scent reach. `ecology_experiments.json` contains the screen configurations and raw per-seed results, including the early ineffective fertility-control run.
