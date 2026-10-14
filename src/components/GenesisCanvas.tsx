/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  OrganismState,
  SavedWorldData,
  SimulationSnapshot,
  TerrainMap,
  WorkerToMainMessage,
} from '../types/simulation.js';
import { GenesisRenderer } from '../rendering/renderer.js';
import {
  initializeWorldSession,
  persistWorldSession,
  resetWorldSession,
} from '../persistence/sessionManager.js';
import { SessionCoordinator } from '../persistence/sessionCoordinator.js';
import { generateNewWorld } from '../simulation/generation/worldGenerator.js';
import { WorldHud } from './WorldHud.js';
import { OrganismInspector } from './OrganismInspector.js';
import { ambientSound } from '../audio/ambientSound.js';

export const GenesisCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GenesisRenderer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const coordinatorRef = useRef<SessionCoordinator | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);

  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [terrainMap, setTerrainMap] = useState<TerrainMap | null>(null);
  const [selectedOrganism, setSelectedOrganism] = useState<OrganismState | null>(null);
  const [cameraSubject, setCameraSubject] = useState<string>('Autonomous Lens');
  const [isManualCamera, setIsManualCamera] = useState<boolean>(false);
  const [isLeader, setIsLeader] = useState<boolean>(true);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Setup worker simulation - strictly controlled by session leadership
  const startSimulationWorker = useCallback(async (savedData?: SavedWorldData, seed?: number) => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    const worker = new Worker(new URL('../simulation/worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerToMainMessage | { type: 'SAVED'; tick: number; savedData: SavedWorldData }>) => {
      const msg = event.data;

      if (msg.type === 'READY') {
        const { terrainMap: tMap, snapshot: initialSnap } = msg;
        if (rendererRef.current) {
          rendererRef.current.setTerrain(tMap);
          rendererRef.current.updateSnapshot(initialSnap);
        }
        setTerrainMap(tMap);
        setSnapshot(initialSnap);
        setIsLoading(false);
        coordinatorRef.current?.broadcastSnapshot(initialSnap);
      } else if (msg.type === 'SNAPSHOT') {
        const snap = msg.snapshot;
        if (rendererRef.current) {
          rendererRef.current.updateSnapshot(snap);
          setCameraSubject(rendererRef.current.camera.subject.name);
          setIsManualCamera(rendererRef.current.camera.isManualControl);
        }
        setSnapshot(snap);
        coordinatorRef.current?.broadcastSnapshot(snap);

        // Modulate procedural ambient soundscape based on live simulation climate
        ambientSound.updateClimateAudio(snap.climate);

        // Keep selected organism inspector updated
        setSelectedOrganism((prev) => {
          if (!prev) return null;
          const updated = snap.organisms.find((o) => o.id === prev.id);
          return updated || null;
        });
      } else if (msg.type === 'SAVED') {
        const savedMsg = msg as { type: 'SAVED'; tick: number; savedData: SavedWorldData };
        if (savedMsg.savedData && (coordinatorRef.current?.getIsLeader() ?? true)) {
          persistWorldSession(savedMsg.savedData);
        }
      } else if (msg.type === 'ERROR') {
        console.error('[Genesis UI] Worker simulation error:', msg.message);
      }
    };

    worker.postMessage({
      type: 'INIT',
      savedData,
      initialSeed: seed,
    });

    // Auto-save interval (persists world state to IndexedDB every 5 seconds) - strictly for leader
    if (autoSaveTimerRef.current !== null) {
      clearInterval(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setInterval(() => {
      if (workerRef.current && (coordinatorRef.current?.getIsLeader() ?? true)) {
        workerRef.current.postMessage({ type: 'REQUEST_SAVE' });
      }
    }, 5000);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      if (!containerRef.current) return;

      // 1. Initialize PixiJS Renderer
      const renderer = new GenesisRenderer(containerRef.current);
      await renderer.init();
      rendererRef.current = renderer;

      renderer.onOrganismSelect = (org) => {
        setSelectedOrganism(org);
      };

      // 2. Multi-Tab Single-Writer Coordination
      const coordinator = new SessionCoordinator({
        onBecameLeader: async () => {
          if (!isMounted) return;
          setIsLeader(true);
          // Restore latest saved world or generate new random seed
          const sessionResult = await initializeWorldSession();
          if (!isMounted) return;
          startSimulationWorker(sessionResult.savedData, sessionResult.freshSeed);
        },
        onBecameObserver: async () => {
          if (!isMounted) return;
          setIsLeader(false);
          // Observer tab does not run worker or autosave
          if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
          }
          if (autoSaveTimerRef.current !== null) {
            clearInterval(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
          }
          // Load terrain visually while waiting for leader broadcasts
          const sessionResult = await initializeWorldSession();
          if (!isMounted) return;
          const seed = sessionResult.savedData ? sessionResult.savedData.worldSeed : sessionResult.freshSeed;
          const gen = generateNewWorld(seed);
          if (rendererRef.current) {
            rendererRef.current.setTerrain(gen.terrain);
          }
          setTerrainMap(gen.terrain);
          if (sessionResult.savedData) {
            const initialSnap: SimulationSnapshot = {
              tick: sessionResult.savedData.lastSavedTick,
              worldSeed: sessionResult.savedData.worldSeed,
              worldName: sessionResult.savedData.worldName,
              createdTimestamp: sessionResult.savedData.createdTimestamp,
              climate: sessionResult.savedData.climate,
              organisms: sessionResult.savedData.organisms,
              resources: sessionResult.savedData.resources,
              events: sessionResult.savedData.events,
              species: sessionResult.savedData.species,
              stats: sessionResult.savedData.stats,
              mutationEvents: sessionResult.savedData.mutationEvents || [],
            };
            if (rendererRef.current) {
              rendererRef.current.updateSnapshot(initialSnap);
            }
            setSnapshot(initialSnap);
            setIsLoading(false);
          }
        },
        onRemoteSnapshot: (remoteSnap) => {
          if (!isMounted) return;
          if (rendererRef.current) {
            rendererRef.current.updateSnapshot(remoteSnap);
          }
          setSnapshot(remoteSnap);
          setIsLoading(false);
          ambientSound.updateClimateAudio(remoteSnap.climate);
        },
      });

      coordinatorRef.current = coordinator;
      await coordinator.start();
    }

    initSession();

    // Respect browser autoplay restrictions: initialize audio context upon first spectator gesture
    const handleFirstSpectatorGesture = () => {
      ambientSound.initAudio();
    };
    window.addEventListener('pointerdown', handleFirstSpectatorGesture, { once: true });

    return () => {
      isMounted = false;
      window.removeEventListener('pointerdown', handleFirstSpectatorGesture);
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (workerRef.current) {
        if (coordinatorRef.current?.getIsLeader()) {
          workerRef.current.postMessage({ type: 'REQUEST_SAVE' });
        }
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (coordinatorRef.current) {
        coordinatorRef.current.stop();
      }
      if (rendererRef.current) {
        rendererRef.current.destroy();
      }
      ambientSound.destroy();
    };
  }, [startSimulationWorker]);

  const handleResumeCamera = () => {
    if (rendererRef.current) {
      rendererRef.current.camera.resumeCinematic();
      setIsManualCamera(false);
    }
  };

  const handleTogglePause = () => {
    if (!workerRef.current) return;
    if (isPaused) {
      workerRef.current.postMessage({ type: 'RESUME' });
      setIsPaused(false);
    } else {
      workerRef.current.postMessage({ type: 'PAUSE' });
      setIsPaused(true);
    }
  };

  const handleSetSpeed = (speed: number) => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: 'SET_SPEED', speedMultiplier: speed });
    setSimSpeed(speed);
  };

  const handleRerunNewSeed = useCallback(async () => {
    setIsLoading(true);
    setSelectedOrganism(null);
    const newSeed = await resetWorldSession();
    await startSimulationWorker(undefined, newSeed);
  }, [startSimulationWorker]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#070b0e]">
      {/* PixiJS WebGL Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Loading state before first tick arrives */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#070b0e] z-30 transition-opacity duration-700">
          <div className="text-center font-mono">
            <h2 className="text-xl font-serif text-white tracking-widest uppercase mb-2">
              Genesis
            </h2>
            <p className="text-xs text-white/50 tracking-wider animate-pulse">
              Generating autonomous planetary ecosystem...
            </p>
          </div>
        </div>
      )}

      {/* Minimal Hands-free Spectator HUD */}
      <WorldHud
        snapshot={snapshot}
        terrainMap={terrainMap}
        directorSubject={rendererRef.current?.camera.subject}
        isLeader={isLeader}
        cameraSubject={cameraSubject}
        isManualCamera={isManualCamera}
        onResumeCamera={handleResumeCamera}
        speed={simSpeed}
        onSetSpeed={handleSetSpeed}
        isPaused={isPaused}
        onTogglePause={handleTogglePause}
        onRerunNewSeed={handleRerunNewSeed}
      />

      {/* Organism Detail Inspector (opens if an organism is clicked) */}
      <OrganismInspector
        organism={selectedOrganism}
        onClose={() => setSelectedOrganism(null)}
      />
    </div>
  );
};
