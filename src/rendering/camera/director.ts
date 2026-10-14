/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OrganismState,
  SimulationSnapshot,
  TerrainMap,
  SimulationEvent,
} from '../../types/simulation.js';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface FocusSubject {
  id: string | null;
  name: string;
  type:
    | 'speciation'
    | 'extinction'
    | 'predator_prey'
    | 'migration'
    | 'population_crisis'
    | 'ecological_recovery'
    | 'disaster'
    | 'rare_mutation'
    | 'matriarch'
    | 'scenic';
  description: string;
}

interface ScoredCandidate {
  score: number;
  subject: FocusSubject;
  targetX: number;
  targetY: number;
  targetZoom: number;
  organismId?: string;
  secondaryOrganismId?: string;
}

export class CameraDirector {
  public current: CameraState;
  public target: CameraState;
  public subject: FocusSubject = {
    id: null,
    name: 'Planetary Vista',
    type: 'scenic',
    description: 'Autonomous natural equilibrium across global biomes.',
  };
  public isManualControl = false;

  private lastManualInteractionTime = 0;
  private switchSubjectTimer = 0;
  private readonly minDwellDuration = 13.0; // Minimum seconds to remain on an event to be understood
  private currentTrackedOrganismId: string | null = null;
  private currentSecondaryOrganismId: string | null = null;
  private migrationOrigins = new Map<string, { x: number; y: number }>();
  private lastWorldSeed: number | null = null;
  private lastSnapshotTick = -1;

  // Scenic waypoints for rotating planetary overviews
  private scenicWaypoints: Array<{ x: number; y: number; zoom: number; name: string; desc: string }> = [];
  private currentScenicIndex = 0;

  constructor(worldWidth: number, worldHeight: number) {
    this.current = {
      x: worldWidth / 2,
      y: worldHeight / 2,
      zoom: 0.85,
    };
    this.target = { ...this.current };

    // Initialize scenic vantage points across the world
    this.scenicWaypoints = [
      {
        x: worldWidth * 0.5,
        y: worldHeight * 0.5,
        zoom: 0.75,
        name: 'Central Vista',
        desc: 'A wide view of the current world.',
      },
      {
        x: worldWidth * 0.28,
        y: worldHeight * 0.32,
        zoom: 0.82,
        name: 'Northwestern Vista',
        desc: 'A wide view of the northwestern terrain.',
      },
      {
        x: worldWidth * 0.72,
        y: worldHeight * 0.72,
        zoom: 0.8,
        name: 'Southeastern Vista',
        desc: 'A wide view of the southeastern terrain.',
      },
      {
        x: worldWidth * 0.75,
        y: worldHeight * 0.25,
        zoom: 0.85,
        name: 'Northeastern Vista',
        desc: 'A wide view of the northeastern terrain.',
      },
    ];
  }

  public notifyManualInteraction(): void {
    this.isManualControl = true;
    this.lastManualInteractionTime = Date.now();
  }

  public resumeCinematic(): void {
    this.isManualControl = false;
    this.switchSubjectTimer = this.minDwellDuration; // Trigger fresh cinematic evaluation
  }

  public update(
    dtSeconds: number,
    snapshot: SimulationSnapshot,
    terrain: TerrainMap
  ): void {
    const now = Date.now();
    if (this.lastWorldSeed !== snapshot.worldSeed || snapshot.tick < this.lastSnapshotTick) {
      this.migrationOrigins.clear();
    }
    this.lastWorldSeed = snapshot.worldSeed;
    this.lastSnapshotTick = snapshot.tick;
    for (const organism of snapshot.organisms) {
      if (!this.migrationOrigins.has(organism.id)) {
        this.migrationOrigins.set(organism.id, { x: organism.x, y: organism.y });
      }
    }
    const livingIds = new Set(snapshot.organisms.map((organism) => organism.id));
    for (const id of this.migrationOrigins.keys()) {
      if (!livingIds.has(id)) this.migrationOrigins.delete(id);
    }

    // Auto-resume autonomous director after 6 seconds of spectator inactivity
    if (this.isManualControl && now - this.lastManualInteractionTime > 6000) {
      this.isManualControl = false;
      this.switchSubjectTimer = 0;
    }

    if (!this.isManualControl) {
      this.switchSubjectTimer += dtSeconds;

      // Check if tracked organism is still alive
      let trackedOrg: OrganismState | undefined;
      if (this.currentTrackedOrganismId) {
        trackedOrg = snapshot.organisms.find(
          (o) => o.id === this.currentTrackedOrganismId && o.state !== 'dead'
        );
      }

      // If dwell duration expired or current subject perished, select next highest-scoring event
      if (this.switchSubjectTimer >= this.minDwellDuration || (!trackedOrg && this.subject.type !== 'scenic')) {
        this.switchSubjectTimer = 0;
        this.evaluateAndSelectBestEvent(snapshot, terrain);

        if (this.currentTrackedOrganismId) {
          trackedOrg = snapshot.organisms.find((o) => o.id === this.currentTrackedOrganismId);
        }
      }

      // Dynamic tracking with soft camera damping
      if (trackedOrg) {
        // If tracking an encounter between hunter and prey, center on midpoint
        if (this.currentSecondaryOrganismId) {
          const secondOrg = snapshot.organisms.find(
            (o) => o.id === this.currentSecondaryOrganismId && o.state !== 'dead'
          );
          if (secondOrg) {
            this.target.x = (trackedOrg.x + secondOrg.x) / 2;
            this.target.y = (trackedOrg.y + secondOrg.y) / 2;
          } else {
            this.target.x = trackedOrg.x;
            this.target.y = trackedOrg.y;
            this.currentSecondaryOrganismId = null;
          }
        } else {
          this.target.x = trackedOrg.x;
          this.target.y = trackedOrg.y;
        }
      }
    }

    // Ultra-smooth critically damped interpolation (avoids jerky camera movement)
    const lerpRate = this.isManualControl ? 0.22 : 0.042;
    this.current.x += (this.target.x - this.current.x) * lerpRate;
    this.current.y += (this.target.y - this.current.y) * lerpRate;
    this.current.zoom += (this.target.zoom - this.current.zoom) * (lerpRate * 0.75);
  }

  /**
   * Event Scoring Algorithm:
   * Prioritizes:
   * 1. Major extinctions (score 100)
   * 2. Birth of new species (score 95)
   * 3. Important predator-prey encounters (score 85)
   * 4. Rare mutations with significant consequences (score 80)
   * 5. Population crises (score 75)
   * 6. Ecological recoveries (score 70)
   * 7. Large migrations (score 65)
   * 8. Ancient matriarchs (score 50)
   * 9. Scenic planetary overviews (score 35)
   */
  private evaluateAndSelectBestEvent(
    snapshot: SimulationSnapshot,
    terrain: TerrainMap
  ): void {
    const candidates: ScoredCandidate[] = [];
    const organisms = snapshot.organisms;
    const recentEvents = snapshot.events.slice(0, 8);
    const activeDisasters = snapshot.climate.activeDisasters || [];

    // 1. Major Extinctions (within last 120 ticks)
    const recentExtinction = recentEvents.find(
      (e) =>
        (e.type === 'extinction' || e.type === 'drought_extinction') &&
        snapshot.stats.tick - e.tick < 150
    );
    if (recentExtinction) {
      candidates.push({
        score: 100,
        subject: {
          id: recentExtinction.id,
          name: recentExtinction.title,
          type: 'extinction',
          description: recentExtinction.description,
        },
        targetX: recentExtinction.x ?? this.current.x,
        targetY: recentExtinction.y ?? this.current.y,
        targetZoom: 0.95,
      });
    }

    // 2. Birth of New Species (speciation event)
    const recentSpeciation = recentEvents.find(
      (e) => e.type === 'speciation' && snapshot.stats.tick - e.tick < 200
    );
    if (recentSpeciation) {
      const founderOrg = organisms.find(
        (o) => o.speciesId === recentSpeciation.highlightSpeciesId && o.state !== 'dead'
      );
      if (founderOrg) {
        candidates.push({
          score: 95,
          subject: {
            id: founderOrg.id,
            name: `Founder of ${founderOrg.speciesName}`,
            type: 'speciation',
            description: recentSpeciation.description,
          },
          targetX: founderOrg.x,
          targetY: founderOrg.y,
          targetZoom: 1.45,
          organismId: founderOrg.id,
        });
      }
    }

    // 3. Important Predator-Prey Encounters
    for (let i = 0; i < organisms.length; i++) {
      const hunter = organisms[i];
      if (hunter.state === 'hunting' && hunter.genome.diet === 'carnivore') {
        // Find fleeing or nearby prey
        for (let j = 0; j < organisms.length; j++) {
          if (i === j) continue;
          const prey = organisms[j];
          if (prey.id === hunter.targetId && prey.speciesId !== hunter.speciesId && prey.state !== 'dead') {
            const dist = Math.hypot(hunter.x - prey.x, hunter.y - prey.y);
            if (dist < 85) {
              candidates.push({
                score: 85 + (prey.state === 'fleeing' ? 5 : 0),
                subject: {
                  id: hunter.id,
                  name: `Predation: ${hunter.speciesName} pursuing ${prey.speciesName}`,
                  type: 'predator_prey',
                  description: `Active hunt encounter in progress at close range.`,
                },
                targetX: (hunter.x + prey.x) / 2,
                targetY: (hunter.y + prey.y) / 2,
                targetZoom: 1.35,
                organismId: hunter.id,
                secondaryOrganismId: prey.id,
              });
              break;
            }
          }
        }
      }
    }

    // 4. Rare Mutations with Significant Consequences
    if (snapshot.mutationEvents && snapshot.mutationEvents.length > 0) {
      const recentMutations = snapshot.mutationEvents.slice(-60);
      const significantMutation = recentMutations.find((m) =>
        Math.abs(m.delta) > 0.22 && organisms.some((o) =>
          o.id === m.offspringId && o.offspringCount >= 2
        )
      );
      if (significantMutation) {
        const mutatedOrg = organisms.find(
          (o) => o.id === significantMutation.offspringId && o.state !== 'dead'
        );
        if (mutatedOrg) {
          candidates.push({
            score: 70,
            subject: {
              id: mutatedOrg.id,
              name: `Reproductive Mutation: ${mutatedOrg.speciesName}`,
              type: 'rare_mutation',
              description: `A ${significantMutation.traitName} mutation of ${significantMutation.delta.toFixed(2)} was recorded in an organism that later had ${mutatedOrg.offspringCount} offspring.`,
            },
            targetX: mutatedOrg.x,
            targetY: mutatedOrg.y,
            targetZoom: 1.4,
            organismId: mutatedOrg.id,
          });
        }
      }
    }

    // 5. Population Crises (Species with only 1-3 surviving members)
    for (let s = 0; s < snapshot.species.length; s++) {
      const taxon = snapshot.species[s];
      if (!taxon.extinct && taxon.aliveCount > 0 && taxon.aliveCount <= 3) {
        const survivor = organisms.find((o) => o.speciesId === taxon.id && o.state !== 'dead');
        if (survivor) {
          candidates.push({
            score: 80,
            subject: {
              id: survivor.id,
              name: `Vulnerable Lineage: ${taxon.name}`,
              type: 'population_crisis',
              description: `Only ${taxon.aliveCount} surviving individuals remain of this lineage.`,
            },
            targetX: survivor.x,
            targetY: survivor.y,
            targetZoom: 1.35,
            organismId: survivor.id,
          });
          break;
        }
      }
    }

    // 6. Ecological Recoveries & Active Disasters
    const recoveryEvent = recentEvents.find(
      (e) => e.type === 'ecosystem_recovery' && snapshot.stats.tick - e.tick < 200
    );
    if (recoveryEvent) {
      candidates.push({
        score: 75,
        subject: {
          id: recoveryEvent.id,
          name: recoveryEvent.title,
          type: 'ecological_recovery',
          description: recoveryEvent.description,
        },
        targetX: recoveryEvent.x ?? terrain.worldWidth / 2,
        targetY: recoveryEvent.y ?? terrain.worldHeight / 2,
        targetZoom: 0.9,
      });
    }

    if (activeDisasters.length > 0) {
      const d = activeDisasters[0];
      candidates.push({
        score: 68,
        subject: {
          id: d.id,
          name: d.name,
          type: 'disaster',
          description: `Catastrophic environmental event affecting local habitats.`,
        },
        targetX: d.x,
        targetY: d.y,
        targetZoom: 1.05,
      });
    }

    // 7. Large Migrations (3+ organisms moving coherently with high velocity)
    if (organisms.length >= 4) {
      for (let i = 0; i < organisms.length; i += 3) {
        const orgA = organisms[i];
        const originA = this.migrationOrigins.get(orgA.id);
        const travelAX = originA ? orgA.x - originA.x : 0;
        const travelAY = originA ? orgA.y - originA.y : 0;
        const travelA = Math.hypot(travelAX, travelAY);
        if (travelA > 90 && Math.hypot(orgA.vx, orgA.vy) > 1.2) {
          // Check nearby comrades moving in same direction
          let coherentCount = 1;
          let avgX = orgA.x;
          let avgY = orgA.y;
          for (let j = 0; j < organisms.length; j++) {
            if (i === j) continue;
            const orgB = organisms[j];
            const dist = Math.hypot(orgA.x - orgB.x, orgA.y - orgB.y);
            const originB = this.migrationOrigins.get(orgB.id);
            const travelBX = originB ? orgB.x - originB.x : 0;
            const travelBY = originB ? orgB.y - originB.y : 0;
            const travelB = Math.hypot(travelBX, travelBY);
            if (dist < 140 && orgB.speciesId === orgA.speciesId && travelB > 90) {
              const dot = (travelAX * travelBX + travelAY * travelBY) / (travelA * travelB);
              if (dot > 0.6) {
                coherentCount++;
                avgX += orgB.x;
                avgY += orgB.y;
              }
            }
          }

          if (coherentCount >= 3) {
            candidates.push({
              score: 82,
              subject: {
                id: orgA.id,
                name: `Group Migration: ${orgA.speciesName}`,
                type: 'migration',
                description: `${coherentCount} members of one species have traveled more than 90 world units in a similar direction.`,
              },
              targetX: avgX / coherentCount,
              targetY: avgY / coherentCount,
              targetZoom: 1.05,
              organismId: orgA.id,
            });
            break;
          }
        }
      }
    }

    // 8. Ancient Matriarch / Oldest Elder Organism
    if (organisms.length > 0) {
      let oldest = organisms[0];
      for (let i = 1; i < organisms.length; i++) {
        if (organisms[i].age > oldest.age) oldest = organisms[i];
      }
      if (oldest.age > 400) {
        candidates.push({
          score: 50,
          subject: {
            id: oldest.id,
            name: `Elder Matriarch: ${oldest.speciesName}`,
            type: 'matriarch',
            description: `Persevered through ${Math.floor(oldest.age / 120)} seasons of planetary change.`,
          },
          targetX: oldest.x,
          targetY: oldest.y,
          targetZoom: 1.35,
          organismId: oldest.id,
        });
      }
    }

    // 9. Scenic Planetary Overviews (Fallback / Serene Panoramas)
    const wp = this.scenicWaypoints[this.currentScenicIndex % this.scenicWaypoints.length];
    candidates.push({
      score: 35,
      subject: {
        id: null,
        name: wp.name,
        type: 'scenic',
        description: wp.desc,
      },
      targetX: wp.x,
      targetY: wp.y,
      targetZoom: wp.zoom,
    });
    this.currentScenicIndex++;

    // Pick candidate with highest score
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates[0];

    this.subject = chosen.subject;
    this.target.x = chosen.targetX;
    this.target.y = chosen.targetY;
    this.target.zoom = chosen.targetZoom;
    this.currentTrackedOrganismId = chosen.organismId || null;
    this.currentSecondaryOrganismId = chosen.secondaryOrganismId || null;
    if (chosen.subject.type === 'migration') {
      for (const organism of organisms) {
        this.migrationOrigins.set(organism.id, { x: organism.x, y: organism.y });
      }
    }
  }

  public setManualPan(dx: number, dy: number): void {
    this.notifyManualInteraction();
    this.current.x -= dx / this.current.zoom;
    this.current.y -= dy / this.current.zoom;
    this.target.x = this.current.x;
    this.target.y = this.current.y;
  }

  public setManualZoom(
    delta: number,
    pivotX: number,
    pivotY: number,
    screenW: number,
    screenH: number
  ): void {
    this.notifyManualInteraction();
    const zoomFactor = delta < 0 ? 1.15 : 0.87;
    const newZoom = Math.max(0.45, Math.min(2.8, this.current.zoom * zoomFactor));

    const worldPivotX = this.current.x + (pivotX - screenW / 2) / this.current.zoom;
    const worldPivotY = this.current.y + (pivotY - screenH / 2) / this.current.zoom;

    this.current.zoom = newZoom;
    this.current.x = worldPivotX - (pivotX - screenW / 2) / newZoom;
    this.current.y = worldPivotY - (pivotY - screenH / 2) / newZoom;
    this.target.zoom = newZoom;
    this.target.x = this.current.x;
    this.target.y = this.current.y;
  }

  public focusOnOrganism(org: OrganismState): void {
    this.currentTrackedOrganismId = org.id;
    this.currentSecondaryOrganismId = null;
    this.target.x = org.x;
    this.target.y = org.y;
    this.target.zoom = 1.45;
    this.subject = {
      id: org.id,
      name: `${org.speciesName}`,
      type: 'matriarch',
      description: `Viewing organism from lineage ${org.speciesName}.`,
    };
    this.isManualControl = false;
    this.switchSubjectTimer = 0;
  }
}
