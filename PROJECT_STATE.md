# GENESIS project state

## Objective and architecture

Build a zero-player browser ecosystem in which each visitor watches an independent, persistent world evolve under deterministic simulation. React hosts the spectator UI; PixiJS renders it. `src/simulation/worker.ts` runs `SimulationEngine` off the main thread. The engine owns terrain, climate, organisms, behavior, genetics, resources, events, and seeded PRNG state. `src/persistence/` validates and stores saves in IndexedDB with recovery; `SessionCoordinator` elects one writing tab and broadcasts snapshots to observer tabs.

## Behavior and implemented systems

`src/simulation/ecology/config.ts` defaults to **Model 0**, the production behavior. Model 1 adds scored foraging, route rejection, mate and local-food gates, and spatial plant reseeding. Model 2 changes Model 1's shared-food competition calculation. Both remain opt-in experiments; no experimental ecology parameters were promoted. Old saves lacking a behavior model resolve to Model 0; saved RNG state and optional ecology configuration support replay. The latest audit warns that older app builds may reject a Model 2 save.

Verified in source and tests: procedural terrain and seeded world generation; autonomous feeding, predation, metabolism, hydration, reproduction, genetics, climate and events; spectator camera and chronicle; save validation and recovery; leader/observer tab coordination; behavior model selection and replay tests. A code path for species formation exists, but spontaneous speciation has **not** been observed in completed benchmark sets. Multi-tab safety is implemented, though this review did not independently test every browser failure mode.

## Latest evidence and open problems

The latest completed performance audit reports **95 passing tests in two files**, TypeScript lint and build passing. [Audit evidence](SIMULATION_PERFORMANCE_AUDIT.md) reports identical six saved-state hashes for Models 0/1 across three seeds after optimization and matching ecological checkpoints for 20 seeds through 50,000 ticks. Model 1's 20-seed 50,000-tick runtime sum fell from 843.977 to 758.567 seconds; Model 0 had no demonstrated speed change. These are headless measurements, not browser frame rates. The test count should be refreshed after any new test changes.

The same audit found no carnivores at 10,000 or 50,000 ticks in the compared development seeds. Model 1's 11 surviving worlds in the earlier 30-seed 50,000-tick run had all touched the 220-organism cap. Model 2 reduced cap occupancy from 36,640 to 19,252 ticks across 20 development seeds at 50,000 ticks, but still relied on the cap and had no independent holdout. Three-seed predator probes found food-energy deficits and rare local mates; they do not establish the dominant cause across worlds. These are unresolved engineering problems, along with poor long-run survival and unproven population-level speciation.

## Decisions, phase, and next task

Keep Model 0 in production: Model 1 failed predator viability and cap goals; Model 2 improved one cap measure but did not solve either problem. Preserve existing saves and deterministic trajectories while investigating mechanisms. The current phase is **post-audit, before another ecology change**. Next, isolate predator food acquisition and mating constraints with focused, deterministic scenarios and a small paired seed screen; set explicit success criteria before a larger holdout. This is a recommendation, not an implemented fix or completed benchmark.

Detailed evidence: [audit index](docs/audits/README.md), especially [performance and Model 2](SIMULATION_PERFORMANCE_AUDIT.md), [behavior repair](ECOLOGY_BEHAVIOR_REPAIR.md), [calibration](ECOLOGY_CALIBRATION.md), [diagnostics](ECOLOGY_DIAGNOSTICS.md), and [historical baseline](SIMULATION_AUDIT.md). Raw JSON outputs remain at the repository root; consult only the result relevant to the task.
