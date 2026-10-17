# GENESIS repository instructions

GENESIS is a zero-player, deterministic, browser-based ecosystem simulation. Each visitor receives an independent persistent world. Preserve existing functionality and backwards compatibility.

## Start a task

1. Read this file and `PROJECT_STATE.md` at the start of a new development phase. Check `TASKS.md` when choosing work.
2. Use targeted searches to identify the smallest relevant source set. Read those files and their immediate dependencies before editing. Avoid unrelated benchmark JSON and large historical reports unless needed for the task; use `docs/audits/README.md` to locate evidence.
3. Make the smallest correct change. Prefer targeted fixes over architectural rewrites; avoid unrelated refactoring and unnecessary dependencies.
4. Run focused tests first, then broader tests when the scope or risk warrants it. Do not launch expensive long-running benchmarks unless the task requires them, and do not rerun completed suites without a clear reason.
5. Report changed files, verification, blockers, and next steps concisely. Avoid verbose plans and repeated whole-project summaries. Update `PROJECT_STATE.md` after meaningful completed development work; update `TASKS.md` only when priorities or status materially change. Do not rewrite either file for trivial interactions.

## Invariants and evidence

- Production ecology behavior is Model 0. Model 1 is experimental; Model 2 is also an opt-in experiment. Never adopt experimental models without benchmark evidence that addresses ecological quality, runtime, deterministic replay, and save compatibility.
- Preserve deterministic simulation and reproducible RNG state. Preserve world saves, recovery behavior, and multi-tab writer safety.
- Never weaken validation, security, accessibility, or data-loss prevention.
- Never fabricate tests, metrics, ecological outcomes, or implementation status. Separate verified results from hypotheses and unfinished work. State the tested seed set and limits when citing benchmark outcomes.
- Preserve existing project conventions and keep implementation scope aligned with the task.
