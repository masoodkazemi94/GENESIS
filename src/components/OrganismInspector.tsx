/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { OrganismState } from '../types/simulation.js';

interface OrganismInspectorProps {
  organism: OrganismState | null;
  onClose: () => void;
}

export const OrganismInspector: React.FC<OrganismInspectorProps> = ({ organism, onClose }) => {
  if (!organism) return null;

  const {
    id,
    parentAId,
    parentBId,
    genome,
    age,
    maxAge,
    isMature,
    reproductiveCooldown,
    energy,
    hydration,
    health,
    generation,
    offspringCount,
    kills,
    state,
    targetType,
    collisionRadius,
    x,
    y,
    vx,
    vy,
  } = organism;

  const dietCapitalized = genome.diet.charAt(0).toUpperCase() + genome.diet.slice(1);
  const lifeProgress = Math.min(100, Math.round((age / (maxAge || 1)) * 100));
  const speed = Math.hypot(vx, vy);

  // Format behavior state for clean display
  const behaviorDisplay = state.replace(/_/g, ' ');

  return (
    <div className="absolute top-20 right-6 w-96 max-h-[calc(100vh-6rem)] overflow-y-auto bg-black/65 backdrop-blur-md border border-white/10 rounded-xl p-5 shadow-2xl text-white select-none z-20 font-sans">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-mono text-white/50 tracking-wider uppercase">
            Autonomous Organism
          </div>
          <h2 className="text-base font-semibold text-white/95 mt-0.5">
            {organism.speciesName}
          </h2>
          <div className="text-xs text-white/60 italic font-mono">
            Gen {generation} · {dietCapitalized} · {isMature ? 'Mature' : 'Juvenile'}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white text-lg leading-none p-1 cursor-pointer transition-colors"
          aria-label="Close details"
        >
          ×
        </button>
      </div>

      {/* Current Autonomous Decision */}
      <div className="mt-3.5 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-mono">
        <div className="flex justify-between items-center text-white/80">
          <span className="text-white/40 uppercase tracking-wider text-[10px]">Active Behavior</span>
          <span className="text-emerald-400 capitalize font-medium">{behaviorDisplay}</span>
        </div>
        <div className="flex justify-between items-center text-white/70 mt-1">
          <span className="text-white/40 uppercase tracking-wider text-[10px]">Target Intent</span>
          <span className="capitalize text-white/90">
            {targetType !== 'none' ? targetType : 'Self / Territory'}
          </span>
        </div>
        {reproductiveCooldown > 0 && (
          <div className="flex justify-between items-center text-white/50 mt-1 text-[11px]">
            <span>Reproductive Cooldown</span>
            <span className="tabular-nums">{reproductiveCooldown} ticks</span>
          </div>
        )}
      </div>

      {/* Vital Gauges */}
      <div className="mt-4 space-y-2.5 text-xs font-mono">
        <div>
          <div className="flex justify-between text-white/70 mb-1">
            <span>Energy (Metabolic Reserve)</span>
            <span className="tabular-nums">{Math.round(energy)}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, energy))}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-white/70 mb-1">
            <span>Hydration</span>
            <span className="tabular-nums">{Math.round(hydration)}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-400 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, hydration))}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-white/70 mb-1">
            <span>Vigor & Health</span>
            <span className="tabular-nums">{Math.round(health)}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, health))}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-white/50 mb-1">
            <span>Age & Senescence ({age} / {maxAge}t)</span>
            <span className="tabular-nums">{lifeProgress}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-400 transition-all duration-300"
              style={{ width: `${lifeProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Evolutionary Genome Traits */}
      <div className="mt-4 pt-3 border-t border-white/10">
        <div className="text-xs uppercase tracking-wider text-white/50 mb-2 font-mono">
          Inherited Genome Traits (10 Loci)
        </div>
        <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 text-xs font-mono text-white/75">
          <div>
            <span className="text-white/40">Speed: </span>
            <span className="tabular-nums font-medium text-white/90">{(genome.speed || genome.maxSpeed).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-white/40">Body Size: </span>
            <span className="tabular-nums font-medium text-white/90">{(genome.bodySize || genome.size).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-white/40">Vision: </span>
            <span className="tabular-nums font-medium text-white/90">{Math.round(genome.visionRange || genome.sensoryRadius)}u</span>
          </div>
          <div>
            <span className="text-white/40">Metab Effic: </span>
            <span className="tabular-nums font-medium text-white/90">{genome.metabolicEfficiency ? genome.metabolicEfficiency.toFixed(2) : '1.00'}</span>
          </div>
          <div>
            <span className="text-white/40">Repro Invest: </span>
            <span className="tabular-nums font-medium text-white/90">{genome.reproductiveInvestment ? `${Math.round(genome.reproductiveInvestment * 100)}%` : '50%'}</span>
          </div>
          <div>
            <span className="text-white/40">Camouflage: </span>
            <span className="tabular-nums font-medium text-white/90">{genome.camouflage !== undefined ? `${Math.round(genome.camouflage * 100)}%` : '0%'}</span>
          </div>
          <div>
            <span className="text-white/40">Aggression: </span>
            <span className="tabular-nums font-medium text-white/90">{genome.aggression !== undefined ? `${Math.round(genome.aggression * 100)}%` : `${Math.round(genome.bravery * 100)}%`}</span>
          </div>
          <div>
            <span className="text-white/40">Food Effic: </span>
            <span className="tabular-nums font-medium text-white/90">{genome.foodProcessingEfficiency ? genome.foodProcessingEfficiency.toFixed(2) : '1.00'}</span>
          </div>
          <div>
            <span className="text-white/40">Heat Tol: </span>
            <span className="tabular-nums font-medium text-amber-300">{genome.heatTolerance ? `${Math.round(genome.heatTolerance)}°C` : '30°C'}</span>
          </div>
          <div>
            <span className="text-white/40">Cold Tol: </span>
            <span className="tabular-nums font-medium text-sky-300">{genome.coldTolerance ? `${Math.round(genome.coldTolerance)}°C` : '0°C'}</span>
          </div>
        </div>
      </div>

      {/* Kinematics & Space */}
      <div className="mt-3 pt-3 border-t border-white/10">
        <div className="text-xs uppercase tracking-wider text-white/50 mb-1.5 font-mono">
          Kinematics
        </div>
        <div className="grid grid-cols-2 gap-y-1 gap-x-2 text-xs font-mono text-white/60">
          <div>
            <span className="text-white/40">Coords: </span>
            <span className="tabular-nums">{Math.round(x)}, {Math.round(y)}</span>
          </div>
          <div>
            <span className="text-white/40">Velocity: </span>
            <span className="tabular-nums">{speed.toFixed(2)} / {(genome.speed || genome.maxSpeed).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-white/40">Collision R: </span>
            <span className="tabular-nums">{collisionRadius.toFixed(1)}u</span>
          </div>
        </div>
      </div>

      {/* Lineage Ancestry & Reproductive Success Tracking */}
      <div className="mt-3 pt-3 border-t border-white/10 text-xs font-mono">
        <div className="text-xs uppercase tracking-wider text-white/50 mb-1 font-mono">
          Lineage Ancestry
        </div>
        <div className="text-white/70 space-y-0.5 text-[11px]">
          <div>
            <span className="text-white/40">Parent A: </span>
            <span className="text-white/90">{parentAId ? parentAId.slice(-7) : 'Primordial Founder'}</span>
          </div>
          <div>
            <span className="text-white/40">Parent B: </span>
            <span className="text-white/90">{parentBId ? parentBId.slice(-7) : 'Primordial Founder'}</span>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-white/5 flex justify-between text-white/60 text-xs">
          <span>Offspring Success: <strong className="text-emerald-400 tabular-nums">{offspringCount}</strong></span>
          <span>Hunts: <strong className="text-rose-400 tabular-nums">{kills}</strong></span>
          <span className="text-white/40 truncate max-w-[80px]" title={id}>ID: {id.slice(-6)}</span>
        </div>
      </div>
    </div>
  );
};
