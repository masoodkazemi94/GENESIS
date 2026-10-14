/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ClimateState,
  DisasterType,
  EnvironmentalDisaster,
  OrganismState,
  ResourcePatch,
  SimulationEvent,
  TerrainCell,
  TerrainMap,
} from '../../types/simulation.js';
import { PRNG } from '../math/prng.js';
import { getCellAt, SEA_LEVEL, MOUNTAIN_LEVEL } from './terrain.js';

export interface EnvironmentalUpdateResult {
  newEvents: Array<{
    type: SimulationEvent['type'];
    title: string;
    description: string;
    isMilestone?: boolean;
    highlightSpeciesId?: string;
    highlightOrganismId?: string;
    x?: number;
    y?: number;
  }>;
  recoveredPatches: ResourcePatch[];
  destroyedPlantsCount: number;
  totalHabitatDeterioration: number;
}

export interface DisasterCooldowns {
  drought: number;
  wildfire: number;
  flood: number;
  volcanic_eruption: number;
  cold_snap: number;
}

export const DEFAULT_DISASTER_COOLDOWNS: DisasterCooldowns = {
  drought: 2400,            // Min ticks between droughts
  wildfire: 1600,           // Min ticks between wildfires
  flood: 1800,              // Min ticks between floods
  volcanic_eruption: 4800,  // Rare volcanic eruptions
  cold_snap: 2200,          // Min ticks between severe cold snaps
};

/**
 * Computes effective localized temperature at coordinates (x, y)
 * taking into account terrain latitude/elevation, seasonal cycle,
 * diurnal solar swing, macro climate trends, and active disaster anomalies.
 */
export function getEffectiveLocalTemperature(
  terrain: TerrainMap,
  x: number,
  y: number,
  climate: ClimateState
): number {
  const cell = getCellAt(terrain, x, y);
  const baseCellTemp = cell ? cell.temperature : (climate.temperature || 18.0);

  // Base seasonal and diurnal temperature swings
  let temp = baseCellTemp + (climate.globalTempAnomaly || 0);

  // Localized disaster thermal modulations
  if (climate.activeDisasters && climate.activeDisasters.length > 0) {
    for (let i = 0; i < climate.activeDisasters.length; i++) {
      const d = climate.activeDisasters[i];
      if (!d.active) continue;

      const dx = d.x - x;
      const dy = d.y - y;
      const dist = Math.hypot(dx, dy);

      if (dist <= d.radius) {
        const falloff = 1.0 - dist / d.radius;

        if (d.type === 'wildfire') {
          // Intense fire heat in local burn zone (+15°C to +35°C)
          temp += falloff * 32.0 * d.severity;
        } else if (d.type === 'volcanic_eruption') {
          const calderaRadius = d.radius * 0.28;
          if (dist <= calderaRadius) {
            // Extreme lava/magma heat near caldera (+42°C)
            const calderaFalloff = 1.0 - dist / calderaRadius;
            temp += calderaFalloff * 42.0 * d.severity;
          } else {
            // Ash cloud aerosol cooling in surrounding shadow (-4°C to -8°C)
            temp -= falloff * 6.5 * d.severity;
          }
        } else if (d.type === 'cold_snap') {
          // Deep polar frost freezing temperatures (-12°C to -18°C)
          temp -= falloff * 15.0 * d.severity;
        }
      }
    }
  }

  return Math.round(temp * 10) / 10;
}

/**
 * Computes effective localized moisture at coordinates (x, y)
 * taking into account terrain base moisture, seasonal rainfall,
 * drought parching, flooding, and wildfire ground scorching.
 */
export function getEffectiveLocalMoisture(
  terrain: TerrainMap,
  x: number,
  y: number,
  climate: ClimateState
): number {
  const cell = getCellAt(terrain, x, y);
  if (!cell) return 0.5;

  if (cell.isFlooded) return 1.0;

  let moisture = cell.moisture;

  // Seasonal rainfall modulation
  moisture += (climate.globalRainAnomaly || 0) * 0.25;

  // Drought reduces soil moisture significantly
  if (climate.isDrought) {
    const sev = typeof climate.droughtSeverity === 'number' ? climate.droughtSeverity : 0.65;
    moisture *= Math.max(0.12, 1.0 - sev * 0.72);
  }

  // Habitat deterioration from fire scorches ground moisture
  if (cell.deterioration && cell.deterioration > 0) {
    moisture *= Math.max(0.08, 1.0 - cell.deterioration * 0.65);
  }

  return Math.max(0.02, Math.min(1.0, Math.round(moisture * 100) / 100));
}

/**
 * Evaluates probabilistic but deterministic disaster triggers
 * based on climate trends, season, biome conditions, and cooldowns.
 */
export function evaluateDisasterTriggers(
  terrain: TerrainMap,
  climate: ClimateState,
  cooldowns: DisasterCooldowns,
  tick: number,
  prng: PRNG,
  resources: ResourcePatch[]
): EnvironmentalDisaster | null {
  // 1. DROUGHT: High probability during hot summer or severe positive temperature trends
  if (cooldowns.drought <= 0 && !climate.isDrought) {
    const isHotSummer = climate.season === 'summer' && climate.temperature > 23;
    const isDryAnomaly = climate.globalRainAnomaly < -0.15;
    const droughtChance = isHotSummer ? 0.0035 : isDryAnomaly ? 0.002 : 0.0008;

    if (prng.chance(droughtChance)) {
      cooldowns.drought = DEFAULT_DISASTER_COOLDOWNS.drought;
      const severity = Math.min(0.88, Math.max(0.45, 0.55 + prng.range(-0.1, 0.3)));
      const durationTicks = prng.rangeInt(1000, 2200);

      return {
        id: `disaster_drought_${tick}_${prng.rangeInt(100, 999)}`,
        type: 'drought',
        name: severity > 0.75 ? 'The Great Arid Drought' : 'Regional Drought Spell',
        startTick: tick,
        durationTicks,
        remainingTicks: durationTicks,
        severity,
        x: terrain.worldWidth / 2,
        y: terrain.worldHeight / 2,
        radius: terrain.worldWidth * 0.9,
        active: true,
        affectedCount: 0,
        plantsDestroyed: 0,
      };
    }
  }

  // 2. WILDFIRE: Originates in hot, dry, vegetated terrain (grassland / forest during heat)
  if (cooldowns.wildfire <= 0) {
    const isDryAndHot = climate.temperature > 22 && (climate.rainfall < 0.28 || climate.isDrought);
    const fireChance = isDryAndHot ? 0.005 : prng.chance(0.001) ? 0.001 : 0;

    if (fireChance > 0 && prng.chance(fireChance)) {
      // Find candidate dry vegetated cell
      const cs = terrain.cellSize;
      let bestCandidate: TerrainCell | null = null;
      let bestFireScore = -1;

      // Deterministic sample of 30 candidate cells
      for (let attempt = 0; attempt < 30; attempt++) {
        const cx = prng.rangeInt(20, terrain.width - 20);
        const cy = prng.rangeInt(20, terrain.height - 20);
        const cell = terrain.cells[cy * terrain.width + cx];
        if (!cell || cell.isWater || cell.isRiver || cell.isLake || cell.isFlooded) continue;
        if (cell.biome !== 'grassland' && cell.biome !== 'forest') continue;

        const effectiveMoist = getEffectiveLocalMoisture(terrain, cx * cs, cy * cs, climate);
        const fireScore = (1.0 - effectiveMoist) * 0.6 + cell.plantSuitability * 0.4;
        if (fireScore > bestFireScore) {
          bestFireScore = fireScore;
          bestCandidate = cell;
        }
      }

      if (bestCandidate && bestFireScore > 0.35) {
        cooldowns.wildfire = DEFAULT_DISASTER_COOLDOWNS.wildfire;
        const severity = Math.min(0.90, Math.max(0.40, 0.60 + prng.range(-0.15, 0.25)));
        const radius = prng.range(130, 240); // Bounded localized radius
        const durationTicks = prng.rangeInt(350, 650);

        return {
          id: `disaster_wildfire_${tick}_${prng.rangeInt(100, 999)}`,
          type: 'wildfire',
          name: severity > 0.72 ? 'Wildfire Inferno' : 'Grassland Brushfire',
          startTick: tick,
          durationTicks,
          remainingTicks: durationTicks,
          severity,
          x: (bestCandidate.x + 0.5) * cs,
          y: (bestCandidate.y + 0.5) * cs,
          radius,
          active: true,
          affectedCount: 0,
          plantsDestroyed: 0,
        };
      }
    }
  }

  // 3. FLOODING: Originates from heavy rainfall or spring snowmelt swelling low river basins
  if (cooldowns.flood <= 0 && !climate.isDrought) {
    const isSpringMelt = climate.season === 'spring' && climate.rainfall > 0.45;
    const isTorrential = climate.rainfall > 0.72;
    const floodChance = isTorrential ? 0.004 : isSpringMelt ? 0.003 : 0.0006;

    if (prng.chance(floodChance)) {
      // Find candidate river / low-elevation junction
      const cs = terrain.cellSize;
      let floodOriginCell: TerrainCell | null = null;

      for (let attempt = 0; attempt < 35; attempt++) {
        const cx = prng.rangeInt(30, terrain.width - 30);
        const cy = prng.rangeInt(30, terrain.height - 30);
        const cell = terrain.cells[cy * terrain.width + cx];
        if (cell && (cell.isRiver || (cell.height > SEA_LEVEL && cell.height < SEA_LEVEL + 0.08))) {
          floodOriginCell = cell;
          break;
        }
      }

      if (floodOriginCell) {
        cooldowns.flood = DEFAULT_DISASTER_COOLDOWNS.flood;
        const severity = Math.min(0.85, Math.max(0.40, 0.55 + prng.range(-0.1, 0.25)));
        const radius = prng.range(160, 280);
        const durationTicks = prng.rangeInt(450, 800);

        return {
          id: `disaster_flood_${tick}_${prng.rangeInt(100, 999)}`,
          type: 'flood',
          name: severity > 0.7 ? 'Torrential River Inundation' : 'Flash River Flood',
          startTick: tick,
          durationTicks,
          remainingTicks: durationTicks,
          severity,
          x: (floodOriginCell.x + 0.5) * cs,
          y: (floodOriginCell.y + 0.5) * cs,
          radius,
          active: true,
          affectedCount: 0,
          plantsDestroyed: 0,
        };
      }
    }
  }

  // 4. RARE VOLCANIC ERUPTION: Super rare, erupts from prominent mountain peak
  if (cooldowns.volcanic_eruption <= 0 && tick > 1200) {
    const volcanoChance = 0.0006; // Rare occurrence
    if (prng.chance(volcanoChance)) {
      // Find highest peak cell in terrain
      let highestCell: TerrainCell | null = null;
      let maxElevation = MOUNTAIN_LEVEL;

      // Sample mountain regions
      for (let i = 0; i < terrain.cells.length; i += 73) {
        const cell = terrain.cells[i];
        if (cell && cell.height > maxElevation) {
          maxElevation = cell.height;
          highestCell = cell;
        }
      }

      if (highestCell) {
        cooldowns.volcanic_eruption = DEFAULT_DISASTER_COOLDOWNS.volcanic_eruption;
        const severity = Math.min(0.95, Math.max(0.65, 0.78 + prng.range(-0.1, 0.15)));
        const radius = prng.range(420, 680); // Caldera + ash cloud radius
        const durationTicks = prng.rangeInt(800, 1500);
        const cs = terrain.cellSize;

        return {
          id: `disaster_volcano_${tick}_${prng.rangeInt(100, 999)}`,
          type: 'volcanic_eruption',
          name: severity > 0.85 ? 'Cataclysmic Volcanic Eruption' : 'Alpine Volcanic Eruption',
          startTick: tick,
          durationTicks,
          remainingTicks: durationTicks,
          severity,
          x: (highestCell.x + 0.5) * cs,
          y: (highestCell.y + 0.5) * cs,
          radius,
          active: true,
          affectedCount: 0,
          plantsDestroyed: 0,
        };
      }
    }
  }

  // 5. COLD SNAP: Extreme winter frost / polar vortex
  if (cooldowns.cold_snap <= 0 && climate.season === 'winter') {
    const coldSnapChance = 0.0035;
    if (prng.chance(coldSnapChance)) {
      cooldowns.cold_snap = DEFAULT_DISASTER_COOLDOWNS.cold_snap;
      const severity = Math.min(0.90, Math.max(0.50, 0.65 + prng.range(-0.1, 0.2)));
      const radius = terrain.worldWidth * 0.75;
      const durationTicks = prng.rangeInt(500, 950);

      return {
        id: `disaster_cold_${tick}_${prng.rangeInt(100, 999)}`,
        type: 'cold_snap',
        name: severity > 0.75 ? 'Glacial Polar Vortex' : 'Severe Winter Frost',
        startTick: tick,
        durationTicks,
        remainingTicks: durationTicks,
        severity,
        x: terrain.worldWidth / 2,
        y: terrain.worldHeight * 0.35,
        radius,
        active: true,
        affectedCount: 0,
        plantsDestroyed: 0,
      };
    }
  }

  return null;
}

/**
 * Step active disasters:
 * - Decrements remaining duration
 * - Burns/floods/erupts across local terrain cells
 * - Destroys or submerges flora
 * - Damages caught organisms without thermal/environmental tolerance
 * - Heals deteriorating habitat cells and triggers recolonization
 */
export function updateEnvironmentalDisasters(
  terrain: TerrainMap,
  climate: ClimateState,
  organisms: OrganismState[],
  resources: ResourcePatch[],
  tick: number,
  prng: PRNG
): EnvironmentalUpdateResult {
  const newEvents: EnvironmentalUpdateResult['newEvents'] = [];
  const recoveredPatches: ResourcePatch[] = [];
  let destroyedPlantsCount = 0;
  let totalHabitatDeterioration = 0;

  const cs = terrain.cellSize;

  // 1. Process active disasters
  for (let dIdx = climate.activeDisasters.length - 1; dIdx >= 0; dIdx--) {
    const disaster = climate.activeDisasters[dIdx];
    disaster.remainingTicks -= 1;

    // A. Apply WILDFIRE physical effects
    if (disaster.type === 'wildfire') {
      const minGx = Math.max(0, Math.floor((disaster.x - disaster.radius) / cs));
      const maxGx = Math.min(terrain.width - 1, Math.floor((disaster.x + disaster.radius) / cs));
      const minGy = Math.max(0, Math.floor((disaster.y - disaster.radius) / cs));
      const maxGy = Math.min(terrain.height - 1, Math.floor((disaster.y + disaster.radius) / cs));
      const rSq = disaster.radius * disaster.radius;

      // Mark scorched cells
      for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          const cell = terrain.cells[gy * terrain.width + gx];
          if (!cell || cell.isWater) continue;
          const cellX = (gx + 0.5) * cs;
          const cellY = (gy + 0.5) * cs;
          const distSq = (cellX - disaster.x) * (cellX - disaster.x) + (cellY - disaster.y) * (cellY - disaster.y);

          if (distSq <= rSq) {
            cell.deterioration = Math.min(1.0, (cell.deterioration || 0) + 0.08 * disaster.severity);
            cell.burnedCooldown = 280;
            cell.ashFertilityBoost = 0.45;
          }
        }
      }

      // Incinerate living plant patches in fire radius
      for (let r = 0; r < resources.length; r++) {
        const res = resources[r];
        if (res.type === 'plant' && res.amount > 0) {
          const dx = res.x - disaster.x;
          const dy = res.y - disaster.y;
          if (dx * dx + dy * dy <= rSq) {
            const burned = res.amount;
            res.amount = Math.max(0, res.amount - 2.8 * disaster.severity);
            if (burned > 0.5 && res.amount <= 0.5) {
              destroyedPlantsCount += 1;
              disaster.plantsDestroyed += 1;
            }
          }
        }
      }

      // Inflict burn damage on organisms caught in fire zone
      for (let o = 0; o < organisms.length; o++) {
        const org = organisms[o];
        if (org.state === 'dead') continue;
        const dx = org.x - disaster.x;
        const dy = org.y - disaster.y;
        const distSq = dx * dx + dy * dy;

        if (distSq <= rSq) {
          const dist = Math.sqrt(distSq);
          const falloff = 1.0 - dist / disaster.radius;
          // Thermal burn damage
          const burnDamage = falloff * 0.95 * disaster.severity;
          org.health = Math.max(0, org.health - burnDamage);
          org.energy = Math.max(0, org.energy - burnDamage * 0.6);
          disaster.affectedCount += 1;

          if (org.health <= 0) {
            org.state = 'dead';
            org.deathCause = 'starvation'; // Or severe environmental hazard
          }
        }
      }
    }

    // B. Apply FLOOD physical effects
    else if (disaster.type === 'flood') {
      const minGx = Math.max(0, Math.floor((disaster.x - disaster.radius) / cs));
      const maxGx = Math.min(terrain.width - 1, Math.floor((disaster.x + disaster.radius) / cs));
      const minGy = Math.max(0, Math.floor((disaster.y - disaster.radius) / cs));
      const maxGy = Math.min(terrain.height - 1, Math.floor((disaster.y + disaster.radius) / cs));
      const rSq = disaster.radius * disaster.radius;

      // Inundate lowlands and riverbeds
      for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          const cell = terrain.cells[gy * terrain.width + gx];
          if (!cell || cell.isWater) continue;
          const cellX = (gx + 0.5) * cs;
          const cellY = (gy + 0.5) * cs;
          const distSq = (cellX - disaster.x) * (cellX - disaster.x) + (cellY - disaster.y) * (cellY - disaster.y);

          if (distSq <= rSq) {
            // Lowland cells and river banks are submerged
            if (cell.height <= SEA_LEVEL + 0.08 || cell.isRiver) {
              cell.isFlooded = true;
            }
          }
        }
      }

      // Impede movement and stamina of land creatures caught in flooded cells
      for (let o = 0; o < organisms.length; o++) {
        const org = organisms[o];
        if (org.state === 'dead') continue;
        const cell = getCellAt(terrain, org.x, org.y);
        if (cell && cell.isFlooded) {
          // Strong movement drag and stamina drain
          org.vx *= 0.65;
          org.vy *= 0.65;
          org.energy = Math.max(0, org.energy - 0.08 * disaster.severity);
          disaster.affectedCount += 1;
        }
      }
    }

    // C. Apply VOLCANIC ERUPTION physical effects
    else if (disaster.type === 'volcanic_eruption') {
      const calderaRadius = disaster.radius * 0.28;
      const calderaRSq = calderaRadius * calderaRadius;
      const rSq = disaster.radius * disaster.radius;

      const minGx = Math.max(0, Math.floor((disaster.x - disaster.radius) / cs));
      const maxGx = Math.min(terrain.width - 1, Math.floor((disaster.x + disaster.radius) / cs));
      const minGy = Math.max(0, Math.floor((disaster.y - disaster.radius) / cs));
      const maxGy = Math.min(terrain.height - 1, Math.floor((disaster.y + disaster.radius) / cs));

      for (let gy = minGy; gy <= maxGy; gy++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          const cell = terrain.cells[gy * terrain.width + gx];
          if (!cell) continue;
          const cellX = (gx + 0.5) * cs;
          const cellY = (gy + 0.5) * cs;
          const distSq = (cellX - disaster.x) * (cellX - disaster.x) + (cellY - disaster.y) * (cellY - disaster.y);

          if (distSq <= calderaRSq) {
            // Lava/caldera zone: lethal scorched rock
            cell.deterioration = 1.0;
            cell.burnedCooldown = 400;
            cell.ashFertilityBoost = 0.70;
          } else if (distSq <= rSq) {
            // Volcanic ash deposit
            cell.deterioration = Math.min(0.65, (cell.deterioration || 0) + 0.03 * disaster.severity);
            cell.burnedCooldown = 220;
            cell.ashFertilityBoost = 0.55;
          }
        }
      }

      // Incinerate plants in caldera
      for (let r = 0; r < resources.length; r++) {
        const res = resources[r];
        if (res.type === 'plant' && res.amount > 0) {
          const dx = res.x - disaster.x;
          const dy = res.y - disaster.y;
          if (dx * dx + dy * dy <= calderaRSq) {
            res.amount = 0;
            destroyedPlantsCount += 1;
            disaster.plantsDestroyed += 1;
          }
        }
      }

      // Harm organisms caught in immediate caldera
      for (let o = 0; o < organisms.length; o++) {
        const org = organisms[o];
        if (org.state === 'dead') continue;
        const dx = org.x - disaster.x;
        const dy = org.y - disaster.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= calderaRSq) {
          org.health = Math.max(0, org.health - 2.5 * disaster.severity);
          disaster.affectedCount += 1;
          if (org.health <= 0) org.state = 'dead';
        }
      }
    }

    // Check disaster expiration
    if (disaster.remainingTicks <= 0) {
      disaster.active = false;

      // Clean up flood waters
      if (disaster.type === 'flood') {
        for (let i = 0; i < terrain.cells.length; i++) {
          const cell = terrain.cells[i];
          if (cell.isFlooded) {
            cell.isFlooded = false;
            // Alluvial silt enriches soil fertility
            cell.fertility = Math.min(1.0, cell.fertility + 0.08);
            cell.plantSuitability = Math.min(1.0, cell.plantSuitability + 0.06);
          }
        }
      }

      if (disaster.type === 'drought') {
        climate.isDrought = false;
        climate.droughtSeverity = 0;
      }

      climate.activeDisasters.splice(dIdx, 1);
    }
  }

  // 2. Local Habitat Deterioration Decay & Ecological Recolonization
  for (let idx = 0; idx < terrain.cells.length; idx++) {
    const cell = terrain.cells[idx];
    if (!cell || !cell.deterioration || cell.deterioration <= 0) continue;

    totalHabitatDeterioration += cell.deterioration;

    if (cell.burnedCooldown && cell.burnedCooldown > 0) {
      cell.burnedCooldown -= 1;
    } else {
      // Natural recovery: soil microbes, lichens, and weeds heal scarred earth
      cell.deterioration = Math.max(0, cell.deterioration - 0.006);

      // When cell reaches full recovery, ash fertility boost promotes plant recolonization!
      if (cell.deterioration === 0 && cell.ashFertilityBoost && cell.ashFertilityBoost > 0) {
        const boost = cell.ashFertilityBoost;
        cell.ashFertilityBoost = 0;
        cell.fertility = Math.min(1.0, cell.fertility + boost * 0.25);
        cell.plantSuitability = Math.min(1.0, cell.plantSuitability + boost * 0.2);

        // Pioneer flora recolonizes recovered habitat!
        if (resources.length < 210 && prng.chance(0.65)) {
          const worldX = (cell.x + 0.5) * cs;
          const worldY = (cell.y + 0.5) * cs;
          const maxAmount = prng.range(45, 95);
          const initialAmount = prng.range(20, 40);

          const pioneerPatch: ResourcePatch = {
            id: `pioneer_${tick}_${prng.rangeInt(100, 999)}`,
            x: worldX,
            y: worldY,
            type: 'plant',
            amount: initialAmount,
            maxAmount,
            radius: prng.range(16, 28),
            growthRate: prng.range(0.22, 0.42) * cell.plantSuitability,
          };

          resources.push(pioneerPatch);
          recoveredPatches.push(pioneerPatch);

          if (recoveredPatches.length === 1 && prng.chance(0.25)) {
            newEvents.push({
              type: 'ecosystem_recovery',
              title: 'Ecosystem Habitat Recovery',
              description: `Pioneer flora has begun recolonizing ash-enriched recovered soils at sector (${cell.x}, ${cell.y}).`,
              x: worldX,
              y: worldY,
              isMilestone: true,
            });
          }
        }
      }
    }
  }

  return {
    newEvents,
    recoveredPatches,
    destroyedPlantsCount,
    totalHabitatDeterioration,
  };
}
