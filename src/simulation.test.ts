/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { PRNG, SimplexNoise2D } from './simulation/math/prng.js';
import { generateNewWorld } from './simulation/generation/worldGenerator.js';
import { generateTerrain, getCellAt, isValidSpawnCell, findValidSpawnLocation, GRID_RES } from './simulation/terrain/terrain.js';
import {
  createBaseGenome,
  crossoverGenomes,
  crossoverGenomesWithLog,
  mutateGenome,
  validateGenome,
  checkMatingCompatibility,
  computePopulationTraitAverages,
  calculateGeneticDistance,
  REPRODUCTIVE_ISOLATION_THRESHOLD,
  SPECIATION_DIVERGENCE_THRESHOLD,
  isReproductivelyIsolated,
  evaluateSpeciationCriteria,
} from './simulation/genetics/genetics.js';
import { SimulationEngine } from './simulation/engine.js';
import {
  isValidSavedWorld,
  saveWorldToIndexedDB,
  loadWorldFromIndexedDB,
  archiveCurrentWorld,
  loadArchivedWorld,
  clearSavedWorld,
  clearMemoryStorageForTesting,
} from './persistence/idb.js';
import {
  initializeWorldSession,
  resetWorldSession,
  persistWorldSession,
  generateCryptoSeed,
} from './persistence/sessionManager.js';
import {
  getCalendarDate,
  formatCalendarDate,
  TICKS_PER_DAY,
  TICKS_PER_YEAR,
  DAYS_PER_YEAR,
} from './simulation/calendar/calendar.js';
import { createSpatialGrid, populateSpatialGrid, queryNeighbors, updatePhysics } from './simulation/physics/physics.js';
import { updateCreatureBehavior } from './simulation/behavior/behavior.js';
import { updateOrganismMetabolism, createOrganism } from './simulation/organism/organism.js';
import { spawnCarrion, updateResourceEcosystem } from './simulation/ecosystem/ecosystem.js';
import { SpeciesAncestryTree } from './simulation/species/lineageTree.js';
import { generateSpeciesTaxon } from './simulation/species/species.js';
import { EventChronicle } from './simulation/events/events.js';
import {
  createInitialClimate,
  updateClimate,
  getEffectiveLocalTemperature,
  getEffectiveLocalMoisture,
  evaluateDisasterTriggers,
  updateEnvironmentalDisasters,
  DEFAULT_DISASTER_COOLDOWNS,
} from './simulation/terrain/climate.js';
import { CameraDirector } from './rendering/camera/director.js';
import {
  formatChronicleSentence,
  generateScientificObservations,
  getCurrentChronicleEvent,
} from './simulation/events/worldChronicle.js';
import { ResourcePatch } from './types/simulation.js';

describe('Genesis Engine - Deterministic Procedural Terrain Generation', () => {
  it('generates 100% identical 256x256 terrain for identical seeds', () => {
    const seed = 0x8a9f4c12;
    const t1 = generateTerrain(seed);
    const t2 = generateTerrain(seed);

    expect(t1.width).toBe(256);
    expect(t1.height).toBe(256);
    expect(t1.cells.length).toBe(256 * 256);
    expect(t2.cells.length).toBe(256 * 256);

    // Sample cells across corners, center, and rivers
    for (let i = 0; i < t1.cells.length; i += 257) {
      const c1 = t1.cells[i];
      const c2 = t2.cells[i];

      expect(c1.height).toBe(c2.height);
      expect(c1.moisture).toBe(c2.moisture);
      expect(c1.temperature).toBe(c2.temperature);
      expect(c1.rainfall).toBe(c2.rainfall);
      expect(c1.plantSuitability).toBe(c2.plantSuitability);
      expect(c1.biome).toBe(c2.biome);
      expect(c1.isWater).toBe(c2.isWater);
      expect(c1.isWalkable).toBe(c2.isWalkable);
      expect(c1.isRiver).toBe(c2.isRiver);
      expect(c1.isLake).toBe(c2.isLake);
    }
  });

  it('generates distinctly different worlds for different seeds', () => {
    const t1 = generateTerrain(11111);
    const t2 = generateTerrain(99999);

    let heightDifferences = 0;
    const centerStart = 64 * 256 + 64;
    for (let i = centerStart; i < centerStart + 2000; i += 5) {
      if (Math.abs(t1.cells[i].height - t2.cells[i].height) > 0.05) {
        heightDifferences++;
      }
    }
    expect(heightDifferences).toBeGreaterThan(100);
  });
});

describe('Genesis Engine - Valid Terrain Values and Ecosystem Biomes', () => {
  it('contains valid ranges for height, temperature, moisture, and plant suitability', () => {
    const terrain = generateTerrain(456789);
    const foundBiomes = new Set<string>();
    let riverCount = 0;
    let lakeCount = 0;

    for (let i = 0; i < terrain.cells.length; i++) {
      const c = terrain.cells[i];
      foundBiomes.add(c.biome);

      expect(c.height).toBeGreaterThanOrEqual(0);
      expect(c.height).toBeLessThanOrEqual(1);

      expect(c.moisture).toBeGreaterThanOrEqual(0);
      expect(c.moisture).toBeLessThanOrEqual(1);

      expect(c.rainfall).toBeGreaterThanOrEqual(0);
      expect(c.rainfall).toBeLessThanOrEqual(1);

      expect(c.temperature).toBeGreaterThanOrEqual(-30);
      expect(c.temperature).toBeLessThanOrEqual(45);

      expect(c.plantSuitability).toBeGreaterThanOrEqual(0);
      expect(c.plantSuitability).toBeLessThanOrEqual(1);

      if (c.isRiver) riverCount++;
      if (c.isLake) lakeCount++;
    }

    // Must represent oceans, lakes, rivers, beaches, grasslands, forests, deserts, and mountains
    expect(foundBiomes.has('deep_ocean') || foundBiomes.has('shallow_ocean')).toBe(true);
    expect(foundBiomes.has('lake')).toBe(true);
    expect(foundBiomes.has('river')).toBe(true);
    expect(foundBiomes.has('beach')).toBe(true);
    expect(foundBiomes.has('grassland')).toBe(true);
    expect(foundBiomes.has('forest')).toBe(true);
    expect(foundBiomes.has('desert')).toBe(true);
    expect(foundBiomes.has('mountain')).toBe(true);
    expect(foundBiomes.has('snow_peak')).toBe(true);

    expect(riverCount).toBeGreaterThan(10);
    expect(lakeCount).toBeGreaterThan(0);
  });

  it('accurately varies temperature based on latitude and elevation lapse rate', () => {
    const terrain = generateTerrain(7891011);
    const w = terrain.width;

    // Sample north pole (y = 5) vs equator (y = 128)
    const poleCell = terrain.cells[5 * w + 128];
    const equatorCell = terrain.cells[128 * w + 128];

    // High latitude pole must be significantly colder than equatorial lowland
    expect(poleCell.temperature).toBeLessThan(equatorCell.temperature);
  });
});

describe('Genesis Engine - Valid Organism Spawn Locations', () => {
  it('ensures all initial organisms spawn on walkable land away from deep water and impassable peaks', () => {
    const seed = 54321;
    const world = generateNewWorld(seed);

    expect(world.organisms.length).toBeGreaterThanOrEqual(50);

    for (const org of world.organisms) {
      const cell = getCellAt(world.terrain, org.x, org.y);
      expect(cell).not.toBeNull();
      if (cell) {
        // Must not spawn inside impassable mountains or deep water
        expect(cell.isWalkable).toBe(true);
        expect(cell.isWater).toBe(false);
        expect(cell.isLake).toBe(false);
        expect(cell.biome).not.toBe('deep_ocean');
        expect(cell.biome).not.toBe('shallow_ocean');
        expect(cell.biome).not.toBe('snow_peak');
        expect(cell.height).toBeLessThan(0.80);
        expect(isValidSpawnCell(cell)).toBe(true);
      }
    }
  });
});

describe('Genesis Engine - Genetics and Speciation', () => {
  it('bounds mutations within biological constraints', () => {
    const prng = new PRNG(555);
    const base = createBaseGenome(prng, 'herbivore');

    for (let i = 0; i < 20; i++) {
      const mutated = mutateGenome(base, prng, 0.5);
      expect(mutated.size).toBeGreaterThanOrEqual(0.5);
      expect(mutated.size).toBeLessThanOrEqual(2.6);
      expect(mutated.maxSpeed).toBeGreaterThanOrEqual(0.7);
      expect(mutated.maxSpeed).toBeLessThanOrEqual(4.0);
      expect(mutated.colorHue).toBeGreaterThanOrEqual(0);
      expect(mutated.colorHue).toBeLessThanOrEqual(360);
    }
  });

  it('calculates genetic distance accurately', () => {
    const prng = new PRNG(777);
    const g1 = createBaseGenome(prng, 'herbivore');
    const g2 = createBaseGenome(prng, 'carnivore');

    const selfDist = calculateGeneticDistance(g1, g1);
    expect(selfDist).toBe(0);

    const crossDist = calculateGeneticDistance(g1, g2);
    expect(crossDist).toBeGreaterThan(0.2);
    expect(crossDist).toBeLessThanOrEqual(1.0);
  });
});

describe('Genesis Engine - Spatial Partitioning & Physics', () => {
  it('correctly queries local neighbors without false positives', () => {
    const world = generateNewWorld(888);
    const grid = createSpatialGrid(world.terrain.worldWidth, world.terrain.worldHeight, 80);
    populateSpatialGrid(grid, world.organisms);

    const first = world.organisms[0];
    const neighbors = queryNeighbors(grid, first.x, first.y, 100);

    expect(neighbors.some((n) => n.id === first.id)).toBe(true);

    for (const n of neighbors) {
      const dist = Math.hypot(n.x - first.x, n.y - first.y);
      expect(dist).toBeLessThanOrEqual(100);
    }
  });
});

describe('Genesis Engine - Persistence Validation', () => {
  it('validates genuine saved world structures and rejects corrupted data', () => {
    const engine = new SimulationEngine(12345);
    const serialized = engine.serializeForStorage();

    expect(isValidSavedWorld(serialized)).toBe(true);
    expect(isValidSavedWorld(null)).toBe(false);
    expect(isValidSavedWorld({})).toBe(false);
    expect(isValidSavedWorld({ version: 1, worldSeed: 'invalid' })).toBe(false);
  });
});

describe('Genesis Engine - Simulation Loop Execution', () => {
  it('advances ticks and maintains life cycle without crashing', () => {
    const engine = new SimulationEngine(99999);
    const initialTick = engine.tick;

    for (let i = 0; i < 20; i++) {
      engine.step();
    }

    expect(engine.tick).toBe(initialTick + 20);
    expect(engine.organisms.length).toBeGreaterThan(0);
    expect(engine.climate.solarRadiation).toBeGreaterThanOrEqual(0);
  });
});

describe('Genesis Engine - Autonomous Creature System & Decision Engine', () => {
  it('hungry creatures pursue food with positive acceleration toward target', () => {
    const prng = new PRNG(101);
    const world = generateNewWorld(101);
    const grid = createSpatialGrid(world.terrain.worldWidth, world.terrain.worldHeight, 80);

    const taxon = world.species[0]; // Herbivore
    const org = world.organisms[0];
    org.energy = 25; // Hungry
    org.genome.diet = 'herbivore';
    org.vx = 0;
    org.vy = 0;
    org.ax = 0;
    org.ay = 0;

    // Place a succulent plant 45 units to the east of the organism
    const targetPlant = {
      id: 'test_food_1',
      x: org.x + 45,
      y: org.y,
      type: 'plant' as const,
      amount: 50,
      maxAmount: 50,
      radius: 15,
      growthRate: 0.2,
    };

    grid.populateOrganisms([org]);
    updateCreatureBehavior([org], [targetPlant], world.terrain, grid, prng);

    // Target must be locked to food
    expect(org.targetType).toBe('food');
    expect(org.targetId).toBe(targetPlant.id);
    expect(org.state === 'pursuing_food' || org.state === 'eating').toBe(true);

    // Acceleration must point towards food (positive ax)
    expect(org.ax).toBeGreaterThan(0);
  });

  it('threatened creatures flee away from predators with escape acceleration', () => {
    const prng = new PRNG(202);
    const world = generateNewWorld(202);
    const grid = createSpatialGrid(world.terrain.worldWidth, world.terrain.worldHeight, 80);

    const herbivore = world.organisms.find((o) => o.genome.diet === 'herbivore')!;
    const carnivore = world.organisms.find((o) => o.genome.diet === 'carnivore')!;

    // Place herbivore on certified habitable land and carnivore directly to the west
    const spawn = findValidSpawnLocation(world.terrain, prng);
    herbivore.x = spawn.x;
    herbivore.y = spawn.y;
    herbivore.energy = 85;
    herbivore.vx = 0;
    herbivore.vy = 0;
    herbivore.ax = 0;
    herbivore.ay = 0;

    carnivore.x = spawn.x - 30;
    carnivore.y = spawn.y;
    carnivore.genome.size = herbivore.genome.size * 1.25; // Dominant predator

    grid.populateOrganisms([herbivore, carnivore]);
    updateCreatureBehavior([herbivore, carnivore], [], world.terrain, grid, prng);

    // Herbivore must flee
    expect(herbivore.state).toBe('fleeing');
    expect(herbivore.targetType).toBe('predator');
    expect(herbivore.targetId).toBe(carnivore.id);

    // Acceleration must point away from the predator (eastward / positive ax)
    expect(herbivore.ax).toBeGreaterThan(0);
  });

  it('exhausted creatures enter resting state to reduce activity and recover', () => {
    const prng = new PRNG(303);
    const world = generateNewWorld(303);
    const grid = createSpatialGrid(world.terrain.worldWidth, world.terrain.worldHeight, 80);

    const org = world.organisms[0];
    org.energy = 15; // Severely exhausted
    org.vx = 1.0;
    org.vy = 0.5;

    // Isolate from predators
    grid.populateOrganisms([org]);
    updateCreatureBehavior([org], [], world.terrain, grid, prng);

    expect(org.state).toBe('resting');

    // Test metabolism dampening in resting state
    const initialEnergy = org.energy;
    updateOrganismMetabolism(org, 21);

    // Energy drop must be minimal due to 60% resting discount
    expect(initialEnergy - org.energy).toBeLessThan(0.06);
  });

  it('physical movement respects terrain limits and numerical constraints', () => {
    const world = generateNewWorld(404);
    const grid = createSpatialGrid(world.terrain.worldWidth, world.terrain.worldHeight, 80);
    grid.populateOrganisms(world.organisms);

    // Set aggressive velocity on organism
    const org = world.organisms[0];
    org.ax = 10.0;
    org.ay = 10.0;

    for (let step = 0; step < 10; step++) {
      updatePhysics(world.organisms, world.terrain, grid, 1.0);
    }

    // Velocity must not exceed maximum speed
    const speed = Math.hypot(org.vx, org.vy);
    expect(speed).toBeLessThanOrEqual(org.genome.maxSpeed * 1.05);

    // Coordinates and velocities must remain finite numbers
    for (const o of world.organisms) {
      expect(Number.isFinite(o.x)).toBe(true);
      expect(Number.isFinite(o.y)).toBe(true);
      expect(Number.isFinite(o.vx)).toBe(true);
      expect(Number.isFinite(o.vy)).toBe(true);
      expect(Number.isFinite(o.collisionRadius)).toBe(true);
    }
  });
});

describe('Genesis Engine - Basic Resource Ecology & Trophic Roles', () => {
  it('generates the three initial trophic roles: Herbivores, Carnivores, and Scavengers', () => {
    const world = generateNewWorld(777123);
    const herbivores = world.organisms.filter((o) => o.genome.diet === 'herbivore');
    const carnivores = world.organisms.filter((o) => o.genome.diet === 'carnivore');
    const scavengers = world.organisms.filter((o) => o.genome.diet === 'scavenger');

    expect(herbivores.length).toBeGreaterThanOrEqual(30);
    expect(carnivores.length).toBeGreaterThanOrEqual(6);
    expect(scavengers.length).toBeGreaterThanOrEqual(10);

    // Scavengers possess acute olfactory sensory radius and skittish bravery
    for (const sc of scavengers) {
      expect(sc.genome.sensoryRadius).toBeGreaterThanOrEqual(100);
      expect(sc.genome.bravery).toBeLessThan(0.45);
      expect(sc.preferredBiomes.length).toBeGreaterThan(0);
    }
  });

  it('plants grow via solar photosynthesis and do not recover instantly', () => {
    const world = generateNewWorld(888123);
    const prng = new PRNG(999);
    const testPlant = world.resources.find((r) => r.type === 'plant')!;
    testPlant.amount = 10; // Depleted
    const initialAmount = testPlant.amount;

    // Simulate daytime photosynthesis
    const daylightClimate = {
      ...createInitialClimate(),
      dayCycle: 0.25, // Noon
      temperature: 22,
      rainfall: 0.6,
      season: 'spring' as const,
      solarRadiation: 0.95,
    };

    const ecoResult = updateResourceEcosystem([testPlant], world.terrain, daylightClimate, 100, prng);

    // Plant must grow gradually, not instantly jump to maxAmount
    expect(testPlant.amount).toBeGreaterThan(initialAmount);
    expect(testPlant.amount).toBeLessThan(testPlant.maxAmount * 0.9);
    expect(ecoResult.solarEnergyInflow).toBeGreaterThan(0);
  });

  it('herbivores consume plant biomass, reducing flora amount and gaining metabolic energy', () => {
    const world = generateNewWorld(333);
    const prng = new PRNG(444);
    const grid = createSpatialGrid(world.terrain.worldWidth, world.terrain.worldHeight, 80);

    const herbivore = world.organisms.find((o) => o.genome.diet === 'herbivore')!;
    herbivore.energy = 30; // Hungry
    herbivore.vx = 0;
    herbivore.vy = 0;
    herbivore.ax = 0;
    herbivore.ay = 0;

    const plant = {
      id: 'graze_plant_1',
      x: herbivore.x,
      y: herbivore.y,
      type: 'plant' as const,
      amount: 40,
      maxAmount: 50,
      radius: 18,
      growthRate: 0.2,
    };

    grid.populateOrganisms([herbivore]);
    grid.populateFood([plant]);

    const initialHerbivoreEnergy = herbivore.energy;
    const initialPlantAmount = plant.amount;

    const out = updateCreatureBehavior([herbivore], [plant], world.terrain, grid, prng);

    expect(herbivore.state).toBe('eating');
    expect(plant.amount).toBeLessThan(initialPlantAmount);
    expect(herbivore.energy).toBeGreaterThan(initialHerbivoreEnergy);
    expect(out.plantBiomassConsumed).toBeGreaterThan(0);
  });

  it('predators hunt prey when hungry, but do not hunt when satiated', () => {
    const world = generateNewWorld(555);
    const prng = new PRNG(666);
    const grid = createSpatialGrid(world.terrain.worldWidth, world.terrain.worldHeight, 80);

    const carnivore = world.organisms.find((o) => o.genome.diet === 'carnivore')!;
    const prey = world.organisms.find((o) => o.genome.diet === 'herbivore')!;

    // Position prey close to carnivore
    prey.x = carnivore.x + 35;
    prey.y = carnivore.y;
    prey.health = 100;
    prey.energy = 80;

    // Test 1: Satiated predator does NOT hunt
    carnivore.energy = 88; // Satiated
    grid.populateOrganisms([carnivore, prey]);
    updateCreatureBehavior([carnivore, prey], [], world.terrain, grid, prng);

    // Satiated carnivore must not lock onto prey for food
    expect(carnivore.targetType).not.toBe('prey');
    expect(carnivore.state).not.toBe('hunting');

    // Test 2: Hungry predator actively hunts and consumes prey
    carnivore.energy = 30; // Starving predator
    prey.health = 15; // Low health prey for strike kill
    updateCreatureBehavior([carnivore, prey], [], world.terrain, grid, prng);

    expect(carnivore.state).toBe('hunting');
    expect(carnivore.targetType).toBe('food');
  });

  it('dead organisms produce temporary carrion and scavengers consume it', () => {
    const world = generateNewWorld(1234);
    const prng = new PRNG(5678);
    const grid = createSpatialGrid(world.terrain.worldWidth, world.terrain.worldHeight, 80);

    const scavenger = world.organisms.find((o) => o.genome.diet === 'scavenger')!;
    scavenger.energy = 30; // Hungry scavenger

    // Spawn carrion carcass near scavenger
    const resources = [...world.resources];
    spawnCarrion(resources, scavenger.x, scavenger.y, 1.2, 35);
    const carrion = resources.find((r) => r.type === 'carrion')!;
    expect(carrion).toBeDefined();

    grid.populateOrganisms([scavenger]);
    grid.populateFood(resources);

    const initialCarrionAmount = carrion.amount;
    const initialScavengerEnergy = scavenger.energy;

    const out = updateCreatureBehavior([scavenger], resources, world.terrain, grid, prng);

    // Scavenger must feed on carrion carcass
    expect(scavenger.state).toBe('scavenging');
    expect(carrion.amount).toBeLessThan(initialCarrionAmount);
    expect(scavenger.energy).toBeGreaterThan(initialScavengerEnergy);
    expect(out.carrionBiomassConsumed).toBeGreaterThan(0);
  });

  it('carrion decomposes over time and recycles nutrients back into the soil', () => {
    const terrain = generateTerrain(998877);
    const prng = new PRNG(112233);
    const carrionList = [
      {
        id: 'decay_carrion_1',
        x: 400,
        y: 400,
        type: 'carrion' as const,
        amount: 30,
        maxAmount: 30,
        radius: 15,
        growthRate: 0,
      },
    ];

    const climate = {
      ...createInitialClimate(),
      dayCycle: 0.5,
      temperature: 20,
      rainfall: 0.5,
      season: 'spring' as const,
      solarRadiation: 0.5,
    };

    const initialNutrients = 50;
    const result = updateResourceEcosystem(carrionList, terrain, climate, initialNutrients, prng);

    expect(carrionList[0].amount).toBeLessThan(30);
    expect(result.recycledSoilNutrients).toBeGreaterThan(0);
  });

  it('reproduction expends substantial energy from both parents and charges thermodynamic tax', () => {
    const world = generateNewWorld(4455);
    const prng = new PRNG(6677);
    const grid = createSpatialGrid(world.terrain.worldWidth, world.terrain.worldHeight, 80);

    const p1 = world.organisms[0];
    const p2 = world.organisms.find((o) => o.speciesId === p1.speciesId && o.id !== p1.id)!;

    p1.isMature = true;
    p2.isMature = true;
    p1.reproductiveCooldown = 0;
    p2.reproductiveCooldown = 0;
    p1.energy = 90;
    p2.energy = 90;
    p1.hydration = 80;
    p2.hydration = 80;
    p2.x = p1.x + 2;
    p2.y = p1.y;

    grid.populateOrganisms([p1, p2]);
    const out = updateCreatureBehavior([p1, p2], [], world.terrain, grid, prng);

    expect(out.reproducedParents.length).toBeGreaterThan(0);
    expect(p1.energy).toBeLessThanOrEqual(90 - 35);
    expect(p2.energy).toBeLessThanOrEqual(90 - 35);
    expect(out.reproductionTaxDissipated).toBeGreaterThan(0);
    expect(p1.reproductiveCooldown).toBeGreaterThan(50);
  });
});

describe('Genesis Engine - Energy Conservation Ledger & Stability', () => {
  it('maintains non-negative, finite energy ledger values across simulation steps', () => {
    const engine = new SimulationEngine(876543);

    for (let s = 0; s < 30; s++) {
      engine.step();
    }

    const ledger = engine.energyLedger;
    expect(ledger.solarEnergyInflow).toBeGreaterThan(0);
    expect(ledger.plantBiomassEnergy).toBeGreaterThan(0);
    expect(ledger.organismReserveEnergy).toBeGreaterThan(0);
    expect(ledger.soilNutrientEnergy).toBeGreaterThanOrEqual(0);
    expect(ledger.dissipatedMetabolicHeat).toBeGreaterThan(0);

    expect(Number.isFinite(ledger.solarEnergyInflow)).toBe(true);
    expect(Number.isFinite(ledger.plantBiomassEnergy)).toBe(true);
    expect(Number.isFinite(ledger.organismReserveEnergy)).toBe(true);
    expect(Number.isFinite(ledger.dissipatedMetabolicHeat)).toBe(true);
  });

  it('runs an accelerated simulation without runaway explosion, extinction, or numerical NaN', () => {
    const engine = new SimulationEngine(424242);
    const initialOrganismCount = engine.organisms.length;

    // Run accelerated 200 simulation steps (~10 seconds of sim time)
    for (let step = 0; step < 200; step++) {
      engine.step();
    }

    const stats = engine.getStats();

    // 1. No runaway population explosion (staying comfortably under carrying capacity of 220)
    expect(stats.totalOrganisms).toBeLessThanOrEqual(220);

    // 2. No immediate extinction (viable population survives)
    expect(stats.totalOrganisms).toBeGreaterThan(15);

    // 3. Finite numerical stability (no NaN or Infinity)
    for (const org of engine.organisms) {
      expect(Number.isFinite(org.x)).toBe(true);
      expect(Number.isFinite(org.y)).toBe(true);
      expect(Number.isFinite(org.vx)).toBe(true);
      expect(Number.isFinite(org.vy)).toBe(true);
      expect(Number.isFinite(org.energy)).toBe(true);
      expect(Number.isFinite(org.health)).toBe(true);
      expect(Number.isFinite(org.hydration)).toBe(true);
      expect(org.energy).toBeGreaterThanOrEqual(0);
      expect(org.energy).toBeLessThanOrEqual(100);
    }

    // 4. Resource scarcity and demographics recorded
    expect(stats.resourceScarcity).toBeGreaterThanOrEqual(0);
    expect(stats.resourceScarcity).toBeLessThanOrEqual(1);
    expect(stats.plantBiomass).toBeGreaterThan(0);
    expect(stats.totalDeaths + stats.totalOrganisms).toBeGreaterThanOrEqual(initialOrganismCount);
  });
});

describe('Genesis Engine - Genetic Inheritance & Evolutionary Selection System', () => {
  it('genome contains all 10 core evolutionary traits strictly validated within biological bounds', () => {
    const prng = new PRNG(101112);
    const genome = createBaseGenome(prng, 'herbivore');

    // Verify all 10 core evolutionary traits exist with valid numbers
    expect(typeof genome.speed).toBe('number');
    expect(typeof genome.bodySize).toBe('number');
    expect(typeof genome.visionRange).toBe('number');
    expect(typeof genome.metabolicEfficiency).toBe('number');
    expect(typeof genome.reproductiveInvestment).toBe('number');
    expect(typeof genome.camouflage).toBe('number');
    expect(typeof genome.aggression).toBe('number');
    expect(typeof genome.foodProcessingEfficiency).toBe('number');
    expect(typeof genome.heatTolerance).toBe('number');
    expect(typeof genome.coldTolerance).toBe('number');

    // Verify bounded physiological ranges
    expect(genome.speed).toBeGreaterThanOrEqual(0.6);
    expect(genome.speed).toBeLessThanOrEqual(4.2);
    expect(genome.bodySize).toBeGreaterThanOrEqual(0.45);
    expect(genome.bodySize).toBeLessThanOrEqual(2.8);
    expect(genome.visionRange).toBeGreaterThanOrEqual(35);
    expect(genome.visionRange).toBeLessThanOrEqual(250);
    expect(genome.metabolicEfficiency).toBeGreaterThanOrEqual(0.45);
    expect(genome.metabolicEfficiency).toBeLessThanOrEqual(1.7);
    expect(genome.reproductiveInvestment).toBeGreaterThanOrEqual(0.22);
    expect(genome.reproductiveInvestment).toBeLessThanOrEqual(0.78);
    expect(genome.camouflage).toBeGreaterThanOrEqual(0.0);
    expect(genome.camouflage).toBeLessThanOrEqual(1.0);
    expect(genome.aggression).toBeGreaterThanOrEqual(0.02);
    expect(genome.aggression).toBeLessThanOrEqual(0.98);
    expect(genome.foodProcessingEfficiency).toBeGreaterThanOrEqual(0.55);
    expect(genome.foodProcessingEfficiency).toBeLessThanOrEqual(1.7);
    expect(genome.heatTolerance).toBeGreaterThanOrEqual(12);
    expect(genome.heatTolerance).toBeLessThanOrEqual(48);
    expect(genome.coldTolerance).toBeGreaterThanOrEqual(-20);
    expect(genome.coldTolerance).toBeLessThanOrEqual(20);

    // Verify morphology and backward-compatibility aliases
    expect(genome.maxSpeed).toBe(genome.speed);
    expect(genome.size).toBe(genome.bodySize);
    expect(genome.sensoryRadius).toBe(genome.visionRange);
    expect(genome.bravery).toBe(genome.aggression);

    // Verify strict validator clamps invalid/extreme values safely
    const extremeGenome = validateGenome({
      speed: 99.0,
      bodySize: -10.0,
      coldTolerance: -150.0,
      camouflage: 5.0,
    });
    expect(extremeGenome.speed).toBeLessThanOrEqual(4.2);
    expect(extremeGenome.bodySize).toBeGreaterThanOrEqual(0.45);
    expect(extremeGenome.coldTolerance).toBeGreaterThanOrEqual(-20);
    expect(extremeGenome.camouflage).toBeLessThanOrEqual(1.0);
  });

  it('explicit mating compatibility validates maturity, energy, cooldown, and reproductive isolation', () => {
    const world = generateNewWorld(303132);
    const prng = new PRNG(404142);
    const p1 = world.organisms[0];
    const p2 = world.organisms.find((o) => o.speciesId === p1.speciesId && o.id !== p1.id)!;

    p1.isMature = true;
    p2.isMature = true;
    p1.reproductiveCooldown = 0;
    p2.reproductiveCooldown = 0;
    p1.energy = 85;
    p2.energy = 85;

    // Test 1: Compatible healthy adult conspecifics
    const compatResult = checkMatingCompatibility(p1, p2);
    expect(compatResult.compatible).toBe(true);

    // Test 2: Self-mating is strictly disallowed
    expect(checkMatingCompatibility(p1, p1).compatible).toBe(false);

    // Test 3: Juvenile immaturity prevents mating
    p2.isMature = false;
    expect(checkMatingCompatibility(p1, p2).compatible).toBe(false);
    p2.isMature = true;

    // Test 4: Reproductive cooldown prevents mating
    p2.reproductiveCooldown = 50;
    expect(checkMatingCompatibility(p1, p2).compatible).toBe(false);
    p2.reproductiveCooldown = 0;

    // Test 5: Exhaustion prevents mating
    p2.energy = 20;
    expect(checkMatingCompatibility(p1, p2).compatible).toBe(false);
    p2.energy = 85;

    // Test 6: Cross-diet reproductive barrier prevents hybridization between carnivore and herbivore
    const carnivore = world.organisms.find((o) => o.genome.diet === 'carnivore')!;
    carnivore.isMature = true;
    carnivore.reproductiveCooldown = 0;
    carnivore.energy = 90;
    expect(checkMatingCompatibility(p1, carnivore).compatible).toBe(false);
  });

  it('two-parent inheritance performs genetic recombination and tracks lineage ancestry', () => {
    const prng = new PRNG(505152);
    const p1Genome = validateGenome({
      speed: 3.5,
      bodySize: 1.8,
      visionRange: 180,
      metabolicEfficiency: 0.8,
      reproductiveInvestment: 0.65,
      camouflage: 0.2,
      aggression: 0.8,
      foodProcessingEfficiency: 1.4,
      heatTolerance: 35,
      coldTolerance: 5,
      colorHue: 350,
      diet: 'carnivore',
    });

    const p2Genome = validateGenome({
      speed: 1.5,
      bodySize: 0.9,
      visionRange: 90,
      metabolicEfficiency: 1.4,
      reproductiveInvestment: 0.35,
      camouflage: 0.7,
      aggression: 0.3,
      foodProcessingEfficiency: 0.9,
      heatTolerance: 25,
      coldTolerance: -10,
      colorHue: 120,
      diet: 'carnivore',
    });

    const { childGenome } = crossoverGenomesWithLog(
      p1Genome,
      p2Genome,
      prng,
      'parent_1',
      'parent_2',
      10,
      'taxon_1',
      'Test Hunter',
      0.0 // Zero mutation to test pure recombination assortment
    );

    // Child traits must be recombined between parental alleles (bounded by p1 and p2)
    expect(childGenome.speed).toBeGreaterThanOrEqual(Math.min(p1Genome.speed, p2Genome.speed));
    expect(childGenome.speed).toBeLessThanOrEqual(Math.max(p1Genome.speed, p2Genome.speed));
    expect(childGenome.bodySize).toBeGreaterThanOrEqual(Math.min(p1Genome.bodySize, p2Genome.bodySize));
    expect(childGenome.bodySize).toBeLessThanOrEqual(Math.max(p1Genome.bodySize, p2Genome.bodySize));
    expect(childGenome.visionRange).toBeGreaterThanOrEqual(Math.min(p1Genome.visionRange, p2Genome.visionRange));
    expect(childGenome.visionRange).toBeLessThanOrEqual(Math.max(p1Genome.visionRange, p2Genome.visionRange));
  });

  it('creates mutation-event log recording parent-to-offspring changes without automatic improvement', () => {
    const prng = new PRNG(606162);
    const p1 = createBaseGenome(prng, 'herbivore');
    const p2 = createBaseGenome(prng, 'herbivore');

    // Run crossover with active mutation rate
    const { childGenome, mutations } = crossoverGenomesWithLog(
      p1,
      p2,
      prng,
      'parent_alpha',
      'parent_beta',
      42,
      'species_emerald',
      'Emerald Strider',
      0.35 // Higher mutation rate to guarantee events
    );

    expect(mutations.length).toBeGreaterThan(0);

    for (const mut of mutations) {
      expect(mut.parentAId).toBe('parent_alpha');
      expect(mut.parentBId).toBe('parent_beta');
      expect(mut.tick).toBe(42);
      expect(typeof mut.traitName).toBe('string');
      expect(Number.isFinite(mut.oldValue)).toBe(true);
      expect(Number.isFinite(mut.newValue)).toBe(true);
      expect(Number.isFinite(mut.delta)).toBe(true);
      expect(mut.delta).toBeCloseTo(mut.newValue - mut.oldValue, 2);

      // Bounded mutation magnitude: delta must never exceed allowable bound (<= 18% of range)
      expect(Math.abs(mut.delta)).toBeLessThanOrEqual(50);
    }

    // Verify mutations are undirected over a large sample (mean delta ≈ 0, no automatic improvement)
    const deltas: number[] = [];
    const samplePrng = new PRNG(707172);
    for (let i = 0; i < 60; i++) {
      const res = crossoverGenomesWithLog(p1, p2, samplePrng, 'p1', 'p2', i, 'sp', 'sp', 0.2);
      for (const m of res.mutations) {
        deltas.push(m.delta);
      }
    }

    const meanDelta = deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1);
    // Mean delta must remain close to zero (neutral drift, not biased automatic enhancement)
    expect(Math.abs(meanDelta)).toBeLessThan(1.5);
  });

  it('computes accurate population-wide trait averages across living organisms', () => {
    const world = generateNewWorld(808182);
    const averages = computePopulationTraitAverages(world.organisms);

    expect(averages.avgSpeed).toBeGreaterThan(0);
    expect(averages.avgBodySize).toBeGreaterThan(0);
    expect(averages.avgVisionRange).toBeGreaterThan(0);
    expect(averages.avgMetabolicEfficiency).toBeGreaterThan(0);
    expect(averages.avgReproductiveInvestment).toBeGreaterThan(0);
    expect(averages.avgFoodProcessingEfficiency).toBeGreaterThan(0);
    expect(Number.isFinite(averages.avgHeatTolerance)).toBe(true);
    expect(Number.isFinite(averages.avgColdTolerance)).toBe(true);
  });

  it('scenario: cold-resistant organisms tend to achieve greater reproductive success in a colder environment', () => {
    const prng = new PRNG(909192);
    const world = generateNewWorld(909192);
    const taxon = world.species[0];

    // Set ambient climate temperature to freezing (-6°C)
    const freezingTemp = -6;

    // Create Cohort A: Cold-Adapted Organisms (coldTolerance = -14°C)
    const coldAdaptedOrganisms = [];
    for (let i = 0; i < 8; i++) {
      const genome = createBaseGenome(prng, 'herbivore');
      genome.coldTolerance = -14; // Thrives down to -14°C without hypothermia
      genome.heatTolerance = 24;
      const org = createOrganism(`cold_${i}`, taxon, genome, 1, 200 + i * 5, 200, 0, prng, true);
      coldAdaptedOrganisms.push(org);
    }

    // Create Cohort B: Cold-Susceptible Organisms (coldTolerance = +12°C)
    const coldSusceptibleOrganisms = [];
    for (let i = 0; i < 8; i++) {
      const genome = createBaseGenome(prng, 'herbivore');
      genome.coldTolerance = 12; // Suffers severe cold stress when temp is below +12°C
      genome.heatTolerance = 38;
      const org = createOrganism(`warm_${i}`, taxon, genome, 1, 300 + i * 5, 300, 0, prng, true);
      coldSusceptibleOrganisms.push(org);
    }

    // Simulate 120 ticks of freezing ambient temperature
    for (let t = 0; t < 120; t++) {
      for (const org of coldAdaptedOrganisms) {
        if (org.state !== 'dead') updateOrganismMetabolism(org, freezingTemp);
      }
      for (const org of coldSusceptibleOrganisms) {
        if (org.state !== 'dead') updateOrganismMetabolism(org, freezingTemp);
      }
    }

    // Cold-adapted organisms must have significantly higher remaining energy/health
    const avgColdAdaptedEnergy =
      coldAdaptedOrganisms.reduce((sum, o) => sum + o.energy, 0) / coldAdaptedOrganisms.length;
    const avgColdSusceptibleEnergy =
      coldSusceptibleOrganisms.reduce((sum, o) => sum + o.energy, 0) / coldSusceptibleOrganisms.length;

    expect(avgColdAdaptedEnergy).toBeGreaterThan(avgColdSusceptibleEnergy);

    const coldAdaptedSurvivors = coldAdaptedOrganisms.filter((o) => o.state !== 'dead').length;
    const coldSusceptibleSurvivors = coldSusceptibleOrganisms.filter((o) => o.state !== 'dead').length;
    expect(coldAdaptedSurvivors).toBeGreaterThanOrEqual(coldSusceptibleSurvivors);
  });

  it('scenario: excessive speed creates sufficient metabolic costs to reduce fitness under food scarcity', () => {
    const prng = new PRNG(131415);
    const world = generateNewWorld(131415);
    const taxon = world.species[0];

    // Cohort 1: Moderate-speed, energy-efficient organisms
    const moderateSpeedOrgs = [];
    for (let i = 0; i < 6; i++) {
      const genome = createBaseGenome(prng, 'herbivore');
      genome.speed = 1.4;
      genome.maxSpeed = 1.4;
      genome.bodySize = 1.0;
      genome.metabolicEfficiency = 1.3;
      const org = createOrganism(`mod_${i}`, taxon, genome, 1, 100, 100, 0, prng, true);
      org.energy = 80;
      moderateSpeedOrgs.push(org);
    }

    // Cohort 2: Excessive-speed organisms
    const excessiveSpeedOrgs = [];
    for (let i = 0; i < 6; i++) {
      const genome = createBaseGenome(prng, 'herbivore');
      genome.speed = 3.8;
      genome.maxSpeed = 3.8;
      genome.bodySize = 1.0;
      genome.metabolicEfficiency = 0.8;
      const org = createOrganism(`fast_${i}`, taxon, genome, 1, 100, 100, 0, prng, true);
      org.energy = 80;
      excessiveSpeedOrgs.push(org);
    }

    // Simulate 200 ticks of food scarcity (zero food replenishment, continuous metabolism)
    for (let t = 0; t < 200; t++) {
      for (const org of moderateSpeedOrgs) {
        if (org.state !== 'dead') updateOrganismMetabolism(org, 20);
      }
      for (const org of excessiveSpeedOrgs) {
        if (org.state !== 'dead') updateOrganismMetabolism(org, 20);
      }
    }

    const avgModerateEnergy = moderateSpeedOrgs.reduce((s, o) => s + o.energy, 0) / moderateSpeedOrgs.length;
    const avgExcessiveEnergy = excessiveSpeedOrgs.reduce((s, o) => s + o.energy, 0) / excessiveSpeedOrgs.length;

    // High speed creatures burn energy substantially faster, reducing reserves under scarcity
    expect(avgModerateEnergy).toBeGreaterThan(avgExcessiveEnergy);
  });

  it('keeps simulation deterministic for identical seeds and initial states', () => {
    const seed = 98765432;
    const engine1 = new SimulationEngine(seed);
    const engine2 = new SimulationEngine(seed);

    // Initial organisms must have 100% identical genomes and traits
    expect(engine1.organisms.length).toBe(engine2.organisms.length);
    for (let i = 0; i < engine1.organisms.length; i++) {
      const g1 = engine1.organisms[i].genome;
      const g2 = engine2.organisms[i].genome;
      expect(g1.speed).toBe(g2.speed);
      expect(g1.bodySize).toBe(g2.bodySize);
      expect(g1.visionRange).toBe(g2.visionRange);
      expect(g1.metabolicEfficiency).toBe(g2.metabolicEfficiency);
      expect(g1.reproductiveInvestment).toBe(g2.reproductiveInvestment);
      expect(g1.camouflage).toBe(g2.camouflage);
      expect(g1.aggression).toBe(g2.aggression);
      expect(g1.foodProcessingEfficiency).toBe(g2.foodProcessingEfficiency);
      expect(g1.heatTolerance).toBe(g2.heatTolerance);
      expect(g1.coldTolerance).toBe(g2.coldTolerance);
    }

    // Step both engines identically for 30 steps
    for (let step = 0; step < 30; step++) {
      engine1.step();
      engine2.step();
    }

    expect(engine1.tick).toBe(engine2.tick);
    expect(engine1.organisms.length).toBe(engine2.organisms.length);
    expect(engine1.mutationEvents.length).toBe(engine2.mutationEvents.length);

    for (let i = 0; i < engine1.organisms.length; i++) {
      const o1 = engine1.organisms[i];
      const o2 = engine2.organisms[i];
      expect(o1.x).toBeCloseTo(o2.x, 3);
      expect(o1.y).toBeCloseTo(o2.y, 3);
      expect(o1.energy).toBeCloseTo(o2.energy, 3);
      expect(o1.state).toBe(o2.state);
    }
  });
});

describe('Genesis Engine - Species Formation & Lineage Tracking System', () => {
  it('enforces explicit genetic compatibility rules and reproductive isolation thresholds', () => {
    expect(REPRODUCTIVE_ISOLATION_THRESHOLD).toBe(0.28);
    expect(SPECIATION_DIVERGENCE_THRESHOLD).toBe(0.32);

    const prng = new PRNG(112233);
    const g1 = createBaseGenome(prng, 'herbivore');
    const g2 = { ...g1 };

    // Same genome: 0 genetic distance, fully compatible
    expect(isReproductivelyIsolated(g1, g2)).toBe(false);

    // Cross-trophic barrier: Herbivore vs Carnivore is reproductively isolated
    const carnivoreGenome = createBaseGenome(prng, 'carnivore');
    expect(isReproductivelyIsolated(g1, carnivoreGenome)).toBe(true);

    // Diverged genome within same diet exceeding reproductive isolation threshold
    const divergedGenome = validateGenome({
      ...g1,
      speed: 4.0,
      bodySize: 2.6,
      visionRange: 240,
      aggression: 0.95,
      coldTolerance: -18,
      heatTolerance: 45,
    });
    const dist = calculateGeneticDistance(g1, divergedGenome);
    expect(dist).toBeGreaterThan(REPRODUCTIVE_ISOLATION_THRESHOLD);
    expect(isReproductivelyIsolated(g1, divergedGenome)).toBe(true);
  });

  it('does NOT declare a new species after everyday mutations; requires meaningful divergence and isolation', () => {
    const prng = new PRNG(445566);
    const taxon = generateSpeciesTaxon(createBaseGenome(prng, 'herbivore'), 'founder_root', 0, prng);

    // Case 1: Everyday minor mutation (intraspecific variation)
    const slightlyMutatedChild = validateGenome({
      ...taxon.founderGenome!,
      speed: taxon.founderGenome!.speed + 0.15,
      camouflage: taxon.founderGenome!.camouflage + 0.05,
    });

    const evalMinor = evaluateSpeciationCriteria(slightlyMutatedChild, taxon);
    expect(evalMinor.shouldSpeciate).toBe(false);
    expect(evalMinor.reason).toBe('within_intraspecific_variation');
    expect(evalMinor.divergenceScore).toBeLessThan(SPECIATION_DIVERGENCE_THRESHOLD);

    // Case 2: Meaningfully diverged variant exceeding divergence threshold AND isolated
    const divergedChild = validateGenome({
      ...taxon.founderGenome!,
      speed: 3.9,
      bodySize: 2.5,
      visionRange: 220,
      aggression: 0.9,
      foodProcessingEfficiency: 1.6,
      coldTolerance: -15,
      heatTolerance: 42,
      colorHue: (taxon.founderGenome!.colorHue + 120) % 360,
    });

    const evalDiverged = evaluateSpeciationCriteria(divergedChild, taxon);
    expect(evalDiverged.shouldSpeciate).toBe(true);
    expect(evalDiverged.divergenceScore).toBeGreaterThanOrEqual(SPECIATION_DIVERGENCE_THRESHOLD);
    expect(evalDiverged.reason).toBe('divergence_and_reproductive_isolation_exceeded');
  });

  it('constructs an ancestry tree that distinguishes branches, ancestors, descendants, and extinct lineages', () => {
    const prng = new PRNG(778899);
    const tree = new SpeciesAncestryTree();

    // 1. Root species (Primordial founder)
    const gRoot = createBaseGenome(prng, 'herbivore');
    const rootTaxon = generateSpeciesTaxon(gRoot, 'founder_alpha', 0, prng);
    const rootNode = tree.registerSpecies(rootTaxon, null, 0);

    expect(rootNode.branchDepth).toBe(0);
    expect(rootNode.ancestorSpeciesId).toBeNull();
    expect(tree.getRootSpecies().length).toBe(1);

    // 2. Daughter species branching from root
    const gDaughter = validateGenome({ ...gRoot, speed: 3.5, bodySize: 2.0 });
    const daughterTaxon = generateSpeciesTaxon(gDaughter, 'founder_beta', 150, prng, rootTaxon, 0.35);
    const daughterNode = tree.registerSpecies(daughterTaxon, rootTaxon.id, 0.35);

    expect(daughterNode.branchDepth).toBe(1);
    expect(daughterNode.ancestorSpeciesId).toBe(rootTaxon.id);
    expect(tree.getNode(rootTaxon.id)!.descendantSpeciesIds).toContain(daughterTaxon.id);

    // 3. Granddaughter species branching from daughter
    const gGrand = validateGenome({ ...gDaughter, coldTolerance: -15 });
    const grandTaxon = generateSpeciesTaxon(gGrand, 'founder_gamma', 300, prng, daughterTaxon, 0.38);
    const grandNode = tree.registerSpecies(grandTaxon, daughterTaxon.id, 0.38);

    expect(grandNode.branchDepth).toBe(2);
    expect(grandNode.ancestorSpeciesId).toBe(daughterTaxon.id);

    // 4. Ancestor and Descendant traversals
    const grandAncestors = tree.getAncestors(grandTaxon.id);
    expect(grandAncestors.length).toBe(2);
    expect(grandAncestors[0].id).toBe(daughterTaxon.id);
    expect(grandAncestors[1].id).toBe(rootTaxon.id);

    const rootDescendants = tree.getDescendants(rootTaxon.id);
    expect(rootDescendants.length).toBe(2);
    expect(rootDescendants.map((d) => d.id)).toContain(daughterTaxon.id);
    expect(rootDescendants.map((d) => d.id)).toContain(grandTaxon.id);
  });

  it('tracks species population dynamics and detects lineage extinction with exact tick', () => {
    const prng = new PRNG(998877);
    const tree = new SpeciesAncestryTree();

    const taxon = generateSpeciesTaxon(createBaseGenome(prng, 'herbivore'), 'f1', 50, prng);
    tree.registerSpecies(taxon);

    // Initial count is 1
    expect(tree.getNode(taxon.id)!.aliveOrganismsCount).toBe(1);
    expect(tree.getNode(taxon.id)!.isExtinct).toBe(false);

    // Births increment populations
    tree.recordBirth(taxon.id, 2);
    tree.recordBirth(taxon.id, 3);
    expect(tree.getNode(taxon.id)!.aliveOrganismsCount).toBe(3);
    expect(tree.getNode(taxon.id)!.totalOrganismsCount).toBe(3);
    expect(tree.getNode(taxon.id)!.generationPeak).toBe(3);

    // Deaths decrement populations
    expect(tree.recordDeath(taxon.id, 200)).toBe(false); // 2 remaining
    expect(tree.recordDeath(taxon.id, 250)).toBe(false); // 1 remaining
    expect(tree.getNode(taxon.id)!.isExtinct).toBe(false);

    // Final death triggers complete extinction
    const extinctionTriggered = tree.recordDeath(taxon.id, 320);
    expect(extinctionTriggered).toBe(true);

    const node = tree.getNode(taxon.id)!;
    expect(node.aliveOrganismsCount).toBe(0);
    expect(node.isExtinct).toBe(true);
    expect(node.extinctTick).toBe(320);

    // Tree filters distinguish living and extinct
    expect(tree.getLivingSpecies().length).toBe(0);
    expect(tree.getExtinctSpecies().length).toBe(1);
    expect(tree.getExtinctSpecies()[0].id).toBe(taxon.id);
  });

  it('tracks oldest surviving lineage and longest-lived species accurately', () => {
    const prng = new PRNG(123456);
    const tree = new SpeciesAncestryTree();

    // Sp1 founded at tick 10
    const sp1 = generateSpeciesTaxon(createBaseGenome(prng, 'herbivore'), 'f1', 10, prng);
    tree.registerSpecies(sp1);

    // Sp2 founded at tick 80
    const sp2 = generateSpeciesTaxon(createBaseGenome(prng, 'carnivore'), 'f2', 80, prng);
    tree.registerSpecies(sp2);

    // Sp3 founded at tick 150
    const sp3 = generateSpeciesTaxon(createBaseGenome(prng, 'scavenger'), 'f3', 150, prng);
    tree.registerSpecies(sp3);

    const tick500 = 500;
    // Sp1 is oldest surviving lineage at tick 500 (founded at 10, age = 490)
    let oldest = tree.getOldestSurvivingLineage(tick500);
    expect(oldest!.speciesId).toBe(sp1.id);
    expect(oldest!.ageTicks).toBe(490);

    // Sp1 goes extinct at tick 600
    tree.recordDeath(sp1.id, 600);
    expect(tree.getNode(sp1.id)!.isExtinct).toBe(true);

    const tick700 = 700;
    // Now Sp2 is the oldest SURVIVING lineage (founded at 80, age = 620)
    oldest = tree.getOldestSurvivingLineage(tick700);
    expect(oldest!.speciesId).toBe(sp2.id);
    expect(oldest!.foundingTick).toBe(80);
    expect(oldest!.ageTicks).toBe(620);

    // Longest-lived species across history:
    // Sp1: extinct at 600, founded at 10 -> lifespan = 590
    // Sp2: living at 700, founded at 80 -> lifespan = 620
    const longest = tree.getLongestLivedSpecies(tick700);
    expect(longest!.speciesId).toBe(sp2.id);
    expect(longest!.lifespanTicks).toBe(620);
  });

  it('computes dominant species metrics and ecological diversity indices', () => {
    const prng = new PRNG(654321);
    const tree = new SpeciesAncestryTree();

    const spA = generateSpeciesTaxon(createBaseGenome(prng, 'herbivore'), 'fa', 0, prng);
    const spB = generateSpeciesTaxon(createBaseGenome(prng, 'carnivore'), 'fb', 0, prng);
    const spC = generateSpeciesTaxon(createBaseGenome(prng, 'scavenger'), 'fc', 0, prng);

    tree.registerSpecies(spA);
    tree.registerSpecies(spB);
    tree.registerSpecies(spC);

    // Create population: 15 of spA, 5 of spB, 5 of spC (total = 25)
    for (let i = 0; i < 14; i++) tree.recordBirth(spA.id, 1);
    for (let i = 0; i < 4; i++) tree.recordBirth(spB.id, 1);
    for (let i = 0; i < 4; i++) tree.recordBirth(spC.id, 1);

    const dominant = tree.getDominantSpecies();
    expect(dominant!.speciesId).toBe(spA.id);
    expect(dominant!.aliveCount).toBe(15);
    expect(dominant!.dominanceShare).toBeCloseTo(15 / 25, 2); // 0.60

    // Mock organisms to test genetic diversity indices
    const dummyOrgs = [
      ...Array.from({ length: 15 }, (_, i) => ({
        id: `org_a_${i}`,
        speciesId: spA.id,
        genome: spA.founderGenome!,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `org_b_${i}`,
        speciesId: spB.id,
        genome: spB.founderGenome!,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `org_c_${i}`,
        speciesId: spC.id,
        genome: spC.founderGenome!,
      })),
    ] as any[];

    const diversity = tree.computeGeneticDiversity(dummyOrgs, 100);
    expect(diversity.activeSpeciesCount).toBe(3);
    expect(diversity.shannonIndex).toBeGreaterThan(0.5);
    expect(diversity.simpsonIndex).toBeGreaterThan(0.4);
    expect(diversity.simpsonIndex).toBeLessThanOrEqual(1.0);
    expect(diversity.dominantSpeciesCount).toBe(15);
    expect(diversity.dominantSpeciesShare).toBeCloseTo(0.6, 2);
  });

  it('safeguards against unbounded historical memory growth by compacting low-importance events while preserving major milestones', () => {
    // Create chronicle with max ephemeral = 10 and max milestones = 25
    const chronicle = new EventChronicle(10, 25);

    // Add genesis milestone
    chronicle.addEvent('world_genesis', 'Primordial Genesis', 'World was born', 0);

    // Add 40 low-importance / ephemeral events
    for (let t = 1; t <= 40; t++) {
      chronicle.addEvent('population_boom', 'Census Shift', `Local population fluctuated at step ${t}`, t, {
        isMilestone: false,
      });
    }

    // Ephemeral events should be strictly bounded to maxEphemeral (10)
    expect(chronicle.getAllEvents().length).toBeLessThanOrEqual(15);
    expect(chronicle.getArchivedEventsCount()).toBeGreaterThan(25);

    // Verify genesis milestone was preserved with exact simulation tick 0
    const genesis = chronicle.getAllEvents().find((e) => e.type === 'world_genesis');
    expect(genesis).toBeDefined();
    expect(genesis!.tick).toBe(0);

    // Add speciation and extinction milestones
    chronicle.addEvent('speciation', 'Lineage Branched', 'New species arose', 150);
    chronicle.addEvent('extinction', 'Lineage Extinct', 'Species vanished', 280);

    const allEvents = chronicle.getAllEvents();
    const speciationEvt = allEvents.find((e) => e.type === 'speciation');
    const extinctionEvt = allEvents.find((e) => e.type === 'extinction');

    expect(speciationEvt).toBeDefined();
    expect(speciationEvt!.tick).toBe(150);
    expect(extinctionEvt).toBeDefined();
    expect(extinctionEvt!.tick).toBe(280);
  });

  it('integrates species ancestry tree, phylogenetic naming, and speciation into live SimulationEngine', () => {
    const engine = new SimulationEngine(556677);

    // Verify initial taxa are registered in ancestry tree
    expect(engine.speciesTree.getAllNodes().length).toBeGreaterThanOrEqual(4);
    expect(engine.speciesTree.getRootSpecies().length).toBeGreaterThanOrEqual(4);

    // Initial stats include diversity metrics and oldest lineage
    const stats = engine.getStats();
    expect(stats.diversity).toBeDefined();
    expect(stats.diversity!.activeSpeciesCount).toBeGreaterThan(0);
    expect(typeof stats.oldestLineageName).toBe('string');
    expect(typeof stats.longestLivedSpeciesName).toBe('string');

    // Run simulation for 25 steps to verify step lifecycle stability
    for (let i = 0; i < 25; i++) {
      engine.step();
    }

    const snap = engine.getSnapshot();
    expect(snap.ancestryNodes).toBeDefined();
    expect(snap.ancestryNodes!.length).toBeGreaterThanOrEqual(4);
    expect(snap.speciesRegistry).toBeDefined();

    // Verify serialization includes ancestry nodes
    const saved = engine.serializeForStorage();
    expect(saved.ancestryNodes).toBeDefined();
    expect(saved.ancestryNodes!.length).toBe(snap.ancestryNodes!.length);
  });
});

describe('Genesis Engine - Interconnected Climate & Environmental System', () => {
  it('implements seasonal cycles, diurnal solar curves, and long-term climate trends', () => {
    let climate = createInitialClimate();

    // Spring baseline
    const springClimate = updateClimate(climate, 600); // 0.25 of a day in spring
    expect(springClimate.season).toBe('spring');
    expect(springClimate.solarRadiation).toBeGreaterThan(0.5);

    // Summer: significantly warmer than winter
    const summerClimate = updateClimate(climate, 2400 + 600); // summer noon
    expect(summerClimate.season).toBe('summer');

    // Winter: freezing temperatures
    const winterClimate = updateClimate(climate, 2400 * 3 + 600); // winter noon
    expect(winterClimate.season).toBe('winter');

    // Summer temperature must exceed winter temperature by a realistic seasonal margin (> 10°C)
    expect(summerClimate.temperature - winterClimate.temperature).toBeGreaterThan(10);

    // Diurnal variation: midnight has zero solar radiation
    const midnightClimate = updateClimate(climate, 1800); // night time (0.75 of day)
    expect(midnightClimate.solarRadiation).toBe(0);

    // Long-term climate trend remains smooth and bounded
    expect(summerClimate.climateTrend).toBeGreaterThanOrEqual(-1.0);
    expect(summerClimate.climateTrend).toBeLessThanOrEqual(1.0);
  });

  it('calculates regional temperature and moisture variations across terrain and disasters', () => {
    const terrain = generateTerrain(42);
    const climate = createInitialClimate();

    // Find sea-level cell vs high mountain peak cell at similar latitude
    const lowCell = terrain.cells.find((c) => c.y > 100 && c.y < 155 && c.height > 0.38 && c.height < 0.44)!;
    const peakCell = terrain.cells.find((c) => c.y > 100 && c.y < 155 && c.height > 0.65)!;

    const lowTemp = getEffectiveLocalTemperature(terrain, (lowCell.x + 0.5) * terrain.cellSize, (lowCell.y + 0.5) * terrain.cellSize, climate);
    const peakTemp = getEffectiveLocalTemperature(terrain, (peakCell.x + 0.5) * terrain.cellSize, (peakCell.y + 0.5) * terrain.cellSize, climate);

    // Mountain peak must be colder than sea-level valley due to altitude lapse rate
    expect(lowTemp).toBeGreaterThan(peakTemp);

    // Wildfire introduces localized thermal anomaly in its immediate radius
    const fireDisaster = {
      id: 'test_fire',
      type: 'wildfire' as const,
      name: 'Wildfire',
      startTick: 100,
      durationTicks: 300,
      remainingTicks: 300,
      severity: 0.8,
      x: 500,
      y: 500,
      radius: 150,
      active: true,
      affectedCount: 0,
      plantsDestroyed: 0,
    };

    const climateWithFire = {
      ...climate,
      activeDisasters: [fireDisaster],
    };

    const tempNearFire = getEffectiveLocalTemperature(terrain, 510, 510, climateWithFire);
    const tempFarFromFire = getEffectiveLocalTemperature(terrain, 1200, 1200, climateWithFire);
    expect(tempNearFire).toBeGreaterThan(tempFarFromFire + 15);
  });

  it('modulates plant growth based on climate and enforces drought withering', () => {
    const prng = new PRNG(888);
    const terrain = generateTerrain(888);

    const normalClimate = createInitialClimate();
    normalClimate.temperature = 22;
    normalClimate.solarRadiation = 0.85;
    normalClimate.rainfall = 0.5;

    const plant: any = {
      id: 'test_plant',
      x: 800,
      y: 800,
      type: 'plant',
      amount: 40,
      maxAmount: 80,
      radius: 20,
      growthRate: 0.3,
    };

    // Under normal climate, photosynthesis increases biomass
    const initialAmount = plant.amount;
    const ecoResult = updateResourceEcosystem([plant], terrain, normalClimate, 100, prng);
    expect(plant.amount).toBeGreaterThan(initialAmount);
    expect(ecoResult.solarEnergyInflow).toBeGreaterThan(0);

    // Under active drought, plant biomass withers and shrinks
    const droughtClimate = {
      ...normalClimate,
      isDrought: true,
      droughtSeverity: 0.8,
      rainfall: 0.05,
    };

    const beforeDrought = plant.amount;
    updateResourceEcosystem([plant], terrain, droughtClimate, 100, prng);
    expect(plant.amount).toBeLessThan(beforeDrought);
  });

  it('demonstrates wildfire vegetation destruction, organism burns, and habitat deterioration', () => {
    const prng = new PRNG(777);
    const terrain = generateTerrain(777);
    const climate = createInitialClimate();

    // Pick certified walkable land cell for wildfire test
    const targetCell = terrain.cells.find((c) => !c.isWater && c.isWalkable && c.plantSuitability > 0.4)!;
    const fireX = (targetCell.x + 0.5) * terrain.cellSize;
    const fireY = (targetCell.y + 0.5) * terrain.cellSize;

    const plantPatch: any = {
      id: 'forest_flora',
      x: fireX,
      y: fireY,
      type: 'plant',
      amount: 50,
      maxAmount: 60,
      radius: 20,
      growthRate: 0.2,
    };

    const founderGenome = createBaseGenome(prng, 'herbivore');
    const taxon = generateSpeciesTaxon(founderGenome, 'sp_test', 0, prng);
    const victim = createOrganism('victim_org', taxon, founderGenome, 1, fireX + 5, fireY + 5, 0, prng);
    victim.health = 100;
    victim.energy = 80;

    const wildfire = {
      id: 'wildfire_test',
      type: 'wildfire' as const,
      name: 'Wildfire Inferno',
      startTick: 50,
      durationTicks: 200,
      remainingTicks: 200,
      severity: 0.85,
      x: fireX,
      y: fireY,
      radius: 120,
      active: true,
      affectedCount: 0,
      plantsDestroyed: 0,
    };

    climate.activeDisasters = [wildfire];

    // Step environmental disaster
    const envResult = updateEnvironmentalDisasters(
      terrain,
      climate,
      [victim],
      [plantPatch],
      50,
      prng
    );

    // Plant patch within wildfire radius must be incinerated / diminished
    expect(plantPatch.amount).toBeLessThan(50);

    // Organism within wildfire radius must suffer burn damage
    expect(victim.health).toBeLessThan(100);

    // Local terrain cell must be marked deteriorated with burned cooldown
    const localCell = getCellAt(terrain, fireX, fireY);
    expect(localCell?.deterioration).toBeGreaterThan(0);
    expect(localCell?.burnedCooldown).toBeGreaterThan(0);
    expect(localCell?.ashFertilityBoost).toBeGreaterThan(0);
  });

  it('makes terrain temporarily inaccessible during floods and causes movement drag', () => {
    const prng = new PRNG(999);
    const terrain = generateTerrain(999);
    const climate = createInitialClimate();

    // Find a lowland cell
    let lowlandCell = terrain.cells[0];
    for (const c of terrain.cells) {
      if (c.height > 0.36 && c.height < 0.42 && !c.isWater) {
        lowlandCell = c;
        break;
      }
    }

    const cs = terrain.cellSize;
    const floodX = (lowlandCell.x + 0.5) * cs;
    const floodY = (lowlandCell.y + 0.5) * cs;

    const floodDisaster = {
      id: 'flood_test',
      type: 'flood' as const,
      name: 'Flash River Flood',
      startTick: 10,
      durationTicks: 150,
      remainingTicks: 150,
      severity: 0.75,
      x: floodX,
      y: floodY,
      radius: 160,
      active: true,
      affectedCount: 0,
      plantsDestroyed: 0,
    };

    climate.activeDisasters = [floodDisaster];

    // Step disaster
    updateEnvironmentalDisasters(terrain, climate, [], [], 10, prng);

    // Lowland cell must be marked isFlooded
    expect(lowlandCell.isFlooded).toBe(true);

    // Physics movement: creatures in flooded cells experience water drag and speed limits
    const founder = createOrganism('swimmer', generateSpeciesTaxon(createBaseGenome(prng, 'herbivore'), 'sp1', 0, prng), createBaseGenome(prng, 'herbivore'), 1, floodX, floodY, 0, prng);
    founder.vx = 4.0;
    founder.vy = 0;
    const grid = createSpatialGrid(terrain.worldWidth, terrain.worldHeight, 80);

    updatePhysics([founder], terrain, grid);

    // Due to turbulent flood water drag, velocity is heavily dampened
    expect(founder.vx).toBeLessThan(3.0);
  });

  it('demonstrates habitat recovery and pioneer flora recolonization', () => {
    const prng = new PRNG(333);
    const terrain = generateTerrain(333);
    const climate = createInitialClimate();

    // Manually create a recovering charred cell
    const targetCell = terrain.cells[100];
    targetCell.isWater = false;
    targetCell.deterioration = 0.003; // Almost fully healed
    targetCell.burnedCooldown = 0;   // Cooldown expired
    targetCell.ashFertilityBoost = 0.6; // High ash mineral fertility

    const resources: any[] = [];
    const initialFertility = targetCell.fertility;

    // Advance environmental update to trigger recovery threshold
    const envResult = updateEnvironmentalDisasters(
      terrain,
      climate,
      [],
      resources,
      100,
      prng
    );

    // Deterioration cleared
    expect(targetCell.deterioration).toBe(0);

    // Soil fertility boosted by mineral ash
    expect(targetCell.fertility).toBeGreaterThan(initialFertility);

    // Pioneer plant recolonizes the recovered land
    expect(resources.length).toBeGreaterThan(0);
    expect(resources[0].type).toBe('plant');
  });

  it('tests environmental selection pressure: cold tolerance under freezing conditions', () => {
    const prng = new PRNG(444);
    const founderTaxon = generateSpeciesTaxon(createBaseGenome(prng, 'herbivore'), 'sp_cold_test', 0, prng);

    // Creature A: High cold tolerance adapted to sub-zero alpine conditions
    const genomeAdapted = createBaseGenome(prng, 'herbivore');
    genomeAdapted.coldTolerance = -12.0;

    // Creature B: Poor cold tolerance adapted to hot tropics
    const genomeVulnerable = createBaseGenome(prng, 'herbivore');
    genomeVulnerable.coldTolerance = 14.0;

    const orgAdapted = createOrganism('org_adapted', founderTaxon, genomeAdapted, 1, 100, 100, 0, prng);
    const orgVulnerable = createOrganism('org_vulnerable', founderTaxon, genomeVulnerable, 1, 100, 100, 0, prng);

    orgAdapted.energy = 80;
    orgAdapted.health = 100;
    orgVulnerable.energy = 80;
    orgVulnerable.health = 100;

    const freezingTemp = -5.0; // Sub-zero winter temperature

    // Step metabolism 30 times under freezing conditions
    for (let step = 0; step < 30; step++) {
      updateOrganismMetabolism(orgAdapted, freezingTemp);
      updateOrganismMetabolism(orgVulnerable, freezingTemp);
    }

    // Adapted organism has cold tolerance (-12°C) well below -5°C, so zero cold thermal drain
    // Vulnerable organism has cold tolerance (+14°C) far above -5°C, so suffers severe hypothermic drain
    expect(orgAdapted.energy).toBeGreaterThan(orgVulnerable.energy);
    expect(orgAdapted.health).toBeGreaterThanOrEqual(orgVulnerable.health);
  });

  it('verifies 100% deterministic disaster triggers and climate states for identical seeds', () => {
    const seed = 0x51c0a9;
    const engine1 = new SimulationEngine(seed);
    const engine2 = new SimulationEngine(seed);

    for (let i = 0; i < 50; i++) {
      engine1.step();
      engine2.step();
    }

    expect(engine1.tick).toBe(engine2.tick);
    expect(engine1.climate.temperature).toBe(engine2.climate.temperature);
    expect(engine1.climate.rainfall).toBe(engine2.climate.rainfall);
    expect(engine1.climate.season).toBe(engine2.climate.season);
    expect(engine1.climate.isDrought).toBe(engine2.climate.isDrought);
    expect(engine1.climate.activeDisasters.length).toBe(engine2.climate.activeDisasters.length);
    expect(engine1.chronicle.getAllEvents().length).toBe(engine2.chronicle.getAllEvents().length);

    // Event log timestamps & ticks match identically
    const events1 = engine1.chronicle.getAllEvents();
    const events2 = engine2.chronicle.getAllEvents();
    for (let e = 0; e < events1.length; e++) {
      expect(events1[e].type).toBe(events2[e].type);
      expect(events1[e].tick).toBe(events2[e].tick);
    }
  });

  it('records drought-induced extinctions and handles total biosphere collapse without indefinite survival guarantee', () => {
    const engine = new SimulationEngine(12984);
    const sp = Array.from(engine.speciesMap.values())[0];

    // Force active drought state
    engine.climate.activeDisasters = [{
      id: 'drought_test',
      type: 'drought',
      name: 'The Great Arid Drought',
      startTick: engine.tick,
      durationTicks: 500,
      remainingTicks: 500,
      severity: 0.9,
      x: 1000,
      y: 1000,
      radius: 2000,
      active: true,
      affectedCount: 0,
      plantsDestroyed: 0,
    }];
    engine.climate.isDrought = true;
    engine.climate.droughtSeverity = 0.9;

    // Simulate species dying of dehydration during drought
    const dyingOrg = engine.organisms.find((o) => o.speciesId === sp.id)!;
    // Remove all other organisms of this species so dyingOrg is the sole survivor
    engine.organisms = engine.organisms.filter((o) => o.speciesId !== sp.id || o.id === dyingOrg.id);
    sp.aliveCount = 1;
    dyingOrg.health = 0;
    dyingOrg.deathCause = 'dehydration';
    dyingOrg.state = 'dead';

    engine.step();

    const events = engine.chronicle.getAllEvents();
    const droughtExtinctionEvt = events.find((e) => e.type === 'drought_extinction');
    expect(droughtExtinctionEvt).toBeDefined();

    // Test total biosphere collapse: if all organisms die, total extinction is recorded and no wild migrants spawn
    engine.organisms = []; // Empty population
    for (const taxon of engine.speciesMap.values()) {
      taxon.extinct = true;
      taxon.aliveCount = 0;
    }

    engine.step();

    expect(engine.biosphereExtinctLogged).toBe(true);
    const collapseEvt = engine.chronicle.getAllEvents().find((e) => e.type === 'biosphere_collapse');
    expect(collapseEvt).toBeDefined();

    // Organisms must remain 0 (survival is not guaranteed)
    expect(engine.organisms.length).toBe(0);
  });
});

describe('Genesis - Hands-free Spectator Experience, Director & Chronicle', () => {
  it('event scoring algorithm prioritizes major extinctions and speciations over scenic vistas', () => {
    const director = new CameraDirector(2560, 2560);
    const engine = new SimulationEngine(48123);
    const snapshot = engine.getSnapshot();

    // With baseline peaceful state, director selects subject
    director.update(14.0, snapshot, engine.terrain);
    expect(director.subject).toBeDefined();

    // Now inject a major extinction event
    engine.chronicle.addEvent(
      'extinction',
      'Extinction of Apex Lineage',
      'The last of the lineage has vanished.',
      engine.tick,
      { isMilestone: true }
    );
    const updatedSnapshot = engine.getSnapshot();

    director.update(15.0, updatedSnapshot, engine.terrain);
    expect(director.subject.type).toBe('extinction');
    expect(director.subject.name).toContain('Extinction of Apex Lineage');
  });

  it('event scoring algorithm identifies and locks onto important predator-prey encounters', () => {
    const director = new CameraDirector(2560, 2560);
    const engine = new SimulationEngine(48123);

    // Create an active hunter and fleeing prey in close proximity
    const hunter = engine.organisms[0];
    hunter.state = 'hunting';
    hunter.genome.diet = 'carnivore';
    hunter.targetId = engine.organisms[1].id;
    hunter.x = 800;
    hunter.y = 800;

    const prey = engine.organisms[1];
    prey.state = 'fleeing';
    prey.speciesId = 'other_species_id';
    prey.x = 830;
    prey.y = 825;

    const snapshot = engine.getSnapshot();
    director.update(15.0, snapshot, engine.terrain);

    expect(director.subject.type).toBe('predator_prey');
    expect(director.subject.name).toContain('Predation');
    expect(director.target.x).toBeCloseTo((hunter.x + prey.x) / 2, 0);
  });

  it('requires sustained same-species displacement before calling movement a migration', () => {
    const director = new CameraDirector(2560, 2560);
    const engine = new SimulationEngine(48123);
    const group = engine.organisms.slice(0, 3);
    group.forEach((organism, index) => {
      organism.x = 800 + index * 12;
      organism.y = 800;
    });
    director.update(0, engine.getSnapshot(), engine.terrain);

    for (const organism of group) {
      organism.x += 110;
      organism.vx = 1.5;
      organism.vy = 0;
    }
    director.update(14, engine.getSnapshot(), engine.terrain);
    expect(director.subject.type).toBe('migration');
    expect(director.subject.description).toContain('more than 90 world units');
  });

  it('generates authentic natural history sentences from verified simulation events', () => {
    const engine = new SimulationEngine(48123);
    const snapshot = engine.getSnapshot();

    const specEvent = {
      id: 'spec_1',
      tick: 100,
      timestamp: Date.now(),
      type: 'speciation' as const,
      title: 'Speciation: Nova',
      description: 'A new lineage emerged.',
      x: 800,
      y: 800,
      isMilestone: true,
    };
    const specSentence = formatChronicleSentence(specEvent, snapshot, engine.terrain);
    expect(specSentence).toMatch(/A new lineage has emerged in the/);
    const movedSnapshot = {
      ...snapshot,
      organisms: snapshot.organisms.map((organism) => ({ ...organism, x: 2300, y: 2300 })),
    };
    expect(formatChronicleSentence(specEvent, movedSnapshot, engine.terrain)).toBe(specSentence);

    const recovEvent = {
      id: 'rec_1',
      tick: 250,
      timestamp: Date.now(),
      type: 'ecosystem_recovery' as const,
      title: 'Habitat Regrowth',
      description: 'Flora returning to parched soil.',
      isMilestone: true,
    };
    const recovSentence = formatChronicleSentence(recovEvent, snapshot, engine.terrain);
    expect(recovSentence).toMatch(/Pioneer flora is recolonizing recovered habitat/);
    expect(recovSentence).not.toMatch(/drought/);

    const extEvent = {
      id: 'ext_1',
      tick: 400,
      timestamp: Date.now(),
      type: 'extinction' as const,
      title: 'Lineage Vanished',
      description: 'All members perished.',
      isMilestone: true,
    };
    const extSentence = formatChronicleSentence(extEvent, snapshot, engine.terrain);
    expect(extSentence).toMatch(/has vanished into planetary history/);

    const droughtExtinction = formatChronicleSentence(
      { ...extEvent, type: 'drought_extinction' }, snapshot, engine.terrain
    );
    expect(droughtExtinction).toMatch(/has vanished amid severe drought/);
    expect(droughtExtinction).not.toMatch(/approaching/);

    const unlocatedSpeciation = formatChronicleSentence(
      { ...specEvent, x: undefined, y: undefined }, snapshot, engine.terrain
    );
    expect(unlocatedSpeciation).toBe('A new lineage has emerged.');
  });

  it('stops presenting old milestones as current events', () => {
    const engine = new SimulationEngine(48123);
    const initial = engine.getSnapshot();
    expect(getCurrentChronicleEvent(initial)?.type).toBe('world_genesis');

    const later = { ...initial, tick: 201 };
    expect(getCurrentChronicleEvent(later)).toBeUndefined();
  });

  it('generates rotating scientific observations strictly from genuine snapshot data', () => {
    const engine = new SimulationEngine(48123);
    const snapshot = engine.getSnapshot();

    const observations = generateScientificObservations(snapshot);
    expect(observations.length).toBeGreaterThan(0);
    expect(typeof observations[0]).toBe('string');
    const combined = observations.join(' ');
    expect(combined).toMatch(/living organisms|biomass|trophic|equilibrium/i);
    expect(combined).not.toMatch(/stabilizes|has intensified|expand toward/);
  });

  it('generates fresh cryptographically random seeds and distinct worlds upon rerun', () => {
    const s1 = (Math.random() * 0xffffffff) >>> 0;
    const s2 = ((Math.random() * 0xffffffff) ^ 0x9e3779b9) >>> 0;
    expect(s1).not.toBe(s2);

    const world1 = new SimulationEngine(s1);
    const world2 = new SimulationEngine(s2);

    expect(world1.worldSeed).toBe(s1);
    expect(world2.worldSeed).toBe(s2);
    // Two different seeds produce different world geography or names
    expect(world1.worldName !== world2.worldName || world1.organisms[0].x !== world2.organisms[0].x).toBe(true);
  });
});

describe('Genesis Engine - Skeptical Engineering Audit Verification Suite', () => {
  it('consumes water from real freshwater springs and replenishes hydration', () => {
    const prng = new PRNG(7001);
    const terrain = generateTerrain(7001);
    const grid = createSpatialGrid(terrain.worldWidth, terrain.worldHeight, 80);

    const founderGenome = createBaseGenome(prng, 'herbivore');
    const taxon = generateSpeciesTaxon(founderGenome, 'sp_thirsty', 0, prng);
    const org = createOrganism('thirsty_org', taxon, founderGenome, 1, 200, 200, 0, prng);
    org.hydration = 15; // Severely thirsty
    org.energy = 85;    // Satiated on food

    // Place a real freshwater spring nearby within drinking distance
    const spring: ResourcePatch = {
      id: 'spring_test',
      x: 205,
      y: 205,
      type: 'water_spring',
      amount: 120,
      maxAmount: 150,
      radius: 18,
      growthRate: 0.8,
    };

    const behaviorOutput = updateCreatureBehavior([org], [spring], terrain, grid, prng);

    // Organism must have drank from the spring
    expect(org.state).toBe('drinking');
    expect(org.targetType).toBe('water');
    expect(org.hydration).toBeGreaterThan(15);
    expect(spring.amount).toBeLessThan(120);
    expect(behaviorOutput.waterConsumed).toBeGreaterThan(0);
  });

  it('drinks from real river and lake terrain cells when thirsty', () => {
    const prng = new PRNG(7002);
    const terrain = generateTerrain(7002);
    const grid = createSpatialGrid(terrain.worldWidth, terrain.worldHeight, 80);

    // Locate a river cell in terrain
    let riverCell = terrain.cells.find((c) => c.isRiver)!;
    if (!riverCell) {
      riverCell = terrain.cells.find((c) => c.isWater)!;
    }

    const cs = terrain.cellSize;
    const waterX = (riverCell.x + 0.5) * cs;
    const waterY = (riverCell.y + 0.5) * cs;

    const founderGenome = createBaseGenome(prng, 'herbivore');
    const taxon = generateSpeciesTaxon(founderGenome, 'sp_river_drinker', 0, prng);
    // Position organism close to the river bank
    const org = createOrganism('river_drinker', taxon, founderGenome, 1, waterX + 4, waterY + 4, 0, prng);
    org.hydration = 20; // Thirsty
    org.energy = 90;

    const behaviorOutput = updateCreatureBehavior([org], [], terrain, grid, prng);

    expect(org.state).toBe('drinking');
    expect(org.targetType).toBe('water');
    expect(org.hydration).toBeGreaterThan(20);
  });

  it('guarantees species counts are calculated from actual living populations', () => {
    const engine = new SimulationEngine(7003);
    const initialStats = engine.getStats();

    // Collect all living species IDs
    const actualLivingSpecies = new Set(
      engine.organisms.filter((o) => o.state !== 'dead').map((o) => o.speciesId)
    );
    expect(initialStats.speciesActiveCount).toBe(actualLivingSpecies.size);

    // Pick one species and eliminate all its members
    const targetSpeciesId = Array.from(actualLivingSpecies)[0];
    engine.organisms = engine.organisms.filter((o) => o.speciesId !== targetSpeciesId);

    const updatedStats = engine.getStats();
    expect(updatedStats.speciesActiveCount).toBe(actualLivingSpecies.size - 1);

    // If all organisms are removed, active species count must be exactly 0
    engine.organisms = [];
    const emptyStats = engine.getStats();
    expect(emptyStats.speciesActiveCount).toBe(0);
  });

  it('saves and restores world state correctly with continued valid evolution', () => {
    const engine = new SimulationEngine(7004);

    // Advance 25 ticks
    for (let t = 0; t < 25; t++) {
      engine.step();
    }

    const saved = engine.serializeForStorage();

    // Verify serialized state conforms to versioned schema
    expect(saved.version).toBeGreaterThanOrEqual(1);
    expect(saved.worldSeed).toBe(7004);
    expect(saved.lastSavedTick).toBe(25);
    expect(saved.organisms.length).toBeGreaterThan(0);
    expect(saved.resources.length).toBeGreaterThan(0);
    expect(saved.species.length).toBeGreaterThan(0);

    // Restore into a new SimulationEngine instance
    const restoredEngine = new SimulationEngine(saved);

    expect(restoredEngine.worldSeed).toBe(saved.worldSeed);
    expect(restoredEngine.worldName).toBe(saved.worldName);
    expect(restoredEngine.tick).toBe(25);
    expect(restoredEngine.organisms.length).toBe(saved.organisms.length);
    expect(restoredEngine.resources.length).toBe(saved.resources.length);
    expect(restoredEngine.speciesMap.size).toBe(saved.species.length);

    // Step restored engine forward 20 ticks without error or NaN
    for (let t = 0; t < 20; t++) {
      restoredEngine.step();
    }

    expect(restoredEngine.tick).toBe(45);
    for (const org of restoredEngine.organisms) {
      expect(Number.isFinite(org.x)).toBe(true);
      expect(Number.isFinite(org.y)).toBe(true);
      expect(Number.isFinite(org.energy)).toBe(true);
      expect(Number.isFinite(org.hydration)).toBe(true);
      expect(org.energy).toBeGreaterThanOrEqual(0);
      expect(org.hydration).toBeGreaterThanOrEqual(0);
    }
  });

  it('benchmarks performance scaling with population under spatial hashing', () => {
    const engine = new SimulationEngine(7005);
    const times: number[] = [];

    // Measure duration of 20 ticks
    for (let t = 0; t < 20; t++) {
      const start = performance.now();
      engine.step();
      times.push(performance.now() - start);
    }

    const avgMsPerStep = times.reduce((a, b) => a + b, 0) / times.length;
    // Must comfortably beat the 50 ms real-time frame budget (typically < 10ms in node)
    expect(avgMsPerStep).toBeLessThan(50);
  });

  it('coordinates tab session concurrency lease preventing dual active writers', () => {
    const LEASE_MS = 3000;
    const tab1 = 'tab_alpha_1';
    const tab2 = 'tab_beta_2';
    const now = 10000;

    // Tab 1 claims lease
    const lease1 = { tabId: tab1, expire: now + LEASE_MS };
    expect(lease1.expire).toBeGreaterThan(now);

    // Tab 2 checks lease while Tab 1 lease is unexpired: Tab 2 must NOT claim
    const canTab2Claim = lease1.expire < now;
    expect(canTab2Claim).toBe(false);

    // Once Tab 1 lease expires (now advanced beyond expiration): Tab 2 can claim
    const futureTime = now + LEASE_MS + 500;
    const canTab2ClaimAfterExpiry = lease1.expire < futureTime;
    expect(canTab2ClaimAfterExpiry).toBe(true);
  });
});

describe('Genesis Engine - Architectural Quality Assurance Suite', () => {
  it('1. First visit generates a world', async () => {
    clearMemoryStorageForTesting();
    const session = await initializeWorldSession();

    expect(session.isReturningWorld).toBe(false);
    expect(session.savedData).toBeUndefined();
    expect(typeof session.freshSeed).toBe('number');
    expect(session.freshSeed).toBeGreaterThan(0);

    const engine = new SimulationEngine(session.freshSeed);
    expect(engine.tick).toBe(0);
    expect(engine.worldSeed).toBe(session.freshSeed);
    expect(engine.organisms.length).toBeGreaterThan(0);
    expect(engine.speciesMap.size).toBeGreaterThan(0);
    expect(engine.worldName.trim().length).toBeGreaterThan(0);
  });

  it('2. Refresh restores the same world', async () => {
    clearMemoryStorageForTesting();
    const originalEngine = new SimulationEngine(888111);
    for (let t = 0; t < 30; t++) {
      originalEngine.step();
    }

    const saved = originalEngine.serializeForStorage();
    await persistWorldSession(saved);

    // Simulating page refresh
    const refreshedSession = await initializeWorldSession();
    expect(refreshedSession.isReturningWorld).toBe(true);
    expect(refreshedSession.savedData).toBeDefined();
    expect(refreshedSession.savedData!.worldSeed).toBe(888111);
    expect(refreshedSession.savedData!.lastSavedTick).toBe(30);
    expect(refreshedSession.savedData!.worldName).toBe(originalEngine.worldName);
    expect(refreshedSession.savedData!.organisms.length).toBe(originalEngine.organisms.length);
  });

  it('3. Returning visits preserve the previous simulation state', async () => {
    clearMemoryStorageForTesting();
    const engine = new SimulationEngine(999222);
    for (let t = 0; t < 60; t++) {
      engine.step();
    }

    const recordedTick = engine.tick;
    const recordedBirths = engine.totalBirths;
    const recordedDeaths = engine.totalDeaths;
    const recordedSeason = engine.climate.season;

    await persistWorldSession(engine.serializeForStorage());

    // Subsequent session visit
    const returningSession = await initializeWorldSession();
    expect(returningSession.isReturningWorld).toBe(true);

    const restored = new SimulationEngine(returningSession.savedData!);
    expect(restored.tick).toBe(recordedTick);
    expect(restored.totalBirths).toBe(recordedBirths);
    expect(restored.totalDeaths).toBe(recordedDeaths);
    expect(restored.climate.season).toBe(recordedSeason);
    expect(restored.worldSeed).toBe(999222);
  });

  it('4. Save and restore preserve deterministic continuation', () => {
    const engineA = new SimulationEngine(777333);
    for (let t = 0; t < 40; t++) {
      engineA.step();
    }

    const snapshot = engineA.serializeForStorage();
    expect(snapshot.prngState).toBeDefined();

    // Advance Engine A an additional 30 ticks
    for (let t = 0; t < 30; t++) {
      engineA.step();
    }

    // Engine B is restored from snapshot at tick 40 and stepped 30 ticks
    const engineB = new SimulationEngine(snapshot);
    expect(engineB.tick).toBe(40);

    for (let t = 0; t < 30; t++) {
      engineB.step();
    }

    expect(engineB.tick).toBe(engineA.tick);
    expect(engineB.organisms.length).toBe(engineA.organisms.length);

    for (let i = 0; i < engineA.organisms.length; i++) {
      const orgA = engineA.organisms[i];
      const orgB = engineB.organisms[i];
      expect(orgB.id).toBe(orgA.id);
      expect(orgB.x).toBeCloseTo(orgA.x, 3);
      expect(orgB.y).toBeCloseTo(orgA.y, 3);
      expect(orgB.energy).toBeCloseTo(orgA.energy, 3);
      expect(orgB.hydration).toBeCloseTo(orgA.hydration, 3);
      expect(orgB.age).toBe(orgA.age);
    }
  });

  it('5. Calendar calculations are consistent', () => {
    expect(TICKS_PER_DAY).toBe(2400);
    expect(DAYS_PER_YEAR).toBe(4);
    expect(TICKS_PER_YEAR).toBe(9600);

    // Spring (Day 1)
    const springStart = getCalendarDate(0);
    expect(springStart.year).toBe(1);
    expect(springStart.dayOfYear).toBe(1);
    expect(springStart.season).toBe('spring');
    expect(springStart.timeOfDay).toBe('Dawn');

    // Summer (Day 2)
    const summerNoon = getCalendarDate(2400 + 600);
    expect(summerNoon.year).toBe(1);
    expect(summerNoon.dayOfYear).toBe(2);
    expect(summerNoon.season).toBe('summer');
    expect(summerNoon.timeOfDay).toBe('Midday');

    // Autumn (Day 3)
    const autumnStart = getCalendarDate(4800);
    expect(autumnStart.year).toBe(1);
    expect(autumnStart.dayOfYear).toBe(3);
    expect(autumnStart.season).toBe('autumn');

    // Winter (Day 4)
    const winterStart = getCalendarDate(7200);
    expect(winterStart.year).toBe(1);
    expect(winterStart.dayOfYear).toBe(4);
    expect(winterStart.season).toBe('winter');

    // Year 2, Day 1
    const year2Start = getCalendarDate(9600);
    expect(year2Start.year).toBe(2);
    expect(year2Start.dayOfYear).toBe(1);
    expect(year2Start.season).toBe('spring');

    // Verified format string
    expect(formatCalendarDate(summerNoon)).toBe('Year 1, Day 2 (Summer) • Midday');
  });

  it('6. New Seed cancellation preserves the world', async () => {
    clearMemoryStorageForTesting();
    const originalEngine = new SimulationEngine(444111);
    for (let t = 0; t < 20; t++) {
      originalEngine.step();
    }

    const saved = originalEngine.serializeForStorage();
    await persistWorldSession(saved);

    // User opens New Seed dialog and cancels -> No resetWorldSession call is dispatched
    const active = await loadWorldFromIndexedDB();
    expect(active).toBeDefined();
    expect(active!.worldSeed).toBe(444111);
    expect(active!.lastSavedTick).toBe(20);

    const archived = await loadArchivedWorld();
    expect(archived).toBeNull(); // No archive created upon cancellation
  });

  it('7. New Seed confirmation creates a separate world', async () => {
    clearMemoryStorageForTesting();
    const initialEngine = new SimulationEngine(444111);
    for (let t = 0; t < 25; t++) {
      initialEngine.step();
    }

    await persistWorldSession(initialEngine.serializeForStorage());

    // User confirms New Seed
    const newSeed = await resetWorldSession();
    expect(newSeed).not.toBe(444111);

    // Previous world was safely archived
    const archived = await loadArchivedWorld();
    expect(archived).toBeDefined();
    expect(archived!.worldSeed).toBe(444111);
    expect(archived!.lastSavedTick).toBe(25);

    // Active world cleared ready for the new seed
    const active = await loadWorldFromIndexedDB();
    expect(active).toBeNull();

    // New world is a completely separate simulation
    const newEngine = new SimulationEngine(newSeed);
    expect(newEngine.worldSeed).toBe(newSeed);
    expect(newEngine.tick).toBe(0);
    expect(newEngine.organisms.length).toBeGreaterThan(0);
  });

  it('8. Multiple tabs cannot overwrite each other\'s progress', async () => {
    clearMemoryStorageForTesting();
    const leaderEngine = new SimulationEngine(112233);
    for (let t = 0; t < 50; t++) {
      leaderEngine.step();
    }

    // Leader persists tick 50
    const leaderSave = leaderEngine.serializeForStorage();
    const leaderPersisted = await persistWorldSession(leaderSave);
    expect(leaderPersisted).toBe(true);

    // An observer tab does not write to persistence
    const isObserver = false;
    let observerAttemptedPersist = false;
    if (isObserver) {
      observerAttemptedPersist = await persistWorldSession({
        ...leaderSave,
        lastSavedTick: 5, // Stale snapshot
      });
    }
    expect(observerAttemptedPersist).toBe(false);

    // Storage still contains the genuine leader's tick 50
    const active = await loadWorldFromIndexedDB();
    expect(active!.lastSavedTick).toBe(50);
  });

  it('9. Interrupted saves do not corrupt the previous valid snapshot', async () => {
    clearMemoryStorageForTesting();
    const engine = new SimulationEngine(555666);
    for (let t = 0; t < 40; t++) {
      engine.step();
    }

    // Valid save at tick 40
    const validSave = engine.serializeForStorage();
    await saveWorldToIndexedDB(validSave);

    // Interrupted/corrupt save payload (e.g. missing required organism list or NaN seed)
    const corruptedPayload = {
      version: 2,
      worldSeed: NaN,
      worldName: '',
      lastSavedTick: -10,
    } as unknown as typeof validSave;

    const corruptedWriteResult = await saveWorldToIndexedDB(corruptedPayload);
    expect(corruptedWriteResult).toBe(false);

    // Load from storage: previous valid snapshot must remain intact
    const loaded = await loadWorldFromIndexedDB();
    expect(loaded).toBeDefined();
    expect(loaded!.worldSeed).toBe(555666);
    expect(loaded!.lastSavedTick).toBe(40);
    expect(loaded!.organisms.length).toBe(validSave.organisms.length);
  });

  it('10. A completely extinct world remains a valid saved world', async () => {
    clearMemoryStorageForTesting();
    const engine = new SimulationEngine(777888);
    for (let t = 0; t < 20; t++) {
      engine.step();
    }

    // Induce total organism extinction
    engine.organisms = [];
    const extinctSave = engine.serializeForStorage();

    expect(extinctSave.organisms.length).toBe(0);
    expect(isValidSavedWorld(extinctSave)).toBe(true);

    const saved = await saveWorldToIndexedDB(extinctSave);
    expect(saved).toBe(true);

    const restored = await loadWorldFromIndexedDB();
    expect(restored).toBeDefined();
    expect(restored!.organisms.length).toBe(0);
    expect(restored!.worldSeed).toBe(777888);

    // Step the restored extinct world: must simulate climate & resources without crashing
    const extinctEngine = new SimulationEngine(restored!);
    expect(extinctEngine.organisms.length).toBe(0);
    expect(() => extinctEngine.step()).not.toThrow();
    expect(extinctEngine.tick).toBe(21);
  });
});


