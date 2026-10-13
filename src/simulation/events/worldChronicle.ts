/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SimulationEvent,
  SimulationSnapshot,
  TerrainMap,
  OrganismState,
  SpeciesTaxon,
} from '../../types/simulation.js';
import { getCellAt } from '../terrain/terrain.js';

/**
 * Derives geographical cardinal and biome description from world coordinates.
 */
export function getGeographicalDescription(
  terrain: TerrainMap,
  x: number,
  y: number
): { region: string; biomeName: string } {
  const w = terrain.worldWidth;
  const h = terrain.worldHeight;

  // Cardinal direction
  const isNorth = y < h * 0.38;
  const isSouth = y > h * 0.62;
  const isWest = x < w * 0.38;
  const isEast = x > w * 0.62;

  let region = 'central';
  if (isNorth && isWest) region = 'northwestern';
  else if (isNorth && isEast) region = 'northeastern';
  else if (isSouth && isWest) region = 'southwestern';
  else if (isSouth && isEast) region = 'southeastern';
  else if (isNorth) region = 'northern';
  else if (isSouth) region = 'southern';
  else if (isWest) region = 'western';
  else if (isEast) region = 'eastern';

  const cell = getCellAt(terrain, x, y);
  let biomeName = 'lowlands';
  if (cell) {
    switch (cell.biome) {
      case 'forest':
        biomeName = 'forests';
        break;
      case 'ancient_forest':
        biomeName = 'ancient woodlands';
        break;
      case 'grassland':
      case 'lush_grassland':
        biomeName = 'grasslands';
        break;
      case 'desert':
      case 'arid_steppe':
        biomeName = 'arid dunes';
        break;
      case 'mountain':
      case 'rocky_highland':
        biomeName = 'mountain ridges';
        break;
      case 'snow_peak':
      case 'tundra_snow':
        biomeName = 'alpine peaks';
        break;
      case 'lake':
      case 'river':
        biomeName = 'lake basins';
        break;
      case 'deep_ocean':
      case 'shallow_ocean':
        biomeName = 'coastal depths';
        break;
      case 'beach':
      case 'sand_coast':
        biomeName = 'golden shores';
        break;
      default:
        biomeName = 'valleys';
    }
  }

  return { region, biomeName };
}

/**
 * Transforms verified simulation event data into short, literary natural history sentences.
 * STRICTLY reflects genuine simulation events without pretense or scripts.
 */
export function formatChronicleSentence(
  event: SimulationEvent,
  snapshot: SimulationSnapshot,
  terrain: TerrainMap
): string {
  const { species, organisms, climate } = snapshot;

  // Find associated species or organism if highlighted
  let matchedSpecies: SpeciesTaxon | undefined;
  if (event.highlightSpeciesId) {
    matchedSpecies = species.find((s) => s.id === event.highlightSpeciesId);
  }
  let matchedOrganism: OrganismState | undefined;
  if (event.highlightOrganismId) {
    matchedOrganism = organisms.find((o) => o.id === event.highlightOrganismId);
  }

  // Derive geographical location from organism or active disaster epicenter
  let loc = { region: 'central', biomeName: 'grasslands' };
  if (matchedOrganism) {
    loc = getGeographicalDescription(terrain, matchedOrganism.x, matchedOrganism.y);
  } else if (climate.activeDisasters && climate.activeDisasters.length > 0) {
    const d = climate.activeDisasters[0];
    loc = getGeographicalDescription(terrain, d.x, d.y);
  } else if (organisms.length > 0) {
    const spOrg = matchedSpecies
      ? organisms.find((o) => o.speciesId === matchedSpecies!.id)
      : organisms[0];
    if (spOrg) {
      loc = getGeographicalDescription(terrain, spOrg.x, spOrg.y);
    }
  }

  const spName = matchedSpecies ? matchedSpecies.name : 'A pioneering';

  switch (event.type) {
    case 'speciation':
      return `A new lineage has emerged in the ${loc.region} ${loc.biomeName}.`;

    case 'extinction':
      return `The ${spName} lineage has vanished into planetary history.`;

    case 'drought_extinction':
      return `The ${spName} species is approaching extinction amid severe drought.`;

    case 'ecosystem_recovery':
      return `The ${loc.region} ${loc.biomeName} are recovering after a devastating drought.`;

    case 'wildfire_disaster':
      return `A wildfire has erupted across the ${loc.region} ${loc.biomeName}.`;

    case 'drought_disaster':
      return `Arid drought grips the ${loc.region} ${loc.biomeName}, reducing vital freshwater.`;

    case 'flood_disaster':
      return `Flooding has submerged the ${loc.region} ${loc.biomeName}, cutting off grazing paths.`;

    case 'volcano_disaster':
      return `A volcanic event has blanketed the ${loc.region} ${loc.biomeName} in nutrient ash.`;

    case 'cold_snap':
      return `A glacial freeze chills the ${loc.region} ${loc.biomeName}, testing cold endurance.`;

    case 'predator_takeover':
      return `An apex hunter of ${spName} has established dominance in the ${loc.region} range.`;

    case 'matriarch_record':
      return `An elder matriarch of ${spName} has persevered across generations.`;

    case 'bottleneck_survival':
      return `The ${spName} species has narrowly survived a perilous evolutionary bottleneck.`;

    case 'biosphere_collapse':
      return `All macroscopic life has ceased; silence falls upon the biosphere.`;

    case 'world_genesis':
      return `Autonomous life has seeded across the primordial planetary biomes.`;

    default:
      return event.title
        ? `${event.title} in the ${loc.region} ${loc.biomeName}.`
        : `A significant event occurred in the ${loc.region} ${loc.biomeName}.`;
  }
}

/**
 * Returns rotating scientific observations strictly computed from genuine snapshot data.
 */
export function generateScientificObservations(snapshot: SimulationSnapshot): string[] {
  const { stats, climate, species, organisms } = snapshot;
  const observations: string[] = [];

  // 1. Season & Solar radiation
  const seasonName = climate.season.charAt(0).toUpperCase() + climate.season.slice(1);
  if (climate.isDrought) {
    observations.push(
      `Extreme drought conditions persist, suppressing photosynthetic plant replenishment across the plains.`
    );
  } else if (climate.rainfall > 0.6) {
    observations.push(
      `Abundant seasonal rainfall during ${seasonName} accelerates vegetation regrowth in wetland basins.`
    );
  } else if (climate.solarRadiation < 0.25) {
    observations.push(
      `Nocturnal cooling reduces thermal energy expenditure across sleeping terrestrial fauna.`
    );
  } else {
    observations.push(
      `Solar radiation during ${seasonName} powers steady primary biomass synthesis across the biomes.`
    );
  }

  // 2. Population & Species balance
  const activeSpeciesCount = species.filter((s) => !s.extinct && s.aliveCount > 0).length;
  if (activeSpeciesCount > 0) {
    observations.push(
      `${organisms.length} living organisms sustain ${activeSpeciesCount} distinct phylogenetic lineages.`
    );
  }

  // 3. Trophic balance
  const carnivoreCount = organisms.filter((o) => o.genome.diet === 'carnivore').length;
  const herbivoreCount = organisms.filter((o) => o.genome.diet === 'herbivore').length;
  if (carnivoreCount > 0 && herbivoreCount > 0) {
    const ratio = (herbivoreCount / carnivoreCount).toFixed(1);
    observations.push(
      `Trophic balance stabilizes at approximately ${ratio} herbivores per active predator.`
    );
  } else if (herbivoreCount > 0 && carnivoreCount === 0) {
    observations.push(
      `Without predatory check, herbivore grazers expand toward environmental carrying capacity.`
    );
  }

  // 4. Adaptations & Genetics
  const traitAvg = stats.traitAverages;
  if (traitAvg) {
    if (traitAvg.avgColdTolerance < 8) {
      observations.push(
        `Natural selection favors cold-insulated lineages with lower thermal vulnerability thresholds.`
      );
    } else if (traitAvg.avgSpeed > 2.8) {
      observations.push(
        `High metabolic speed traits predominate, enabling swift evasive maneuvering against hunters.`
      );
    } else if (traitAvg.avgCamouflage > 0.45) {
      observations.push(
        `Camouflage patterning frequency has intensified, providing refuge in dense forest cover.`
      );
    }
  }

  // 5. Environmental recovery
  if (stats.totalHabitatDeterioration && stats.totalHabitatDeterioration > 20) {
    observations.push(
      `Soil nutrient deposits from recent disaster aftermath catalyze pioneer flora recolonization.`
    );
  }

  return observations.length > 0
    ? observations
    : [`Autonomous planetary equilibrium continues across natural evolutionary cycles.`];
}
