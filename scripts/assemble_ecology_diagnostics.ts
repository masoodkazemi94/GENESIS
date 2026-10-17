/** Combine completed diagnostic runs without changing or estimating their measurements. */
import { readFileSync, writeFileSync } from 'node:fs';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const historicalShort = read('ecology_diagnostics_pre_fix.json');
const historicalLong = read('ecology_diagnostics_long.json');
const correctedShort = read('ecology_diagnostics_corrected.json');
const corrected500k = read('ecology_diagnostics_500k.json');
const legacyReach500k = read('ecology_diagnostics_legacy_reach_500k.json');
const correctedSeed10k = read('ecology_seed_691153_corrected_10k.json');
const legacyReachSeed10k = read('ecology_seed_691153_legacy_reach_10k.json');
const groups = { historicalShort, historicalLong, correctedShort, corrected500k,
  legacyReach500k, correctedSeed10k, legacyReachSeed10k };
const completedTicks = Object.values(groups).reduce((sum, group) => sum + group.totalTicks, 0);
writeFileSync('ecology_diagnostics.json', JSON.stringify({ schemaVersion: 2,
  sourceFiles: ['ecology_diagnostics_pre_fix.json', 'ecology_diagnostics_long.json',
    'ecology_diagnostics_corrected.json', 'ecology_diagnostics_500k.json',
    'ecology_diagnostics_legacy_reach_500k.json',
    'ecology_seed_691153_corrected_10k.json', 'ecology_seed_691153_legacy_reach_10k.json'],
  completedTicks, groups }, null, 2));
console.log(`Assembled ${completedTicks} observed ticks across seven diagnostic groups.`);
