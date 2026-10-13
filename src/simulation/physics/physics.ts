/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { OrganismState, ResourcePatch, TerrainMap } from '../../types/simulation.js';
import { getCellAt } from '../terrain/terrain.js';

/**
 * High-performance 2D Spatial Hash Grid for entity lookups in O(1) time
 */
export class SpatialHashGrid {
  public cellSize: number;
  public cols: number;
  public rows: number;
  public buckets: Map<number, OrganismState[]> = new Map();
  public foodBuckets: Map<number, ResourcePatch[]> = new Map();
  public carrionBuckets: Map<number, ResourcePatch[]> = new Map();

  constructor(worldWidth: number, worldHeight: number, cellSize = 80) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldWidth / cellSize);
    this.rows = Math.ceil(worldHeight / cellSize);
  }

  public clear(): void {
    this.buckets.clear();
    this.foodBuckets.clear();
    this.carrionBuckets.clear();
  }

  public populateOrganisms(organisms: OrganismState[]): void {
    this.buckets.clear();
    for (let i = 0; i < organisms.length; i++) {
      const org = organisms[i];
      if (org.state === 'dead') continue;
      const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(org.x / this.cellSize)));
      const cy = Math.max(0, Math.min(this.rows - 1, Math.floor(org.y / this.cellSize)));
      const key = cy * this.cols + cx;
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = [];
        this.buckets.set(key, bucket);
      }
      bucket.push(org);
    }
  }

  public populateFood(resources: ResourcePatch[]): void {
    this.foodBuckets.clear();
    this.carrionBuckets.clear();
    for (let i = 0; i < resources.length; i++) {
      const res = resources[i];
      if (res.amount <= 1.0) continue;
      const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(res.x / this.cellSize)));
      const cy = Math.max(0, Math.min(this.rows - 1, Math.floor(res.y / this.cellSize)));
      const key = cy * this.cols + cx;

      if (res.type === 'plant') {
        let bucket = this.foodBuckets.get(key);
        if (!bucket) {
          bucket = [];
          this.foodBuckets.set(key, bucket);
        }
        bucket.push(res);
      } else if (res.type === 'carrion') {
        let bucket = this.carrionBuckets.get(key);
        if (!bucket) {
          bucket = [];
          this.carrionBuckets.set(key, bucket);
        }
        bucket.push(res);
      }
    }
  }

  public queryRadius(x: number, y: number, radius: number): OrganismState[] {
    const minCx = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));

    const results: OrganismState[] = [];
    const rSq = radius * radius;

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets.get(cy * this.cols + cx);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const neighbor = bucket[i];
          const dx = neighbor.x - x;
          const dy = neighbor.y - y;
          if (dx * dx + dy * dy <= rSq) {
            results.push(neighbor);
          }
        }
      }
    }

    return results;
  }

  public queryFoodRadius(x: number, y: number, radius: number): ResourcePatch[] {
    const minCx = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));

    const results: ResourcePatch[] = [];
    const rSq = radius * radius;

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.foodBuckets.get(cy * this.cols + cx);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const food = bucket[i];
          const dx = food.x - x;
          const dy = food.y - y;
          if (dx * dx + dy * dy <= rSq) {
            results.push(food);
          }
        }
      }
    }

    return results;
  }

  public queryCarrionRadius(x: number, y: number, radius: number): ResourcePatch[] {
    const minCx = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));

    const results: ResourcePatch[] = [];
    const rSq = radius * radius;

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.carrionBuckets.get(cy * this.cols + cx);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const carrion = bucket[i];
          const dx = carrion.x - x;
          const dy = carrion.y - y;
          if (dx * dx + dy * dy <= rSq) {
            results.push(carrion);
          }
        }
      }
    }

    return results;
  }
}

// Backwards compatibility helpers
export type SpatialGrid = SpatialHashGrid;

export function createSpatialGrid(worldWidth: number, worldHeight: number, cellSize = 80): SpatialHashGrid {
  return new SpatialHashGrid(worldWidth, worldHeight, cellSize);
}

export function populateSpatialGrid(
  grid: SpatialHashGrid,
  organisms: OrganismState[],
  resources?: ResourcePatch[]
): void {
  grid.populateOrganisms(organisms);
  if (resources) {
    grid.populateFood(resources);
  }
}

export function queryNeighbors(grid: SpatialHashGrid, x: number, y: number, radius: number): OrganismState[] {
  return grid.queryRadius(x, y, radius);
}

/**
 * Updates physical kinematics with true acceleration, velocity, organism collisions,
 * and sliding terrain collision resolution.
 */
export function updatePhysics(
  organisms: OrganismState[],
  terrain: TerrainMap,
  grid: SpatialHashGrid,
  dt = 1.0
): void {
  const worldWidth = terrain.worldWidth;
  const worldHeight = terrain.worldHeight;
  const margin = 20;

  for (let i = 0; i < organisms.length; i++) {
    const org = organisms[i];
    if (org.state === 'dead') continue;

    // 1. Numerical limit sanitization (protect against NaN/Infinity)
    if (!Number.isFinite(org.ax)) org.ax = 0;
    if (!Number.isFinite(org.ay)) org.ay = 0;
    if (!Number.isFinite(org.vx)) org.vx = 0;
    if (!Number.isFinite(org.vy)) org.vy = 0;

    // 2. Terrain drag & medium resistance
    const curCell = getCellAt(terrain, org.x, org.y);
    const inWater = curCell ? (curCell.isWater || !!curCell.isFlooded) : true;
    const isUnwalkable = curCell ? !curCell.isWalkable : false;

    let terrainFriction = 0.90;
    if (inWater) terrainFriction = 0.65;
    if (curCell?.isFlooded) terrainFriction = 0.58; // Extra turbulent drag in active flood waters
    if (org.state === 'resting') terrainFriction = 0.72; // strong dampening when resting

    // 3. Integrate acceleration into velocity (no teleportation)
    org.vx = (org.vx + org.ax * dt) * terrainFriction;
    org.vy = (org.vy + org.ay * dt) * terrainFriction;

    // Reset frame acceleration accumulator
    org.ax = 0;
    org.ay = 0;

    // 4. Enforce maximum speed limits
    const maxAllowedSpeed = inWater ? org.genome.maxSpeed * 0.55 : org.genome.maxSpeed;
    const currentSpeed = Math.hypot(org.vx, org.vy);
    if (currentSpeed > maxAllowedSpeed && currentSpeed > 0.001) {
      org.vx = (org.vx / currentSpeed) * maxAllowedSpeed;
      org.vy = (org.vy / currentSpeed) * maxAllowedSpeed;
    }

    // 5. Integrate velocity into position
    org.x += org.vx * dt;
    org.y += org.vy * dt;

    // 6. Smooth angular orientation toward velocity heading
    if (currentSpeed > 0.04) {
      const targetAngle = Math.atan2(org.vy, org.vx);
      let angleDiff = targetAngle - org.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      org.angle += angleDiff * 0.22;
    }

    // 7. Organism-to-Organism Collision Resolution (rigid separation)
    const neighbors = grid.queryRadius(org.x, org.y, org.collisionRadius * 2.5);
    for (let j = 0; j < neighbors.length; j++) {
      const other = neighbors[j];
      if (other.id === org.id || other.state === 'dead') continue;

      const dx = org.x - other.x;
      const dy = org.y - other.y;
      const distSq = dx * dx + dy * dy;
      const minDist = org.collisionRadius + other.collisionRadius;

      if (distSq < minDist * minDist && distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;

        // Separate organisms along contact normal
        org.x += nx * overlap * 0.5;
        org.y += ny * overlap * 0.5;
        other.x -= nx * overlap * 0.5;
        other.y -= ny * overlap * 0.5;

        // Relative velocity dampening
        const relVx = org.vx - other.vx;
        const relVy = org.vy - other.vy;
        const dot = relVx * nx + relVy * ny;
        if (dot < 0) {
          org.vx -= nx * dot * 0.35;
          org.vy -= ny * dot * 0.35;
          other.vx += nx * dot * 0.35;
          other.vy += ny * dot * 0.35;
        }
      }
    }

    // 8. Blocking Terrain Collision Resolution
    // Check neighbor terrain grid cells around organism's radius
    const cs = terrain.cellSize;
    const minGx = Math.max(0, Math.floor((org.x - org.collisionRadius) / cs));
    const maxGx = Math.min(terrain.width - 1, Math.floor((org.x + org.collisionRadius) / cs));
    const minGy = Math.max(0, Math.floor((org.y - org.collisionRadius) / cs));
    const maxGy = Math.min(terrain.height - 1, Math.floor((org.y + org.collisionRadius) / cs));

    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const cell = terrain.cells[gy * terrain.width + gx];
        // If cell is impassable (cliffs, deep water, or lakes)
        if (cell && (!cell.isWalkable || cell.biome === 'deep_ocean' || cell.isLake)) {
          // Bounding box of blocking cell
          const cellLeft = gx * cs;
          const cellRight = (gx + 1) * cs;
          const cellTop = gy * cs;
          const cellBottom = (gy + 1) * cs;

          // Closest point on blocking square to organism center
          const closestX = Math.max(cellLeft, Math.min(cellRight, org.x));
          const closestY = Math.max(cellTop, Math.min(cellBottom, org.y));

          const diffX = org.x - closestX;
          const diffY = org.y - closestY;
          const cDistSq = diffX * diffX + diffY * diffY;

          if (cDistSq < org.collisionRadius * org.collisionRadius && cDistSq > 0.0001) {
            const cDist = Math.sqrt(cDistSq);
            const penetration = org.collisionRadius - cDist;
            const normX = diffX / cDist;
            const normY = diffY / cDist;

            // Push organism out of the obstacle
            org.x += normX * penetration;
            org.y += normY * penetration;

            // Slide along terrain obstacle (eliminate velocity along normal)
            const vDotN = org.vx * normX + org.vy * normY;
            if (vDotN < 0) {
              org.vx -= normX * vDotN * 1.2;
              org.vy -= normY * vDotN * 1.2;
            }
          }
        }
      }
    }

    // 9. World Boundary Containment
    if (org.x < margin + org.collisionRadius) {
      org.x = margin + org.collisionRadius;
      org.vx = Math.abs(org.vx) * 0.7;
    } else if (org.x > worldWidth - margin - org.collisionRadius) {
      org.x = worldWidth - margin - org.collisionRadius;
      org.vx = -Math.abs(org.vx) * 0.7;
    }

    if (org.y < margin + org.collisionRadius) {
      org.y = margin + org.collisionRadius;
      org.vy = Math.abs(org.vy) * 0.7;
    } else if (org.y > worldHeight - margin - org.collisionRadius) {
      org.y = worldHeight - margin - org.collisionRadius;
      org.vy = -Math.abs(org.vy) * 0.7;
    }
  }
}
