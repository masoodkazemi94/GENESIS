/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SavedWorldData } from '../types/simulation.js';

const DB_NAME = 'genesis_simulation_db';
const DB_VERSION = 1;
const STORE_NAME = 'world_sessions';
const WORLD_KEY = 'active_local_world';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorldToIndexedDB(data: SavedWorldData): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(data, WORLD_KEY);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[Genesis Persistence] Failed to save world to IndexedDB:', err);
  }
}

export async function loadWorldFromIndexedDB(): Promise<SavedWorldData | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(WORLD_KEY);

      req.onsuccess = () => {
        const result = req.result as SavedWorldData | undefined;
        if (result && isValidSavedWorld(result)) {
          resolve(result);
        } else {
          if (result) {
            console.warn('[Genesis Persistence] Stored world failed validation; triggering graceful recovery');
          }
          resolve(null);
        }
      };

      req.onerror = () => {
        console.warn('[Genesis Persistence] IndexedDB read error; falling back to new world');
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('[Genesis Persistence] Error opening IndexedDB:', err);
    return null;
  }
}

export async function clearSavedWorld(): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(WORLD_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[Genesis Persistence] Error clearing world:', err);
  }
}

/**
 * Validates saved world structure to prevent corrupted data from crashing the app
 */
export function isValidSavedWorld(data: unknown): data is SavedWorldData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<SavedWorldData>;
  return (
    typeof d.version === 'number' &&
    typeof d.worldSeed === 'number' &&
    typeof d.worldName === 'string' &&
    typeof d.lastSavedTick === 'number' &&
    Array.isArray(d.organisms) &&
    Array.isArray(d.resources) &&
    Array.isArray(d.species)
  );
}
