/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BiomeType, Genome, OrganismState, SpeciesTaxon } from '../../types/simulation.js';
import { PRNG } from '../math/prng.js';

export function getPreferredBiomesForDiet(diet: Genome['diet']): BiomeType[] {
  switch (diet) {
    case 'herbivore':
      return ['forest', 'grassland', 'beach'];
    case 'carnivore':
      return ['forest', 'grassland', 'desert', 'mountain'];
    case 'scavenger':
      return ['grassland', 'desert', 'forest', 'beach'];
    case 'omnivore':
      return ['forest', 'grassland', 'beach', 'desert'];
  }
}

export function createOrganism(
  id: string,
  species: SpeciesTaxon,
  genome: Genome,
  generation: number,
  x: number,
  y: number,
  tick: number,
  prng: PRNG,
  isFounder = false,
  parentAId?: string,
  parentBId?: string
): OrganismState {
  const angle = prng.range(0, Math.PI * 2);
  const baseLifespan = prng.rangeInt(2400, 4200); // ~120 to 210 seconds in sim time
  const maxAge = Math.round(baseLifespan * genome.endurance);
  const collisionRadius = Math.max(3.2, Math.round(5.0 * genome.size * 10) / 10);
  const maturityAge = Math.round(120 * (genome.size * 0.8 + 0.2));

  // Initial founders start biologically mature
  const initialAge = isFounder ? Math.round(maturityAge * prng.range(1.1, 1.8)) : 0;
  const isMature = initialAge >= maturityAge;

  // Offspring starting energy is proportional to parents' reproductive investment
  const initialEnergy = isFounder ? 85 : Math.round(34 + genome.reproductiveInvestment * 44);

  return {
    id,
    speciesId: species.id,
    speciesName: species.name,
    speciesColorHex: species.colorHex,
    lineageId: species.founderId,
    generation,

    // Spatial & Kinematics
    x,
    y,
    vx: 0,
    vy: 0,
    ax: 0,
    ay: 0,
    angle,
    collisionRadius,

    // Vitals & Maturity
    energy: initialEnergy,
    hydration: 85,
    health: 100,
    age: initialAge,
    maxAge,
    isMature,
    maturityAge,
    reproductiveCooldown: isFounder ? prng.rangeInt(20, 60) : 100,

    // Decision state
    state: 'wandering',
    targetId: null,
    targetType: 'none',
    targetX: null,
    targetY: null,
    wanderAngle: angle,

    // Genetics & Habitat Preferences
    genome,
    preferredBiomes: getPreferredBiomesForDiet(genome.diet),

    // Lineage stats & Ancestry
    parentAId,
    parentBId,
    offspringCount: 0,
    kills: 0,
    bornTick: tick,
  };
}

export function updateOrganismMetabolism(
  org: OrganismState,
  temperature: number,
  isDrought = false,
  isFlooded = false
): number {
  org.age += 1;

  // Check biological maturity
  if (!org.isMature && org.age >= org.maturityAge) {
    org.isMature = true;
  }

  // Decrement reproductive cooldown
  if (org.reproductiveCooldown > 0) {
    org.reproductiveCooldown -= 1;
  }

  // ---------------------------------------------------------------------------
  // 1. THERMAL STRESS (Heat tolerance and Cold tolerance)
  // ---------------------------------------------------------------------------
  let thermalEnergyDrain = 0;
  let thermalDamage = 0;

  if (temperature > org.genome.heatTolerance) {
    // Heat stress above organism's thermal limit
    const excessHeat = temperature - org.genome.heatTolerance;
    thermalEnergyDrain += excessHeat * 0.038;
    if (excessHeat > 3.0) {
      thermalDamage += excessHeat * 0.08;
    }
  } else if (temperature < org.genome.coldTolerance) {
    // Cold stress / hypothermia below organism's cold resistance threshold
    const severeCold = org.genome.coldTolerance - temperature;
    thermalEnergyDrain += severeCold * 0.045;
    if (severeCold > 3.0) {
      thermalDamage += severeCold * 0.12;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. BASAL AND KINETIC ENERGY CONSUMPTION (Ecological & Energy Tradeoffs)
  // ---------------------------------------------------------------------------
  const speed = Math.hypot(org.vx, org.vy);
  const speedRatio = speed / (org.genome.maxSpeed || 1);

  // Basal somatic maintenance scales with body size and speed capacity,
  // discounted by metabolic efficiency
  const basalCost =
    (0.022 * Math.pow(org.genome.bodySize, 1.25) +
      0.016 * Math.pow(org.genome.speed, 1.35) +
      (org.genome.visionRange / 200) * 0.006) /
    (org.genome.metabolicEfficiency || 1.0);

  // Kinetic movement cost scales with current velocity and body mass
  const kineticCost = (speedRatio * 0.042 * org.genome.speed * org.genome.bodySize);

  // Flood water wading stamina tax
  const floodCost = isFlooded ? 0.035 : 0;

  let totalMetabolicCost = basalCost + kineticCost + thermalEnergyDrain + floodCost;

  // Resting behavior reduces metabolic expenditure by 60%
  if (org.state === 'resting') {
    totalMetabolicCost *= 0.40;
  }

  const previousEnergy = org.energy;
  org.energy = Math.max(0, org.energy - totalMetabolicCost);
  const actualEnergyBurned = previousEnergy - org.energy;

  // Apply thermal cellular damage if severe
  if (thermalDamage > 0) {
    org.health = Math.max(0, org.health - thermalDamage);
  }

  // ---------------------------------------------------------------------------
  // 3. HYDRATION LOSS
  // ---------------------------------------------------------------------------
  let hydrationCost = (0.028 + Math.max(0, temperature - 16) * 0.002) / org.genome.endurance;
  if (isDrought) {
    // Arid drought accelerates dehydration
    hydrationCost *= 1.45;
  }
  if (org.state === 'resting') {
    hydrationCost *= 0.5;
  }
  org.hydration = Math.max(0, org.hydration - hydrationCost);

  // ---------------------------------------------------------------------------
  // 4. MORTALITY & HEALTH STATUS
  // ---------------------------------------------------------------------------
  if (org.energy <= 0) {
    org.health -= 0.55; // starvation
    if (!org.deathCause) org.deathCause = 'starvation';
  }
  if (org.hydration <= 0) {
    org.health -= 0.65; // dehydration
    if (!org.deathCause) org.deathCause = 'dehydration';
  }
  if (org.age > org.maxAge) {
    const senescence = (org.age - org.maxAge) * 0.04;
    org.health -= senescence;
    if (!org.deathCause && org.health <= 0) org.deathCause = 'senescence';
  }

  // Natural healing if well fed, hydrated, rested, and within thermal comfort
  if (
    org.energy > 55 &&
    org.hydration > 45 &&
    org.health < 100 &&
    org.age <= org.maxAge &&
    thermalDamage === 0
  ) {
    const recoveryBoost = org.state === 'resting' ? 0.35 : 0.18;
    org.health = Math.min(100, org.health + recoveryBoost);
    if (org.health > 20 && org.deathCause && org.deathCause !== 'predation') {
      org.deathCause = undefined;
    }
  }

  if (org.health <= 0) {
    org.state = 'dead';
    if (!org.deathCause) {
      org.deathCause =
        org.energy <= 0
          ? 'starvation'
          : org.age > org.maxAge
          ? 'senescence'
          : 'dehydration';
    }
  }

  return actualEnergyBurned;
}
