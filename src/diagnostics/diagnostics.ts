/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SimulationSnapshot } from '../types/simulation.js';

export interface EcologicalHealthReport {
  shannonDiversityIndex: number;
  trophicBalanceRatio: number; // herbivore to carnivore ratio
  totalLivingEntities: number;
  averageEnergy: number;
  isStable: boolean;
}

export function evaluateEcologicalHealth(snapshot: SimulationSnapshot): EcologicalHealthReport {
  const orgs = snapshot.organisms;
  const total = orgs.length;

  if (total === 0) {
    return {
      shannonDiversityIndex: 0,
      trophicBalanceRatio: 0,
      totalLivingEntities: 0,
      averageEnergy: 0,
      isStable: false,
    };
  }

  // Calculate species distribution and Shannon diversity index: H = - sum(p_i * ln(p_i))
  const speciesCounts = new Map<string, number>();
  let totalEnergy = 0;
  let herbivores = 0;
  let carnivores = 0;

  for (let i = 0; i < total; i++) {
    const o = orgs[i];
    speciesCounts.set(o.speciesId, (speciesCounts.get(o.speciesId) || 0) + 1);
    totalEnergy += o.energy;
    if (o.genome.diet === 'herbivore') herbivores++;
    else if (o.genome.diet === 'carnivore') carnivores++;
  }

  let shannon = 0;
  for (const count of speciesCounts.values()) {
    const p = count / total;
    if (p > 0) {
      shannon -= p * Math.log(p);
    }
  }

  const trophicRatio = carnivores > 0 ? herbivores / carnivores : herbivores;
  const avgEnergy = totalEnergy / total;
  const isStable = total >= 15 && avgEnergy > 20 && shannon > 0.4;

  return {
    shannonDiversityIndex: Math.round(shannon * 100) / 100,
    trophicBalanceRatio: Math.round(trophicRatio * 10) / 10,
    totalLivingEntities: total,
    averageEnergy: Math.round(avgEnergy),
    isStable,
  };
}
