/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  SimulationSnapshot,
  SimulationEvent,
  TerrainMap,
} from '../types/simulation.js';
import { FocusSubject } from '../rendering/camera/director.js';
import {
  formatChronicleSentence,
  generateScientificObservations,
  getCurrentChronicleEvent,
} from '../simulation/events/worldChronicle.js';
import { getCalendarDate } from '../simulation/calendar/calendar.js';
import { ambientSound } from '../audio/ambientSound.js';

interface WorldHudProps {
  snapshot: SimulationSnapshot | null;
  terrainMap: TerrainMap | null;
  directorSubject?: FocusSubject;
  isLeader: boolean;
  cameraSubject: string;
  isManualCamera: boolean;
  onResumeCamera: () => void;
  speed: number;
  onSetSpeed: (speed: number) => void;
  isPaused: boolean;
  onTogglePause: () => void;
  onRerunNewSeed?: () => void;
}

export const WorldHud: React.FC<WorldHudProps> = ({
  snapshot,
  terrainMap,
  directorSubject,
  cameraSubject,
  isLeader,
  isManualCamera,
  onResumeCamera,
  speed,
  onSetSpeed,
  isPaused,
  onTogglePause,
  onRerunNewSeed,
}) => {
  const [observationIndex, setObservationIndex] = useState(0);
  const [isAudioMuted, setIsAudioMuted] = useState(ambientSound.muted);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Rotate scientific observations every 13 seconds
  useEffect(() => {
    const timer = window.setInterval(() => {
      setObservationIndex((prev) => prev + 1);
    }, 13000);
    return () => clearInterval(timer);
  }, []);

  if (!snapshot) return null;

  const { stats, climate, events, worldName, worldSeed, species, organisms } = snapshot;

  // Authoritative calendar calculation: 2,400 ticks per day, 4 days per year (Spring, Summer, Autumn, Winter)
  const calendarDate = getCalendarDate(stats.tick);
  const seasonCapitalized = calendarDate.season.charAt(0).toUpperCase() + calendarDate.season.slice(1);
  const livingSpeciesCount = species.filter((s) => !s.extinct && s.aliveCount > 0).length;

  // Generate rotating scientific observations strictly from genuine snapshot data
  const observations = generateScientificObservations(snapshot);
  const currentObservation = observations[observationIndex % observations.length];

  // Latest verified chronicle event sentence
  const currentEvent = getCurrentChronicleEvent(snapshot);
  const chronicleSentence = terrainMap && currentEvent
    ? formatChronicleSentence(currentEvent, snapshot, terrainMap)
    : currentEvent?.description || 'No recent major event.';

  // Milestones for the minimal history timeline
  const timelineMilestones = events
    .filter((e) => e.isMilestone)
    .slice(0, 7)
    .reverse();

  const handleToggleSound = async () => {
    const unmuted = await ambientSound.toggleMute();
    setIsAudioMuted(!unmuted);
  };

  const handleNewSeedClick = () => {
    setShowConfirmModal(true);
  };

  const handleCancelNewSeed = () => {
    setShowConfirmModal(false);
  };

  const handleConfirmNewSeed = () => {
    setShowConfirmModal(false);
    if (onRerunNewSeed) {
      onRerunNewSeed();
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 select-none p-3 md:p-6 flex flex-col justify-between z-20 font-sans">
      {/* ================= TOP BAR ================= */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 w-full">
        {/* World Identity & Simulated Calendar */}
        <div className="pointer-events-auto bg-black/45 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 shadow-2xl max-w-sm">
          <div className="flex items-baseline gap-2">
            <h1 className="text-base md:text-lg font-serif font-semibold text-white tracking-wide">
              {worldName}
            </h1>
            <span className="text-xs font-mono text-emerald-400/90 font-medium">
              Year {calendarDate.year}, Day {calendarDate.dayOfYear}
            </span>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70 font-mono">
            <span>
              {seasonCapitalized} • {calendarDate.timeOfDay}
            </span>
            <span>•</span>
            <span className="text-white/90">
              {organisms.length} Organisms
            </span>
            <span>•</span>
            <span className="text-white/90">
              {livingSpeciesCount} Species
            </span>
          </div>

          {/* Multi-Tab Observer Warning Banner */}
          {!isLeader && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-950/70 border border-sky-500/30 text-[10px] text-sky-300 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              Observer Tab • Simulating in primary tab
            </div>
          )}

          {/* Active Disaster / Stress Alert Badge */}
          {climate.isDrought && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/70 border border-amber-500/30 text-[10px] text-amber-300 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Severe Arid Drought
            </div>
          )}
          {climate.activeDisasters && climate.activeDisasters.length > 0 && !climate.isDrought && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/70 border border-rose-500/30 text-[10px] text-rose-300 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
              {climate.activeDisasters[0].name}
            </div>
          )}
        </div>

        {/* Center: Automatic World Chronicle Sentence */}
        <div className="pointer-events-auto max-w-lg self-center md:self-auto w-full md:w-auto">
          <div className="bg-black/55 backdrop-blur-lg border border-white/10 px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2.5 text-center">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-ping opacity-75" />
            <p className="text-xs md:text-sm text-emerald-100/95 font-serif italic tracking-wide leading-snug">
              &ldquo;{chronicleSentence}&rdquo;
            </p>
          </div>
        </div>

        {/* Top Right: Soundscape, Director Status & Speed */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 self-end md:self-auto">
          {/* Ambient Soundscape Toggle */}
          <button
            onClick={handleToggleSound}
            title="Toggle procedural ambient soundscape"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/45 backdrop-blur-md border border-white/10 hover:border-white/20 text-xs font-mono text-white/80 transition-all cursor-pointer shadow-lg active:scale-95"
          >
            {isAudioMuted ? (
              <>
                <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
                <span className="hidden sm:inline text-white/60">Sound: Muted</span>
                <span className="sm:hidden text-white/60">Muted</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 text-emerald-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
                <span className="hidden sm:inline text-emerald-300">Soundscape Active</span>
                <span className="sm:hidden text-emerald-300">Active</span>
              </>
            )}
          </button>

          {/* Director Status Pill */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/45 backdrop-blur-md border border-white/10 text-xs font-mono text-white/80 shadow-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-white/60 hidden sm:inline">Director:</span>
            <span className="text-white font-medium truncate max-w-[140px]">
              {cameraSubject || directorSubject?.name || 'Autonomous Lens'}
            </span>
            {isManualCamera && (
              <button
                onClick={onResumeCamera}
                className="ml-1 text-[11px] text-cyan-300 hover:text-cyan-200 underline cursor-pointer"
              >
                Resume
              </button>
            )}
          </div>

          {/* Discreet simulation speed controls */}
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg bg-black/45 backdrop-blur-md border border-white/10 text-xs font-mono">
            <button
              onClick={onTogglePause}
              className="p-1 hover:text-white text-white/70 transition-colors cursor-pointer"
              title={isPaused ? 'Resume simulation' : 'Pause simulation'}
            >
              {isPaused ? '▶' : '⏸'}
            </button>
            {[1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => onSetSpeed(s)}
                className={`px-1.5 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                  speed === s ? 'bg-white/20 text-white font-semibold' : 'text-white/50 hover:text-white'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Rerun with New Seed Button */}
          {onRerunNewSeed && (
            <button
              onClick={handleNewSeedClick}
              title="Rerun world simulation with a brand-new random seed"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/30 hover:border-emerald-400 text-xs font-mono text-emerald-200 transition-all cursor-pointer shadow-lg active:scale-95"
            >
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>New Seed</span>
            </button>
          )}
        </div>
      </header>

      {/* ================= CONFIRMATION MODAL (PRIORITY 3) ================= */}
      {showConfirmModal && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="max-w-md w-full bg-[#0d141c] border border-white/20 rounded-2xl p-6 shadow-2xl text-white font-mono animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Generate Primordial World?</h3>
                <p className="text-xs text-white/60 mt-0.5">Existing world will be archived</p>
              </div>
            </div>

            <p className="text-xs text-white/80 leading-relaxed mb-4">
              Generating a new random seed will replace the active world <span className="text-emerald-400 font-semibold">&ldquo;{worldName}&rdquo;</span>.
              An archived recovery snapshot of your current world will be safely preserved in local storage before creation.
            </p>

            <div className="bg-black/40 border border-white/10 rounded-xl p-3 mb-5 text-[11px] space-y-1 text-white/70">
              <div className="flex justify-between">
                <span>Active World:</span>
                <span className="text-white font-medium">{worldName}</span>
              </div>
              <div className="flex justify-between">
                <span>World Seed:</span>
                <span className="text-white font-medium">{worldSeed}</span>
              </div>
              <div className="flex justify-between">
                <span>Simulation Time:</span>
                <span className="text-white font-medium">Year {calendarDate.year}, Day {calendarDate.dayOfYear} ({seasonCapitalized})</span>
              </div>
              <div className="flex justify-between">
                <span>Ecosystem:</span>
                <span className="text-white font-medium">{organisms.length} organisms across {livingSpeciesCount} species</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={handleCancelNewSeed}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white transition-colors cursor-pointer"
              >
                Cancel (Keep World)
              </button>
              <button
                onClick={handleConfirmNewSeed}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-semibold shadow-lg shadow-emerald-900/50 transition-all cursor-pointer active:scale-95"
              >
                Archive & Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= BOTTOM BAR ================= */}
      <footer className="flex flex-col gap-3 w-full">
        <div className="flex flex-col md:flex-row items-end md:items-center justify-between gap-3">
          {/* Automatically Rotating Scientific Observations */}
          <div className="pointer-events-auto bg-black/45 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2.5 max-w-lg shadow-2xl">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Autonomous Scientific Observation
              </span>
              <span className="text-[10px] font-mono text-white/40">
                {(observationIndex % observations.length) + 1}/{observations.length}
              </span>
            </div>
            <p className="text-xs text-white/85 font-mono leading-relaxed transition-opacity duration-500">
              {currentObservation}
            </p>
          </div>

          {/* Current Focused Event / Subject Detail */}
          {directorSubject && directorSubject.type !== 'scenic' && (
            <div className="pointer-events-auto bg-black/45 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2.5 max-w-sm shadow-2xl text-right md:text-left">
              <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-semibold block mb-0.5">
                Camera Focus • {directorSubject.type.replace('_', ' ')}
              </span>
              <p className="text-xs font-serif text-white/95 truncate">
                {directorSubject.name}
              </p>
              <p className="text-[11px] font-mono text-white/60 truncate mt-0.5">
                {directorSubject.description}
              </p>
            </div>
          )}
        </div>

        {/* Minimal Timeline of Major World History */}
        {timelineMilestones.length > 0 && (
          <div className="pointer-events-auto bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2 shadow-2xl overflow-x-auto">
            <div className="flex items-center justify-between gap-4 min-w-[500px]">
              <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest shrink-0">
                World Chronicle
              </span>
              <div className="flex items-center gap-6 w-full">
                {timelineMilestones.map((m, idx) => {
                  const mCal = getCalendarDate(m.tick);
                  const isLatest = idx === timelineMilestones.length - 1;
                  return (
                    <div
                      key={m.id}
                      className={`flex items-center gap-2 text-xs font-mono transition-opacity ${
                        isLatest ? 'text-white' : 'text-white/60 hover:text-white/90'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          m.type === 'speciation'
                            ? 'bg-emerald-400'
                            : m.type === 'extinction' || m.type === 'drought_extinction'
                            ? 'bg-rose-400'
                            : m.type === 'ecosystem_recovery'
                            ? 'bg-teal-400'
                            : m.type.includes('disaster')
                            ? 'bg-amber-400'
                            : 'bg-cyan-400'
                        } ${isLatest ? 'ring-2 ring-white/50 animate-pulse' : ''}`}
                      />
                      <span className="text-[11px] text-white/50">Yr {mCal.year}, D{mCal.dayOfYear}</span>
                      <span className="text-xs truncate max-w-[110px]" title={m.title}>
                        {m.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
};
