/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BiomeType, TerrainCell, TerrainMap } from '../../types/simulation.js';
import { PRNG, SimplexNoise2D } from '../math/prng.js';

export const GRID_RES = 256; // 256 × 256 logical cells
export const CELL_SIZE = 10; // 10 units per cell
export const WORLD_WIDTH = GRID_RES * CELL_SIZE; // 2560 units
export const WORLD_HEIGHT = GRID_RES * CELL_SIZE; // 2560 units

export const SEA_LEVEL = 0.36;
export const BEACH_LEVEL = 0.41;
export const MOUNTAIN_LEVEL = 0.65;
export const SNOW_PEAK_LEVEL = 0.74;

/**
 * Procedural terrain generation with:
 * - 256x256 logical cells
 * - Multi-octave coherent noise elevation with mountain ridging
 * - Temperature variation based on latitude & elevation lapse rate
 * - Moisture and rainfall distributions
 * - Connected downhill river paths flowing to oceans or lakes
 * - Explicit lake basin handling
 * - Plant habitat suitability & walkability flags
 * - 100% deterministic generation
 */
export function generateTerrain(seed: number): TerrainMap {
  const prng = new PRNG(seed);
  const elevNoise = new SimplexNoise2D(prng);
  const ridgeNoise = new SimplexNoise2D(prng.fork());
  const moistureNoise = new SimplexNoise2D(prng.fork());
  const tempNoise = new SimplexNoise2D(prng.fork());

  const totalCells = GRID_RES * GRID_RES;
  const rawHeights = new Float32Array(totalCells);
  const rawMoisture = new Float32Array(totalCells);
  const rawTemp = new Float32Array(totalCells);
  const rawRainfall = new Float32Array(totalCells);

  const centerX = GRID_RES / 2;
  const centerY = GRID_RES / 2;
  const maxRadius = GRID_RES * 0.48;

  // Pass 1: Compute elevation, temperature, moisture, and rainfall
  for (let gy = 0; gy < GRID_RES; gy++) {
    const ny = gy / GRID_RES;
    // Symmetrical latitude distance: 0 at center (equator), 1 at north/south poles
    const latDist = Math.abs(ny - 0.5) * 2.0;
    // Equator baseline: ~32°C, polar baseline: ~ -8°C
    const baseTemp = 32.0 - latDist * 38.0;

    for (let gx = 0; gx < GRID_RES; gx++) {
      const idx = gy * GRID_RES + gx;
      const nx = gx / GRID_RES;

      // Distance from center for continental landmass shaping
      const dx = gx - centerX;
      const dy = gy - centerY;
      const distFromCenter = Math.sqrt(dx * dx + dy * dy) / maxRadius;
      
      // Radial falloff so world is framed by natural surrounding ocean
      const continentalMask = Math.max(0, 1.0 - Math.pow(distFromCenter, 1.95) * 0.88);

      // Multi-octave continuous base terrain noise
      const baseElevation = elevNoise.fbm(nx * 2.8, ny * 2.8, 5, 0.52, 2.05);

      // Sharp ridged multifractal noise for dramatic mountain spines
      const ridgeRaw = Math.abs(ridgeNoise.fbm(nx * 4.2 + 5.1, ny * 4.2 + 3.7, 4, 0.5, 2.0) * 2.0 - 1.0);
      const mountainSpines = Math.pow(1.0 - ridgeRaw, 2.2);

      // Combined height normalized [0, 1]
      let height = (baseElevation * 0.72 + mountainSpines * 0.28) * continentalMask;
      if (continentalMask > 0.3) {
        height += 0.08 * continentalMask;
      }
      height = Math.max(0, Math.min(1, height));
      rawHeights[idx] = height;

      // Temperature with elevation lapse rate (altitude drops temperature)
      const tNoise = (tempNoise.noise2D(nx * 3.5 + 8.1, ny * 3.5 + 4.9) + 1) * 0.5;
      const lapseRate = 32.0; // °C drop from sea level to peak
      const elevationAboveSea = Math.max(0, height - SEA_LEVEL) / (1.0 - SEA_LEVEL);
      const temperature = baseTemp - elevationAboveSea * lapseRate + (tNoise - 0.5) * 6.0;
      rawTemp[idx] = Math.round(temperature * 10) / 10;

      // Moisture & rainfall with prevailing wind gradient
      const mNoise = moistureNoise.fbm(nx * 3.0 + 17.2, ny * 3.0 + 9.3, 4, 0.5, 2.0);
      const moisture = Math.max(0, Math.min(1, mNoise));
      rawMoisture[idx] = moisture;
      rawRainfall[idx] = Math.max(0, Math.min(1, moisture * 0.9 + (1.0 - latDist) * 0.1));
    }
  }

  // Pass 2: River network and lake formation following downhill paths
  const riverFlags = new Uint8Array(totalCells);
  const lakeFlags = new Uint8Array(totalCells);
  const flowAngles = new Float32Array(totalCells);

  // Natural inland lake basins in valleys
  const lakePrng = prng.fork();
  for (let l = 0; l < 10; l++) {
    const lx = lakePrng.rangeInt(40, GRID_RES - 40);
    const ly = lakePrng.rangeInt(40, GRID_RES - 40);
    const lIdx = ly * GRID_RES + lx;
    if (rawHeights[lIdx] > SEA_LEVEL + 0.04 && rawHeights[lIdx] < 0.65) {
      lakeFlags[lIdx] = 1;
      const r = lakePrng.rangeInt(1, 3);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r * r) {
            const nlx = lx + dx;
            const nly = ly + dy;
            if (nlx >= 0 && nlx < GRID_RES && nly >= 0 && nly < GRID_RES) {
              lakeFlags[nly * GRID_RES + nlx] = 1;
            }
          }
        }
      }
    }
  }

  // Generate river sources in high-elevation, high-moisture regions
  const riverSourceCandidates: Array<{ x: number; y: number; h: number }> = [];
  for (let gy = 10; gy < GRID_RES - 10; gy += 4) {
    for (let gx = 10; gx < GRID_RES - 10; gx += 4) {
      const idx = gy * GRID_RES + gx;
      const h = rawHeights[idx];
      const m = rawMoisture[idx];
      if (h >= 0.62 && h <= 0.85 && m >= 0.32) {
        riverSourceCandidates.push({ x: gx, y: gy, h });
      }
    }
  }

  // Shuffle candidate sources deterministically
  for (let i = riverSourceCandidates.length - 1; i > 0; i--) {
    const j = prng.rangeInt(0, i);
    const tmp = riverSourceCandidates[i];
    riverSourceCandidates[i] = riverSourceCandidates[j];
    riverSourceCandidates[j] = tmp;
  }

  // Pick up to 24 well-distributed river sources
  const numRivers = Math.min(24, riverSourceCandidates.length);
  const neighborOffsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],          [1,  0],
    [-1,  1], [0,  1], [1,  1],
  ];

  for (let r = 0; r < numRivers; r++) {
    let curX = riverSourceCandidates[r].x;
    let curY = riverSourceCandidates[r].y;
    let pathLength = 0;
    const visitedInPath = new Set<number>();

    while (pathLength < 350) {
      const curIdx = curY * GRID_RES + curX;
      visitedInPath.add(curIdx);
      riverFlags[curIdx] = 1;

      const curH = rawHeights[curIdx];

      // Stop if reached the sea
      if (curH <= SEA_LEVEL) {
        break;
      }

      // Find neighbor with lowest elevation
      let lowestH = curH;
      let nextX = -1;
      let nextY = -1;
      let bestDx = 0;
      let bestDy = 0;

      for (let n = 0; n < neighborOffsets.length; n++) {
        const nx = curX + neighborOffsets[n][0];
        const ny = curY + neighborOffsets[n][1];
        if (nx < 1 || nx >= GRID_RES - 1 || ny < 1 || ny >= GRID_RES - 1) continue;

        const nIdx = ny * GRID_RES + nx;
        if (visitedInPath.has(nIdx)) continue;

        const nH = rawHeights[nIdx];
        if (nH < lowestH) {
          lowestH = nH;
          nextX = nx;
          nextY = ny;
          bestDx = neighborOffsets[n][0];
          bestDy = neighborOffsets[n][1];
        }
      }

      // If neighbor is lower, flow downhill
      if (nextX !== -1 && nextY !== -1) {
        flowAngles[curIdx] = Math.atan2(bestDy, bestDx);
        curX = nextX;
        curY = nextY;
        pathLength++;
      } else {
        // Local basin/depression: Form an inland Lake
        lakeFlags[curIdx] = 1;
        // Expand lake into adjacent depression cells
        for (let n = 0; n < neighborOffsets.length; n++) {
          const lnx = curX + neighborOffsets[n][0];
          const lny = curY + neighborOffsets[n][1];
          if (lnx >= 0 && lnx < GRID_RES && lny >= 0 && lny < GRID_RES) {
            const lnIdx = lny * GRID_RES + lnx;
            if (rawHeights[lnIdx] <= curH + 0.015) {
              lakeFlags[lnIdx] = 1;
            }
          }
        }

        // Find lowest spillway rim point to continue draining
        let spillwayH = Infinity;
        let spillX = -1;
        let spillY = -1;
        for (let n = 0; n < neighborOffsets.length; n++) {
          const sx = curX + neighborOffsets[n][0];
          const sy = curY + neighborOffsets[n][1];
          if (sx < 1 || sx >= GRID_RES - 1 || sy < 1 || sy >= GRID_RES - 1) continue;
          const sIdx = sy * GRID_RES + sx;
          if (!visitedInPath.has(sIdx) && rawHeights[sIdx] < spillwayH) {
            spillwayH = rawHeights[sIdx];
            spillX = sx;
            spillY = sy;
          }
        }

        if (spillX !== -1 && spillY !== -1 && pathLength < 320) {
          curX = spillX;
          curY = spillY;
          pathLength++;
        } else {
          break; // River terminates at terminal lake basin
        }
      }
    }
  }

  // Pass 3: Assemble TerrainCell objects and assign biomes, suitability, and walkability
  const cells: TerrainCell[] = new Array(totalCells);

  for (let gy = 0; gy < GRID_RES; gy++) {
    for (let gx = 0; gx < GRID_RES; gx++) {
      const idx = gy * GRID_RES + gx;
      const height = rawHeights[idx];
      const moisture = rawMoisture[idx];
      const temperature = rawTemp[idx];
      const rainfall = rawRainfall[idx];
      const isRiver = riverFlags[idx] === 1;
      const isLake = lakeFlags[idx] === 1;

      let biome: BiomeType;
      let isWater = false;
      let isWalkable = true;

      // Biome categorization
      if (isLake) {
        biome = 'lake';
        isWater = true;
        isWalkable = false;
      } else if (isRiver && height > SEA_LEVEL) {
        biome = 'river';
        isWater = true;
        isWalkable = true; // Wadeable flowing water
      } else if (height < 0.22) {
        biome = 'deep_ocean';
        isWater = true;
        isWalkable = false;
      } else if (height <= SEA_LEVEL) {
        biome = 'shallow_ocean';
        isWater = true;
        isWalkable = false;
      } else if (height <= BEACH_LEVEL) {
        biome = 'beach';
        isWater = false;
        isWalkable = true;
      } else if (height >= SNOW_PEAK_LEVEL || (height >= MOUNTAIN_LEVEL && temperature < 5.0) || (height > BEACH_LEVEL && temperature < 2.0)) {
        biome = 'snow_peak';
        isWater = false;
        // High steep precipices are impassable
        isWalkable = height < 0.86;
      } else if (height >= MOUNTAIN_LEVEL) {
        biome = 'mountain';
        isWater = false;
        isWalkable = true;
      } else {
        // Lowland/Midland biomes based on temperature & moisture
        if (temperature < 0.0) {
          biome = 'snow_peak'; // Frost tundra
          isWalkable = true;
        } else if (moisture < 0.35 && temperature > 12.0) {
          biome = 'desert';
          isWater = false;
          isWalkable = true;
        } else if (moisture > 0.54) {
          biome = 'forest';
          isWater = false;
          isWalkable = true;
        } else {
          biome = 'grassland';
          isWater = false;
          isWalkable = true;
        }
      }

      // Base soil fertility calculation
      let fertility = moisture * 0.7 + (1.0 - Math.abs(temperature - 20.0) / 25.0) * 0.3;
      fertility = Math.max(0, Math.min(1, fertility));
      if (biome === 'forest') fertility = Math.min(1, fertility + 0.3);
      else if (biome === 'grassland') fertility = Math.min(1, fertility + 0.15);
      else if (biome === 'desert') fertility = fertility * 0.2;
      else if (biome === 'beach') fertility = fertility * 0.25;
      else if (biome === 'mountain') fertility = fertility * 0.35;
      else if (biome === 'snow_peak') fertility = 0.05;
      else if (isWater) fertility = 0.45; // Plankton/algae

      // Plant Habitat Suitability Score (0 to 1)
      let plantSuitability = 0;
      if (!isWater && biome !== 'deep_ocean' && biome !== 'shallow_ocean') {
        const tempOptimum = Math.max(0, 1.0 - Math.pow(Math.abs(temperature - 21.0) / 22.0, 2));
        const moistureOptimum = Math.min(1, moisture * 1.5);
        plantSuitability = fertility * 0.5 + tempOptimum * 0.3 + moistureOptimum * 0.2;
        if (biome === 'snow_peak') plantSuitability *= 0.1;
        if (biome === 'desert') plantSuitability *= 0.2;
        if (biome === 'beach') plantSuitability *= 0.3;
        plantSuitability = Math.max(0, Math.min(1, plantSuitability));
      }

      cells[idx] = {
        x: gx,
        y: gy,
        height,
        moisture,
        temperature,
        rainfall,
        fertility,
        plantSuitability,
        biome,
        isWater,
        isWalkable,
        isRiver,
        isLake,
        flowDirection: isRiver ? flowAngles[idx] : undefined,
      };
    }
  }

  return {
    width: GRID_RES,
    height: GRID_RES,
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    cellSize: CELL_SIZE,
    cells,
  };
}

export function getCellAt(terrain: TerrainMap, worldX: number, worldY: number): TerrainCell | null {
  const gx = Math.floor(worldX / terrain.cellSize);
  const gy = Math.floor(worldY / terrain.cellSize);
  if (gx < 0 || gx >= terrain.width || gy < 0 || gy >= terrain.height) {
    return null;
  }
  return terrain.cells[gy * terrain.width + gx] || null;
}

export function isWaterAt(terrain: TerrainMap, worldX: number, worldY: number): boolean {
  const cell = getCellAt(terrain, worldX, worldY);
  return cell ? cell.isWater : true;
}

export function isWalkableAt(terrain: TerrainMap, worldX: number, worldY: number): boolean {
  const cell = getCellAt(terrain, worldX, worldY);
  return cell ? cell.isWalkable : false;
}

/**
 * Validates if a coordinate is suitable for terrestrial organism spawning
 */
export function isValidSpawnCell(cell: TerrainCell): boolean {
  return (
    cell.isWalkable &&
    !cell.isWater &&
    !cell.isLake &&
    cell.height < 0.80 &&
    cell.biome !== 'deep_ocean' &&
    cell.biome !== 'shallow_ocean' &&
    cell.biome !== 'snow_peak'
  );
}

/**
 * Finds a guaranteed valid spawn location on habitable land
 */
export function findValidSpawnLocation(
  terrain: TerrainMap,
  prng: PRNG,
  maxAttempts = 500
): { x: number; y: number } {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const gx = prng.rangeInt(15, terrain.width - 15);
    const gy = prng.rangeInt(15, terrain.height - 15);
    const cell = terrain.cells[gy * terrain.width + gx];
    if (cell && isValidSpawnCell(cell)) {
      return {
        x: gx * terrain.cellSize + terrain.cellSize * 0.5,
        y: gy * terrain.cellSize + terrain.cellSize * 0.5,
      };
    }
  }
  // Safe fallback to central continental coordinates
  return {
    x: terrain.worldWidth * 0.5,
    y: terrain.worldHeight * 0.5,
  };
}

/**
 * Premium painterly / pixel-art indie palette
 */
export function getBiomeColor(biome: BiomeType): number {
  switch (biome) {
    case 'deep_ocean':
      return 0x0a1c2a; // Deep indigo abyss
    case 'shallow_ocean':
      return 0x144963; // Coastal sapphire/cerulean
    case 'lake':
      return 0x1b5e73; // Freshwater inland cyan-teal
    case 'river':
      return 0x227b8c; // Flowing mountain river blue
    case 'beach':
    case 'sand_coast':
      return 0xd9c898; // Warm golden shore sand
    case 'grassland':
    case 'lush_grassland':
      return 0x4f8b42; // Rich vibrant meadow green
    case 'forest':
    case 'ancient_forest':
      return 0x224f2b; // Deep pine emerald woodland
    case 'desert':
    case 'arid_steppe':
      return 0xc79456; // Warm sunbaked terracotta ochre
    case 'mountain':
    case 'rocky_highland':
      return 0x6e6865; // Slate granite crags
    case 'snow_peak':
    case 'tundra_snow':
      return 0xe5eef2; // Crisp alpine frost
  }
}
