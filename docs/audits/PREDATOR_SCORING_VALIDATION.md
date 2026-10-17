# Predator hunt-scoring validation

## Method

Model 1 development seeds **691153, 260679, 10101** were advanced for 5,000 ticks. Every 80 ticks, the audit selected the first visible, directly reachable prey rejected by either the relative-speed gate or a nonpositive expected-return score. It serialized that exact state and ran two 120-tick branches with identical PRNG state and real movement, prey escape, strikes, feeding, and metabolism. One branch retained normal decisions. The other forced that predator to pursue the selected prey while it lived, even after it left sensory range. No prey, food, or energy was added. The intervention changes only the target and food priority through an ephemeral audit hook; it is **not** a behavior model or production setting. Raw paired records and the reproduction command are in [predator_scoring_validation.json](data/predator_scoring_validation.json) and `scripts/predator_scoring_validation.ts`.

The sample is deliberately small and selected from correlated states, especially the four early negative-score states per seed. The speed-gate sample occurred only in seed 260679. These are counterfactual episodes, not independent worlds or an estimate of population-wide hunt profitability. Forced pursuit beyond normal detection is favorable to capture and can be more costly than a bounded scoring correction.

## Paired outcomes

| Rejection | Branches | Forced target kills | Positive incremental net energy | Sum incremental net energy | Sum incremental movement cost | Selected prey alive, normal / forced | Predator alive, normal / forced |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Nonpositive score | 12 | 4 | 3 | -31.731 | +159.591 | 11 / 8 | 12 / 12 |
| Too fast | 4 | 1 | 1 | -27.988 | +37.010 | 4 / 3 | 4 / 4 |

Net energy is the selected predator's feeding gain minus actual metabolic expenditure over the branch, then forced minus normal. The negative-score branches gained 261.148 versus 79.681 reserve units in normal branches, but their extra movement and other expenditure outweighed this in aggregate. The speed-gate branches gained 67.742 versus 39.173. Normal branches sometimes killed other prey; the prey-survival column tracks the *selected* prey. All sampled predators survived the short horizon. Forced versus normal branch execution totals were 858.165 versus 901.360 ms; this tiny instrumented sample cannot establish a runtime improvement.

## Finding and decision

Some rejected prey were catchable and three negative-score branches improved net energy. Those successes do not establish a scoring defect: only **4 of 16** forced branches improved net energy, and both rejection categories had negative aggregate incremental net energy. No specific scoring term is confirmed wrong. No scoring correction or combined scoring-plus-litter scenario was created. Models 0–2 and the Model 0 production default retain their behavior.

The remaining uncertainty is whether a different bounded selection policy could identify the profitable rejected prey without also accepting costly pursuits. That would need a new, separately versioned candidate and a larger paired sample before ecological screening. This screen does not justify that candidate or a long holdout.
