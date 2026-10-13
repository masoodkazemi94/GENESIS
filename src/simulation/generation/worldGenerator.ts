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
import { generateTerrain, findValidSpawnLocation, isValidSpawnCell, WORLD_WIDTH, WORLD_HEIGHT } from '../terrain/terrain.js';
import { createInitialResources } from '../ecosystem/ecosystem.js';

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

export function generateNewWorld(seed: number): GeneratedWorld {
  const prng = new PRNG(seed);
  const worldName = generatePlanetName(prng);
  const terrain = generateTerrain(seed);
  const resources = createInitialResources(terrain, prng.fork(), 220);

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
