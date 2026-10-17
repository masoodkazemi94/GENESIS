import type { OrganismState, ResourcePatch, TerrainMap } from '../../types/simulation.js';
import type { EcologyConfig } from '../ecology/config.js';
import { SpatialHashGrid } from '../physics/physics.js';
import { getCellAt } from '../terrain/terrain.js';
import type { SimulationProbe } from '../performance/probe.js';

export type FoodCandidate = {
  x: number; y: number; id: string; type: 'plant' | 'carrion' | 'prey';
  entity: ResourcePatch | OrganismState;
  score: number; distance: number;
};

const walkable = (terrain: TerrainMap, x: number, y: number) => {
  const cell = getCellAt(terrain, x, y);
  return !!cell && cell.isWalkable && !cell.isLake && !cell.isFlooded;
};

/** Reject a direct route blocked by water or flood. Wandering may reveal another approach. */
export function directRouteOpen(terrain: TerrainMap, x: number, y: number, tx: number, ty: number,
  probe?: SimulationProbe): boolean {
  const started = probe?.start();
  try {
  const distance = Math.hypot(tx - x, ty - y);
  const steps = Math.ceil(distance / (terrain.cellSize * .5));
  for (let step = 1; step <= steps; step++) {
    const fraction = step / steps;
    if (!walkable(terrain, x + (tx - x) * fraction, y + (ty - y) * fraction)) return false;
  }
  return true;
  } finally {
    if (started !== undefined) probe?.end('terrain.routeCheck', started);
  }
}

/** Expected short-horizon net energy. This is a choice model, not guaranteed prey capture. */
export function chooseFoodTarget(org: OrganismState, terrain: TerrainMap, grid: SpatialHashGrid,
  config: EcologyConfig, pressureCache: Map<ResourcePatch, { consumers: number; predators: number }>,
  probe?: SimulationProbe, nearbyOrganisms?: OrganismState[], woundedPreyFollowThrough = false): FoodCandidate | null {
  const started = probe?.start();
  try {
  const sensor = org.genome.sensoryRadius;
  const hunger = Math.max(0, (100 - org.energy) / 100);
  const competitors = nearbyOrganisms ?? grid.queryRadius(org.x, org.y, sensor);
  let best: FoodCandidate | null = null;
  const consider = (entity: ResourcePatch | OrganismState, type: FoodCandidate['type'], radius: number) => {
    const candidateStarted = probe?.start();
    try {
    const distance = Math.hypot(entity.x - org.x, entity.y - org.y);
    if (distance > radius) {
      if (type === 'prey') probe?.count('predator.rejectOutOfRange');
      return;
    }
    const contact = type === 'prey'
      ? org.collisionRadius + (entity as OrganismState).collisionRadius + 3.5
      : org.collisionRadius + (entity as ResourcePatch).radius * 0.6 + 4;
    if (distance > contact && !directRouteOpen(terrain, org.x, org.y, entity.x, entity.y, probe)) {
      if (type === 'prey') probe?.count('predator.rejectBlockedRoute');
      return;
    }
    let gain = 0;
    if (type === 'prey') {
      probe?.count('predator.preyEvaluations');
      const prey = entity as OrganismState;
      if (prey.state === 'dead' || prey.id === org.id) return;
      const speedRatio = org.genome.maxSpeed / Math.max(.1, prey.genome.maxSpeed);
      if (distance > contact * 2 && speedRatio < .95) {
        probe?.count('predator.rejectTooFast');
        return;
      }
      const captureChance = Math.min(.85, Math.max(.12,
        .45 + (speedRatio - 1) * .55 - Math.max(0, distance - contact) / (sensor * 2)));
      const strikeDamage = 36 * config.predatorDamage * org.genome.bodySize /
        Math.max(.1, prey.genome.bodySize) * (1 + org.genome.aggression * .35);
      const strikesNeeded = Math.ceil(Math.max(1, prey.health) / Math.max(1, strikeDamage));
      gain = Math.min(100 - org.energy, Math.min(prey.energy * .75 + prey.genome.bodySize * 20,
        55 * prey.genome.bodySize) * org.genome.foodProcessingEfficiency * config.feedingEfficiency) *
        captureChance / Math.sqrt(strikesNeeded);
    } else {
      const patch = entity as ResourcePatch;
      if (patch.amount <= (type === 'plant' ? 1.5 : .5)) return;
      const bite = type === 'plant' ? 8.5 : 7.5;
      const efficiency = type === 'plant' ? 1.85 : 1.95;
      gain = Math.min(100 - org.energy, Math.min(patch.amount, bite * 3) * efficiency *
        org.genome.foodProcessingEfficiency * config.feedingEfficiency);
      // Several consumers can empty a small patch before this animal arrives.
      let pressure = pressureCache.get(patch);
      if (!pressure) {
        pressure = { consumers: 0, predators: 0 };
        for (const nearby of grid.queryRadius(patch.x, patch.y, 55)) {
          if (nearby.state === 'dead') continue;
          const range = Math.hypot(nearby.x - patch.x, nearby.y - patch.y);
          if (nearby.genome.diet === 'carnivore') pressure.predators++;
          else if (range < 35) pressure.consumers++;
        }
        pressureCache.set(patch, pressure);
      }
      const competition = pressure.consumers - (org.genome.diet !== 'carnivore' && distance < 35 ? 1 : 0);
      gain /= 1 + competition * .35;
      if (type === 'carrion') gain *= 1.08; // Dietary preference, below travel cost.
    }
    const travelTicks = Math.max(0, distance - contact) / Math.max(.3, org.genome.maxSpeed * .65);
    const travelCost = travelTicks * (.022 * Math.pow(org.genome.bodySize, 1.25) +
      .042 * org.genome.speed * org.genome.bodySize) / Math.max(.3, org.genome.metabolicEfficiency);
    const predatorRisk = type === 'prey' ? 0 : pressureCache.get(entity as ResourcePatch)!.predators * 8;
    // Distance also represents the opportunity cost of passing closer food.
    const score = gain * (.35 + .65 * hunger) - travelCost - predatorRisk - travelTicks * .12;
    if (score <= 0) {
      if (type === 'prey') probe?.count('predator.rejectNegativeValue');
      return;
    }
    if (type === 'prey') probe?.count('predator.positiveValueCandidates');
    const sameTarget = org.targetId === entity.id &&
      (org.targetType === 'food' || org.targetType === 'carrion');
    // Development probe: finish a close, already accepted hunt after a nonlethal strike.
    // The normal route, speed, and positive-return gates above still apply.
    const woundedClosePrey = woundedPreyFollowThrough && type === 'prey' && sameTarget &&
      (entity as OrganismState).health < 100 && distance <= contact * 2;
    const retained = sameTarget ? score * (woundedClosePrey ? 1.5 : 1.15) : score;
    if (!best || retained > best.score) best = { x: entity.x, y: entity.y, id: entity.id,
      type, entity, score: retained, distance };
    } finally {
      if (candidateStarted !== undefined) probe?.end('foraging.candidateScore', candidateStarted);
    }
  };
  if (org.genome.diet === 'herbivore' || org.genome.diet === 'scavenger' || org.genome.diet === 'omnivore') {
    for (const patch of grid.queryFoodRadius(org.x, org.y, sensor)) consider(patch, 'plant', sensor);
  }
  if (org.genome.diet === 'scavenger') {
    const range = sensor * 1.8 * config.scavengerCarrionRange;
    for (const patch of grid.queryCarrionRadius(org.x, org.y, range)) consider(patch, 'carrion', range);
  }
  if (org.genome.diet === 'carnivore' || (org.genome.diet === 'omnivore' && org.energy < 50)) {
    for (const prey of competitors) {
      if (prey.genome.diet === 'carnivore' && prey.genome.bodySize >= org.genome.bodySize * .72) continue;
      if (org.genome.diet === 'omnivore' && prey.genome.size >= org.genome.size * .65) continue;
      consider(prey, 'prey', sensor * Math.max(.25, 1 - prey.genome.camouflage * .65));
    }
  }
  return best;
  } finally {
    if (started !== undefined) probe?.end('foraging.chooseTarget', started);
  }
}
