/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DietType,
  GeneticDiversityMetrics,
  OrganismState,
  SpeciesNode,
  SpeciesTaxon,
} from '../../types/simulation.js';
import { calculateGeneticDistance } from '../genetics/genetics.js';

/**
 * Ancestry Tree Data Model & Historical Species Registry.
 *
 * Distinguishes species branches, ancestors, descendants, and extinct lineages.
 * Maintains stable IDs and tracks dominance, diversity, oldest surviving lineages,
 * and longest-lived species over evolutionary time.
 */
export class SpeciesAncestryTree {
  private nodes: Map<string, SpeciesNode> = new Map();

  constructor(initialNodes?: SpeciesNode[]) {
    if (initialNodes && Array.isArray(initialNodes)) {
      this.restore(initialNodes);
    }
  }

  /**
   * Registers a taxon into the phylogenetic ancestry tree.
   * If ancestorSpeciesId is provided, establishes directional branch linkage.
   */
  registerSpecies(
    taxon: SpeciesTaxon,
    ancestorSpeciesId?: string | null,
    divergenceScore?: number
  ): SpeciesNode {
    const existing = this.nodes.get(taxon.id);
    if (existing) {
      return existing;
    }

    const parentId = ancestorSpeciesId ?? taxon.ancestorSpeciesId ?? null;
    let branchDepth = taxon.lineageDepth ?? 0;

    if (parentId && this.nodes.has(parentId)) {
      const parentNode = this.nodes.get(parentId)!;
      if (!parentNode.descendantSpeciesIds.includes(taxon.id)) {
        parentNode.descendantSpeciesIds.push(taxon.id);
      }
      branchDepth = parentNode.branchDepth + 1;
    }

    const node: SpeciesNode = {
      id: taxon.id,
      name: taxon.name,
      commonName: taxon.commonName,
      diet: taxon.diet,
      colorHex: taxon.colorHex,
      founderId: taxon.founderId,
      ancestorSpeciesId: parentId,
      descendantSpeciesIds: [],
      foundingTick: taxon.foundingTick,
      extinctTick: taxon.extinctTick,
      isExtinct: taxon.extinct,
      branchDepth,
      generationPeak: taxon.generationPeak ?? 1,
      totalOrganismsCount: taxon.totalHistoricalCount ?? 1,
      aliveOrganismsCount: taxon.aliveCount ?? 1,
      divergenceScore: divergenceScore ?? taxon.divergenceScore ?? 0,
    };

    this.nodes.set(node.id, node);
    return node;
  }

  /**
   * Records an organism birth for population tracking.
   */
  recordBirth(speciesId: string, generation = 1): void {
    const node = this.nodes.get(speciesId);
    if (node) {
      node.aliveOrganismsCount += 1;
      node.totalOrganismsCount += 1;
      node.generationPeak = Math.max(node.generationPeak, generation);
      if (node.isExtinct && node.aliveOrganismsCount > 0) {
        node.isExtinct = false;
        node.extinctTick = null;
      }
    }
  }

  /**
   * Records an organism mortality and detects lineage extinction.
   * Returns true if this death resulted in complete species extinction.
   */
  recordDeath(speciesId: string, tick: number): boolean {
    const node = this.nodes.get(speciesId);
    if (!node) return false;

    node.aliveOrganismsCount = Math.max(0, node.aliveOrganismsCount - 1);

    if (node.aliveOrganismsCount === 0 && !node.isExtinct) {
      node.isExtinct = true;
      node.extinctTick = tick;
      return true;
    }

    return false;
  }

  getNode(speciesId: string): SpeciesNode | undefined {
    return this.nodes.get(speciesId);
  }

  getAllNodes(): SpeciesNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Returns root species with no ancestors (founding eon lineages).
   */
  getRootSpecies(): SpeciesNode[] {
    return this.getAllNodes().filter((n) => n.ancestorSpeciesId === null);
  }

  /**
   * Returns currently living (non-extinct) species with active populations.
   */
  getLivingSpecies(): SpeciesNode[] {
    return this.getAllNodes().filter((n) => !n.isExtinct && n.aliveOrganismsCount > 0);
  }

  /**
   * Returns all extinct species that have vanished from the world.
   */
  getExtinctSpecies(): SpeciesNode[] {
    return this.getAllNodes().filter((n) => n.isExtinct || n.aliveOrganismsCount === 0);
  }

  /**
   * Traverses upward from species to root ancestor lineage.
   * Returns array ordered from immediate parent to root.
   */
  getAncestors(speciesId: string): SpeciesNode[] {
    const ancestors: SpeciesNode[] = [];
    const visited = new Set<string>();
    let curr = this.nodes.get(speciesId);

    while (curr && curr.ancestorSpeciesId && !visited.has(curr.ancestorSpeciesId)) {
      visited.add(curr.ancestorSpeciesId);
      const parent = this.nodes.get(curr.ancestorSpeciesId);
      if (parent) {
        ancestors.push(parent);
        curr = parent;
      } else {
        break;
      }
    }

    return ancestors;
  }

  /**
   * Traverses downward to collect all descendant branches originating from this species.
   */
  getDescendants(speciesId: string): SpeciesNode[] {
    const descendants: SpeciesNode[] = [];
    const queue = [speciesId];
    const visited = new Set<string>([speciesId]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currNode = this.nodes.get(currentId);
      if (!currNode) continue;

      for (const childId of currNode.descendantSpeciesIds) {
        if (!visited.has(childId)) {
          visited.add(childId);
          const childNode = this.nodes.get(childId);
          if (childNode) {
            descendants.push(childNode);
            queue.push(childId);
          }
        }
      }
    }

    return descendants;
  }

  /**
   * Tracks the oldest surviving lineage (the living species founded earliest).
   */
  getOldestSurvivingLineage(currentTick: number): {
    speciesId: string;
    name: string;
    commonName: string;
    ageTicks: number;
    foundingTick: number;
  } | null {
    const living = this.getLivingSpecies();
    if (living.length === 0) return null;

    let oldest = living[0];
    for (let i = 1; i < living.length; i++) {
      if (living[i].foundingTick < oldest.foundingTick) {
        oldest = living[i];
      }
    }

    return {
      speciesId: oldest.id,
      name: oldest.name,
      commonName: oldest.commonName,
      ageTicks: Math.max(0, currentTick - oldest.foundingTick),
      foundingTick: oldest.foundingTick,
    };
  }

  /**
   * Tracks the longest-lived species across historical time
   * (for extinct species: lifespan = extinctTick - foundingTick;
   *  for living species: lifespan = currentTick - foundingTick).
   */
  getLongestLivedSpecies(currentTick: number): {
    speciesId: string;
    name: string;
    commonName: string;
    lifespanTicks: number;
    isExtinct: boolean;
  } | null {
    const all = this.getAllNodes();
    if (all.length === 0) return null;

    let longest = all[0];
    let maxLifespan = longest.isExtinct
      ? (longest.extinctTick ?? currentTick) - longest.foundingTick
      : currentTick - longest.foundingTick;

    for (let i = 1; i < all.length; i++) {
      const node = all[i];
      const lifespan = node.isExtinct
        ? (node.extinctTick ?? currentTick) - node.foundingTick
        : currentTick - node.foundingTick;

      if (lifespan > maxLifespan) {
        maxLifespan = lifespan;
        longest = node;
      }
    }

    return {
      speciesId: longest.id,
      name: longest.name,
      commonName: longest.commonName,
      lifespanTicks: Math.max(0, maxLifespan),
      isExtinct: longest.isExtinct,
    };
  }

  /**
   * Dominant species metrics (the most populous active species).
   */
  getDominantSpecies(): {
    speciesId: string;
    name: string;
    commonName: string;
    aliveCount: number;
    dominanceShare: number;
  } | null {
    const living = this.getLivingSpecies();
    if (living.length === 0) return null;

    let totalLiving = 0;
    let dominant = living[0];

    for (const node of living) {
      totalLiving += node.aliveOrganismsCount;
      if (node.aliveOrganismsCount > dominant.aliveOrganismsCount) {
        dominant = node;
      }
    }

    const dominanceShare = totalLiving > 0 ? dominant.aliveOrganismsCount / totalLiving : 0;

    return {
      speciesId: dominant.id,
      name: dominant.name,
      commonName: dominant.commonName,
      aliveCount: dominant.aliveOrganismsCount,
      dominanceShare: Math.round(dominanceShare * 1000) / 1000,
    };
  }

  /**
   * Calculates comprehensive ecological and genetic diversity metrics:
   * - Shannon-Wiener Diversity Index: H' = - sum(p_i * ln(p_i))
   * - Simpson Diversity Index: D = 1 - sum(p_i^2)
   * - Dominant species share
   * - Average pairwise genetic distance across living sample
   */
  computeGeneticDiversity(
    livingOrganisms: OrganismState[],
    currentTick = 0
  ): GeneticDiversityMetrics {
    const totalLiving = livingOrganisms.length;
    const allHistorical = this.getAllNodes();

    if (totalLiving === 0) {
      return {
        shannonIndex: 0,
        simpsonIndex: 0,
        dominantSpeciesId: '',
        dominantSpeciesName: 'None',
        dominantSpeciesCommonName: 'None',
        dominantSpeciesCount: 0,
        dominantSpeciesShare: 0,
        averagePairwiseDistance: 0,
        activeSpeciesCount: 0,
        totalHistoricalSpeciesCount: allHistorical.length,
        oldestSurvivingLineage: null,
        longestLivedSpecies: this.getLongestLivedSpecies(currentTick),
      };
    }

    // Count living organisms by species
    const speciesCounts = new Map<string, number>();
    for (let i = 0; i < totalLiving; i++) {
      const spId = livingOrganisms[i].speciesId;
      speciesCounts.set(spId, (speciesCounts.get(spId) || 0) + 1);
    }

    let shannon = 0;
    let simpsonSum = 0;
    let domId = '';
    let maxCount = 0;

    for (const [spId, count] of speciesCounts.entries()) {
      const p = count / totalLiving;
      if (p > 0) {
        shannon -= p * Math.log(p);
        simpsonSum += p * p;
      }
      if (count > maxCount) {
        maxCount = count;
        domId = spId;
      }
    }

    const simpson = Math.max(0, 1 - simpsonSum);
    const domNode = this.nodes.get(domId);

    // Compute average pairwise genetic distance on a bounded sample (up to 32 organisms)
    let pairwiseSum = 0;
    let pairCount = 0;
    const sampleSize = Math.min(32, totalLiving);
    const step = Math.max(1, Math.floor(totalLiving / sampleSize));
    const sample: OrganismState[] = [];

    for (let i = 0; i < totalLiving && sample.length < sampleSize; i += step) {
      sample.push(livingOrganisms[i]);
    }

    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) {
        pairwiseSum += calculateGeneticDistance(sample[i].genome, sample[j].genome);
        pairCount += 1;
      }
    }

    const avgPairwise = pairCount > 0 ? pairwiseSum / pairCount : 0;

    return {
      shannonIndex: Math.round(shannon * 1000) / 1000,
      simpsonIndex: Math.round(simpson * 1000) / 1000,
      dominantSpeciesId: domId,
      dominantSpeciesName: domNode?.name ?? 'Unknown',
      dominantSpeciesCommonName: domNode?.commonName ?? 'Unknown',
      dominantSpeciesCount: maxCount,
      dominantSpeciesShare: Math.round((maxCount / totalLiving) * 1000) / 1000,
      averagePairwiseDistance: Math.round(avgPairwise * 1000) / 1000,
      activeSpeciesCount: speciesCounts.size,
      totalHistoricalSpeciesCount: allHistorical.length,
      oldestSurvivingLineage: this.getOldestSurvivingLineage(currentTick),
      longestLivedSpecies: this.getLongestLivedSpecies(currentTick),
    };
  }

  serialize(): SpeciesNode[] {
    return Array.from(this.nodes.values());
  }

  restore(nodes: SpeciesNode[]): void {
    this.nodes.clear();
    for (const node of nodes) {
      this.nodes.set(node.id, { ...node, descendantSpeciesIds: [...(node.descendantSpeciesIds || [])] });
    }
  }
}
