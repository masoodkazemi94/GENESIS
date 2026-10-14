/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { OrganismState, ResourcePatch, TerrainMap } from '../../types/simulation.js';
import { checkMatingCompatibility } from '../genetics/genetics.js';
import { PRNG } from '../math/prng.js';
import { SpatialHashGrid } from '../physics/physics.js';
import { getCellAt } from '../terrain/terrain.js';

export interface HuntKillRecord {
  predator: OrganismState;
  prey: OrganismState;
  energyGained: number;
  residualCarrionMass: number;
}

export interface BehaviorOutput {
  reproducedParents: Array<{ parentA: OrganismState; parentB: OrganismState }>;
  kills: HuntKillRecord[];
  plantBiomassConsumed: number;
  carrionBiomassConsumed: number;
  waterConsumed: number;
  reproductionEnergyInvested: number;
  reproductionTaxDissipated: number;
}

/**
 * Genuine Utility-Based Decision Engine for Autonomous Creatures.
 * Evaluates candidate desires (Danger Evasion, Satiety/Foraging/Hunting/Scavenging, Rest, Reproduction, Exploration)
 * with explicit decision rules, physical steering acceleration, and observable consequences.
 *
 * Trophic roles:
 * - Herbivores: Seek flora patches, graze plant biomass, flee from carnivores
 * - Carnivores: Hunt prey only when energy demand justifies it; transfer bounded energy from prey
 * - Scavengers: Track olfactory scent of carrion, consume decomposing carcasses, avoid apex confrontations
 */
export function updateCreatureBehavior(
  organisms: OrganismState[],
  resources: ResourcePatch[],
  terrain: TerrainMap,
  grid: SpatialHashGrid,
  prng: PRNG
): BehaviorOutput {
  const reproducedParents: Array<{ parentA: OrganismState; parentB: OrganismState }> = [];
  const kills: HuntKillRecord[] = [];
  let plantBiomassConsumed = 0;
  let carrionBiomassConsumed = 0;
  let waterConsumed = 0;
  let reproductionEnergyInvested = 0;
  let reproductionTaxDissipated = 0;

  // Populate spatial hash grid for fast food and carrion queries
  grid.populateFood(resources);

  for (let i = 0; i < organisms.length; i++) {
    const org = organisms[i];
    if (org.state === 'dead') continue;

    const sensor = org.genome.sensoryRadius;
    const maxSpeed = org.genome.maxSpeed;
    const maxSteeringForce = 0.42 / org.genome.size;

    // Scan neighbors in spatial hash grid
    const neighbors = grid.queryRadius(org.x, org.y, sensor);

    // =========================================================================
    // 1. DANGER & THREAT EVALUATION
    // =========================================================================
    let nearestPredator: OrganismState | null = null;
    let minPredDistSq = sensor * sensor;

    if (org.genome.diet !== 'carnivore') {
      for (let j = 0; j < neighbors.length; j++) {
        const other = neighbors[j];
        if (other.state === 'dead' || other.id === org.id) continue;
        // Threat criterion: carnivore with comparable or larger size
        if (other.genome.diet === 'carnivore' && other.genome.size >= org.genome.size * 0.70) {
          const dx = other.x - org.x;
          const dy = other.y - org.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < minPredDistSq) {
            minPredDistSq = distSq;
            nearestPredator = other;
          }
        }
      }
    }

    let utilityDanger = 0;
    if (nearestPredator) {
      const predDist = Math.sqrt(minPredDistSq);
      const proximity = Math.max(0, 1.0 - predDist / sensor);
      // Scavengers and herbivores are cautious; bold organisms have higher bravery
      const skittishFactor = org.genome.diet === 'scavenger' ? 1.35 : 1.15;
      utilityDanger = proximity * proximity * (skittishFactor - org.genome.bravery * 0.45);
    }

    // =========================================================================
    // 2. HUNGER & FOOD EVALUATION (Differentiated by Trophic Role)
    // =========================================================================
    const hungerLevel = Math.max(0, (100 - org.energy) / 100);
    let utilityFood = Math.pow(hungerLevel, 1.35) * 0.90;

    let nearestFoodTarget: {
      x: number;
      y: number;
      id: string | null;
      type: 'plant' | 'prey' | 'carrion';
      entity: ResourcePatch | OrganismState | null;
    } | null = null;
    let minFoodDistSq = sensor * sensor;

    if (org.genome.diet === 'carnivore') {
      // -----------------------------------------------------------------------
      // CARNIVORE: Hunt prey only when energy demand justifies it
      // Predators do not hunt endlessly when satiated!
      // -----------------------------------------------------------------------
      if (org.energy > 74) {
        // Satiated predator: hunting utility is heavily discounted
        utilityFood *= 0.18;
      }

      for (let j = 0; j < neighbors.length; j++) {
        const candidate = neighbors[j];
        if (candidate.state === 'dead' || candidate.id === org.id) continue;
        // Predators target herbivores, scavengers, or smaller organisms
        if (candidate.genome.diet !== 'carnivore' || candidate.genome.bodySize < org.genome.bodySize * 0.72) {
          const dx = candidate.x - org.x;
          const dy = candidate.y - org.y;
          const distSq = dx * dx + dy * dy;

          // Camouflage reduces predator visual detection radius
          const camoFactor = Math.max(0.25, 1.0 - candidate.genome.camouflage * 0.65);
          const effectiveSensorDistSq = (sensor * camoFactor) * (sensor * camoFactor);

          if (distSq < minFoodDistSq && distSq <= effectiveSensorDistSq) {
            minFoodDistSq = distSq;
            nearestFoodTarget = {
              x: candidate.x,
              y: candidate.y,
              id: candidate.id,
              type: 'prey',
              entity: candidate,
            };
          }
        }
      }
    } else if (org.genome.diet === 'scavenger') {
      // -----------------------------------------------------------------------
      // SCAVENGER: Prioritize decomposing carrion via keen olfactory sensing (1.8x range)
      // -----------------------------------------------------------------------
      const nearbyCarrion = grid.queryCarrionRadius(org.x, org.y, sensor * 1.8);
      for (let c = 0; c < nearbyCarrion.length; c++) {
        const carrion = nearbyCarrion[c];
        if (carrion.amount <= 0.5) continue;
        const dx = carrion.x - org.x;
        const dy = carrion.y - org.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minFoodDistSq) {
          minFoodDistSq = distSq;
          nearestFoodTarget = {
            x: carrion.x,
            y: carrion.y,
            id: carrion.id,
            type: 'carrion',
            entity: carrion,
          };
        }
      }

      // If no carrion exists and scavenger is hungry, opportunistically forage flora
      if (!nearestFoodTarget && org.energy < 55) {
        const nearbyFlora = grid.queryFoodRadius(org.x, org.y, sensor);
        for (let r = 0; r < nearbyFlora.length; r++) {
          const patch = nearbyFlora[r];
          const dx = patch.x - org.x;
          const dy = patch.y - org.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < minFoodDistSq) {
            minFoodDistSq = distSq;
            nearestFoodTarget = {
              x: patch.x,
              y: patch.y,
              id: patch.id,
              type: 'plant',
              entity: patch,
            };
          }
        }
      }
    } else {
      // -----------------------------------------------------------------------
      // HERBIVORE & OMNIVORE: Graze plant biomass from flora patches
      // -----------------------------------------------------------------------
      const nearbyFlora = grid.queryFoodRadius(org.x, org.y, sensor);
      for (let r = 0; r < nearbyFlora.length; r++) {
        const patch = nearbyFlora[r];
        if (patch.amount <= 1.5) continue;
        const pCell = getCellAt(terrain, patch.x, patch.y);
        if (pCell && pCell.isFlooded) continue; // Submerged by flood waters

        const dx = patch.x - org.x;
        const dy = patch.y - org.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minFoodDistSq) {
          minFoodDistSq = distSq;
          nearestFoodTarget = {
            x: patch.x,
            y: patch.y,
            id: patch.id,
            type: 'plant',
            entity: patch,
          };
        }
      }

      // Omnivores can also hunt smaller creatures opportunistically if hungry
      if (org.genome.diet === 'omnivore' && org.energy < 50) {
        for (let j = 0; j < neighbors.length; j++) {
          const candidate = neighbors[j];
          if (candidate.state === 'dead' || candidate.id === org.id) continue;
          if (candidate.genome.size < org.genome.size * 0.65) {
            const dx = candidate.x - org.x;
            const dy = candidate.y - org.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < minFoodDistSq) {
              minFoodDistSq = distSq;
              nearestFoodTarget = {
                x: candidate.x,
                y: candidate.y,
                id: candidate.id,
                type: 'prey',
                entity: candidate,
              };
            }
          }
        }
      }
    }

    if (!nearestFoodTarget) {
      utilityFood *= 0.38; // Can't satisfy hunger without nearby target
    }

    // =========================================================================
    // 3. THIRST & WATER EVALUATION (Rivers, Lakes, Springs, Wetland Shores)
    // =========================================================================
    const thirstLevel = Math.max(0, (100 - org.hydration) / 100);
    let utilityThirst = Math.pow(thirstLevel, 1.35) * 0.94;
    if (org.hydration > 75) {
      utilityThirst *= 0.15; // Satiated hydration
    }

    let nearestWaterTarget: {
      x: number;
      y: number;
      id: string | null;
      type: 'spring' | 'terrain_water';
      entity: ResourcePatch | null;
    } | null = null;
    let minWaterDistSq = sensor * sensor;

    // 1. Query water springs from spatial hash grid
    const nearbySprings = grid.queryWaterRadius(org.x, org.y, sensor);
    for (let s = 0; s < nearbySprings.length; s++) {
      const spring = nearbySprings[s];
      if (spring.amount <= 0.5) continue;
      const dx = spring.x - org.x;
      const dy = spring.y - org.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < minWaterDistSq) {
        minWaterDistSq = distSq;
        nearestWaterTarget = {
          x: spring.x,
          y: spring.y,
          id: spring.id,
          type: 'spring',
          entity: spring,
        };
      }
    }

    // 2. If no spring found within range and creature is thirsty, search nearby terrain cells
    if (!nearestWaterTarget && org.hydration < 75) {
      const cs = terrain.cellSize;
      const orgGx = Math.floor(org.x / cs);
      const orgGy = Math.floor(org.y / cs);
      const cellRadius = Math.min(8, Math.ceil(sensor / cs));

      for (let dgy = -cellRadius; dgy <= cellRadius; dgy += 2) {
        const cgy = orgGy + dgy;
        if (cgy < 0 || cgy >= terrain.height) continue;
        for (let dgx = -cellRadius; dgx <= cellRadius; dgx += 2) {
          const cgx = orgGx + dgx;
          if (cgx < 0 || cgx >= terrain.width) continue;
          const cell = terrain.cells[cgy * terrain.width + cgx];
          if (cell && (cell.isRiver || cell.isLake || cell.isWater || cell.isFlooded)) {
            const wx = (cgx + 0.5) * cs;
            const wy = (cgy + 0.5) * cs;
            const dx = wx - org.x;
            const dy = wy - org.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < minWaterDistSq) {
              minWaterDistSq = distSq;
              nearestWaterTarget = {
                x: wx,
                y: wy,
                id: null,
                type: 'terrain_water',
                entity: null,
              };
            }
          }
        }
      }
    }

    if (!nearestWaterTarget) {
      utilityThirst *= 0.35; // Cannot locate water within sensory range
    }

    // =========================================================================
    // 4. EXHAUSTION & REST EVALUATION
    // =========================================================================
    let utilityRest = 0;
    if (org.energy < 22 && utilityDanger < 0.3) {
      utilityRest = (1.0 - org.energy / 100) * 0.80;
    }

    // =========================================================================
    // 5. REPRODUCTION & MATING EVALUATION
    // =========================================================================
    let utilityMate = 0;
    let mateTarget: OrganismState | null = null;
    let minMateDistSq = sensor * sensor;

    const canMate =
      org.isMature &&
      org.reproductiveCooldown === 0 &&
      org.energy >= org.genome.fertilityThreshold &&
      org.hydration >= 35 &&
      org.age < org.maxAge * 0.88;

    if (canMate) {
      const fertilitySurplus = (org.energy - org.genome.fertilityThreshold) / (100 - org.genome.fertilityThreshold);
      utilityMate = Math.max(0, fertilitySurplus) * 0.82;

      for (let j = 0; j < neighbors.length; j++) {
        const candidate = neighbors[j];
        if (candidate.state === 'dead' || candidate.id === org.id) continue;
        if (checkMatingCompatibility(org, candidate).compatible) {
          const dx = candidate.x - org.x;
          const dy = candidate.y - org.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < minMateDistSq) {
            minMateDistSq = distSq;
            mateTarget = candidate;
          }
        }
      }

      if (!mateTarget) {
        utilityMate *= 0.35;
      }
    }

    // Baseline exploration/wander utility
    const utilityWander = 0.20;

    // =========================================================================
    // 6. UTILITY ARBITRATION (Select Winner with Highest Score)
    // =========================================================================
    const maxUtility = Math.max(utilityDanger, utilityFood, utilityThirst, utilityRest, utilityMate, utilityWander);

    if (maxUtility === utilityDanger && nearestPredator) {
      // -----------------------------------------------------------------------
      // BEHAVIOR: ESCAPE PREDATORS / AVOID DANGER
      // -----------------------------------------------------------------------
      org.state = 'fleeing';
      org.targetId = nearestPredator.id;
      org.targetType = 'predator';
      org.targetX = nearestPredator.x;
      org.targetY = nearestPredator.y;

      const fleeDx = org.x - nearestPredator.x;
      const fleeDy = org.y - nearestPredator.y;
      const fleeDist = Math.hypot(fleeDx, fleeDy) || 1;

      // Desired velocity directly away from threat
      const desiredVx = (fleeDx / fleeDist) * (maxSpeed * 1.15);
      const desiredVy = (fleeDy / fleeDist) * (maxSpeed * 1.15);

      // Reynolds steering force acceleration
      const steerAx = Math.max(-maxSteeringForce * 1.5, Math.min(maxSteeringForce * 1.5, desiredVx - org.vx));
      const steerAy = Math.max(-maxSteeringForce * 1.5, Math.min(maxSteeringForce * 1.5, desiredVy - org.vy));
      org.ax += steerAx;
      org.ay += steerAy;
    } else if (maxUtility === utilityRest) {
      // -----------------------------------------------------------------------
      // BEHAVIOR: REST (Recover vigor and reduce metabolic expenditure)
      // -----------------------------------------------------------------------
      org.state = 'resting';
      org.targetId = null;
      org.targetType = 'none';
      org.targetX = null;
      org.targetY = null;

      // Decelerate to stillness
      org.ax -= org.vx * 0.45;
      org.ay -= org.vy * 0.45;
    } else if (maxUtility === utilityFood && nearestFoodTarget) {
      // -----------------------------------------------------------------------
      // BEHAVIOR: SEEK & PURSUE FOOD / EAT (Differentiated by Food Type)
      // -----------------------------------------------------------------------
      org.targetId = nearestFoodTarget.id;
      org.targetType = nearestFoodTarget.type === 'carrion' ? 'carrion' : 'food';
      org.targetX = nearestFoodTarget.x;
      org.targetY = nearestFoodTarget.y;

      const dx = nearestFoodTarget.x - org.x;
      const dy = nearestFoodTarget.y - org.y;
      const dist = Math.hypot(dx, dy);

      if (nearestFoodTarget.type === 'plant') {
        // HERBIVORE GRAZING ON LIVING FLORA
        const plant = nearestFoodTarget.entity as ResourcePatch;
        const eatRange = org.collisionRadius + plant.radius * 0.6 + 4;

        if (dist <= eatRange) {
          // ACTION: EAT PLANT
          org.state = 'eating';
          const bite = Math.min(plant.amount, 8.5);
          plant.amount -= bite;
          plantBiomassConsumed += bite;

          // Herbivore assimilation efficiency scaled by foodProcessingEfficiency
          const energyGained = bite * 1.85 * (org.genome.foodProcessingEfficiency || 1.0);
          org.energy = Math.min(100, org.energy + energyGained);

          // Decelerate while grazing
          org.ax -= org.vx * 0.35;
          org.ay -= org.vy * 0.35;
        } else {
          // ACTION: PURSUE FOOD
          org.state = 'pursuing_food';
          const desiredVx = (dx / (dist || 1)) * maxSpeed;
          const desiredVy = (dy / (dist || 1)) * maxSpeed;
          org.ax += Math.max(-maxSteeringForce, Math.min(maxSteeringForce, desiredVx - org.vx));
          org.ay += Math.max(-maxSteeringForce, Math.min(maxSteeringForce, desiredVy - org.vy));
        }
      } else if (nearestFoodTarget.type === 'carrion') {
        // SCAVENGER CONSUMING DECOMPOSING CARRION
        const carrion = nearestFoodTarget.entity as ResourcePatch;
        const eatRange = org.collisionRadius + carrion.radius * 0.6 + 4;

        if (dist <= eatRange) {
          // ACTION: SCAVENGE CARRION
          org.state = 'scavenging';
          const bite = Math.min(carrion.amount, 7.5);
          carrion.amount -= bite;
          carrionBiomassConsumed += bite;

          // High detritivore digestive efficiency scaled by foodProcessingEfficiency
          const energyGained = bite * 1.95 * (org.genome.foodProcessingEfficiency || 1.0);
          org.energy = Math.min(100, org.energy + energyGained);

          org.ax -= org.vx * 0.35;
          org.ay -= org.vy * 0.35;
        } else {
          // ACTION: PURSUE CARRION
          org.state = 'scavenging';
          const desiredVx = (dx / (dist || 1)) * maxSpeed;
          const desiredVy = (dy / (dist || 1)) * maxSpeed;
          org.ax += Math.max(-maxSteeringForce, Math.min(maxSteeringForce, desiredVx - org.vx));
          org.ay += Math.max(-maxSteeringForce, Math.min(maxSteeringForce, desiredVy - org.vy));
        }
      } else {
        // CARNIVORE HUNTING PREY
        const prey = nearestFoodTarget.entity as OrganismState;
        const strikeRange = org.collisionRadius + prey.collisionRadius + 3.5;

        if (dist <= strikeRange) {
          // ACTION: STRIKE PREY (scaled by body size and aggression)
          org.state = 'hunting';
          const damage = 36 * (org.genome.bodySize / (prey.genome.bodySize || 1)) * (1 + org.genome.aggression * 0.35);
          prey.health -= damage;

          if (prey.health <= 0) {
            prey.state = 'dead';
            prey.deathCause = 'predation';

            // Predator energy transfer scaled by food processing efficiency
            const transferCap =
              Math.min(prey.energy * 0.75 + prey.genome.bodySize * 20, 55 * prey.genome.bodySize) *
              (org.genome.foodProcessingEfficiency || 1.0);
            const actualGain = Math.min(100 - org.energy, transferCap);
            org.energy += actualGain;
            org.kills += 1;

            // Residual carcass mass that remains as carrion for scavengers
            const residualMass = Math.max(12, prey.genome.bodySize * 26 - actualGain * 0.35);

            kills.push({
              predator: org,
              prey,
              energyGained: actualGain,
              residualCarrionMass: residualMass,
            });
          }

          org.ax -= org.vx * 0.3;
          org.ay -= org.vy * 0.3;
        } else {
          // ACTION: PURSUE PREY
          org.state = 'hunting';
          const desiredVx = (dx / (dist || 1)) * (maxSpeed * 1.12);
          const desiredVy = (dy / (dist || 1)) * (maxSpeed * 1.12);
          org.ax += Math.max(-maxSteeringForce * 1.3, Math.min(maxSteeringForce * 1.3, desiredVx - org.vx));
          org.ay += Math.max(-maxSteeringForce * 1.3, Math.min(maxSteeringForce * 1.3, desiredVy - org.vy));
        }
      }
    } else if (maxUtility === utilityThirst && nearestWaterTarget) {
      // -----------------------------------------------------------------------
      // BEHAVIOR: SEEK & CONSUME WATER (Rivers, Lakes, Springs, Wetland Shores)
      // -----------------------------------------------------------------------
      org.targetId = nearestWaterTarget.id;
      org.targetType = 'water';
      org.targetX = nearestWaterTarget.x;
      org.targetY = nearestWaterTarget.y;

      const dx = nearestWaterTarget.x - org.x;
      const dy = nearestWaterTarget.y - org.y;
      const dist = Math.hypot(dx, dy);
      const drinkRange = org.collisionRadius + (nearestWaterTarget.type === 'spring' ? (nearestWaterTarget.entity?.radius || 18) * 0.7 : 14);

      if (dist <= drinkRange) {
        // ACTION: DRINK WATER
        org.state = 'drinking';
        const thirstDeficit = 100 - org.hydration;
        let actualDrink = Math.min(thirstDeficit, 14.0);

        if (nearestWaterTarget.type === 'spring' && nearestWaterTarget.entity) {
          actualDrink = Math.min(actualDrink, nearestWaterTarget.entity.amount);
          nearestWaterTarget.entity.amount -= actualDrink;
        }

        org.hydration = Math.min(100, org.hydration + actualDrink);
        waterConsumed += actualDrink;

        // Decelerate while drinking
        org.ax -= org.vx * 0.45;
        org.ay -= org.vy * 0.45;
      } else {
        // ACTION: PURSUE WATER
        org.state = 'drinking';
        const desiredVx = (dx / (dist || 1)) * maxSpeed;
        const desiredVy = (dy / (dist || 1)) * maxSpeed;
        org.ax += Math.max(-maxSteeringForce, Math.min(maxSteeringForce, desiredVx - org.vx));
        org.ay += Math.max(-maxSteeringForce, Math.min(maxSteeringForce, desiredVy - org.vy));
      }
    } else if (maxUtility === utilityMate && mateTarget) {
      // -----------------------------------------------------------------------
      // BEHAVIOR: LOCATE MATES & REPRODUCE
      // -----------------------------------------------------------------------
      org.targetId = mateTarget.id;
      org.targetType = 'mate';
      org.targetX = mateTarget.x;
      org.targetY = mateTarget.y;

      const dx = mateTarget.x - org.x;
      const dy = mateTarget.y - org.y;
      const dist = Math.hypot(dx, dy);
      const contactDist = org.collisionRadius + mateTarget.collisionRadius + 4;

      if (dist <= contactDist) {
        // ACTION: REPRODUCE
        // Both parents pay an actual energy cost based on reproductive investment
        const avgReproInvestment = (org.genome.reproductiveInvestment + mateTarget.genome.reproductiveInvestment) / 2;
        const parentCost = Math.round(26 + avgReproInvestment * 20);
        org.energy -= parentCost;
        mateTarget.energy -= parentCost;

        // Thermodynamic accounting: investment transfer with thermodynamic tax
        const childEndowment = Math.round(parentCost * 1.45);
        const taxDissipated = Math.max(8, (parentCost * 2) - childEndowment);
        reproductionEnergyInvested += parentCost * 2;
        reproductionTaxDissipated += taxDissipated;

        org.reproductiveCooldown = 180 + org.genome.gestationTicks;
        mateTarget.reproductiveCooldown = 180 + mateTarget.genome.gestationTicks;
        org.offspringCount += 1;
        mateTarget.offspringCount += 1;
        org.state = 'reproducing';
        mateTarget.state = 'reproducing';

        reproducedParents.push({ parentA: org, parentB: mateTarget });

        org.ax -= org.vx * 0.5;
        org.ay -= org.vy * 0.5;
      } else {
        // ACTION: APPROACH MATE
        org.state = 'locating_mate';
        const desiredVx = (dx / (dist || 1)) * (maxSpeed * 0.85);
        const desiredVy = (dy / (dist || 1)) * (maxSpeed * 0.85);
        org.ax += Math.max(-maxSteeringForce, Math.min(maxSteeringForce, desiredVx - org.vx));
        org.ay += Math.max(-maxSteeringForce, Math.min(maxSteeringForce, desiredVy - org.vy));
      }
    } else {
      // -----------------------------------------------------------------------
      // BEHAVIOR: WANDER & EXPLORE
      // -----------------------------------------------------------------------
      org.state = 'wandering';
      org.targetId = null;
      org.targetType = 'none';

      // Organic Perlin-style heading shift
      org.wanderAngle += prng.gaussian(0, 0.22);
      const wanderSpeed = maxSpeed * 0.45;
      const desiredVx = Math.cos(org.wanderAngle) * wanderSpeed;
      const desiredVy = Math.sin(org.wanderAngle) * wanderSpeed;

      org.ax += Math.max(-maxSteeringForce * 0.6, Math.min(maxSteeringForce * 0.6, desiredVx - org.vx));
      org.ay += Math.max(-maxSteeringForce * 0.6, Math.min(maxSteeringForce * 0.6, desiredVy - org.vy));
    }

    // =========================================================================
    // 6. AVOID INACCESSIBLE TERRAIN (Predictive Obstacle Steering)
    // =========================================================================
    const intendedVx = org.vx + org.ax;
    const intendedVy = org.vy + org.ay;
    const intendedSpeed = Math.hypot(intendedVx, intendedVy);

    if (intendedSpeed > 0.04) {
      const probeDist = org.collisionRadius + 14;
      const probeAngle = Math.atan2(intendedVy, intendedVx);
      const probeX = org.x + Math.cos(probeAngle) * probeDist;
      const probeY = org.y + Math.sin(probeAngle) * probeDist;

      const probeCell = getCellAt(terrain, probeX, probeY);
      if (probeCell && (!probeCell.isWalkable || probeCell.biome === 'deep_ocean' || probeCell.isLake || probeCell.isFlooded)) {
        // Repel away from inaccessible obstacle or flood waters
        const repelAngle = probeAngle + Math.PI;
        const repelForce = maxSteeringForce * 1.2;
        org.ax += Math.cos(repelAngle) * repelForce;
        org.ay += Math.sin(repelAngle) * repelForce;
      }
    }
  }

  return {
    reproducedParents,
    kills,
    plantBiomassConsumed,
    carrionBiomassConsumed,
    waterConsumed,
    reproductionEnergyInvested,
    reproductionTaxDissipated,
  };
}
