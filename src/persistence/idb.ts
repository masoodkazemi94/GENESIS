/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SavedWorldData } from '../types/simulation.js';
import { isValidEcologyConfig } from '../simulation/ecology/config.js';

const DB_NAME = 'genesis_simulation_db';
const DB_VERSION = 1;
const STORE_NAME = 'world_sessions';
export const WORLD_KEY = 'active_local_world';
export const BACKUP_KEY = 'previous_valid_snapshot';
export const ARCHIVE_KEY = 'archived_world_recovery';

// In-memory fallback map for environments where IndexedDB is restricted or unavailable (e.g. testing / private browsing)
const memoryStorageFallback = new Map<string, SavedWorldData>();

export function clearMemoryStorageForTesting(): void {
  memoryStorageFallback.clear();
}

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

/**
 * Validates saved world structure to prevent corrupted data from crashing the app.
 * Note: An extinct world (organisms: []) is explicitly valid.
 */
export function isValidSavedWorld(data: unknown): data is SavedWorldData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<SavedWorldData>;
  return (
    typeof d.version === 'number' &&
    typeof d.worldSeed === 'number' &&
    !isNaN(d.worldSeed) &&
    typeof d.worldName === 'string' &&
    d.worldName.trim().length > 0 &&
    typeof d.lastSavedTick === 'number' &&
    !isNaN(d.lastSavedTick) &&
    d.lastSavedTick >= 0 &&
    Array.isArray(d.organisms) &&
    Array.isArray(d.resources) &&
    Array.isArray(d.species) &&
    (d.ecologyConfig === undefined || isValidEcologyConfig(d.ecologyConfig)) &&
    typeof d.climate === 'object' &&
    d.climate !== null
  );
}

/**
 * Safely writes the world state to IndexedDB (with graceful memory fallback).
 * Safeguards:
 * 1. Rejects incomplete or invalid payloads before touching storage.
 * 2. Archives previous valid snapshot to BACKUP_KEY so interrupted writes cannot destroy progress.
 */
export async function saveWorldToIndexedDB(data: SavedWorldData): Promise<boolean> {
  if (!isValidSavedWorld(data)) {
    console.warn('[Genesis Persistence] Refusing to overwrite save with invalid or incomplete state');
    return false;
  }

  if (typeof indexedDB === 'undefined') {
    const existing = memoryStorageFallback.get(WORLD_KEY);
    if (existing && isValidSavedWorld(existing)) {
      memoryStorageFallback.set(BACKUP_KEY, JSON.parse(JSON.stringify(existing)));
    }
    memoryStorageFallback.set(WORLD_KEY, JSON.parse(JSON.stringify(data)));
    return true;
  }

  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // Read current active world first to update BACKUP_KEY atomically within the transaction
      const getReq = store.get(WORLD_KEY);
      getReq.onsuccess = () => {
        const existing = getReq.result as SavedWorldData | undefined;
        if (existing && isValidSavedWorld(existing)) {
          store.put(existing, BACKUP_KEY);
        }
        // Write new validated snapshot
        store.put(data, WORLD_KEY);
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => {
        console.warn('[Genesis Persistence] Transaction error saving world:', tx.error);
        resolve(false);
      };
      tx.onabort = () => {
        console.warn('[Genesis Persistence] Transaction aborted saving world:', tx.error);
        resolve(false);
      };
    });
  } catch (err) {
    console.warn('[Genesis Persistence] Failed to save world to IndexedDB, using memory fallback:', err);
    memoryStorageFallback.set(WORLD_KEY, JSON.parse(JSON.stringify(data)));
    return true;
  }
}

/**
 * Loads the saved world with automatic recovery fallback:
 * 1. Attempts to load WORLD_KEY.
 * 2. If corrupted or missing, falls back to BACKUP_KEY.
 * 3. If both unavailable, returns null (clean graceful recovery).
 */
export async function loadWorldFromIndexedDB(): Promise<SavedWorldData | null> {
  if (typeof indexedDB === 'undefined') {
    const active = memoryStorageFallback.get(WORLD_KEY);
    if (active && isValidSavedWorld(active)) {
      return JSON.parse(JSON.stringify(active));
    }
    const backup = memoryStorageFallback.get(BACKUP_KEY);
    if (backup && isValidSavedWorld(backup)) {
      return JSON.parse(JSON.stringify(backup));
    }
    return null;
  }

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
          return;
        }

        if (result) {
          console.warn('[Genesis Persistence] Active save corrupted. Attempting recovery from backup snapshot...');
        }

        // Try backup snapshot
        const backupReq = store.get(BACKUP_KEY);
        backupReq.onsuccess = () => {
          const backupResult = backupReq.result as SavedWorldData | undefined;
          if (backupResult && isValidSavedWorld(backupResult)) {
            console.info('[Genesis Persistence] Successfully recovered world from backup snapshot!');
            resolve(backupResult);
          } else {
            resolve(null);
          }
        };
        backupReq.onerror = () => resolve(null);
      };

      req.onerror = () => {
        console.warn('[Genesis Persistence] IndexedDB read error; falling back to new world');
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('[Genesis Persistence] Error opening IndexedDB, checking memory fallback:', err);
    const mem = memoryStorageFallback.get(WORLD_KEY);
    return mem && isValidSavedWorld(mem) ? JSON.parse(JSON.stringify(mem)) : null;
  }
}

/**
 * Archives the active world before replacing or resetting it.
 */
export async function archiveCurrentWorld(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') {
    const current = memoryStorageFallback.get(WORLD_KEY);
    if (current && isValidSavedWorld(current)) {
      memoryStorageFallback.set(ARCHIVE_KEY, JSON.parse(JSON.stringify(current)));
    }
    return true;
  }

  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(WORLD_KEY);

      req.onsuccess = () => {
        const current = req.result as SavedWorldData | undefined;
        if (current && isValidSavedWorld(current)) {
          store.put(current, ARCHIVE_KEY);
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    const mem = memoryStorageFallback.get(WORLD_KEY);
    if (mem && isValidSavedWorld(mem)) {
      memoryStorageFallback.set(ARCHIVE_KEY, JSON.parse(JSON.stringify(mem)));
    }
    return true;
  }
}

/**
 * Retrieves the archived world if available.
 */
export async function loadArchivedWorld(): Promise<SavedWorldData | null> {
  if (typeof indexedDB === 'undefined') {
    const arc = memoryStorageFallback.get(ARCHIVE_KEY);
    return arc && isValidSavedWorld(arc) ? JSON.parse(JSON.stringify(arc)) : null;
  }

  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(ARCHIVE_KEY);
      req.onsuccess = () => {
        const result = req.result as SavedWorldData | undefined;
        resolve(result && isValidSavedWorld(result) ? result : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    const arc = memoryStorageFallback.get(ARCHIVE_KEY);
    return arc && isValidSavedWorld(arc) ? JSON.parse(JSON.stringify(arc)) : null;
  }
}

export async function clearSavedWorld(): Promise<void> {
  memoryStorageFallback.delete(WORLD_KEY);
  if (typeof indexedDB === 'undefined') {
    return;
  }

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
