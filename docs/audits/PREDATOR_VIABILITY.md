# Predator viability diagnosis

## Scope and method

This is a diagnostic screen, not a production ecology change. `scripts/predator_viability.ts` ran Models 0, 1, and 2 on fixed seeds **691153, 260679, 10101** for **5,000 ticks**. Model 0 used natural placement only. Models 1 and 2 used the same natural baseline and six one-factor interventions. The script uses the real `SimulationEngine`, observes every predator feeding, metabolism, birth, maturation, and death event, and samples prey and mate access every 100 ticks. The [raw per-organism records](data/predator_viability_experiments.json) retain the complete measured results. These seeds were already used in prior development probes, so they are not an independent holdout.

## Source review

- `behavior/foraging.ts` screens prey by detection radius, route, relative speed, expected capture chance, prey health, capped energy transfer, and travel cost. A visible prey animal can therefore be rejected or pursued without being killed. `behavior/behavior.ts` applies strike damage on contact; only a lethal strike transfers energy, capped at the predator's remaining reserve capacity. The prey becomes dead and residual carrion is spawned by `engine.ts`.
- `organism/organism.ts` charges basal, movement, thermal, and flood costs each tick. Hunting movement gets the configurable pursuit multiplier. Rest reduces total expenditure. The observer reports **actual reserve energy burned**, so expenditure is clipped if energy reaches zero. The life records reconcile exactly: initial reserve + food gained − measured expenditure − parent reproduction cost − final reserve = 0 (maximum absolute residual in the 45 runs: 0 at three-decimal precision).
- Mating requires maturity, cooldown zero, energy above the genome fertility threshold, hydration at least 35, age below 88% of maximum, compatible genetics, and proximity. Models 1/2 also require a direct open route and local food or at least 85 energy for carnivores. The chosen mating action must beat food, thirst, rest, and wandering utility. Contact triggers a real energy charge to **both** parents, cooldown, and an offspring; the 220-organism cap can block it. Newborns start immature with an energy reserve and must live to maturity to replace a lineage.
- The reproduction ledger computes an estimated `childEndowment` for its tax that can differ from the newborn reserve assigned by `createOrganism`. The parent reserve deductions are real and are included in the life balance above. This ledger discrepancy does not explain predator extinction; it warrants a separate conservation audit before any ecology change.

No predator-specific logic defect was confirmed by this review or the controlled runs, so no new behavior model was introduced. Models 0–2, production defaults, and save formats remain unchanged.

## One-factor results

Totals below combine the three paired seeds. Energy values are actual reserve gains and actual basal + movement + thermal + flood expenditure for all predators alive during each run. `Mature` counts offspring that reached maturity; `later births` counts generation 3 or higher. `Final` is the combined population at tick 5,000. Mate access is sampled reachable compatible mates / predator observations, not independent pair counts.

| Model | Scenario | Food | Spent | Births | Mature | Later births | Final | Reachable mates |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | Natural | 6,033 | 7,957 | 4 | 4 | 1 | 0 | 6/578 |
| 1 | Natural | 3,384 | 5,353 | 0 | 0 | 0 | 0 | 10/585 |
| 1 | Prey encounter | 3,090 | 5,098 | 1 | 1 | 0 | 0 | 16/527 |
| 1 | Hunt return | 6,080 | 7,489 | 5 | 5 | 3 | 4 | 20/751 |
| 1 | Basal cost | 3,099 | 4,940 | 1 | 1 | 0 | 1 | 12/684 |
| 1 | Pursuit cost | 2,727 | 4,861 | 0 | 0 | 0 | 0 | 10/554 |
| 1 | Mate range | 3,356 | 5,310 | 0 | 0 | 0 | 0 | 23/603 |
| 1 | Founder cluster | 2,327 | 4,384 | 1 | 1 | 0 | 0 | 36/555 |
| 2 | Natural | 3,366 | 5,328 | 1 | 1 | 0 | 0 | 8/608 |
| 2 | Prey encounter | 3,569 | 5,460 | 2 | 2 | 0 | 0 | 10/586 |
| 2 | Hunt return | 4,757 | 6,570 | 1 | 1 | 0 | 0 | 18/634 |
| 2 | Basal cost | 2,989 | 4,899 | 1 | 1 | 0 | 0 | 7/728 |
| 2 | Pursuit cost | 2,255 | 4,299 | 0 | 0 | 0 | 0 | 8/543 |
| 2 | Mate range | 3,670 | 5,668 | 0 | 0 | 0 | 0 | 23/598 |
| 2 | Founder cluster | 1,074 | 3,316 | 0 | 0 | 0 | 0 | 40/504 |

The interventions were: moving three **existing** prey near each founder; multiplying founder predator food-processing efficiency by 1.3; setting `metabolicCost` to 0.7; setting `predatorPursuitCost` to 0.7; doubling mate-detection range; or moving existing founder predators around one founder. Each row changes one input or one initial placement factor relative to its model's natural baseline. Prey and mates then move and reproduce normally. The basal multiplier affects all organisms, and founder food processing can be inherited; downstream prey abundance and behavior can therefore change. No food or animals were created, and no birth was forced.

## Diagnosis and limits

**The confirmed proximate constraint in these runs is insufficient realized hunt income; scarce mating opportunities are an additional observed bottleneck whose independent causal contribution remains unresolved.** Natural Model 1 predators gained 3,384 energy but spent 5,353 across the three worlds, with no births. Model 2 had a similar deficit. Merely moving prey near founders, reducing pursuit cost, or widening mate range did not produce a surviving lineage. The mate-range intervention raised reachable-mate observations from 10 to 23 in Model 1, yet produced no births; access alone was insufficient with the measured energy deficit. Clustering founders raised mate access to 36/555 but reduced prey access and still ended at zero. These outcomes do not identify a single dominant cause across worlds.

Higher realized hunt return is a plausible mechanism worth narrower follow-up: Model 1 produced five offspring, all reached maturity, three later-generation births occurred, and four descendants remained at tick 5,000. **All five births and all four survivors came from seed 691153**; surviving generations were 2, 3, 4, and 5. Seeds 260679 and 10101 still lost every predator. Model 2's hunt-return runs produced one mature offspring and no later-generation birth or final predator. A surviving or reproducing lineage in one development seed is not evidence of population-level viability, a safe parameter value, or a reason to promote an experimental model.

The energy totals include offspring and finite founder/newborn starting reserves, so food below expenditure can coexist briefly with births. They do not imply sustainable energy flow. A 100,000-tick holdout is unwarranted. Next, test why the other paired seeds fail to convert visible prey into kills and whether a targeted, ecologically bounded hunt-return mechanism can replace founders across several independent seeds without worsening prey collapse, runtime, replay, or cap dependence. Keep Model 0 in production.

## Reproduce and verification

Run from the repository root: `npx tsx scripts/predator_viability.ts`. This overwrites `docs/audits/data/predator_viability_experiments.json`. Focused regression tests in `src/behavior_repair.test.ts` check exact lethal-strike energy gain and parent energy charges in addition to prey and mate decision rules. The broader test, lint, and build results are recorded in `PROJECT_STATE.md`.
