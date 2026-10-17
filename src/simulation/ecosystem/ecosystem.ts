/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClimateState, ResourcePatch, TerrainMap } from '../../types/simulation.js';
import { PRNG } from '../math/prng.js';
import { getCellAt } from '../terrain/terrain.js';
import { getEffectiveLocalTemperature, getEffectiveLocalMoisture } from '../terrain/climate.js';

export interface EcosystemUpdateResult {
  solarEnergyInflow: number;
  recycledSoilNutrients: number;
  soilNutrientsAbsorbed: number;
  plantBiomass: number;
  carrionBiomass: number;
}

export function createInitialResources(terrain: TerrainMap, prng: PRNG, count = 200, capacityMultiplier = 1): ResourcePatch[] {
  const patches: ResourcePatch[] = [];
  let attempts = 0;

  while (patches.length < count && attempts < count * 6) {
    attempts++;
    const x = prng.range(60, terrain.worldWidth - 60);
    const y = prng.range(60, terrain.worldHeight - 60);
    const cell = getCellAt(terrain, x, y);
    if (!cell || cell.isWater) continue;

    // Favor high plant suitability biomes (forests, grasslands, river banks)
    if (cell.plantSuitability < 0.15 && prng.chance(0.85)) continue;

    const maxAmount = prng.range(35, 90) * capacityMultiplier;
    const baseGrowth = prng.range(0.12, 0.28) * Math.max(0.18, cell.plantSuitability);
    patches.push({
      id: `res_${patches.length}_${prng.rangeInt(1000, 9999)}`,
      x,
      y,
      type: 'plant',
      amount: maxAmount * prng.range(0.5, 0.95),
      maxAmount,
      radius: prng.range(14, 28),
      growthRate: baseGrowth,
    });
  }

  // Spawn natural freshwater drinking springs & oases
  for (let w = 0; w < 30; w++) {
    const x = prng.range(60, terrain.worldWidth - 60);
    const y = prng.range(60, terrain.worldHeight - 60);
    const cell = getCellAt(terrain, x, y);
    if (!cell || cell.isWater) continue;
    if (cell.moisture < 0.22 && prng.chance(0.7)) continue;
    patches.push({
      id: `spring_${patches.length}_${prng.rangeInt(1000, 9999)}`,
      x,
      y,
      type: 'water_spring',
      amount: 140,
      maxAmount: 140,
      radius: 18,
      growthRate: 0.85,
    });
  }

  return patches;
}

/**
 * Spawns organic carcass mass from predator kills or non-predated organism deaths
 */
export function spawnCarrion(
  resources: ResourcePatch[],
  x: number,
  y: number,
  bodySize: number,
  carrionAmount: number,
  id = `carrion_${resources.length}`
): void {
  const radius = Math.max(10, Math.min(26, bodySize * 15));
  resources.push({
    id,
    x,
    y,
    type: 'carrion',
    amount: Math.max(5, carrionAmount),
    maxAmount: Math.max(12, carrionAmount * 1.2),
    radius,
    growthRate: 0,
  });
}

/**
 * Updates the ecological resource network with climate & environmental interconnection:
 * 1. Photosynthesis: Modulated by local solar radiation, local temperature thermal curve, and local moisture.
 * 2. Drought Response: Drought halts photosynthesis and causes plant biomass to wither and shrink.
 * 3. Temperature Response: Freezing cold (< 2°C) freezes plant growth; extreme heat (> 38°C) stunts growth.
 * 4. Flood Response: Submerged plants in flooded cells stall growth until floodwaters recede.
 * 5. Carrion Decomposition: Temperature-modulated organic recycling into soil fertility.
 * 6. Nutrient Recycling: Recycled soil nutrients feed back into plant regrowth.
 */
export function updateResourceEcosystem(
  resources: ResourcePatch[],
  terrain: TerrainMap,
  climate: ClimateState,
  soilNutrientReserve: number,
  prng: PRNG,
  growthMultiplier = 1,
  plantOnlyReseeding = false,
  avoidPlantClustering = false
): EcosystemUpdateResult {
  let solarEnergyInflow = 0;
  let recycledSoilNutrients = 0;
  let soilNutrientsAbsorbed = 0;
  let plantBiomass = 0;
  let carrionBiomass = 0;

  // Global solar radiation base (diminished at night, obstructed by volcanic ash)
  const basePhotoFactor = Math.max(0.04, climate.solarRadiation * 1.25);
  const soilEnrichment = Math.min(0.4, (soilNutrientReserve / 1000) * 0.2);

  for (let i = 0; i < resources.length; i++) {
    const res = resources[i];

    if (res.type === 'plant') {
      const cell = getCellAt(terrain, res.x, res.y);
      const isFlooded = cell ? !!cell.isFlooded : false;
      const localTemp = getEffectiveLocalTemperature(terrain, res.x, res.y, climate);
      const localMoist = getEffectiveLocalMoisture(terrain, res.x, res.y, climate);

      // Photosynthesis temperature curve (bell curve peaking between 16°C and 28°C)
      let tempPhotoCurve = 1.0;
      if (localTemp < 2.0) {
        // Freezing conditions inhibit photosynthesis
        tempPhotoCurve = Math.max(0, (localTemp + 5.0) / 7.0 * 0.25);
      } else if (localTemp < 14.0) {
        tempPhotoCurve = 0.3 + ((localTemp - 2.0) / 12.0) * 0.7;
      } else if (localTemp > 38.0) {
        // Extreme heat stress stunts photosynthesis
        tempPhotoCurve = Math.max(0.1, (46.0 - localTemp) / 8.0);
      }

      // Moisture factor: plants require soil moisture
      const moistFactor = Math.max(0.1, localMoist * 1.2);

      // DROUGHT EFFECT: Plants wither and lose biomass under severe drought
      if (climate.isDrought || localMoist < 0.16) {
        const withering = (0.05 + climate.droughtSeverity * 0.08) * (res.amount > 5 ? 1.0 : 0.4);
        res.amount = Math.max(0.8, res.amount - withering);
      }
      // FROST DAMAGE: Sub-zero freezing temperatures slowly frost-damage foliage
      else if (localTemp < -4.0) {
        const frostLoss = 0.035;
        res.amount = Math.max(1.0, res.amount - frostLoss);
      }
      // FLOOD EFFECT: Submerged plants temporarily do not photosynthesize
      else if (isFlooded) {
        // Stalled under flood water
      }
      // NORMAL / OPTIMAL PHOTOSYNTHESIS
      else {
        const habitatFertility = cell
          ? Math.max(0.1, cell.fertility * 0.7 + cell.plantSuitability * 0.3 + (cell.ashFertilityBoost || 0) * 0.3)
          : 0.4;

        const healthRatio = Math.max(0.15, res.amount / res.maxAmount);
        const capacitySpace = Math.max(0, res.maxAmount - res.amount);

        if (capacitySpace > 0) {
          const potentialGrowth =
            res.growthRate * growthMultiplier *
            basePhotoFactor *
            tempPhotoCurve *
            moistFactor *
            habitatFertility *
            (0.35 + healthRatio * 0.65) *
            (1.0 + soilEnrichment);

          const actualGrowth = Math.min(capacitySpace, potentialGrowth);
          res.amount += actualGrowth;
          solarEnergyInflow += actualGrowth;

          if (soilNutrientReserve > 5) {
            const absorbed = Math.min(actualGrowth * 0.15, 0.05);
            soilNutrientsAbsorbed += absorbed;
          }
        }
      }

      plantBiomass += res.amount;
    } else if (res.type === 'carrion') {
      // Carrion decomposition rate accelerates in warm humid weather, slows in freezing cold
      const localTemp = getEffectiveLocalTemperature(terrain, res.x, res.y, climate);
      const tempDecompMod = Math.max(0.2, Math.min(2.0, (localTemp + 10) / 25));
      const decompRate = 0.035 * tempDecompMod;

      const decayAmount = Math.min(res.amount, decompRate);
      res.amount -= decayAmount;

      recycledSoilNutrients += decayAmount * 0.8;
      carrionBiomass += res.amount;
    } else if (res.type === 'water_spring') {
      if (climate.isDrought) {
        // Drought parches natural freshwater springs
        const parching = 0.12 * Math.max(0.3, climate.droughtSeverity || 0.5);
        res.amount = Math.max(0, res.amount - parching);
      } else {
        const recharge = res.growthRate * (0.4 + climate.rainfall * 0.9);
        res.amount = Math.min(res.maxAmount, res.amount + recharge);
      }
    }
  }

  // Remove fully decomposed or consumed carrion
  for (let i = resources.length - 1; i >= 0; i--) {
    if (resources[i].type === 'carrion' && resources[i].amount <= 0.6) {
      resources.splice(i, 1);
    }
  }

  // Seed new plant patches if regional density drops below carrying capacity and not during severe drought
  const reseedingCount = plantOnlyReseeding
    ? resources.reduce((count, resource) => count + (resource.type === 'plant' && resource.amount > 1.5 ? 1 : 0), 0)
    : resources.length;
  if (reseedingCount < 180 && !climate.isDrought && prng.chance(0.20)) {
    const x = prng.range(60, terrain.worldWidth - 60);
    const y = prng.range(60, terrain.worldHeight - 60);
    const cell = getCellAt(terrain, x, y);

    const nearbyPlant = avoidPlantClustering && resources.some(resource => resource.type === 'plant' &&
      (resource.x - x) ** 2 + (resource.y - y) ** 2 < 35 ** 2);
    if (cell && !cell.isWater && !cell.isFlooded && cell.plantSuitability > 0.22 && !nearbyPlant) {
      const maxAmount = prng.range(35, 80);
      const initialAmount = prng.range(12, 22);
      resources.push({
        id: `plant_${resources.length}_${prng.rangeInt(1000, 9999)}`,
        x,
        y,
        type: 'plant',
        amount: initialAmount,
        maxAmount,
        radius: prng.range(14, 26),
        growthRate: prng.range(0.14, 0.30) * Math.max(0.18, cell.plantSuitability),
      });
      plantBiomass += initialAmount;
      solarEnergyInflow += initialAmount;
    }
  }

  return {
    solarEnergyInflow,
    recycledSoilNutrients,
    soilNutrientsAbsorbed,
    plantBiomass,
    carrionBiomass,
  };
}
