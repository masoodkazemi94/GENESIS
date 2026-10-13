/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SavedWorldData } from '../types/simulation.js';
import { loadWorldFromIndexedDB, saveWorldToIndexedDB } from './idb.js';

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

export async function initializeWorldSession(): Promise<WorldSessionInitResult> {
  try {
    const saved = await loadWorldFromIndexedDB();
    if (saved) {
      return {
        isReturningWorld: true,
        savedData: saved,
        freshSeed: saved.worldSeed,
      };
    }
  } catch (err) {
    console.warn('[Genesis Session] Error loading world from IndexedDB:', err);
  }

  // First visit or recovery: Generate a cryptographically random seed
  const freshSeed = generateCryptoSeed();
  return {
    isReturningWorld: false,
    freshSeed,
  };
}

export async function persistWorldSession(data: SavedWorldData): Promise<void> {
  await saveWorldToIndexedDB(data);
}
