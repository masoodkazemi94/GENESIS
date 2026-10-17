/** Optional headless instrumentation; absent during normal simulation. Timings may overlap. */
export class SimulationProbe {
  readonly entries: Record<string, { calls: number; milliseconds: number }> = {};

  start(): number { return performance.now(); }

  end(name: string, started: number): void {
    const entry = this.entries[name] ??= { calls: 0, milliseconds: 0 };
    entry.calls++;
    entry.milliseconds += performance.now() - started;
  }

  count(name: string, amount = 1): void {
    const entry = this.entries[name] ??= { calls: 0, milliseconds: 0 };
    entry.calls += amount;
  }
}
