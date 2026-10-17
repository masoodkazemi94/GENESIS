# GENESIS ecology diagnostics

## Scope and provenance

This document describes completed headless runs. The original 100-seed audit is retained in `SIMULATION_AUDIT.md` and `benchmark_results.json`. Observer data is in `ecology_diagnostics.json` and its component files. The observer records decisions, feeding, births, metabolism, deaths, and periodic spatial samples without consuming the simulation RNG. The original ten-seed diagnostic was captured before the behavior corrections; a separate ten-seed diagnostic was captured after them. The original long-lived seed was also tested at 100,000 ticks before correction and at 500,000 ticks after correction.

Environment: Node v22.17.0, macOS arm64, Apple M4, 10 logical cores, 16 GiB RAM. This is headless Node execution, not browser frame performance. The fixed seeds are listed in the JSON files.

## Observed access and behavior

In ten corrected worlds run for 10,000 ticks each (100,000 completed ticks), the observer recorded **2,325,414 organism decisions with a food target visible** and **883,025 decisions selecting food**. These are repeated decisions by the same organisms, not independent animals. It recorded **30,544 successful plant feeding actions**, **914 successful carrion feeding actions**, **345 successful predator strikes**, **365 nonlethal strikes**, and **6 plant attempts after a patch was depleted**. Carnivores detected prey on 67,629 decisions and selected a food pursuit on 39,505 of those decisions.

Across those worlds, food gave organisms **360,537** energy units while measured metabolism spent **357,100**. By diet, gains/spending were herbivores **304,640/289,588**, scavengers **37,189/41,970**, and carnivores **18,708/25,542**. These totals omit reproductive investment and thermal injury, and an energy ratio near one does not mean an individual lineage is viable. The carnivore deficit is a measured warning sign.

The measured metabolic spending broke down into **219,099 basal**, **126,064 movement**, **11,877 thermal**, and **60 flood** energy units (rounded). Actual energy removed was allocated proportionally across components when an organism had less reserve than its calculated cost. Reproduction costs are separate from these metabolic totals.

There were **56,104 food-targeting episodes** and **31,803 episodes ending in a feeding event** in these ten worlds. An episode ends when the target changes, another utility wins, or the organism dies; therefore the complement is not a pure pathfinding failure rate. Reached episodes include targets already in feeding range. The raw episodes and travel durations are in the JSON.

Restricting the measure to episodes that started **beyond feeding contact**, there were **46,508 starts**, **22,270 feeding completions** (47.9%), and **24,197 recorded abandonments**. Successful trips averaged **21.29 ticks**. These figures measure pursuit continuity and arrival, not whether a collision-free route existed. Water was visible as a spring or terrain-water target in **2,143,902 decisions** and selected in **408,349 decisions**.

The 100,000-tick diagnostic on historical seed **691153** (before corrections) illustrates the gap between global supply and local access. Periodic samples found a mean **82.48** viable plant patches and **1,884.15** plant biomass globally, but only **1.492** viable plants and **29.176** plant biomass within an organism's sensory radius. The mean local carrion and spring counts were **0.087** and **0.256**. The average nearest-neighbor spacing between sampled plant patches was **64.736 world units**. Local counts include resources inside the radius even if terrain or behavior makes them unusable; target-visible decisions are the stricter behavioral measure. Terrain drinking water is not included in spring counts.

Across the ten corrected worlds, recorded deaths were **663 starvation**, **394 senescence**, **345 predation**, **104 thermal stress**, and **37 dehydration**; no direct disaster death occurred in those runs. Thermal tolerance affects energy drain and health in `organism.ts`, but this sample alone does not estimate the fitness advantage of any heat or cold trait. Historical cause totals used the older, less accurate categories and should not be compared category by category.

## Reproduction and spatial separation

The ten corrected worlds produced **950 births**: **886 herbivores**, **50 scavengers**, and **14 carnivores**. At 100-tick samples, compatible carnivore mates existed elsewhere in the world in **626** organism observations, but were within sensing range in only **34**. Herbivore counts were **12,565** and **3,567** respectively. These are repeated spatial observations, not independent mating pairs.

Reasons that prevented mating eligibility or selection were counted per decision, so a long cooldown creates many observations: energy below threshold **2,236,737**, cooldown **524,607**, no compatible mate within sensing range **395,928**, another utility selected **142,453**, immaturity **118,015**, old age **37,278**, and low hydration **5,012**. These counts cannot be interpreted as numbers of failed birth attempts. Direct birth attempts blocked at the population cap are recorded separately.

In the original 100,000-tick observation of seed 691153, **53 mating actions** reached the old cap check after both parents had paid the reproductive cost. The corrected behavior now checks the cap before charging parents; a regression test covers this. The same correction changes future trajectories, so historical and corrected runs should not be pooled.

## Genetics and speciation

The ten corrected short worlds had **1,583 logged numeric-trait mutation events** across 950 births, or **1.67 logged events per birth**. The largest measured child-to-founder divergence was **0.120**; the largest sampled within-species pair distance was **0.140**. No sampled pair crossed the **0.28** reproductive-isolation threshold, and no birth reached 80% of the **0.32** speciation threshold. The pre-correction 100,000-tick run of seed 691153 had a maximum observed child divergence of **0.178** across **3,954 births**, still well below 0.32.

The code compares each newborn with its parent taxon's founder genome and creates a new taxon if the child exceeds the fixed divergence and isolation thresholds. The founder genome takes precedence over the evolving centroid, so centroid updates do not move this baseline. It does **not** track persistent isolated subpopulations or require a population-level reproductive barrier. Also, the helper calls genomes reproductively isolated above **0.28**, while same-species mating remains allowed until distance exceeds **0.35**; no sampled pair approached either threshold in the measured short runs. As written, taxon splitting is a newborn threshold rule, not a demonstrated population-level speciation mechanism. Logged mutation events omit hue and dietary-affinity drift, so the logged count underestimates all mutation draws. No production mutation rate or threshold was changed to force speciation.

The historical seed 691153 survived 500,000 ticks before these corrections, with 20,833 births and no speciation. Under the corrected behavior it reached only one scavenger at tick 10,000 and became extinct at tick **10,536**. Its corrected 500,000-tick run executed all ticks after extinction, yielded **79 births**, and formed no species. This one-seed reversal is a warning about nonlinear ecological effects, not evidence of an overall survival rate.

A paired 10,000-tick replay of seed 691153 with current code isolated the carrion reach setting. With corrected 1.8× reach, carrion-targeting episodes began at mean distance **118.41** and **189/592** (31.9%) reached feeding. With the historical effective 1.0× reach, they began at **88.14** and **504/894** (56.4%) reached feeding. The corrected setting ended with **one** organism versus **29** under historical reach. The wider search exposes distant carrion, while scavenger behavior always chooses carrion before nearby plants when any carrion is found. This is a measured, seed-specific mechanism worth testing in broader holdouts before deploying a different food-choice rule.

The historical survivor did show trait change: mean metabolic efficiency moved from **1.159** at initialization to **1.617** among survivors, while mean speed moved from **2.419** to **1.623**; its reported average pairwise genetic distance moved from **0.137** to **0.105**. Because the final community consisted of 188 scavengers and two omnivores, these whole-community averages also reflect loss of the other founder roles. They do not establish within-lineage adaptation or reproductive isolation by themselves.

To measure long-run divergence with the current cap correction, seed 691153 was also run for **500,000 ticks** with the **historical effective scavenger reach**. It retained **200 organisms** (196 scavengers, four omnivores), produced **21,747 births**, and formed **zero species**. The maximum newborn-to-founder divergence was **0.265**; only **two births** reached 80% of the 0.32 threshold, and none reached 0.28. Across **2,879,036 ordered within-species pair observations**, the maximum sampled distance was **0.258** and **zero** crossed 0.28. Maximum observed reproductive-isolation duration was therefore zero at 5,000-tick sampling resolution. The run logged **34,880 numeric-trait mutation events** (1.604 per birth), so absent mutation is not the cause. Its peak population reached 220, but sampled population fell to 79 at tick 250,000; it was not permanently pinned at the cap. This is a selected survivor and cannot estimate a speciation percentage across worlds.

## Confirmed code defects and limits

1. `behavior.ts` queried carrion at 1.8 times a scavenger's sensory range but initialized the nearest-target limit to the ordinary sensory range, discarding all carrion in the outer scent band. The selection limit now matches the query radius. Existing saves without ecology metadata retain the old effective range; new worlds use the corrected range.
2. `behavior.ts` charged both parents and started cooldown before `engine.ts` rejected a birth at the 220-organism cap. The charge now happens only when a slot is available.
3. `ecosystem.ts` historically used the count of **all** resource types, including carrion and springs, to decide whether to seed plants. A plant-only count is available as an experimental configuration and was screened; it remains unadopted pending long-run verification.
4. Direct disaster deaths were recorded as starvation, and lethal temperature damage could be recorded as dehydration. New deaths have explicit `disaster` and `thermal` causes. Historical counts in old saves are preserved rather than guessed or rewritten.

The diagnostics do not prove that low plant access alone causes extinction. Target switching, spatially distant mates, predator energy deficits, seasonal stress, and food patch loss interact. A modeled reachable-path test and persistent subpopulation tracking remain unimplemented; current travel measurements are targeting episodes rather than obstacle-aware route traces.

## Reproduce

```sh
# Historical baseline is retained in benchmark_results.json.
ECOLOGY_OUTPUT=docs/audits/data/ecology_diagnostics_corrected.json npx tsx scripts/ecology_diagnostics.ts
ECOLOGY_SEED=691153 ECOLOGY_TICKS=500000 ECOLOGY_SAMPLE_EVERY=1000 ECOLOGY_OUTPUT=docs/audits/data/ecology_diagnostics_500k.json npx tsx scripts/ecology_diagnostics.ts
ECOLOGY_CONFIG='{"scavengerCarrionRange":0.5555555555555556}' ECOLOGY_SEED=691153 ECOLOGY_TICKS=500000 ECOLOGY_SAMPLE_EVERY=5000 ECOLOGY_OUTPUT=docs/audits/data/ecology_diagnostics_legacy_reach_500k.json npx tsx scripts/ecology_diagnostics.ts
ECOLOGY_SEED=691153 ECOLOGY_TICKS=10000 ECOLOGY_OUTPUT=docs/audits/data/ecology_seed_691153_corrected_10k.json npx tsx scripts/ecology_diagnostics.ts
ECOLOGY_CONFIG='{"scavengerCarrionRange":0.5555555555555556}' ECOLOGY_SEED=691153 ECOLOGY_TICKS=10000 ECOLOGY_OUTPUT=docs/audits/data/ecology_seed_691153_legacy_reach_10k.json npx tsx scripts/ecology_diagnostics.ts
npx tsx scripts/assemble_ecology_diagnostics.ts
```

The first command uses the first ten fixed seeds from `benchmark_results.json`. The second extends the selected historical survivor under current behavior. These commands overwrite their named outputs and can be slower on other machines.
