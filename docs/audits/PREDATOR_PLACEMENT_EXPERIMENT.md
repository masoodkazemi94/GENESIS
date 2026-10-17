# Predator encounter-placement experiment

## Scope and mechanism

This is one bounded, development-only Model 1 screen on reused development seeds **691153, 260679, 10101**, each run for **5,000 ticks**. `SimulationEngine(seed, { behaviorModel: 1 }, { predatorEncounterPlacement: true })` enables the candidate only for a new world. Production Model 0, Model 2, restored saves, and ordinary Model 1 generation do not invoke it. The switch is not persisted or exposed to the product.

Ordinary generation first creates all 66 founders and resources. The candidate then repositions only the nine carnivore founders. It derives an independent PRNG from the world seed and a fixed salt; it never forks or advances the ordinary generator or simulation PRNG. Candidate cells must be valid, dry land, at least 20 units from every original founder and at least 30 units from other relocated predators, with three open cardinal routes for movement. A site needs a directly reachable prey animal within effective sight. Predator pairs need a direct route to one another within Model 1 mating detection distance; the odd ninth predator needs a partner in a placed pair. Pair selection rewards accessible prey and separation between regions. Compatibility is evaluated with founder cooldowns expired and energy restored for the *potential* encounter; actual cooldowns, reserves, mate decisions, hunting, and reproduction remain untouched. If a complete layout cannot be found, all original predator coordinates are retained. No prey or resources move.

The initial paired states were checked entity by entity. They have identical founder IDs, counts, genomes, all non-coordinate organism fields, prey coordinates, species, resources and quantities, and simulation PRNG state. Exactly nine predator coordinates differ in each tested seed. This tests encounter geometry, not a survival subsidy or guaranteed encounter outcome.

## Results

Values are **baseline → candidate**. Accessible prey and reachable compatible mates are predator observations sampled every 100 ticks; the denominator varies with predator survival. Net energy is all predator feeding gain minus all predator metabolic expenditure. Births are predator births; mature and generation 3+ are distinct cohorts. Runtime includes the headless observer and sampling; candidate runs with births also include a 20-tick replay check. These are indicative wall times, not matched-load CPU benchmarks.

| Seed | Accessible prey / samples | Reachable mates / samples | Kills | Food gained | Metabolism | Net energy | Births / mature / gen 3+ / descendants alive at 5k | Final herbivores / scavengers / predators | Prey killed by predators | Cap ticks / blocked births | Runtime ms |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: | --- | ---: |
| 691153 | 73/208 → 90/258 | 12/208 → 74/258 | 28 → 39 | 1,908.890 → 2,543.032 | 2,520.137 → 3,088.991 | −611.246 → −545.958 | 0/0/0/0 → 0/0/0/0 | 15/55/0 → 12/102/0 | 28 → 39 | 0/0 → 0/0 | 3,662.546 → 3,810.985 |
| 260679 | 141/200 → 167/236 | 63/200 → 171/236 | 6 → 12 | 335.733 → 634.160 | 1,040.516 → 1,351.367 | −704.783 → −717.206 | 0/0/0/0 → 1/1/0/0 | 15/67/0 → 22/35/0 | 6 → 12 | 0/0 → 0/0 | 3,695.437 → 3,125.773 |
| 10101 | 69/177 → 89/187 | 47/177 → 81/187 | 21 → 25 | 1,139.294 → 1,269.386 | 1,792.765 → 1,918.466 | −653.471 → −649.080 | 0/0/0/0 → 2/2/0/0 | 0/132/0 → 2/78/0 | 21 → 25 | 0/0 → 0/0 | 3,495.440 → 2,127.060 |

Each world starts with 42 herbivores, 15 scavengers, and nine predators. No original founder survives to tick 5,000 in either branch; final herbivores and scavengers are descendants. Final total prey are 70 → 114, 82 → 57, and 132 → 80, respectively; these are net population outcomes, not a direct measure of local prey stock. The minimum sampled prey population was 57 in all runs. There was no sampled population cap occupancy or blocked birth. The full 500-tick role trajectories and per-seed counts are in [predator_placement_results.json](data/predator_placement_results.json).

## Decision

**The success gate failed.** Net predator energy improved in seeds 691153 and 10101, but stayed negative; seed 260679 worsened. Three candidate offspring reached maturity, yet none reproduced, none survived to tick 5,000, and there were no generation-3+ births. All predator populations were extinct at tick 5,000. Mate access increased, but it did not establish a reproducing lineage. No severe new sampled prey collapse or cap dependence appeared; role counts changed substantially, particularly scavengers, without an additional lost role relative to each baseline. These observations do not justify independent holdouts, repeated tuning on these seeds, or a population-level viability claim. The review's next predator hypothesis is a bounded capture/feeding-return mechanism, evaluated against observed net hunt returns.

## Determinism and compatibility

Focused tests cover same-seed placement, valid terrain and open movement routes, reachable prey and partners, spatial separation, preserved founders/resources/PRNG, deterministic no-prey fallback, and Model 0/2 no-op generation. Restored Model 0/1/2 worlds continue identically with or without the development option. Actual candidate predator births occurred at tick 35 in seed 260679 and tick 127 in seed 10101; each saved state replayed identically for 20 ticks with the option available. A separate focused test saves after an actual predator birth and compares complete continuation for 30 ticks. Existing save validation and restore tests pass. No persistent field was added.

The six archived 2,000-tick SHA hashes in `optimization_trajectory_final.json` did **not** match a fresh ordinary run from this working tree, although all six population counts matched. The cause was not isolated; the working tree already contains unrelated uncommitted behavior changes. Therefore this audit does not claim byte-for-byte agreement with that older archive. The default generation path is unchanged by this patch, and current save/restore comparisons establish the switch's no-op behavior for old worlds.

Verification: **106 tests passed**, TypeScript check passed, and production build passed. No independent holdout or long-horizon benchmark was run.
