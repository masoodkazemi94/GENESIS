/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DietType, Genome, MutationEvent, OrganismState, PopulationTraitAverages, SpeciesTaxon } from '../../types/simulation.js';
import { PRNG } from '../math/prng.js';

/**
 * Explicit Reproductive Isolation Threshold:
 * Normalized genetic distance above 0.28 imposes an insurmountable pre-zygotic /
 * gametic reproductive isolation barrier between individuals.
 */
export const REPRODUCTIVE_ISOLATION_THRESHOLD = 0.28;

/**
 * Explicit Speciation Divergence Threshold:
 * Offspring whose cumulative genetic divergence from their ancestral species founder
 * exceeds 0.32 and who are reproductively isolated establish a new phylogenetic branch.
 * Minor mutations below this threshold constitute intraspecific polymorphism.
 */
export const SPECIATION_DIVERGENCE_THRESHOLD = 0.32;

/**
 * Validates and strictly bounds all genetic traits to biologically plausible ranges,
 * ensuring numerical stability and mathematical determinism.
 */
export function validateGenome(raw: Partial<Genome>): Genome {
  const clamp = (val: number | undefined, min: number, max: number, def: number): number => {
    if (val === undefined || Number.isNaN(val) || !Number.isFinite(val)) return def;
    return Math.max(min, Math.min(max, val));
  };

  const speed = clamp(raw.speed ?? raw.maxSpeed, 0.6, 4.2, 2.0);
  const bodySize = clamp(raw.bodySize ?? raw.size, 0.45, 2.8, 1.0);
  const visionRange = clamp(raw.visionRange ?? raw.sensoryRadius, 35, 250, 110);
  const metabolicEfficiency = clamp(raw.metabolicEfficiency, 0.45, 1.7, 1.0);
  const reproductiveInvestment = clamp(raw.reproductiveInvestment, 0.22, 0.78, 0.5);
  const camouflage = clamp(raw.camouflage, 0.0, 1.0, 0.25);
  const aggression = clamp(raw.aggression ?? raw.bravery, 0.02, 0.98, 0.3);
  const foodProcessingEfficiency = clamp(raw.foodProcessingEfficiency, 0.55, 1.7, 1.0);
  const heatTolerance = clamp(raw.heatTolerance, 12, 48, 30);
  const coldTolerance = clamp(raw.coldTolerance, -20, 20, 0);

  // Synced morphology & compatibility
  const size = bodySize;
  const maxSpeed = speed;
  const sensoryRadius = visionRange;
  const metabolismRate = clamp(raw.metabolismRate, 0.35, 2.2, Math.max(0.4, (1.1 / metabolicEfficiency) * 0.95));
  const fertilityThreshold = clamp(raw.fertilityThreshold, 52, 92, 72);
  const gestationTicks = Math.round(clamp(raw.gestationTicks, 35, 180, 80));

  let colorHue = (raw.colorHue ?? 120) % 360;
  if (colorHue < 0) colorHue += 360;
  const colorSaturation = clamp(raw.colorSaturation, 0.25, 0.95, 0.7);

  const diet: DietType = raw.diet ?? 'herbivore';
  const dietAffinity = clamp(raw.dietAffinity, 0.0, 1.0, diet === 'herbivore' ? 0.05 : diet === 'carnivore' ? 0.95 : diet === 'scavenger' ? 0.35 : 0.6);
  const tailLength = clamp(raw.tailLength, 0.6, 5.5, 2.5);
  const bravery = aggression;
  const endurance = clamp(raw.endurance, 0.5, 1.8, 1.0);

  return {
    speed,
    bodySize,
    visionRange,
    metabolicEfficiency,
    reproductiveInvestment,
    camouflage,
    aggression,
    foodProcessingEfficiency,
    heatTolerance,
    coldTolerance,
    size,
    maxSpeed,
    sensoryRadius,
    metabolismRate,
    fertilityThreshold,
    gestationTicks,
    colorHue,
    colorSaturation,
    diet,
    dietAffinity,
    tailLength,
    bravery,
    endurance,
  };
}

/**
 * Creates the initial founder genome with heritable variation across all 10 core evolutionary traits.
 */
export function createBaseGenome(prng: PRNG, diet: DietType = 'herbivore'): Genome {
  const isHerb = diet === 'herbivore';
  const isCarn = diet === 'carnivore';
  const isScav = diet === 'scavenger';

  let speed = prng.range(1.6, 2.6);
  let bodySize = prng.range(0.85, 1.35);
  let visionRange = prng.range(75, 135);
  let metabolicEfficiency = prng.range(0.9, 1.25);
  let reproductiveInvestment = prng.range(0.45, 0.62);
  let camouflage = prng.range(0.25, 0.65);
  let aggression = prng.range(0.12, 0.32);
  let foodProcessingEfficiency = prng.range(0.9, 1.25);
  let heatTolerance = prng.range(26, 36);
  let coldTolerance = prng.range(-4, 8);
  let colorHue = prng.range(85, 160); // Emerald/Verdant
  let dietAffinity = 0.05;

  if (isCarn) {
    speed = prng.range(2.2, 3.3);
    bodySize = prng.range(1.2, 1.85);
    visionRange = prng.range(100, 175);
    metabolicEfficiency = prng.range(0.75, 1.1);
    reproductiveInvestment = prng.range(0.35, 0.52);
    camouflage = prng.range(0.2, 0.55);
    aggression = prng.range(0.76, 0.96);
    foodProcessingEfficiency = prng.range(1.05, 1.45);
    heatTolerance = prng.range(24, 34);
    coldTolerance = prng.range(-6, 6);
    colorHue = (prng.range(340, 380) + 360) % 360; // Crimson / Ruby
    dietAffinity = 0.95;
  } else if (isScav) {
    speed = prng.range(1.8, 2.9);
    bodySize = prng.range(0.7, 1.2);
    visionRange = prng.range(135, 215); // Acute olfactory sensor range
    metabolicEfficiency = prng.range(1.05, 1.45); // Efficient detritivore metabolism
    reproductiveInvestment = prng.range(0.42, 0.6);
    camouflage = prng.range(0.35, 0.72);
    aggression = prng.range(0.14, 0.35); // Skittish
    foodProcessingEfficiency = prng.range(1.15, 1.6); // Deep nutrient extraction from decaying flesh
    heatTolerance = prng.range(28, 40);
    coldTolerance = prng.range(-2, 10);
    colorHue = prng.range(32, 58); // Amber / Sepia
    dietAffinity = 0.35;
  } else if (diet === 'omnivore') {
    speed = prng.range(1.7, 2.8);
    bodySize = prng.range(0.9, 1.45);
    visionRange = prng.range(85, 150);
    metabolicEfficiency = prng.range(0.85, 1.2);
    reproductiveInvestment = prng.range(0.4, 0.58);
    camouflage = prng.range(0.2, 0.5);
    aggression = prng.range(0.35, 0.65);
    foodProcessingEfficiency = prng.range(0.95, 1.3);
    heatTolerance = prng.range(25, 35);
    coldTolerance = prng.range(-5, 7);
    colorHue = prng.range(195, 230); // Azure / Slate
    dietAffinity = 0.60;
  }

  return validateGenome({
    speed,
    bodySize,
    visionRange,
    metabolicEfficiency,
    reproductiveInvestment,
    camouflage,
    aggression,
    foodProcessingEfficiency,
    heatTolerance,
    coldTolerance,
    fertilityThreshold: prng.range(64, 82),
    gestationTicks: prng.rangeInt(60, 120),
    colorHue,
    colorSaturation: prng.range(0.55, 0.85),
    diet,
    dietAffinity,
    tailLength: prng.range(1.5, 4.0),
    endurance: prng.range(0.8, 1.3),
  });
}

/**
 * Determines whether two genomes have crossed the reproductive isolation threshold,
 * preventing successful interbreeding.
 */
export function isReproductivelyIsolated(g1: Genome, g2: Genome): boolean {
  // Ecological niche barrier: Carnivores and herbivores cannot interbreed
  if (
    (g1.diet === 'carnivore' && g2.diet === 'herbivore') ||
    (g1.diet === 'herbivore' && g2.diet === 'carnivore')
  ) {
    return true;
  }
  const dist = calculateGeneticDistance(g1, g2);
  return dist > REPRODUCTIVE_ISOLATION_THRESHOLD;
}

/**
 * Checks explicit biological and taxonomic mating compatibility between two candidate organisms.
 */
export function checkMatingCompatibility(
  o1: OrganismState,
  o2: OrganismState
): { compatible: boolean; reason?: string } {
  if (o1.id === o2.id) {
    return { compatible: false, reason: 'self_mating_disallowed' };
  }
  if (o1.state === 'dead' || o2.state === 'dead') {
    return { compatible: false, reason: 'organism_dead' };
  }
  if (!o1.isMature || !o2.isMature) {
    return { compatible: false, reason: 'juvenile_immaturity' };
  }
  if (o1.reproductiveCooldown > 0 || o2.reproductiveCooldown > 0) {
    return { compatible: false, reason: 'in_reproductive_cooldown' };
  }
  if (
    o1.energy < o1.genome.fertilityThreshold * 0.72 ||
    o2.energy < o2.genome.fertilityThreshold * 0.72
  ) {
    return { compatible: false, reason: 'insufficient_energy' };
  }

  // Cross-species compatibility check: must be within reproductive isolation threshold
  if (o1.speciesId !== o2.speciesId) {
    if (isReproductivelyIsolated(o1.genome, o2.genome) || o1.genome.diet !== o2.genome.diet) {
      return { compatible: false, reason: 'reproductive_isolation_barrier' };
    }
  } else {
    // Intra-species extreme divergence check
    const geneticDist = calculateGeneticDistance(o1.genome, o2.genome);
    if (geneticDist > 0.35) {
      return { compatible: false, reason: 'reproductive_isolation_barrier' };
    }
  }

  return { compatible: true };
}

/**
 * Evaluates whether an offspring qualifies for taxonomic speciation based on
 * defined model rules:
 * 1. Divergence: Child genome must diverge from parental species founder/centroid
 *    by at least SPECIATION_DIVERGENCE_THRESHOLD (0.32).
 * 2. Reproductive Isolation: Child must be reproductively isolated from the parental
 *    species baseline (> REPRODUCTIVE_ISOLATION_THRESHOLD of 0.28).
 *
 * This explicitly ensures we DO NOT declare a new species after everyday mutations,
 * requiring meaningful population divergence and sustained isolation.
 */
export function evaluateSpeciationCriteria(
  childGenome: Genome,
  parentSpecies: SpeciesTaxon
): { shouldSpeciate: boolean; divergenceScore: number; reason?: string } {
  const baselineGenome = parentSpecies.founderGenome || parentSpecies.centroidGenome;
  if (!baselineGenome) {
    return { shouldSpeciate: false, divergenceScore: 0, reason: 'no_baseline_genome' };
  }

  const divergenceScore = calculateGeneticDistance(baselineGenome, childGenome);

  // Condition 1: Must exceed speciation divergence threshold
  if (divergenceScore < SPECIATION_DIVERGENCE_THRESHOLD) {
    return {
      shouldSpeciate: false,
      divergenceScore,
      reason: 'within_intraspecific_variation',
    };
  }

  // Condition 2: Must be reproductively isolated from baseline
  if (!isReproductivelyIsolated(baselineGenome, childGenome)) {
    return {
      shouldSpeciate: false,
      divergenceScore,
      reason: 'insufficient_reproductive_isolation',
    };
  }

  return {
    shouldSpeciate: true,
    divergenceScore,
    reason: 'divergence_and_reproductive_isolation_exceeded',
  };
}

/**
 * Performs two-parent genetic recombination and mutation with logging of individual genetic changes.
 * Does NOT automatically improve traits: mutations are strictly zero-mean, bounded, and undirected.
 */
export function crossoverGenomesWithLog(
  p1: Genome,
  p2: Genome,
  prng: PRNG,
  parentAId = '',
  parentBId = '',
  tick = 0,
  speciesId = '',
  speciesName = '',
  mutationRate = 0.11
): { childGenome: Genome; mutations: MutationEvent[] } {
  const mutations: MutationEvent[] = [];

  // Helper for Mendelian assortment & bounded mutations
  const inheritTrait = (
    traitName: keyof Genome,
    v1: number,
    v2: number,
    minVal: number,
    maxVal: number,
    sigmaScale = 0.08
  ): number => {
    // Genetic recombination: 50% parental dominance or intermediate blended assortment
    let recombined: number;
    const recombMode = prng.next();
    if (recombMode < 0.42) {
      recombined = v1;
    } else if (recombMode < 0.84) {
      recombined = v2;
    } else {
      const alpha = prng.range(0.35, 0.65);
      recombined = v1 * alpha + v2 * (1 - alpha);
    }

    // Undirected, bounded mutation
    if (prng.chance(mutationRate)) {
      const traitRange = maxVal - minVal;
      const rawDelta = prng.gaussian(0, sigmaScale * traitRange);
      // Bound mutation magnitude to ±18% of trait range max
      const boundedDelta = Math.max(-0.18 * traitRange, Math.min(0.18 * traitRange, rawDelta));
      const mutatedVal = Math.max(minVal, Math.min(maxVal, recombined + boundedDelta));
      const actualDelta = mutatedVal - recombined;

      if (Math.abs(actualDelta) > 0.001) {
        mutations.push({
          id: `mut_${tick}_${prng.rangeInt(10000, 99999)}`,
          tick,
          parentAId,
          parentBId,
          offspringId: '',
          speciesId,
          speciesName,
          traitName: String(traitName),
          oldValue: Math.round(recombined * 1000) / 1000,
          newValue: Math.round(mutatedVal * 1000) / 1000,
          delta: Math.round(actualDelta * 1000) / 1000,
        });
      }
      return mutatedVal;
    }

    return recombined;
  };

  const speed = inheritTrait('speed', p1.speed, p2.speed, 0.6, 4.2);
  const bodySize = inheritTrait('bodySize', p1.bodySize, p2.bodySize, 0.45, 2.8);
  const visionRange = inheritTrait('visionRange', p1.visionRange, p2.visionRange, 35, 250);
  const metabolicEfficiency = inheritTrait('metabolicEfficiency', p1.metabolicEfficiency, p2.metabolicEfficiency, 0.45, 1.7);
  const reproductiveInvestment = inheritTrait('reproductiveInvestment', p1.reproductiveInvestment, p2.reproductiveInvestment, 0.22, 0.78);
  const camouflage = inheritTrait('camouflage', p1.camouflage, p2.camouflage, 0.0, 1.0);
  const aggression = inheritTrait('aggression', p1.aggression, p2.aggression, 0.02, 0.98);
  const foodProcessingEfficiency = inheritTrait('foodProcessingEfficiency', p1.foodProcessingEfficiency, p2.foodProcessingEfficiency, 0.55, 1.7);
  const heatTolerance = inheritTrait('heatTolerance', p1.heatTolerance, p2.heatTolerance, 12, 48);
  const coldTolerance = inheritTrait('coldTolerance', p1.coldTolerance, p2.coldTolerance, -20, 20);

  // Discrete / morphological traits
  const fertilityThreshold = inheritTrait('fertilityThreshold', p1.fertilityThreshold, p2.fertilityThreshold, 52, 92);
  const gestationTicks = Math.round(inheritTrait('gestationTicks', p1.gestationTicks, p2.gestationTicks, 35, 180));
  const colorSaturation = inheritTrait('colorSaturation', p1.colorSaturation, p2.colorSaturation, 0.25, 0.95);
  const tailLength = inheritTrait('tailLength', p1.tailLength, p2.tailLength, 0.6, 5.5);
  const endurance = inheritTrait('endurance', p1.endurance, p2.endurance, 0.5, 1.8);

  // Hue recombination & slight chromatic drift
  let colorHue = prng.next() < 0.5 ? p1.colorHue : p2.colorHue;
  if (prng.chance(mutationRate * 1.3)) {
    const hueDelta = prng.gaussian(0, 12);
    colorHue = (colorHue + hueDelta + 360) % 360;
  }

  // Dietary affinity drift
  let dietAffinity = (p1.dietAffinity + p2.dietAffinity) / 2;
  if (prng.chance(mutationRate * 0.4)) {
    dietAffinity = Math.max(0, Math.min(1, dietAffinity + prng.gaussian(0, 0.08)));
  }
  let diet: DietType = 'herbivore';
  if (dietAffinity < 0.24) diet = 'herbivore';
  else if (dietAffinity < 0.46) diet = 'scavenger';
  else if (dietAffinity < 0.72) diet = 'omnivore';
  else diet = 'carnivore';

  const childGenome = validateGenome({
    speed,
    bodySize,
    visionRange,
    metabolicEfficiency,
    reproductiveInvestment,
    camouflage,
    aggression,
    foodProcessingEfficiency,
    heatTolerance,
    coldTolerance,
    fertilityThreshold,
    gestationTicks,
    colorHue,
    colorSaturation,
    diet,
    dietAffinity,
    tailLength,
    endurance,
  });

  return { childGenome, mutations };
}

/**
 * Backwards compatible crossover function
 */
export function crossoverGenomes(p1: Genome, p2: Genome, prng: PRNG): Genome {
  return crossoverGenomesWithLog(p1, p2, prng).childGenome;
}

/**
 * Direct mutation helper applying bounded mutations to an existing genome.
 */
export function mutateGenome(base: Genome, prng: PRNG, mutationRate = 0.09): Genome {
  return crossoverGenomesWithLog(base, base, prng, 'parent', 'parent', 0, '', '', mutationRate).childGenome;
}

/**
 * Calculates normalized genetic distance between two genomes [0, 1].
 * Values > 0.30 signify taxonomic speciation boundary.
 */
export function calculateGeneticDistance(g1: Genome, g2: Genome): number {
  const speedDiff = Math.abs(g1.speed - g2.speed) / 3.6;
  const sizeDiff = Math.abs(g1.bodySize - g2.bodySize) / 2.35;
  const visionDiff = Math.abs(g1.visionRange - g2.visionRange) / 215;
  const metaDiff = Math.abs(g1.metabolicEfficiency - g2.metabolicEfficiency) / 1.25;
  const reproDiff = Math.abs(g1.reproductiveInvestment - g2.reproductiveInvestment) / 0.56;
  const camoDiff = Math.abs(g1.camouflage - g2.camouflage);
  const aggDiff = Math.abs(g1.aggression - g2.aggression);
  const foodDiff = Math.abs(g1.foodProcessingEfficiency - g2.foodProcessingEfficiency) / 1.15;
  const heatDiff = Math.abs(g1.heatTolerance - g2.heatTolerance) / 36;
  const coldDiff = Math.abs(g1.coldTolerance - g2.coldTolerance) / 40;
  const dietDiff = Math.abs(g1.dietAffinity - g2.dietAffinity);

  let hueDiff = Math.abs(g1.colorHue - g2.colorHue);
  if (hueDiff > 180) hueDiff = 360 - hueDiff;
  const normHue = hueDiff / 180;

  const dist =
    speedDiff * 0.12 +
    sizeDiff * 0.12 +
    visionDiff * 0.08 +
    metaDiff * 0.08 +
    reproDiff * 0.06 +
    camoDiff * 0.06 +
    aggDiff * 0.08 +
    foodDiff * 0.08 +
    heatDiff * 0.06 +
    coldDiff * 0.06 +
    dietDiff * 0.12 +
    normHue * 0.08;

  return Math.min(1, Math.max(0, dist));
}

/**
 * Computes population-wide arithmetic averages for all 10 core evolutionary traits.
 */
export function computePopulationTraitAverages(organisms: OrganismState[]): PopulationTraitAverages {
  const living = organisms.filter((o) => o.state !== 'dead');
  const count = living.length;
  if (count === 0) {
    return {
      avgSpeed: 0,
      avgBodySize: 0,
      avgVisionRange: 0,
      avgMetabolicEfficiency: 0,
      avgReproductiveInvestment: 0,
      avgCamouflage: 0,
      avgAggression: 0,
      avgFoodProcessingEfficiency: 0,
      avgHeatTolerance: 0,
      avgColdTolerance: 0,
    };
  }

  let totalSpeed = 0;
  let totalBodySize = 0;
  let totalVisionRange = 0;
  let totalMetabolicEfficiency = 0;
  let totalReproductiveInvestment = 0;
  let totalCamouflage = 0;
  let totalAggression = 0;
  let totalFoodProcessingEfficiency = 0;
  let totalHeatTolerance = 0;
  let totalColdTolerance = 0;

  for (let i = 0; i < count; i++) {
    const g = living[i].genome;
    totalSpeed += g.speed;
    totalBodySize += g.bodySize;
    totalVisionRange += g.visionRange;
    totalMetabolicEfficiency += g.metabolicEfficiency;
    totalReproductiveInvestment += g.reproductiveInvestment;
    totalCamouflage += g.camouflage;
    totalAggression += g.aggression;
    totalFoodProcessingEfficiency += g.foodProcessingEfficiency;
    totalHeatTolerance += g.heatTolerance;
    totalColdTolerance += g.coldTolerance;
  }

  const round = (val: number) => Math.round((val / count) * 1000) / 1000;

  return {
    avgSpeed: round(totalSpeed),
    avgBodySize: round(totalBodySize),
    avgVisionRange: round(totalVisionRange),
    avgMetabolicEfficiency: round(totalMetabolicEfficiency),
    avgReproductiveInvestment: round(totalReproductiveInvestment),
    avgCamouflage: round(totalCamouflage),
    avgAggression: round(totalAggression),
    avgFoodProcessingEfficiency: round(totalFoodProcessingEfficiency),
    avgHeatTolerance: round(totalHeatTolerance),
    avgColdTolerance: round(totalColdTolerance),
  };
}
