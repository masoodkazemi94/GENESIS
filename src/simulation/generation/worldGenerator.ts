/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OrganismState,
  ResourcePatch,
  SpeciesTaxon,
  TerrainMap,
} from '../../types/simulation.js';
import { PRNG } from '../math/prng.js';
import { createBaseGenome } from '../genetics/genetics.js';
import { generateSpeciesTaxon } from '../species/species.js';
import { createOrganism } from '../organism/organism.js';
import { generateTerrain, findValidSpawnLocation, getCellAt, isValidSpawnCell } from '../terrain/terrain.js';
import { createInitialResources } from '../ecosystem/ecosystem.js';
import type { EcologyConfig } from '../ecology/config.js';
import { directRouteOpen } from '../behavior/foraging.js';
import { checkMatingCompatibility } from '../genetics/genetics.js';

const PLANET_PREFIXES = [
  'Aethel', 'Sylva', 'Oasis', 'Vesper', 'Borea', 'Nyx', 'Kael', 'Thala',
  'Solaria', 'Elysia', 'Verdia', 'Aura', 'Zephyr', 'Orion', 'Gaia'
];

const PLANET_SUFFIXES = [
  'gard', 'terra', 'prime', 'novum', 'major', 'thalassa', 'realm', 'delta',
  'genesis', 'arcadia', 'solis', 'mundus', 'nimbus'
];

export function generatePlanetName(prng: PRNG): string {
  const p = prng.pick(PLANET_PREFIXES);
  const s = prng.pick(PLANET_SUFFIXES);
  const roman = prng.pick(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']);
  return `${p}${s} ${roman}`;
}

export interface GeneratedWorld {
  worldSeed: number;
  worldName: string;
  terrain: TerrainMap;
  species: SpeciesTaxon[];
  organisms: OrganismState[];
  resources: ResourcePatch[];
}

/** Development-only, transactional relocation. Failure leaves every founder at its original position. */
export function placePredatorFounders(world: GeneratedWorld, seed: number): boolean {
  const predators = world.organisms.filter(o => o.genome.diet === 'carnivore');
  const prey = world.organisms.filter(o => o.genome.diet !== 'carnivore');
  if (predators.length < 2 || !prey.length) return false;
  // Founder cooldowns are transient; evaluate partner compatibility once they expire.
  const compatible = (a: OrganismState, b: OrganismState) => checkMatingCompatibility(
    { ...a, reproductiveCooldown: 0, energy: 100 },
    { ...b, reproductiveCooldown: 0, energy: 100 }).compatible;
  // The constant separates placement draws from both world generation and simulation draws.
  const rng = new PRNG((seed ^ 0x706c6163) >>> 0);
  const occupied = world.organisms.map(o => ({ x: o.x, y: o.y }));
  const sites: { x: number; y: number; food: number; tie: number }[] = [];
  const seen = new Set<string>();
  for (const animal of prey) {
    for (const [dx, dy] of [[-5, 0], [5, 0], [0, -5], [0, 5], [-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      const gx = Math.floor(animal.x / world.terrain.cellSize) + dx;
      const gy = Math.floor(animal.y / world.terrain.cellSize) + dy;
      const key = `${gx},${gy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const x = (gx + .5) * world.terrain.cellSize;
      const y = (gy + .5) * world.terrain.cellSize;
      const cell = getCellAt(world.terrain, x, y);
      if (!cell || !isValidSpawnCell(cell) || cell.isFlooded ||
        occupied.some(o => Math.hypot(o.x - x, o.y - y) < 20)) continue;
      // Exclude tiny walkable pockets; founders need room to start ordinary movement.
      const openDirections = [[20, 0], [-20, 0], [0, 20], [0, -20]]
        .filter(([ox, oy]) => directRouteOpen(world.terrain, x, y, x + ox, y + oy)).length;
      if (openDirections < 3) continue;
      const food = prey.filter(o => {
        const distance = Math.hypot(o.x - x, o.y - y);
        return distance <= predators[0].genome.sensoryRadius * Math.max(.25, 1 - o.genome.camouflage * .65) &&
          directRouteOpen(world.terrain, x, y, o.x, o.y);
      }).length;
      if (food) sites.push({ x, y, food, tie: rng.next() });
    }
  }
  const chosen: typeof sites = [];
  const candidates = sites.sort((a, b) => b.food - a.food || b.tie - a.tie).slice(0, 180);
  for (let index = 0; index + 1 < predators.length; index += 2) {
    const first = predators[index];
    const second = predators[index + 1];
    const pairs: { a: typeof sites[number]; b: typeof sites[number]; score: number }[] = [];
    if (!compatible(first, second)) return false;
    const range = Math.min(first.genome.sensoryRadius, second.genome.sensoryRadius) * 1.5;
    for (const a of candidates) {
      if (chosen.some(c => Math.hypot(c.x - a.x, c.y - a.y) < 40)) continue;
      for (const b of candidates) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance < 30 || distance > Math.min(range, 95) ||
          chosen.some(c => Math.hypot(c.x - b.x, c.y - b.y) < 40) ||
          !directRouteOpen(world.terrain, a.x, a.y, b.x, b.y)) continue;
        const spread = chosen.length ? Math.min(...chosen.map(c => Math.hypot(c.x - a.x, c.y - a.y))) : 250;
        pairs.push({ a, b, score: (a.food + b.food) * 20 + Math.min(spread, 500) * .5 + a.tie + b.tie });
      }
    }
    if (!pairs.length) return false;
    pairs.sort((a, b) => b.score - a.score);
    chosen.push(pairs[0].a, pairs[0].b);
  }
  // Odd founder counts need a compatible partner in an already selected pair.
  if (predators.length % 2) {
    const last = predators[predators.length - 1];
    const site = candidates.filter(a => chosen.every(c => Math.hypot(c.x - a.x, c.y - a.y) >= 30) &&
      chosen.some((c, i) => compatible(last, predators[i]) &&
        Math.hypot(c.x - a.x, c.y - a.y) <= Math.min(last.genome.sensoryRadius,
          predators[i].genome.sensoryRadius) * 1.5 &&
        directRouteOpen(world.terrain, a.x, a.y, c.x, c.y)))
      .sort((a, b) => b.food - a.food || b.tie - a.tie)[0];
    if (!site) return false;
    chosen.push(site);
  }
  chosen.forEach((site, i) => { predators[i].x = site.x; predators[i].y = site.y; });
  return true;
}

export function generateNewWorld(seed: number, config?: EcologyConfig): GeneratedWorld {
  const prng = new PRNG(seed);
  const worldName = generatePlanetName(prng);
  const terrain = generateTerrain(seed);
  const resources = createInitialResources(terrain, prng.fork(), config?.initialPlantCount ?? 220, config?.plantCapacity ?? 1);

  // Create three initial trophic roles: Herbivores, Carnivores, and Scavengers
  const foundingSpeciesConfigs = [
    { diet: 'herbivore' as const, count: 24 }, // Meadow Grazers
    { diet: 'herbivore' as const, count: 18 }, // Canopy Browsers
    { diet: 'scavenger' as const, count: 15 }, // Carrion Detritivores / Scavengers
    { diet: 'carnivore' as const, count: 9 },  // Apex Hunters
  ];

  const speciesList: SpeciesTaxon[] = [];
  const organisms: OrganismState[] = [];

  for (let sIdx = 0; sIdx < foundingSpeciesConfigs.length; sIdx++) {
    const config = foundingSpeciesConfigs[sIdx];
    const genome = createBaseGenome(prng, config.diet);
    const taxon = generateSpeciesTaxon(genome, `founder_${sIdx}`, 0, prng);
    speciesList.push(taxon);

    // Place creatures strictly on habitable, walkable land away from impassable peaks and deep water
    for (let placed = 0; placed < config.count; placed++) {
      const { x, y } = findValidSpawnLocation(terrain, prng);
      const id = `org_gen0_${sIdx}_${placed}`;
      const org = createOrganism(id, taxon, genome, 1, x, y, 0, prng, true);
      organisms.push(org);
    }

    taxon.aliveCount = config.count;
    taxon.totalHistoricalCount = config.count;
  }

  return {
    worldSeed: seed,
    worldName,
    terrain,
    species: speciesList,
    organisms,
    resources,
  };
}
