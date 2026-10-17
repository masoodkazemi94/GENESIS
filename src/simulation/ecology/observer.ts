import type { MutationEvent, OrganismState } from '../../types/simulation.js';

/** Optional, read-only hooks for headless ecological audits. */
export interface EcologyObserver {
  onDecision?(organism: OrganismState, observation: {
    foodType: 'plant' | 'prey' | 'carrion' | null;
    foodTargetId: string | null;
    foodDistance: number | null;
    foodContactRange: number | null;
    waterType: 'spring' | 'terrain_water' | null;
    waterDistance: number | null;
    mateDistance: number | null;
    canMate: boolean;
    action: string;
  }): void;
  onFeeding?(organism: OrganismState, food: 'plant' | 'prey' | 'carrion',
    success: boolean, energyGained: number, biomassConsumed?: number): void;
  onBirth?(child: OrganismState, divergence: number, mutations: readonly MutationEvent[]): void;
  onBirthBlocked?(reason: 'population_cap' | 'missing_taxon'): void;
  onDeath?(organism: OrganismState, cause: string): void;
  onMetabolism?(organism: OrganismState, energySpent: number, costs: {
    basal: number; movement: number; thermal: number; flood: number;
  }): void;
}
