# Reproductive strategy experiment

## Design and scope

The existing Model 1 behavior gates mating by maturity, cooldown, reserve, hydration, age, genetics, route, local food, utility, and the 220-organism cap. The engine charges both parents `C = round(26 + 20 × mean reproductiveInvestment)` for one offspring; a child's reserve is `round(34 + 44 × child reproductiveInvestment)`. The existing overhead ledger uses actual newborn reserve.

An **unsaved development switch**, `experimentalReproductionVersion = 1`, tests potential litter sizes of 1–3 for herbivores and omnivores and 1–2 for carnivores and scavengers. These bounds are provisional. The optional inherited `litterPotential` starts from existing reproductive investment for founders and is recombined with bounded variation in descendants. Actual count is limited by both parents' post-mating reserve, hydration and health, nearby diet-appropriate food divided by competing consumers, offspring minimum reserve of 20, and remaining population slots. Reproductive cooldown is required at mating and lengthens by 80 ticks per extra child. The second and third children cost each parent another six reserve units each. All offspring share the reserve budget of one standard newborn, so a larger litter starts with less energy per child. No emergency or near-extinction bonus exists.

For a completed event with `n` children, the measured transaction is `parent charges = 2C + 12(n−1)`, `newborn transfer = sum(child initial reserves)`, and `overhead = charges − transfer`. The engine creates only children that fit the cap, charges extras only when created, uses deterministic sequential IDs and PRNG draws, and refunds a rejected first birth through the existing path. This switch is intentionally unavailable through saved ecology configuration or the UI. Re-enabling it after restoring a development save is required for an experimental replay; it has **not** passed a product save-compatibility gate and is not an adopted Model 3.

## Paired development screen

The real engine ran Model 1 with normal single births (A) and the litter switch alone (C) on seeds **691153, 260679, 10101** for **5,000 ticks each**. No scoring correction was justified, so B and D do not exist. [Raw per-event and offspring records](data/reproductive_strategy_experiments.json) can be reproduced with `npx tsx scripts/reproductive_strategy_experiment.ts`. These are previously used development seeds, not a holdout.

| Measure, three-seed sum | A: single births | C: litter v1 |
| --- | ---: | ---: |
| Successful mating events | 605 | 538 |
| Offspring per event | 1.000 | 1.266 |
| Offspring reaching maturity by tick 5,000 | 599 / 605 | 680 / 681 |
| Generation 3+ births | 528 | 578 |
| Predator net reserve energy (gain − metabolism − parent charges) | -1,969.500 | -2,043.569 |
| Predator descendants alive at tick 5,000 | 0 | 0 |
| Cap occupancy ticks | 0 | 10 |
| Sum execution time, instrumented | 9.162 s | 11.033 s |

All three predator lineages ended at zero in both scenarios. Final herbivore counts were **15/15/0** in A and **10/15/6** in C; scavenger counts were **55/67/132** and **101/34/131**. The third seed had one omnivore in C and none in A. Species diversity by seed was **3/3/1** in A and **3/3/2** in C. The minimum noncarnivore count was 57 in each A seed and **57/49/57** in C; no prey extinction occurred, but seed 260679 fell lower. That seed alone reached the cap for 10 ticks in C. These results do not demonstrate stable trophic balance or predator replacement.

The switch produced **141 two-offspring events and one three-offspring event**. Mean initial reserve per child was about **57–58** for single births, **28–29** for twins, and **20.33** for the one triplet event. This verifies the intended energy tradeoff. Very few offspring failed to reach maturity by the horizon in either condition; the available three seeds do **not** show a measured juvenile-survival penalty from smaller birth reserves. Maturity fractions are censored by births near tick 5,000. Diet-appropriate local food below 50 at birth was observed for a small subset, with little nonmaturation, so food-scarcity effects remain unresolved.

The inherited potential varied, but high-potential parents did not establish a demonstrated fitness advantage. For parent potential below / at least 0.5, offspring reaching maturity were **29/29 and 570/576** in A, and **63/63 and 617/618** in C. Diet-appropriate local food below 50 at birth coincided with **18/19** reaching maturity in A and **21/21** in C. These small, selected low-food groups do not test prolonged scarcity. Counting each parent's gap between successive events, gaps below / at least 350 ticks numbered **272/407** in A and **152/356** in C. The longer extra-child cooldown plausibly contributes to fewer short gaps, but different lineages and habitats prevent a causal fitness comparison. Higher total mature-offspring and generation-3+ counts occurred alongside fewer mating events, a predator energy deficit, one cap episode, and mixed herbivore and scavenger outcomes. Per-event and offspring values are retained in the JSON. No predator litter event established a persistent lineage; extra predator offspring would require adequate reserve and prey access, which this screen did not demonstrate.

## Accounting, verification, and decision

Across all six runs, `parent charges − newborn reserves − reproductive overhead = 0`, and the independently accumulated engine reproduction ledger matched summed event overhead exactly. Focused tests cover a two-offspring transaction, cap-limited partial litter, and 20-tick experimental save/restore replay after explicitly re-enabling the switch. The latter is a development replay check, not a product save-compatibility claim.

**Decision: do not adopt this litter rule or expand to 10–20 seeds yet.** The screen shows a real energy tradeoff but no predator-lineage benefit or clear juvenile-fitness consequence; one seed increased cap occupancy. Models 0–2 and Model 0 default remain the supported configurations. A later design should first explain why low-reserve juveniles mature at such high rates and test scarcity and parental interval effects with stronger controlled comparisons before a larger ecological screen.
