/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MainToWorkerMessage, WorkerToMainMessage } from '../types/simulation.js';
import { SimulationEngine, SIMULATION_STEP_MS } from './engine.js';

let engine: SimulationEngine | null = null;
let intervalId: number | null = null;
let isRunning = false;
let speedMultiplier = 1;

function runTick() {
  if (!engine || !isRunning) return;

  try {
    for (let i = 0; i < speedMultiplier; i++) {
      engine.step();
    }

    // Send state snapshot to main thread
    const snapshot = engine.getSnapshot();
    const msg: WorkerToMainMessage = {
      type: 'SNAPSHOT',
      snapshot,
    };
    self.postMessage(msg);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Genesis Worker] Error in simulation tick:', err);
    self.postMessage({ type: 'ERROR', message: errorMsg });
  }
}

function startLoop() {
  if (intervalId !== null) {
    clearInterval(intervalId);
  }
  isRunning = true;
  intervalId = (self as unknown as Window).setInterval(runTick, SIMULATION_STEP_MS);
}

function stopLoop() {
  isRunning = false;
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const data = event.data;

  switch (data.type) {
    case 'INIT': {
      try {
        engine = new SimulationEngine(data.savedData || data.initialSeed);
        const snapshot = engine.getSnapshot();
        const readyMsg: WorkerToMainMessage = {
          type: 'READY',
          worldSeed: engine.worldSeed,
          worldName: engine.worldName,
          terrainMap: engine.terrain,
          snapshot,
        };
        self.postMessage(readyMsg);
        startLoop();
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        self.postMessage({ type: 'ERROR', message: errorMsg });
      }
      break;
    }

    case 'PAUSE': {
      stopLoop();
      break;
    }

    case 'RESUME': {
      if (engine && !isRunning) {
        startLoop();
      }
      break;
    }

    case 'SET_SPEED': {
      speedMultiplier = Math.max(1, Math.min(5, Math.round(data.speedMultiplier)));
      break;
    }

    case 'REQUEST_SAVE': {
      if (engine) {
        const serialized = engine.serializeForStorage();
        self.postMessage({ type: 'SAVED', tick: engine.tick, savedData: serialized } as unknown as WorkerToMainMessage);
      }
      break;
    }
  }
};
