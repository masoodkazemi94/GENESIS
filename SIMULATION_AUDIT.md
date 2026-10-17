# GENESIS headless simulation audit

Run date: 2026-10-14. Source data: [full benchmark](benchmark_results.json), [sensitivity runs](benchmark_sensitivity.json), [worker transfer runs](benchmark_transfer.json), and [storage probe](benchmark_storage_probe.json). The scripts in `scripts/benchmark_simulation.ts`, `scripts/benchmark_sensitivity.ts`, and `scripts/benchmark_transfer.ts` reproduce the main methods. All simulations used the real `SimulationEngine` without PixiJS.

## Scope and environment

- Apple M4, 10 logical cores, 16 GiB RAM, macOS arm64, Node.js v22.17.0.
- 100 distinct generated seeds, each run for 10,000 ticks and separately for 100,000 ticks. Two extra 100,000-tick runs and two 500,000-tick runs were chosen for closer inspection; only completed runs appear in the final data.
- A third set of 20 fixed seeds was used for six 10,000-tick sensitivity scenarios. These alter only the stated starting conditions and do not represent production configurations.
- The final benchmark files and storage probe represent **13,491,660 completed ticks**: 1,000,000 short + 10,000,000 long + 200,000 extra deep + 1,000,000 across two 500,000-tick runs + 66,000 replay test + 660 population-load ticks + 1,200,000 sensitivity ticks + 25,000 storage-probe ticks. A separate discarded benchmark session and verification reruns are excluded from this count.
- Timings are wall-clock measurements. CPU contention from other local checks may affect them. This is headless Node performance, not mobile browser frame rate.

Reproduction commands from the project root (the 100,000-tick phase can take several minutes):

```sh
npx tsx scripts/benchmark_simulation.ts
npx tsx scripts/benchmark_simulation.ts --extended
npx tsx scripts/benchmark_simulation.ts --very-deep-survivor
npx tsx scripts/benchmark_sensitivity.ts
npx tsx scripts/benchmark_transfer.ts
```

## Population and evolution

| Measure | 100 seeds × 10,000 ticks | Same 100 seeds × 100,000 ticks |
| --- | ---: | ---: |
| Zero-population worlds at end | 47/100 | 98/100 |
| Median final population | 1 | 0 |
| Mean final population | 9.59 | 1.69 |
| Largest final population | 58 | 167 |
| Largest observed population | 164 | 220 (hard cap) |
| Births across seeds | 11,353 | 30,883 |
| Deaths across seeds | 16,994 | 37,314 |
| Extinct founding species, out of 400 | 334 | 398 |
| New species | 0 | 0 |
| Maximum biological generation reached | 32 | 187 |
| Median first zero tick among worlds that collapsed | 6,687 | 10,359 |
| Disaster events | 91 | 1,122 |
| Mean observed disaster severity | 0.681 | 0.669 |
| Average plant biomass per world: start → end | 9,986 → 7,405 | 9,986 → 9,778 |
| Average water in spring patches: start → end | 1,511 → 1,445 | 1,511 → 1,461 |

The 10,000-tick run took 78.76 seconds on rerun. The 100,000-tick run took 714.41 seconds. The 500,000-tick seed 486400 collapsed at tick 21,923 and finished with zero organisms; its rerun took 20.9 seconds. The other 500,000-tick run, seed 691153, retained **190 organisms** (188 scavengers and two omnivores), after 20,833 births and 20,709 deaths. It reached generation 684, experienced 57 disasters, and formed zero new species. Its run took 228.26 seconds. Its sampled population moved between 38 at tick 25,000 and 220 at tick 275,000; it never reached zero. This demonstrates that a long-lived ecosystem is possible in the model, but it is a selected surviving seed, not a survival-rate estimate.

At tick 100,000, seed 166064 retained two herbivores and seed 691153 retained 166 scavengers and one omnivore. Both reached the 220-organism cap earlier in their history; five seeds touched that cap. Because births stop at the cap, these results cannot determine whether any lineage would grow without the cap. No seed produced a new species, including a lineage that reached generation 684 in the selected 500,000-tick run. Genome trait distributions for the shorter and selected deep runs, plus mean trait values for all 100 long runs, are in the raw JSON.

Population history aggregated across the 100 short runs:

| Tick | Herbivores | Carnivores | Scavengers | Omnivores | Total |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 4,200 | 900 | 1,500 | 0 | 6,600 |
| 1,000 | 5,047 | 851 | 1,341 | 0 | 7,239 |
| 5,000 | 2,411 | 1 | 261 | 1 | 2,674 |
| 10,000 | 907 | 0 | 52 | 0 | 959 |

At tick 10,000, at least one herbivore survived in 52% of seeds, carnivores in 0%, and scavengers in 3%. At tick 100,000, herbivores survived in one seed and scavengers in one seed. The mean lifespan of recorded deaths was approximately 2,319 ticks in the short runs and 2,655 ticks in the long runs. The mean of the 53 nonempty worlds' average living generations at tick 10,000 was 14.87. The maximum-generation statistic uses each taxon's complete history, including extinct organisms.

The recorded causes of death at 10,000 ticks were 7,480 starvation, 1,428 dehydration, 3,028 predation, and 5,058 senescence. At 100,000 ticks they were 19,637 starvation, 3,078 dehydration, 3,060 predation, and 11,539 senescence. These are the engine's cause labels; they do not by themselves prove a single cause for ecosystem collapse.

## Ecological checks

The following 20-seed tests use the same seed set for every intervention, each for 10,000 ticks. The plant and spring changes multiply **starting patch** growth rates; newly seeded patches retain production defaults. The no-carnivore intervention removes nine founding carnivores, leaving the same 42 founding herbivores. These are sensitivity probes, not calibrated balance changes.

| Scenario | Zero-population worlds | Mean final population | Final herbivores (sum) | Largest peak |
| --- | ---: | ---: | ---: | ---: |
| Production | 60% | 6.70 | 134 | 157 |
| No disasters | 40% | 12.70 | 242 | 159 |
| Half initial plant growth | 80% | 3.85 | 77 | 125 |
| Double initial plant growth | 20% | 31.40 | 628 | 170 |
| Double spring recharge | 60% | 6.70 | 134 | 157 |
| No founding carnivores | 45% | 12.40 | 241 | 183 |

These paired interventions support three conclusions. First, plant regeneration strongly affects short-term survival, although doubling initial growth is too large an intervention to adopt without longer tests. Second, predation and disasters contribute to early decline, but substantial collapse remains when either is removed. Third, doubling spring recharge had no detectable effect in this sample. Spring totals remained broadly stable, so global spring volume does not appear to be the main bottleneck. Animals can also drink from terrain water; the reported water quantity counts only spring patches.

Plant biomass recovered to an average of 9,778 by tick 100,000 while 98 worlds had no animals. This shows global plant supply is not sufficient evidence that organisms can find usable food where they live. Scavengers are rarely viable in the baseline, though one scavenger-dominated world retained 190 organisms at tick 500,000. Genetic diversity measured as the engine's mean pairwise distance fell from 0.137 among the 53 eventually surviving short-run seeds at founding to 0.041 at tick 10,000. This measure mixes loss of species with within-lineage genetic change, so it cannot alone establish weak mutation.

The code requires two mature, compatible parents with sufficient energy and hydration to reproduce, and deducts energy from both parents. Unit tests check that reproductive energy accounting occurs. Direct thermal-stress tests also verify that cold-tolerant organisms retain more energy and survival under freezing exposure. The full-seed run did not establish a population-level survival advantage for heat or cold traits, nor did it demonstrate spontaneous speciation. The speciation rule has a unit-tested divergence/isolation threshold, but it produced zero new species in 11 million seed ticks and the selected 500,000-tick run. Those are ecological-model limitations rather than evidence of a broken comparison function.

## Performance and determinism

The load test used 20, 65, and 150 distinct organism copies spread across the actual world, 20 warm-up ticks, and 200 measured ticks per level. It is a synthetic density test, not a representative population history. The reported process memory includes benchmark overhead and earlier levels.

| Organisms requested | Mean tick | p95 tick | Max tick | Spatial query | Storage JSON | Serialize | Peak heap | RSS |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 0.093 ms | 0.109 ms | 0.381 ms | 0.142 µs | 86,906 B | 0.304 ms | 128.65 MiB | 318.06 MiB |
| 65 | 0.196 ms | 0.287 ms | 0.610 ms | 0.142 µs | 146,915 B | 0.556 ms | 144.68 MiB | 319.48 MiB |
| 150 | 0.354 ms | 0.534 ms | 4.353 ms | 0.174 µs | 254,283 B | 0.745 ms | 161.61 MiB | 320.67 MiB |

The Node worker-to-main test sent actual simulation snapshots through `worker_threads` for 30 measured trials after five warm-ups. The small request and worker scheduling are included in each time. This is a headless proxy for worker delivery, not a browser renderer measurement.

| Organisms | Snapshot | Mean delivery | p95 delivery |
| ---: | ---: | ---: | ---: |
| 20 | 91,242 B | 0.457 ms | 0.763 ms |
| 65 | 152,255 B | 0.540 ms | 1.142 ms |
| 150 | 267,556 B | 0.708 ms | 1.009 ms |

A separate save-size probe stepped seed 486400 for 25,000 ticks, including three disasters. Its save held 8,188 modified terrain cells and encoded to **1,246,494 bytes**. This is substantially larger than the early-world storage snapshots above; save size can grow as disasters touch more terrain.

For seeds 10101, 20202, and 30303, a world ran 2,000 ticks, saved, and both the uninterrupted and restored branches ran 10,000 more ticks. Normalized serialized states matched byte-for-byte. The comparison includes organism IDs, positions, genomes, resources, climate, terrain patches, species and ancestry data, events, and RNG state. The only excluded field is the real wall-clock save timestamp. Deterministic replay passed **3/3** seeds. This verifies those trajectories, not every possible world state.

## Verified defects fixed

1. PRNG state was saved as an ever-growing number but restored through a 32-bit constructor; replay diverged. State now wraps to 32 bits each draw and is restored exactly.
2. Disaster damage, flooding, and soil changes were regenerated from the seed instead of restored. Saves now carry sparse modified-terrain patches, including recovered soil.
3. Event IDs/timestamps and generated carrion/plant IDs used wall-clock randomness. Simulation-created identifiers and event times now depend on simulation state.
4. The event chronicle's archived count/next ID, the apex-kill milestone state, and cumulative death ages were absent from saves. The complete bounded mutation log now survives a save.
5. The ancestry tree was given the current tick as a generation number; taxon generation peaks were never updated. Birth records now use the child's generation, and new species nodes receive the divergence score.
6. The existing habitat-recovery test failed because its manually damaged cell was not entered into the recovery index. The test now registers the cell it expects to recover.
7. The interrupted Google Studio benchmark calculated lifespan from an unrelated formula, read nonexistent trait fields, compared only a few replay fields, and contained only 20 incomplete seed records. The replacement records actual death ages, real trait fields and distributions, full-state replay, and completed seed counts.

## Recommendations and limits

- Treat persistent carnivore loss, frequent animal extinction, and zero observed speciation as **ecological balance work**. Do not guarantee survival. Test smaller plant-growth adjustments, better local food access, predator encounter/reproduction conditions, and isolation thresholds against a stated target range and the same fixed seeds before changing production constants.
- Keep the 220 cap visible in balance reviews: five worlds reached it. The cap prevents detecting unlimited growth above 220.
- Benchmark browser worker delivery, Pixi rendering, and mobile devices separately. These runs did not exercise the renderer or measure frame time.
- Saves made before these fixes lack some RNG, terrain, and lineage history. Their omitted history cannot be reconstructed; the byte-for-byte replay result applies to saves created by the corrected engine.
- The numerical checks found no non-finite **terminal** organism/resource values in the 100-seed runs and no non-finite sampled organism values in the sensitivity runs. They do not prove every intermediate value was finite.
- The two selected 500,000-tick seeds do not support a 100-seed, 500,000-tick survival percentage. All measured claims above correspond to runs that completed.

Verification after the fixes: 74/74 automated tests pass, `npm run lint` passes, and `npm run build` succeeds.
