/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SimulationEvent } from '../../types/simulation.js';

const MILESTONE_TYPES: ReadonlySet<SimulationEvent['type']> = new Set([
  'world_genesis',
  'speciation',
  'extinction',
  'matriarch_record',
  'bottleneck_survival',
  'predator_takeover',
  'climate_shift',
  'wildfire_disaster',
  'drought_disaster',
  'flood_disaster',
  'volcano_disaster',
  'cold_snap',
  'ecosystem_recovery',
  'drought_extinction',
  'biosphere_collapse',
]);

/**
 * Event Chronicle with memory safeguards.
 * Compacts low-importance / ephemeral events while strictly preserving
 * major milestones (speciation, extinction, genesis) and their exact simulation ticks.
 */
export class EventChronicle {
  private events: SimulationEvent[] = [];
  private maxEphemeral: number;
  private maxMilestones: number;
  private archivedEventsCount = 0;

  constructor(maxEphemeral = 60, maxMilestones = 180) {
    this.maxEphemeral = maxEphemeral;
    this.maxMilestones = maxMilestones;
  }

  addEvent(
    type: SimulationEvent['type'],
    title: string,
    description: string,
    tick: number,
    extra?: {
      highlightSpeciesId?: string;
      highlightOrganismId?: string;
      x?: number;
      y?: number;
      isMilestone?: boolean;
    }
  ): SimulationEvent {
    const isMilestone = extra?.isMilestone ?? MILESTONE_TYPES.has(type);

    const event: SimulationEvent = {
      id: `evt_${tick}_${Math.random().toString(36).slice(2, 7)}`,
      tick,
      timestamp: Date.now(),
      type,
      title,
      description,
      highlightSpeciesId: extra?.highlightSpeciesId,
      highlightOrganismId: extra?.highlightOrganismId,
      x: extra?.x,
      y: extra?.y,
      isMilestone,
    };

    this.events.unshift(event);
    this.compactHistory();

    return event;
  }

  /**
   * Safeguard against unbounded memory growth:
   * Prunes ephemeral low-importance events first while preserving major milestone events.
   */
  compactHistory(): void {
    const milestones: SimulationEvent[] = [];
    const ephemeral: SimulationEvent[] = [];

    for (let i = 0; i < this.events.length; i++) {
      if (this.events[i].isMilestone) {
        milestones.push(this.events[i]);
      } else {
        ephemeral.push(this.events[i]);
      }
    }

    let prunedCount = 0;

    // Prune ephemeral events exceeding limit
    if (ephemeral.length > this.maxEphemeral) {
      prunedCount += ephemeral.length - this.maxEphemeral;
      ephemeral.length = this.maxEphemeral;
    }

    // Prune milestones only if they exceed safe upper bound
    if (milestones.length > this.maxMilestones) {
      // Prioritize preserving genesis, speciations, and extinctions
      const critical = milestones.filter(
        (e) => e.type === 'world_genesis' || e.type === 'speciation' || e.type === 'extinction'
      );
      const otherMilestones = milestones.filter(
        (e) => e.type !== 'world_genesis' && e.type !== 'speciation' && e.type !== 'extinction'
      );

      const keepOther = Math.max(0, this.maxMilestones - critical.length);
      prunedCount += Math.max(0, otherMilestones.length - keepOther);
      otherMilestones.length = Math.min(otherMilestones.length, keepOther);

      milestones.length = 0;
      milestones.push(...critical, ...otherMilestones);
      milestones.sort((a, b) => b.tick - a.tick);
    }

    this.archivedEventsCount += prunedCount;

    // Recombine sorted by tick descending
    const combined = [...milestones, ...ephemeral];
    combined.sort((a, b) => b.tick - a.tick);
    this.events = combined;
  }

  getRecentEvents(count = 20): SimulationEvent[] {
    return this.events.slice(0, count);
  }

  getMilestoneEvents(): SimulationEvent[] {
    return this.events.filter((e) => e.isMilestone);
  }

  getAllEvents(): SimulationEvent[] {
    return [...this.events];
  }

  getArchivedEventsCount(): number {
    return this.archivedEventsCount;
  }

  restoreEvents(events: SimulationEvent[]): void {
    this.events = events.slice();
    this.compactHistory();
  }
}
