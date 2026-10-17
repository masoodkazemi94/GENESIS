/** Attach completed comparison and verification checks to the primary holdout artifact. */
import { readFileSync, writeFileSync } from 'node:fs';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const primary = read('docs/audits/data/ecology_holdout_results.json');
const legacyHoldout = read('docs/audits/data/ecology_legacy_holdout.json');
const verificationChecks = read('docs/audits/data/ecology_verification_checks.json');
if (primary.configurations.some((group: { results: unknown[] }) => group.results.length !== 150)) {
  throw new Error('Primary baseline and candidate must each complete 150 seeds');
}
if (legacyHoldout.results.length !== 50) throw new Error('Historical-reach holdout must complete 50 seeds');
primary.legacyReachHoldout = legacyHoldout;
primary.verificationChecks = verificationChecks;
writeFileSync('docs/audits/data/ecology_holdout_results.json', JSON.stringify(primary, null, 2));
console.log('Combined two 150-seed configurations, 50 historical-reach holdouts, and replay/load checks.');
