/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Genome, SpeciesTaxon } from '../../types/simulation.js';
import { PRNG } from '../math/prng.js';

const GENUS_ROOTS = [
  'Veloci', 'Silvi', 'Thalasso', 'Krypto', 'Acro', 'Platy', 'Brachy',
  'Lepto', 'Chrono', 'Macro', 'Micro', 'Pteron', 'Dendro', 'Oreo'
];

const GENUS_SUFFIXES = [
  'rhopis', 'phagus', 'cyon', 'therium', 'scorpio', 'triton', 'mys',
  'sauros', 'dromos', 'stoma', 'morphus', 'pteryx'
];

const SPECIES_EPITHETS = [
  'viridis', 'aureus', 'velox', 'gracilis', 'robustus', 'nocturnus',
  'vulgaris', 'elegans', 'ferox', 'umbratus', 'littoralis', 'arcticus',
  'lucidus', 'pumilus', 'grandis', 'argenteus'
];

const COMMON_PREFIXES = [
  'Verdant', 'Amber', 'Shadow', 'Azure', 'Sun', 'Tide', 'Dusk', 'Cinder',
  'Gilded', 'Frost', 'Moss', 'Dawn', 'Crag', 'Swift'
];

const COMMON_SUFFIXES = [
  'Strider', 'Stalker', 'Prowler', 'Grazer', 'Glider', 'Crawler', 'Hunter',
  'Wanderer', 'Runner', 'Lurker', 'Weaver', 'Hound'
];

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  l = Math.max(0, Math.min(1, l));
  s = Math.max(0, Math.min(1, s));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Determines a scientifically inspired binomial and common name based on
 * divergence relative to ancestor genome.
 */
function deriveDivergedNomenclature(
  childGenome: Genome,
  ancestorTaxon: SpeciesTaxon,
  prng: PRNG
): { genus: string; epithet: string; commonPrefix: string; commonSuffix: string } {
  const ancestorGenome = ancestorTaxon.founderGenome || ancestorTaxon.centroidGenome;
  const ancestorGenus = ancestorTaxon.name.split(' ')[0] || (prng.pick(GENUS_ROOTS) + prng.pick(GENUS_SUFFIXES));

  // Determine which trait diverged most prominently
  let chosenEpithet = prng.pick(SPECIES_EPITHETS);
  let chosenPrefix = prng.pick(COMMON_PREFIXES);
  let chosenSuffix = prng.pick(COMMON_SUFFIXES);

  if (ancestorGenome) {
    const coldDelta = ancestorGenome.coldTolerance - childGenome.coldTolerance; // positive if child is colder
    const heatDelta = childGenome.heatTolerance - ancestorGenome.heatTolerance;
    const speedDelta = childGenome.speed - ancestorGenome.speed;
    const sizeDelta = childGenome.bodySize - ancestorGenome.bodySize;
    const camoDelta = childGenome.camouflage - ancestorGenome.camouflage;
    const aggDelta = childGenome.aggression - ancestorGenome.aggression;

    if (coldDelta > 4) {
      chosenEpithet = prng.pick(['arcticus', 'borealis', 'glacialis', 'frigidus']);
      chosenPrefix = prng.pick(['Frost', 'Glacial', 'Boreal', 'Ice']);
    } else if (heatDelta > 4) {
      chosenEpithet = prng.pick(['fervidus', 'solaris', 'torridus', 'cineris']);
      chosenPrefix = prng.pick(['Sun', 'Cinder', 'Solar', 'Ember']);
    } else if (speedDelta > 0.4) {
      chosenEpithet = prng.pick(['velox', 'cursorius', 'celer', 'agilis']);
      chosenPrefix = prng.pick(['Swift', 'Gale', 'Fleet', 'Dart']);
    } else if (sizeDelta > 0.35) {
      chosenEpithet = prng.pick(['robustus', 'titanus', 'grandis', 'magnus']);
      chosenPrefix = prng.pick(['Goliath', 'Crag', 'Titan', 'Iron']);
    } else if (sizeDelta < -0.3) {
      chosenEpithet = prng.pick(['pumilus', 'gracilis', 'minutus', 'nanus']);
      chosenPrefix = prng.pick(['Pygmy', 'Dwarf', 'Slender', 'Lesser']);
    } else if (camoDelta > 0.2) {
      chosenEpithet = prng.pick(['umbratus', 'kryptos', 'occultus', 'nocturnus']);
      chosenPrefix = prng.pick(['Shadow', 'Mist', 'Dusk', 'Ghost']);
    } else if (aggDelta > 0.25) {
      chosenEpithet = prng.pick(['ferox', 'atrox', 'pugnax', 'carnifex']);
      chosenPrefix = prng.pick(['Savage', 'Dread', 'Fierce', 'Dire']);
    }
  }

  // If closely diverged lineage, retain ancestral genus with 70% probability; otherwise evolve allied genus
  const genus = prng.chance(0.7)
    ? ancestorGenus
    : prng.pick(GENUS_ROOTS) + prng.pick(GENUS_SUFFIXES);

  return { genus, epithet: chosenEpithet, commonPrefix: chosenPrefix, commonSuffix: chosenSuffix };
}

export function generateSpeciesTaxon(
  genome: Genome,
  founderId: string,
  tick: number,
  prng: PRNG,
  ancestorSpecies?: SpeciesTaxon | null,
  divergenceScore?: number
): SpeciesTaxon {
  const id = `sp_${tick}_${prng.rangeInt(1000, 9999)}`;
  const lineageDepth = ancestorSpecies ? (ancestorSpecies.lineageDepth ?? 0) + 1 : 0;
  const ancestorSpeciesId = ancestorSpecies ? ancestorSpecies.id : null;

  let latinName: string;
  let commonName: string;
  let colorHex: string;

  if (ancestorSpecies) {
    const nomenclature = deriveDivergedNomenclature(genome, ancestorSpecies, prng);
    latinName = `${nomenclature.genus} ${nomenclature.epithet}`;
    commonName = `${nomenclature.commonPrefix} ${nomenclature.commonSuffix}`;

    // Family color relationship: mutate ancestral hue by ±25 degrees
    const hueShift = prng.range(-28, 28);
    const childHue = (genome.colorHue + hueShift + 360) % 360;
    colorHex = hslToHex(childHue, genome.colorSaturation || 0.65, 0.52);
  } else {
    const genus = prng.pick(GENUS_ROOTS) + prng.pick(GENUS_SUFFIXES);
    const epithet = prng.pick(SPECIES_EPITHETS);
    latinName = `${genus} ${epithet}`;
    commonName = `${prng.pick(COMMON_PREFIXES)} ${prng.pick(COMMON_SUFFIXES)}`;
    colorHex = hslToHex(genome.colorHue, genome.colorSaturation || 0.65, 0.52);
  }

  return {
    id,
    name: latinName,
    commonName,
    colorHex,
    diet: genome.diet,
    foundingTick: tick,
    founderId,
    generationPeak: 1,
    aliveCount: 1,
    totalHistoricalCount: 1,
    extinct: false,
    extinctTick: null,
    ancestorSpeciesId,
    lineageDepth,
    divergenceScore: divergenceScore ?? 0,
    founderGenome: { ...genome },
    centroidGenome: { ...genome },
  };
}
