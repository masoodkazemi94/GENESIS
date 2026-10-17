/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type BiomeType =
  | 'deep_ocean'
  | 'shallow_ocean'
  | 'lake'
  | 'river'
  | 'beach'
  | 'grassland'
  | 'forest'
  | 'desert'
  | 'mountain'
  | 'snow_peak'
  // Backwards-compatible aliases:
  | 'sand_coast'
  | 'lush_grassland'
  | 'ancient_forest'
  | 'arid_steppe'
  | 'rocky_highland'
  | 'tundra_snow';

export type DietType = 'herbivore' | 'carnivore' | 'scavenger' | 'omnivore';

export interface Genome {
  // Required Evolutionary Traits (User Request 4)
  speed: number;                     // 0.8 - 4.0
  bodySize: number;                  // 0.5 - 2.8
  visionRange: number;               // 40 - 240
  metabolicEfficiency: number;       // 0.5 - 1.6 (higher = lower basal energy waste)
  reproductiveInvestment: number;    // 0.25 - 0.75 (fraction of parents' surplus given to offspring)
  camouflage: number;                // 0.0 - 1.0 (reduces predator detection radius)
  aggression: number;                // 0.0 - 1.0 (predatory drive, hunting tenacity vs fleeing)
  foodProcessingEfficiency: number;  // 0.6 - 1.6 (energy extracted per food biomass unit)
  heatTolerance: number;             // 15 to 45 °C
  coldTolerance: number;             // -15 to 18 °C

  // Morphology & backward compatibility
  size: number;                      // alias for bodySize
  maxSpeed: number;                  // alias for speed
  sensoryRadius: number;             // alias for visionRange
  metabolismRate: number;            // 0.5 - 2.0 (energy burn per tick)
  fertilityThreshold: number;        // 60 - 90 (energy required to seek mate)
  gestationTicks: number;            // 40 - 160 ticks
  colorHue: number;                  // 0 - 360 (degrees on color wheel)
  colorSaturation: number;           // 0.3 - 0.9
  diet: DietType;                    // herbivore | carnivore | scavenger | omnivore
  dietAffinity: number;              // 0 (herbivore), 0.35 (scavenger), 0.65 (omnivore), 1 (carnivore)
  tailLength: number;                // 1 - 5 (visual morphological appendage)
  bravery: number;                   // 0.1 (skittish) - 0.9 (bold/aggressive, synced with aggression)
  endurance: number;                 // resilience against starvation/thirst
}

export interface MutationEvent {
  id: string;
  tick: number;
  parentAId: string;
  parentBId?: string;
  offspringId: string;
  speciesId: string;
  speciesName?: string;
  traitName: string;
  oldValue: number;
  newValue: number;
  delta: number;
}

export interface PopulationTraitAverages {
  avgSpeed: number;
  avgBodySize: number;
  avgVisionRange: number;
  avgMetabolicEfficiency: number;
  avgReproductiveInvestment: number;
  avgCamouflage: number;
  avgAggression: number;
  avgFoodProcessingEfficiency: number;
  avgHeatTolerance: number;
  avgColdTolerance: number;
}

export type CauseOfDeath = 'starvation' | 'dehydration' | 'predation' | 'senescence' | 'thermal' | 'disaster';

export interface CauseOfDeathStats {
  starvation: number;
  dehydration: number;
  predation: number;
  senescence: number;
  thermal: number;
  disaster: number;
}

export interface EnergyAccountingLedger {
  solarEnergyInflow: number;        // Cumulative solar energy entering via photosynthesis
  plantBiomassEnergy: number;       // Current energy stored in living flora
  organismReserveEnergy: number;    // Current energy stored in living creatures
  carrionBiomassEnergy: number;     // Current energy stored in decaying carrion
  soilNutrientEnergy: number;       // Recycled decomposition energy in soil
  dissipatedMetabolicHeat: number;  // Cumulative energy burned by movement & basal metabolism
  dissipatedReproductionTax: number;// Cumulative thermodynamic tax on reproduction
}

export type OrganismLifeState =
  | 'wandering'
  | 'seeking_food'
  | 'pursuing_food'
  | 'eating'
  | 'scavenging'
  | 'avoiding_danger'
  | 'fleeing'
  | 'hunting'
  | 'resting'
  | 'locating_mate'
  | 'reproducing'
  | 'drinking'
  | 'dead'
  // Legacy aliases
  | 'foraging'
  | 'mating';

export type TargetType = 'none' | 'food' | 'predator' | 'prey' | 'mate' | 'water' | 'carrion';

export interface OrganismState {
  id: string;
  speciesId: string;
  speciesName: string;
  speciesColorHex: string;
  lineageId: string;
  generation: number;
  
  // Spatial & Physics (Continuous Kinematics)
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  angle: number;             // radians
  collisionRadius: number;   // physical collision boundary
  
  // Vitals & Biological Lifecycle
  energy: number;            // 0 - 100
  hydration: number;         // 0 - 100
  health: number;            // 0 - 100
  age: number;               // in ticks
  maxAge: number;            // life expectancy in ticks
  isMature: boolean;         // biological reproductive maturity
  maturityAge: number;       // ticks required for maturity
  reproductiveCooldown: number; // cooldown ticks between matings
  deathCause?: CauseOfDeath; // tracked when organism dies
  
  // Utility Decision Engine State
  state: OrganismLifeState;
  targetId: string | null;
  targetType: TargetType;
  targetX: number | null;
  targetY: number | null;
  wanderAngle: number;
  
  // Genetics & Ecology
  genome: Genome;
  preferredBiomes: BiomeType[];
  
  // Lineage stats & ancestry
  parentAId?: string;
  parentBId?: string;
  offspringCount: number;
  kills: number;
  bornTick: number;
}

export interface SpeciesTaxon {
  id: string;
  name: string;              // Procedural Latin binomial e.g. "Velocirhopis viridis"
  commonName: string;        // e.g. "Emerald Strider"
  colorHex: string;
  diet: DietType;
  foundingTick: number;
  founderId: string;
  generationPeak: number;
  aliveCount: number;
  totalHistoricalCount: number;
  extinct: boolean;
  extinctTick: number | null;
  ancestorSpeciesId?: string | null; // Direct parent branch or null for root
  lineageDepth: number;              // 0 for root founding species, 1 for daughter, 2...
  divergenceScore?: number;          // Genetic distance from ancestor founder/centroid
  founderGenome?: Genome;
  centroidGenome?: Genome;
}

export interface SpeciesNode {
  id: string;
  name: string;
  commonName: string;
  diet: DietType;
  colorHex: string;
  founderId: string;
  ancestorSpeciesId: string | null;
  descendantSpeciesIds: string[];
  foundingTick: number;
  extinctTick: number | null;
  isExtinct: boolean;
  branchDepth: number;
  generationPeak: number;
  totalOrganismsCount: number;
  aliveOrganismsCount: number;
  divergenceScore?: number;
}

export interface GeneticDiversityMetrics {
  shannonIndex: number;               // Shannon-Wiener Diversity H'
  simpsonIndex: number;               // Simpson Diversity D (1 - sum p_i^2)
  dominantSpeciesId: string;
  dominantSpeciesName: string;
  dominantSpeciesCommonName: string;
  dominantSpeciesCount: number;
  dominantSpeciesShare: number;       // Fraction of living organisms (0.0 to 1.0)
  averagePairwiseDistance: number;    // Mean genetic distance across living sample
  activeSpeciesCount: number;
  totalHistoricalSpeciesCount: number;
  oldestSurvivingLineage?: {
    speciesId: string;
    name: string;
    commonName: string;
    ageTicks: number;
    foundingTick: number;
  } | null;
  longestLivedSpecies?: {
    speciesId: string;
    name: string;
    commonName: string;
    lifespanTicks: number;
    isExtinct: boolean;
  } | null;
}

export interface ResourcePatch {
  id: string;
  x: number;
  y: number;
  type: 'plant' | 'carrion' | 'water_spring';
  amount: number;            // current nutrition/water
  maxAmount: number;
  radius: number;
  growthRate: number;
}

export type DisasterType =
  | 'drought'
  | 'wildfire'
  | 'flood'
  | 'volcanic_eruption'
  | 'cold_snap';

export interface EnvironmentalDisaster {
  id: string;
  type: DisasterType;
  name: string;
  startTick: number;
  durationTicks: number;
  remainingTicks: number;
  severity: number;           // 0.0 to 1.0 (clamped maximum severity)
  x: number;                  // World coordinate center
  y: number;
  radius: number;             // World spatial radius of effect
  active: boolean;
  affectedCount: number;
  plantsDestroyed: number;
}

export interface ClimateState {
  dayCycle: number;          // 0.0 to 1.0 (0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight)
  temperature: number;       // Global baseline Celsius: -5 to 35
  rainfall: number;          // Global baseline 0.0 to 1.0
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  solarRadiation: number;    // 0.0 to 1.0
  climateTrend: number;      // Long-term macro cyclical trend (-1.0 to 1.0)
  globalTempAnomaly: number; // Active anomaly from trends/disasters/season
  globalRainAnomaly: number; // Active rainfall anomaly
  isDrought: boolean;
  droughtSeverity: number;   // 0.0 to 1.0
  activeDisasters: EnvironmentalDisaster[];
  disasterHistoryCount: number;
}

export interface TerrainCell {
  x: number;
  y: number;
  height: number;            // 0.0 (deep ocean) to 1.0 (mountain peaks)
  moisture: number;          // 0.0 (arid) to 1.0 (wetland)
  temperature: number;       // Celsius: -30 to 45
  rainfall: number;          // 0.0 to 1.0
  fertility: number;         // 0.0 to 1.0
  plantSuitability: number;  // 0.0 to 1.0
  biome: BiomeType;
  isWater: boolean;
  isWalkable: boolean;
  isRiver: boolean;
  isLake: boolean;
  flowDirection?: number;    // radians downhill
  isFlooded?: boolean;       // Temporarily submerged by flood disaster
  deterioration?: number;    // 0.0 to 1.0 habitat damage (charred fire, ash fallout, arid cracking)
  ashFertilityBoost?: number;// 0.0 to 1.0 mineral nutrient enrichment after fire/volcano
  burnedCooldown?: number;   // Ticks remaining before recovery begins
}

export interface TerrainMap {
  width: number;             // grid cells (256)
  height: number;            // grid cells (256)
  worldWidth: number;        // world spatial units (2560)
  worldHeight: number;       // world spatial units (2560)
  cellSize: number;          // 10
  cells: TerrainCell[];      // flat 1D array of 65536 cells
  deterioratedIndices?: Set<number>;
  modifiedIndices?: Set<number>;
}

export interface SimulationEvent {
  id: string;
  tick: number;
  timestamp: number;
  type:
    | 'world_genesis'
    | 'speciation'
    | 'extinction'
    | 'population_boom'
    | 'predator_takeover'
    | 'matriarch_record'
    | 'climate_shift'
    | 'bottleneck_survival'
    | 'wildfire_disaster'
    | 'drought_disaster'
    | 'flood_disaster'
    | 'volcano_disaster'
    | 'cold_snap'
    | 'ecosystem_recovery'
    | 'drought_extinction'
    | 'biosphere_collapse';
  title: string;
  description: string;
  highlightSpeciesId?: string;
  highlightOrganismId?: string;
  x?: number;
  y?: number;
  isMilestone?: boolean;
}

export interface EcosystemStats {
  tick: number;
  elapsedSeconds: number;
  totalOrganisms: number;
  herbivores: number;
  carnivores: number;
  scavengers: number;
  omnivores: number;
  speciesActiveCount: number;
  plantBiomass: number;
  organismBiomass: number;
  carrionBiomass: number;
  resourceScarcity: number; // 0.0 (abundant) to 1.0 (critical scarcity)
  totalBirths: number;
  totalDeaths: number;
  causesOfDeath: CauseOfDeathStats;
  energyLedger: EnergyAccountingLedger;
  traitAverages: PopulationTraitAverages;
  maxGeneration: number;
  oldestOrganismAgeTicks: number;
  oldestOrganismName?: string;
  diversity?: GeneticDiversityMetrics;
  oldestLineageAgeTicks?: number;
  oldestLineageName?: string;
  longestLivedSpeciesTicks?: number;
  longestLivedSpeciesName?: string;
  dominantSpeciesName?: string;
  dominantSpeciesShare?: number;
  climateAnomaly?: number;
  activeDisasterCount?: number;
  activeDisasterSummary?: string;
  totalHabitatDeterioration?: number;
  isDroughtActive?: boolean;
  fps?: number;
}

export interface SimulationSnapshot {
  tick: number;
  worldSeed: number;
  worldName: string;
  createdTimestamp: number;
  climate: ClimateState;
  organisms: OrganismState[];
  resources: ResourcePatch[];
  events: SimulationEvent[];
  species: SpeciesTaxon[];
  stats: EcosystemStats;
  mutationEvents: MutationEvent[];
  ancestryNodes?: SpeciesNode[];
  speciesRegistry?: SpeciesTaxon[];
}

export interface SavedWorldData {
  version: number;
  ecologyConfig?: import('../simulation/ecology/config.js').EcologyConfig;
  worldSeed: number;
  worldName: string;
  createdTimestamp: number;
  lastSavedTimestamp: number;
  lastSavedTick: number;
  terrainSeed: number;
  prngState?: number;
  disasterCooldowns?: {
    drought: number;
    wildfire: number;
    flood: number;
    volcanic_eruption: number;
    cold_snap: number;
  };
  maxObservedAge?: number;
  totalHabitatDeterioration?: number;
  biosphereExtinctLogged?: boolean;
  lastApexKills?: number;
  totalDeathAgeTicks?: number;
  archivedEventsCount?: number;
  nextEventId?: number;
  terrainPatches?: Array<{ index: number; fertility: number; plantSuitability: number; isFlooded?: boolean; deterioration?: number; ashFertilityBoost?: number; burnedCooldown?: number }>;
  calendar?: {
    year: number;
    dayOfYear: number;
    season: 'spring' | 'summer' | 'autumn' | 'winter';
    dayCycle: number;
    timeOfDay: string;
  };
  climate: ClimateState;
  organisms: OrganismState[];
  resources: ResourcePatch[];
  events: SimulationEvent[];
  species: SpeciesTaxon[];
  stats: EcosystemStats;
  mutationEvents?: MutationEvent[];
  ancestryNodes?: SpeciesNode[];
  speciesRegistry?: SpeciesTaxon[];
}

export type WorkerToMainMessage =
  | { type: 'READY'; worldSeed: number; worldName: string; terrainMap: TerrainMap; snapshot: SimulationSnapshot }
  | { type: 'SNAPSHOT'; snapshot: SimulationSnapshot }
  | { type: 'SAVED'; tick: number }
  | { type: 'ERROR'; message: string };

export type MainToWorkerMessage =
  | { type: 'INIT'; savedData?: SavedWorldData; initialSeed?: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'SET_SPEED'; speedMultiplier: number }
  | { type: 'REQUEST_SAVE' };
