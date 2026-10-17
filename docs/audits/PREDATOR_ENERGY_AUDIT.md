# Predator energy and reproductive accounting audit

## Scope

Real `SimulationEngine`, development seeds **691153, 260679, 10101**, 5,000 ticks each. Detailed per-decision traces use Model 1. The paired Model 0/1/2 and one-factor intervention summaries in [the data](data/predator_energy_experiments.json) come from the completed `predator_viability_experiments.json` runs on the same seeds and horizon. They are not independent holdouts. Models 0–2 and the Model 0 production default remain unchanged. No ecology parameter or save schema changed.

## A. Reproduction transaction

At contact, a compatible, mature pair must meet cooldown, energy, hydration, age, route (Models 1/2), food (Models 1/2), utility, and population checks. Both parents then lose the same `C = round(26 + 20 × mean(parent reproductiveInvestment))` reserve units: `parentA_after = parentA_before − C` and `parentB_after = parentB_before − C` at contact. They gain cooldowns and offspring counts and enter `reproducing`. Feeding earlier or later in the behavior pass and metabolism after birth can change tick-end reserves separately. The engine recombines and mutates the genome, creates the child, then runs metabolism on all organisms. The newborn starts at `N = round(34 + 44 × child reproductiveInvestment)` reserve units. For a successful birth, the energy rule is **parent transfer = N; reproductive overhead = 2C − N**. For example, at investment 0.5 with no mutation, each parent pays 36, the child receives 56, and 16 is overhead. The valid genome investment interval is 0.22–0.78, making overhead positive. These are reserve-energy units; body mass, tissue, hydration, and heat are not represented as an equivalent balanced energy ledger.

The prior behavior ledger used `round(1.45C)` as the child endowment, even though the actual child depends on its recombined genome. Its `max(8, 2C − estimated endowment)` tax did not equal the parents' actual reserve loss less the newborn reserve. This was a confirmed **accounting defect**. The engine now books overhead only after successful creation, using actual `child.energy`. Parent deductions and newborn reserves are unchanged. Failed eligibility, mate choice, and approach attempts carry no reproduction charge. At the behavior population cap, no charge occurs. If the engine's final cap check or a missing taxon prevents a queued birth, it refunds both charges, clears the new cooldown and offspring counts, and returns the pair to mate-seeking state; no tax is booked. A thrown exception during genetic crossover is not a recoverable birth rejection.

Reproduction itself has no external energy input. Founder reserves enter at world generation, and organisms gain reserve through feeding. The wider simulation is an open, abstract energy system: sunlight drives plant growth, and the predation formula can turn prey size into predator reserve beyond the prey's numerical reserve; residual carrion is also generated from prey size. Thus this rule conserves the **reproduction reserve transaction**, not every trophic or biomass unit in the world. Existing saved cumulative tax values retain their historical estimates; subsequent births use actual overhead. No save migration is needed.

Focused tests cover both parent charges, exact newborn transfer plus overhead, a capped birth with no charge, refund on a missing taxon, and deterministic save continuation after a birth.

## B. Hunt stages and measured losses

Stage counts are predator **decision ticks**, except hunts, strikes, kills, and deaths. Multiple prey can be evaluated on one tick, so rejection counters are candidate evaluations and cannot be subtracted from decision counts. `Accessible` means at least one camouflaged-visible prey has a direct open terrain route; it does not assert catchability. `Selected` means the decision had a prey target, while `pursued` means food won utility and prey lay beyond contact. An episode ends on a kill, action abandonment, or target switch. The trace records per-episode ticks, start/final distance, realized movement in range, energy spent and gained.

| Model 1 seed | Visible / accessible decisions | Selected / pursued | Hunts / abandoned / switched | Contact / missed strike / kills | Kill gain / pursuit burn / wandering or resting burn | Starvation near accessible prey |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 691153 | 7,764 / 7,540 | 3,963 / 2,438 | 43 / 4 / 11 | 54 / 26 / 28 | 1,909 / 630 / 1,765 | 2 / 4 |
| 260679 | 14,246 / 13,994 | 3,389 / 1,035 | 10 / 3 / 1 | 16 / 10 / 6 | 336 / 123 / 888 | 7 / 7 |
| 10101 | 7,641 / 7,394 | 2,830 / 1,526 | 25 / 1 / 3 | 41 / 20 / 21 | 1,139 / 395 / 1,235 | 1 / 6 |

Seed 260679 had prey accessible on 69% of predator decisions but no selected prey target on 10,605 of those decisions. Candidate evaluation counters show 5,727 rejections for speed ratio below 0.95 and 24,073 negative-value rejections; another 1,386 routes were blocked. The other seeds had 5,392 and 8,551 negative-value rejections, and 673 and 761 blocked routes. Out-of-range counts (20,534, 58,600, 27,866) include animals returned by a broad spatial query but outside their camouflage-adjusted detection range. These categories count different candidates, and some accessible decisions reasonably choose water, rest, or mating. They do not prove every rejection is wrong.

Hunt episodes closed a summed 1,318, 269, and 1,155 world-distance units in seeds 691153, 260679, and 10101. They lasted 2,492, 1,051, and 1,567 predator decision ticks. All 78 episodes combined produced 55 kills, 56 nonlethal strikes, 8 abandoned hunts, and 15 target switches. Successful kills returned 3,384 reserve units; measured expenditure was 5,353 across all predators. The detailed state attribution assigns 1,147 to active pursuits, 3,889 to wandering/resting ticks (including basal cost), and 317 to other states. This is an attribution of total metabolic expenditure, not marginal pursuit or search cost. The documented life-ledger total also includes offspring where present; these natural Model 1 runs had none.

The kill transfer formula is `min(100 − predator reserve, min(0.75 × prey reserve + 20 × prey bodySize, 55 × prey bodySize) × foodProcessingEfficiency × feedingEfficiency)`. Across 55 kills, the uncapped transfer would have been about 3,474; reserve capacity discarded **90**, all in seed 691153. The cap does not explain the other two seeds' deficit. Damage can require repeated strikes, and only lethal strikes transfer energy; nonlethal strikes returned zero. A killed prey's residual carrion remains for scavengers.

For selected episodes, the decision model summed 1,563 expected capture-energy units and 481 estimated travel-cost units; realized kills transferred 3,384 while active-pursuit metabolic burn was 1,147. Both income and travel cost were underestimated on this selected sample. The model also applies hunger utility and a distance penalty, so its score is not a literal lifetime energy forecast. Selection bias and moving prey prevent a causal claim that rejected prey would have been profitable. The stronger observed issue is sparse accepted hunts, especially in seed 260679, alongside substantial energy spent outside hunts.

## C. Isolated hypotheses and paired evidence

The completed one-factor runs in the JSON are used as small, deterministic tests, without a new parameter sweep. They change downstream population trajectories, so differences are not per-hunt causal estimates.

1. **Capture opportunity:** Move three existing prey near each founder. Model 1 kills by seed changed from **28/6/21** to **35/6/14**. One mature offspring appeared in 691153; all final predator populations remained zero. Initial proximity alone does not consistently solve capture.
2. **Expected return:** The shadow trace above compares predictions with realized selected hunts without changing decisions. It finds no overestimate of accepted-hunt income on these seeds. A future isolated decision experiment should alter one scoring term in a new, separately versioned model and measure rejected candidates' counterfactual outcomes; no such behavior change is justified yet.
3. **Search and pursuit costs:** A 0.7 pursuit-cost multiplier yielded Model 1 kills **20/6/17** and no births, compared with **28/6/21** naturally. A 0.7 global basal multiplier yielded **34/8/9** kills and one mature offspring in 691153, but no later-generation births. Reducing expenditure changes behavior and prey dynamics; the existing screens do not isolate a profitable correction.
4. **Transfer after kills:** The 90-unit reserve cap loss above is 2.6% of uncapped transfer. A founder-only 1.3× processing trait produced mature offspring and three later-generation births only in 691153; Models 1 and 2 still lost all predators in the other seeds. This intervention is not a recommendation to raise global processing or create energy.
5. **Reproductive requirements:** Model 1 natural runs had zero births. A mate-range doubling raised reachable-mate samples in the prior audit but still yielded zero Model 1 births. Both energy surplus and mate access remain constraints. The exact energy overhead is 2C−N and does not silently add reserve to offspring.

## D. Outcomes, performance, and limits

| Paired 5,000-tick three-seed condition | Mature offspring | Later-generation births | Final predators | Final prey by seed |
| --- | ---: | ---: | ---: | --- |
| Model 0 natural | 4 | 1 | 0 | 9 / 28 / 5 |
| Model 1 natural | 0 | 0 | 0 | 70 / 82 / 132 |
| Model 2 natural | 1 | 0 | 0 | 81 / 40 / 104 |
| Model 1 founder processing ×1.3 | 5 | 3 | 4 | 69 / 51 / 116 |

The detailed Model 1 instrumented runs took **4.30, 4.33, and 2.85 seconds** respectively on this machine. Their per-decision route checks and episode recording add overhead, so these are audit-script times, not browser frame times or comparable performance measurements for an unimplemented correction. There is no proposed behavior-changing correction to compare. The reproduction bookkeeping fix adds constant work per successful birth and no new RNG draw. Focused tests, full **97-test** suite, TypeScript lint, and Vite build pass. The focused post-birth save/restore replay matches serialized state after 20 further ticks. No long-term holdout was run: the controlled evidence does not yet support an ecological candidate.

Remaining blocker: determine whether a narrowly bounded expected-return adjustment can turn currently rejected **catchable** prey into net-positive hunts without damaging prey survival, runtime, and deterministic replay. Any such change belongs in a new experimental behavior version, with paired development tests before an independent holdout.

Reproduce detailed traces with `npx tsx scripts/predator_energy_audit.ts` from the repository root. This rewrites only `docs/audits/data/predator_energy_experiments.json` and reads the existing viability data.
