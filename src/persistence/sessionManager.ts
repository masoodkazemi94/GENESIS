/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SavedWorldData } from '../types/simulation.js';
import {
  archiveCurrentWorld,
  clearSavedWorld,
  isValidSavedWorld,
  loadWorldFromIndexedDB,
  saveWorldToIndexedDB,
} from './idb.js';

export function generateCryptoSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] >>> 0;
  }
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

export interface WorldSessionInitResult {
  isReturningWorld: boolean;
  savedData?: SavedWorldData;
  freshSeed: number;
}

/**
 * Initializes world session:
 * - First-time visitors receive a new random world.
 * - Returning visitors restore their existing saved world.
 * - Refreshing restores the saved world and never intentionally deletes it.
 * - Corrupt saves recover safely.
 */
export async function initializeWorldSession(): Promise<WorldSessionInitResult> {
  try {
    const saved = await loadWorldFromIndexedDB();
    if (saved && isValidSavedWorld(saved)) {
      return {
        isReturningWorld: true,
        savedData: saved,
        freshSeed: saved.worldSeed,
      };
    }
  } catch (err) {
    console.warn('[Genesis Session] Error loading world from IndexedDB:', err);
  }

  // First visit or clean recovery fallback: Generate cryptographically random seed
  const freshSeed = generateCryptoSeed();
  return {
    isReturningWorld: false,
    freshSeed,
  };
}

/**
 * Explicit user action to generate a new world seed.
 * Safely archives the current world to recovery storage before clearing active world.
 */
export async function resetWorldSession(): Promise<number> {
  await archiveCurrentWorld();
  await clearSavedWorld();
  return generateCryptoSeed();
}

/**
 * Persists world session if state is complete and valid.
 * Does not overwrite with incomplete states.
 */
export async function persistWorldSession(data: SavedWorldData): Promise<boolean> {
  if (!isValidSavedWorld(data)) {
    console.warn('[Genesis Session] Aborting persist of invalid world data');
    return false;
  }
  return await saveWorldToIndexedDB(data);
}
