/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SimulationEvent,
  SimulationSnapshot,
  TerrainMap,
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

export function getCurrentChronicleEvent(snapshot: SimulationSnapshot): SimulationEvent | undefined {
  const recent = snapshot.events.filter((event) =>
    event.tick <= snapshot.tick && snapshot.tick - event.tick <= 200
  );
  return recent.find((event) => event.isMilestone) ?? recent[0];
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
  const { species } = snapshot;

  // Find associated species or organism if highlighted
  let matchedSpecies: SpeciesTaxon | undefined;
  if (event.highlightSpeciesId) {
    matchedSpecies = species.find((s) => s.id === event.highlightSpeciesId);
  }
  // Use the event's recorded location; current organism positions can have changed.
  const loc = typeof event.x === 'number' && typeof event.y === 'number'
    ? getGeographicalDescription(terrain, event.x, event.y)
    : null;
  const place = loc ? ` in the ${loc.region} ${loc.biomeName}` : '';

  const spName = matchedSpecies ? matchedSpecies.name : 'unidentified';

  switch (event.type) {
    case 'speciation':
      return `A new lineage has emerged${place}.`;

    case 'extinction':
      return `The ${spName} lineage has vanished into planetary history.`;

    case 'drought_extinction':
      return `The ${spName} lineage has vanished amid severe drought.`;

    case 'ecosystem_recovery':
      return `Pioneer flora is recolonizing recovered habitat${place}.`;

    case 'wildfire_disaster':
      return `A wildfire has erupted${place}.`;

    case 'drought_disaster':
      return `Arid drought has begun${place}.`;

    case 'flood_disaster':
      return `Flooding has begun${place}.`;

    case 'volcano_disaster':
      return `A volcanic eruption has begun${place}.`;

    case 'cold_snap':
      return `A cold snap has begun${place}.`;

    case 'predator_takeover':
      return `An apex hunter of ${spName} has reached five successful hunts${place}.`;

    case 'matriarch_record':
      return `An elder matriarch of ${spName} has persevered across generations.`;

    case 'bottleneck_survival':
      return `The ${spName} species has narrowly survived a perilous evolutionary bottleneck.`;

    case 'biosphere_collapse':
      return `All macroscopic life has ceased; silence falls upon the biosphere.`;

    case 'world_genesis':
      return `Autonomous life has seeded across the primordial planetary biomes.`;

    default:
      return event.description || event.title;
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
      `Rainfall is high during ${seasonName}.`
    );
  } else if (climate.solarRadiation < 0.25) {
    observations.push(
      `Solar radiation is low during the current phase of the day cycle.`
    );
  } else {
    observations.push(
      `Solar radiation is active during ${seasonName}.`
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
      `The current population contains approximately ${ratio} herbivores per carnivore.`
    );
  } else if (herbivoreCount > 0 && carnivoreCount === 0) {
    observations.push(
      `Herbivores are present, while no carnivores remain.`
    );
  }

  // 4. Adaptations & Genetics
  const traitAvg = stats.traitAverages;
  if (traitAvg) {
    if (traitAvg.avgColdTolerance < 8) {
      observations.push(
        `The living population's average cold tolerance is ${traitAvg.avgColdTolerance.toFixed(1)}°C.`
      );
    } else if (traitAvg.avgSpeed > 2.8) {
      observations.push(
        `The living population's average speed trait is ${traitAvg.avgSpeed.toFixed(1)}.`
      );
    } else if (traitAvg.avgCamouflage > 0.45) {
      observations.push(
        `The living population's average camouflage trait is ${traitAvg.avgCamouflage.toFixed(2)}.`
      );
    }
  }

  // 5. Environmental recovery
  if (stats.totalHabitatDeterioration && stats.totalHabitatDeterioration > 20) {
    observations.push(
      `Habitat damage remains across the world.`
    );
  }

  return observations.length > 0
    ? observations
    : [`Autonomous planetary equilibrium continues across natural evolutionary cycles.`];
}
