/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CauseOfDeathStats,
  ClimateState,
  EcosystemStats,
  EnergyAccountingLedger,
  MutationEvent,
  OrganismState,
  ResourcePatch,
  SavedWorldData,
  SimulationSnapshot,
  SimulationEvent,
  SpeciesTaxon,
  TerrainMap,
} from '../types/simulation.js';
import { PRNG } from './math/prng.js';
import {
  createInitialClimate,
  updateClimate,
  getEffectiveLocalTemperature,
  evaluateDisasterTriggers,
  updateEnvironmentalDisasters,
  DEFAULT_DISASTER_COOLDOWNS,
  DisasterCooldowns,
} from './terrain/climate.js';
import { findValidSpawnLocation, getCellAt } from './terrain/terrain.js';
import { generateNewWorld } from './generation/worldGenerator.js';
import { createSpatialGrid, populateSpatialGrid, updatePhysics, SpatialGrid } from './physics/physics.js';
import { updateOrganismMetabolism, createOrganism } from './organism/organism.js';
import { updateCreatureBehavior } from './behavior/behavior.js';
import { updateResourceEcosystem, spawnCarrion } from './ecosystem/ecosystem.js';
import {
  calculateGeneticDistance,
  computePopulationTraitAverages,
  crossoverGenomes,
  crossoverGenomesWithLog,
  createBaseGenome,
  evaluateSpeciationCriteria,
} from './genetics/genetics.js';
import { generateSpeciesTaxon } from './species/species.js';
import { SpeciesAncestryTree } from './species/lineageTree.js';
import { EventChronicle } from './events/events.js';

export const SIMULATION_STEP_MS = 50; // 20 ticks per second (fixed step)

export class SimulationEngine {
  public tick = 0;
  public worldSeed: number;
  public worldName: string;
  public createdTimestamp: number;
  public terrain: TerrainMap;
  public climate: ClimateState;
  public organisms: OrganismState[] = [];
  public resources: ResourcePatch[] = [];
  public speciesMap: Map<string, SpeciesTaxon> = new Map();
  public speciesTree: SpeciesAncestryTree;
  public chronicle: EventChronicle;

  // Energy Accounting Ledger (Thermodynamic Conservation Model)
  public energyLedger: EnergyAccountingLedger = {
    solarEnergyInflow: 0,
    plantBiomassEnergy: 0,
    organismReserveEnergy: 0,
    carrionBiomassEnergy: 0,
    soilNutrientEnergy: 120, // Initial soil nutrient reserve
    dissipatedMetabolicHeat: 0,
    dissipatedReproductionTax: 0,
  };

  // Internal Ecological Vital Statistics
  public totalBirths = 0;
  public totalDeaths = 0;
  public causesOfDeath: CauseOfDeathStats = {
    starvation: 0,
    dehydration: 0,
    predation: 0,
    senescence: 0,
  };

  // Mutation-event log recording genetic changes from parent to offspring
  public mutationEvents: MutationEvent[] = [];

  // Environmental & Disaster System state
  public disasterCooldowns: DisasterCooldowns = { ...DEFAULT_DISASTER_COOLDOWNS };
  public biosphereExtinctLogged = false;
  public totalHabitatDeterioration = 0;

  private spatialGrid: SpatialGrid;
  private prng: PRNG;
  private maxObservedAge = 0;
  private lastApexKills = 0;

  constructor(seedOrSaved?: number | SavedWorldData) {
    this.speciesTree = new SpeciesAncestryTree();
    this.chronicle = new EventChronicle(60, 200);

    if (typeof seedOrSaved === 'object' && seedOrSaved !== null && 'version' in seedOrSaved) {
      // Restore from saved world data
      this.worldSeed = seedOrSaved.worldSeed;
      this.worldName = seedOrSaved.worldName;
      this.createdTimestamp = seedOrSaved.createdTimestamp;
      this.tick = seedOrSaved.lastSavedTick;
      this.climate = seedOrSaved.climate;
      this.organisms = seedOrSaved.organisms;
      this.resources = seedOrSaved.resources;

      if (seedOrSaved.stats) {
        this.totalBirths = seedOrSaved.stats.totalBirths || 0;
        this.totalDeaths = seedOrSaved.stats.totalDeaths || 0;
        if (seedOrSaved.stats.causesOfDeath) {
          this.causesOfDeath = { ...seedOrSaved.stats.causesOfDeath };
        }
        if (seedOrSaved.stats.energyLedger) {
          this.energyLedger = { ...seedOrSaved.stats.energyLedger };
        }
      }

      if (seedOrSaved.mutationEvents) {
        this.mutationEvents = [...seedOrSaved.mutationEvents];
      }

      for (const sp of seedOrSaved.species) {
        this.speciesMap.set(sp.id, sp);
      }

      if (seedOrSaved.ancestryNodes && Array.isArray(seedOrSaved.ancestryNodes)) {
        this.speciesTree.restore(seedOrSaved.ancestryNodes);
      } else {
        // Build tree from species list
        for (const sp of seedOrSaved.species) {
          this.speciesTree.registerSpecies(sp, sp.ancestorSpeciesId);
        }
      }

      this.chronicle.restoreEvents(seedOrSaved.events);
      this.prng = new PRNG(this.worldSeed + this.tick);

      // Recreate procedural terrain from seed
      const gen = generateNewWorld(this.worldSeed);
      this.terrain = gen.terrain;
      this.spatialGrid = createSpatialGrid(this.terrain.worldWidth, this.terrain.worldHeight, 80);
    } else {
      // New world generation
      const seed = typeof seedOrSaved === 'number' ? seedOrSaved : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
      this.worldSeed = seed;
      this.createdTimestamp = Date.now();
      this.prng = new PRNG(seed);
      this.climate = createInitialClimate();

      const gen = generateNewWorld(seed);
      this.worldName = gen.worldName;
      this.terrain = gen.terrain;
      this.organisms = gen.organisms;
      this.resources = gen.resources;

      for (const sp of gen.species) {
        this.speciesMap.set(sp.id, sp);
        this.speciesTree.registerSpecies(sp, null, 0);
      }

      this.spatialGrid = createSpatialGrid(this.terrain.worldWidth, this.terrain.worldHeight, 80);

      this.chronicle.addEvent(
        'world_genesis',
        'World Genesis',
        `A primordial world named "${this.worldName}" arose with ${this.organisms.length} founding creatures across ${this.speciesMap.size} species.`,
        this.tick,
        { isMilestone: true }
      );
    }
  }

  public step(): void {
    this.tick += 1;

    // 1. Advance climate & solar radiation cycle
    this.climate = updateClimate(this.climate, this.tick);

    // 2. Environmental & Disaster System (Probabilistic, deterministic, bounded severity)
    if (this.tick % 40 === 0) {
      for (const k in this.disasterCooldowns) {
        const key = k as keyof DisasterCooldowns;
        if (this.disasterCooldowns[key] > 0) {
          this.disasterCooldowns[key] = Math.max(0, this.disasterCooldowns[key] - 40);
        }
      }

      const newDisaster = evaluateDisasterTriggers(
        this.terrain,
        this.climate,
        this.disasterCooldowns,
        this.tick,
        this.prng,
        this.resources
      );

      if (newDisaster) {
        this.climate.activeDisasters.push(newDisaster);
        this.climate.disasterHistoryCount = (this.climate.disasterHistoryCount || 0) + 1;

        let eventType: SimulationEvent['type'] = 'wildfire_disaster';
        if (newDisaster.type === 'drought') eventType = 'drought_disaster';
        else if (newDisaster.type === 'flood') eventType = 'flood_disaster';
        else if (newDisaster.type === 'volcanic_eruption') eventType = 'volcano_disaster';
        else if (newDisaster.type === 'cold_snap') eventType = 'cold_snap';

        this.chronicle.addEvent(
          eventType,
          newDisaster.name,
          `A catastrophic ${newDisaster.type.replace('_', ' ')} (severity ${(newDisaster.severity * 100).toFixed(0)}%) struck at tick ${this.tick}.`,
          this.tick,
          { isMilestone: true, x: newDisaster.x, y: newDisaster.y }
        );
      }
    }

    // Step active environmental disasters & local habitat deterioration/recovery
    const envResult = updateEnvironmentalDisasters(
      this.terrain,
      this.climate,
      this.organisms,
      this.resources,
      this.tick,
      this.prng
    );
    this.totalHabitatDeterioration = envResult.totalHabitatDeterioration;

    // Chronicle automatic world-history records for habitat recovery
    for (let e = 0; e < envResult.newEvents.length; e++) {
      const ev = envResult.newEvents[e];
      this.chronicle.addEvent(ev.type, ev.title, ev.description, this.tick, {
        isMilestone: ev.isMilestone,
        highlightSpeciesId: ev.highlightSpeciesId,
        highlightOrganismId: ev.highlightOrganismId,
        x: ev.x,
        y: ev.y,
      });
    }

    // 3. Spatial Indexing
    populateSpatialGrid(this.spatialGrid, this.organisms, this.resources);

    // 4. Autonomous Decision Engine (Utility-based AI with genuine consequence)
    const behaviorOutput = updateCreatureBehavior(
      this.organisms,
      this.resources,
      this.terrain,
      this.spatialGrid,
      this.prng
    );

    // Track energy accounting from behavioral outcomes
    this.energyLedger.dissipatedReproductionTax += behaviorOutput.reproductionTaxDissipated;

    // 5. Handle Reproduction & Genetic Inheritance
    for (let i = 0; i < behaviorOutput.reproducedParents.length; i++) {
      // Soft carrying capacity ceiling for smooth real-time execution
      if (this.organisms.length >= 220) break;

      const { parentA, parentB } = behaviorOutput.reproducedParents[i];
      const parentTaxon = this.speciesMap.get(parentA.speciesId);

      if (!parentTaxon) continue;

      // Two-parent inheritance, genetic recombination, and mutation event logging
      const { childGenome, mutations } = crossoverGenomesWithLog(
        parentA.genome,
        parentB.genome,
        this.prng,
        parentA.id,
        parentB.id,
        this.tick
      );

      // Evaluate speciation criteria against founder and species centroid baseline
      const speciationResult = evaluateSpeciationCriteria(childGenome, parentTaxon);

      let childTaxon: SpeciesTaxon;
      if (speciationResult.shouldSpeciate) {
        // Cladogenesis: Branch new species taxon with Latin binomial & phylogenetic ancestry
        const newTaxon = generateSpeciesTaxon(
          childGenome,
          `sp_${this.tick}_${this.speciesMap.size + 1}`,
          this.tick,
          this.prng,
          parentTaxon,
          speciationResult.divergenceScore
        );

        this.speciesMap.set(newTaxon.id, newTaxon);
        this.speciesTree.registerSpecies(newTaxon, parentTaxon.id, this.tick);
        childTaxon = newTaxon;

        this.chronicle.addEvent(
          'speciation',
          `Speciation: ${newTaxon.name}`,
          `A new lineage ("${newTaxon.commonName}") diverged from ${parentTaxon.name} (divergence ${(speciationResult.divergenceScore * 100).toFixed(1)}%).`,
          this.tick,
          { highlightSpeciesId: newTaxon.id, x: parentA.x, y: parentA.y, isMilestone: true }
        );
      } else {
        childTaxon = parentTaxon;
        // Increment population counters on parent taxon and tree
        childTaxon.totalHistoricalCount = (childTaxon.totalHistoricalCount || 0) + 1;
        childTaxon.aliveCount = (childTaxon.aliveCount || 0) + 1;
        this.speciesTree.recordBirth(childTaxon.id, this.tick);

        // Update species centroid genome as an exponential moving average
        const alpha = 0.05;
        if (!childTaxon.centroidGenome) {
          childTaxon.centroidGenome = { ...childGenome };
        }
        const cg = childTaxon.centroidGenome;
        const tg = childGenome;
        cg.speed = cg.speed * (1 - alpha) + tg.speed * alpha;
        cg.bodySize = cg.bodySize * (1 - alpha) + tg.bodySize * alpha;
        cg.visionRange = cg.visionRange * (1 - alpha) + tg.visionRange * alpha;
        cg.metabolicEfficiency = cg.metabolicEfficiency * (1 - alpha) + tg.metabolicEfficiency * alpha;
        cg.reproductiveInvestment = cg.reproductiveInvestment * (1 - alpha) + tg.reproductiveInvestment * alpha;
        cg.camouflage = cg.camouflage * (1 - alpha) + tg.camouflage * alpha;
        cg.aggression = cg.aggression * (1 - alpha) + tg.aggression * alpha;
        cg.foodProcessingEfficiency = cg.foodProcessingEfficiency * (1 - alpha) + tg.foodProcessingEfficiency * alpha;
        cg.heatTolerance = cg.heatTolerance * (1 - alpha) + tg.heatTolerance * alpha;
        cg.coldTolerance = cg.coldTolerance * (1 - alpha) + tg.coldTolerance * alpha;
      }

      // Recombination spawn location near parents
      const spawnX = (parentA.x + parentB.x) / 2 + this.prng.range(-8, 8);
      const spawnY = (parentA.y + parentB.y) / 2 + this.prng.range(-8, 8);
      const childId = `org_${this.tick}_${this.totalBirths + 1}`;

      // Append mutation events to ring buffer
      for (let m = 0; m < mutations.length; m++) {
        this.mutationEvents.push(mutations[m]);
      }
      if (this.mutationEvents.length > 250) {
        this.mutationEvents.splice(0, this.mutationEvents.length - 250);
      }

      const child = createOrganism(
        childId,
        childTaxon,
        childGenome,
        Math.max(parentA.generation, parentB.generation) + 1,
        spawnX,
        spawnY,
        this.tick,
        this.prng,
        false,
        parentA.id,
        parentB.id
      );

      this.organisms.push(child);
      this.totalBirths += 1;
    }

    // 6. Hunt Kills & Apex Predator Milestones
    for (let k = 0; k < behaviorOutput.kills.length; k++) {
      const { predator, prey, residualCarrionMass } = behaviorOutput.kills[k];

      // Spawn residual carcass mass from predator kill as carrion for scavengers
      spawnCarrion(this.resources, prey.x, prey.y, prey.genome.bodySize, residualCarrionMass);

      if (predator.kills >= 5 && predator.kills > this.lastApexKills) {
        this.lastApexKills = predator.kills;
        this.chronicle.addEvent(
          'predator_takeover',
          'Apex Predator Reign',
          `An elder hunter from ${predator.speciesName} has claimed 5 successful prey hunts.`,
          this.tick,
          { highlightOrganismId: predator.id, highlightSpeciesId: predator.speciesId, x: predator.x, y: predator.y, isMilestone: true }
        );
      }
    }

    // 7. Metabolism, Aging, Thermal Stress & Mortality
    for (let i = 0; i < this.organisms.length; i++) {
      const org = this.organisms[i];
      if (org.state === 'dead') continue;

      // Local effective temperature at organism's specific spatial coordinates
      const localTemp = getEffectiveLocalTemperature(this.terrain, org.x, org.y, this.climate);
      const orgCell = getCellAt(this.terrain, org.x, org.y);
      const isFlooded = orgCell ? !!orgCell.isFlooded : false;

      const energyBurned = updateOrganismMetabolism(org, localTemp, this.climate.isDrought, isFlooded);
      this.energyLedger.dissipatedMetabolicHeat += energyBurned;

      // Track oldest organism
      if (org.age > this.maxObservedAge && org.age > 2400) {
        this.maxObservedAge = org.age;
        if (org.age % 1200 === 0) {
          this.chronicle.addEvent(
            'matriarch_record',
            'Matriarch Milestone',
            `An organism from ${org.speciesName} has endured for ${(org.age / 20).toFixed(0)} seconds of continuous evolutionary history.`,
            this.tick,
            { highlightOrganismId: org.id, highlightSpeciesId: org.speciesId, x: org.x, y: org.y, isMilestone: true }
          );
        }
      }
    }

    // 8. Process Deaths, Cause Attribution, Carcass Spawning & Extinctions
    for (let i = this.organisms.length - 1; i >= 0; i--) {
      const org = this.organisms[i];
      if (org.state === 'dead') {
        this.totalDeaths += 1;

        // Record cause of death statistics
        const cause = org.deathCause || (org.energy <= 0 ? 'starvation' : org.age > org.maxAge ? 'senescence' : 'dehydration');
        if (cause in this.causesOfDeath) {
          this.causesOfDeath[cause as keyof CauseOfDeathStats] += 1;
        }

        // Non-predated deaths become decomposing carrion for scavengers
        if (cause !== 'predation') {
          spawnCarrion(this.resources, org.x, org.y, org.genome.bodySize, org.genome.bodySize * 28);
        }

        const taxon = this.speciesMap.get(org.speciesId);
        if (taxon) {
          taxon.aliveCount = Math.max(0, taxon.aliveCount - 1);
          this.speciesTree.recordDeath(org.speciesId, this.tick);

          if (taxon.aliveCount === 0 && !taxon.extinct) {
            taxon.extinct = true;
            taxon.extinctTick = this.tick;

            // Differentiate drought-induced extinctions from normal extinctions
            if (this.climate.isDrought && (cause === 'dehydration' || cause === 'starvation')) {
              this.chronicle.addEvent(
                'drought_extinction',
                'Drought-Induced Extinction',
                `The line of ${taxon.name} ("${taxon.commonName}") collapsed amid severe drought at tick ${this.tick}.`,
                this.tick,
                { highlightSpeciesId: taxon.id, x: org.x, y: org.y, isMilestone: true }
              );
            } else {
              this.chronicle.addEvent(
                'extinction',
                'Lineage Extinction',
                `The line of ${taxon.name} ("${taxon.commonName}") has vanished from the world at tick ${this.tick}.`,
                this.tick,
                { highlightSpeciesId: taxon.id, x: org.x, y: org.y, isMilestone: true }
              );
            }
          }
        }

        this.organisms.splice(i, 1);
      }
    }

    // 9. Physics integration (continuous motion, drag, flood water friction)
    updatePhysics(this.organisms, this.terrain, this.spatialGrid);

    // 10. Ecosystem resources (photosynthesis, flora regrowth, carrion decomposition)
    const ecoResult = updateResourceEcosystem(
      this.resources,
      this.terrain,
      this.climate,
      this.energyLedger.soilNutrientEnergy,
      this.prng
    );

    // Update energy ledger
    this.energyLedger.solarEnergyInflow += ecoResult.solarEnergyInflow;
    this.energyLedger.plantBiomassEnergy = Math.round(ecoResult.plantBiomass);
    this.energyLedger.carrionBiomassEnergy = Math.round(ecoResult.carrionBiomass);
    this.energyLedger.soilNutrientEnergy = Math.max(
      0,
      this.energyLedger.soilNutrientEnergy + ecoResult.recycledSoilNutrients - ecoResult.soilNutrientsAbsorbed
    );

    let totalOrganismReserve = 0;
    for (let o = 0; o < this.organisms.length; o++) {
      totalOrganismReserve += this.organisms[o].energy;
    }
    this.energyLedger.organismReserveEnergy = Math.round(totalOrganismReserve);

    // 11. Biosphere Survival Guarantee Policy
    // An ecosystem is NOT guaranteed to survive indefinitely.
    // If all organisms die out under overwhelming environmental pressures, log Total Biosphere Extinction.
    if (this.organisms.length === 0 && !this.biosphereExtinctLogged) {
      this.biosphereExtinctLogged = true;
      this.chronicle.addEvent(
        'biosphere_collapse',
        'Total Biosphere Extinction',
        `All living macroscopic life has perished. The biosphere has collapsed under overwhelming environmental selection pressures.`,
        this.tick,
        { isMilestone: true }
      );
    }

    // Ecological rescue: ONLY if surviving taxa exist and world is not totally collapsed
    if (this.organisms.length > 0 && this.organisms.length < 8 && this.tick > 200 && this.tick % 80 === 0) {
      const activeTaxa = Array.from(this.speciesMap.values()).filter((s) => !s.extinct);
      if (activeTaxa.length > 0) {
        const rescueTaxon = this.prng.pick(activeTaxa);
        const spawnPos = findValidSpawnLocation(this.terrain, this.prng);
        const rescueOrg = createOrganism(
          `rescue_${this.tick}_${this.prng.rangeInt(100, 999)}`,
          rescueTaxon,
          createBaseGenome(this.prng, rescueTaxon.diet),
          1,
          spawnPos.x,
          spawnPos.y,
          this.tick,
          this.prng,
          true
        );
        this.organisms.push(rescueOrg);
        rescueTaxon.aliveCount = (rescueTaxon.aliveCount || 0) + 1;
        this.speciesTree.recordBirth(rescueTaxon.id, this.tick);
      }
    }
  }

  public getStats(): EcosystemStats {
    let herbivores = 0;
    let carnivores = 0;
    let scavengers = 0;
    let omnivores = 0;
    let plantBiomass = 0;
    let totalCreatureBiomass = 0;
    let oldestAge = 0;
    let oldestName = '';
    let maxGen = 1;

    for (let i = 0; i < this.organisms.length; i++) {
      const o = this.organisms[i];
      if (o.state === 'dead') continue;

      if (o.genome.diet === 'herbivore') herbivores++;
      else if (o.genome.diet === 'carnivore') carnivores++;
      else if (o.genome.diet === 'scavenger') scavengers++;
      else if (o.genome.diet === 'omnivore') omnivores++;

      totalCreatureBiomass += o.genome.bodySize * 10;
      if (o.generation > maxGen) maxGen = o.generation;
      if (o.age > oldestAge) {
        oldestAge = o.age;
        oldestName = `${o.speciesName} (#${o.id.slice(-4)})`;
      }
    }

    let carrionBiomass = 0;
    for (let r = 0; r < this.resources.length; r++) {
      const res = this.resources[r];
      if (res.type === 'plant') plantBiomass += res.amount;
      else if (res.type === 'carrion') carrionBiomass += res.amount;
    }

    const targetCarryingBiomass = 3500;
    const resourceScarcity = Math.max(0, Math.min(1.0, 1.0 - plantBiomass / targetCarryingBiomass));
    const livingSpeciesIds = new Set<string>();
    for (let i = 0; i < this.organisms.length; i++) {
      if (this.organisms[i].state !== 'dead') {
        livingSpeciesIds.add(this.organisms[i].speciesId);
      }
    }
    const activeSpeciesCount = livingSpeciesIds.size;

    const diversity = this.speciesTree.computeGeneticDiversity(this.organisms, this.tick);
    const oldestLineage = this.speciesTree.getOldestSurvivingLineage(this.tick);
    const longestLived = this.speciesTree.getLongestLivedSpecies(this.tick);
    const dominant = this.speciesTree.getDominantSpecies();

    return {
      tick: this.tick,
      elapsedSeconds: Math.round((this.tick * SIMULATION_STEP_MS) / 1000),
      totalOrganisms: this.organisms.length,
      herbivores,
      carnivores,
      scavengers,
      omnivores,
      speciesActiveCount: activeSpeciesCount,
      plantBiomass: Math.round(plantBiomass),
      organismBiomass: Math.round(totalCreatureBiomass),
      carrionBiomass: Math.round(carrionBiomass),
      resourceScarcity,
      totalBirths: this.totalBirths,
      totalDeaths: this.totalDeaths,
      causesOfDeath: { ...this.causesOfDeath },
      energyLedger: { ...this.energyLedger },
      traitAverages: computePopulationTraitAverages(this.organisms),
      maxGeneration: maxGen,
      oldestOrganismAgeTicks: oldestAge,
      oldestOrganismName: oldestName,
      diversity,
      oldestLineageAgeTicks: oldestLineage?.ageTicks ?? 0,
      oldestLineageName: oldestLineage ? `${oldestLineage.name} ("${oldestLineage.commonName}")` : undefined,
      longestLivedSpeciesTicks: longestLived?.lifespanTicks ?? 0,
      longestLivedSpeciesName: longestLived ? `${longestLived.name} ("${longestLived.commonName}")` : undefined,
      dominantSpeciesName: dominant ? `${dominant.name} ("${dominant.commonName}")` : undefined,
      dominantSpeciesShare: dominant?.dominanceShare ?? 0,
      climateAnomaly: this.climate.globalTempAnomaly,
      activeDisasterCount: this.climate.activeDisasters?.length ?? 0,
      activeDisasterSummary: this.climate.activeDisasters?.length
        ? this.climate.activeDisasters.map((d) => d.name).join(', ')
        : undefined,
      totalHabitatDeterioration: Math.round(this.totalHabitatDeterioration * 10) / 10,
      isDroughtActive: this.climate.isDrought,
    };
  }

  public getSnapshot(): SimulationSnapshot {
    return {
      tick: this.tick,
      worldSeed: this.worldSeed,
      worldName: this.worldName,
      createdTimestamp: this.createdTimestamp,
      climate: { ...this.climate, activeDisasters: [...(this.climate.activeDisasters || [])] },
      organisms: this.organisms.map((o) => ({ ...o, genome: { ...o.genome } })),
      resources: this.resources.map((r) => ({ ...r })),
      events: this.chronicle.getRecentEvents(16),
      species: Array.from(this.speciesMap.values()),
      stats: this.getStats(),
      mutationEvents: this.mutationEvents.slice(-60),
      ancestryNodes: this.speciesTree.getAllNodes(),
      speciesRegistry: Array.from(this.speciesMap.values()),
    };
  }

  public serializeForStorage(): SavedWorldData {
    return {
      version: 1,
      worldSeed: this.worldSeed,
      worldName: this.worldName,
      createdTimestamp: this.createdTimestamp,
      lastSavedTimestamp: Date.now(),
      lastSavedTick: this.tick,
      terrainSeed: this.worldSeed,
      climate: { ...this.climate, activeDisasters: [...(this.climate.activeDisasters || [])] },
      organisms: this.organisms,
      resources: this.resources,
      events: this.chronicle.getAllEvents(),
      species: Array.from(this.speciesMap.values()),
      stats: this.getStats(),
      mutationEvents: this.mutationEvents.slice(-100),
      ancestryNodes: this.speciesTree.serialize(),
      speciesRegistry: Array.from(this.speciesMap.values()),
    };
  }
}
