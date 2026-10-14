/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SimulationSnapshot } from '../types/simulation.js';

export interface SessionCoordinatorCallbacks {
  onBecameLeader: () => void;
  onBecameObserver: () => void;
  onRemoteSnapshot?: (snapshot: SimulationSnapshot) => void;
}

export type CoordinatorMessage =
  | { type: 'SNAPSHOT'; snapshot: SimulationSnapshot }
  | { type: 'LEADER_HEARTBEAT'; tabId: string };

export class SessionCoordinator {
  private isLeader = false;
  private channel: BroadcastChannel | null = null;
  private abortController: AbortController | null = null;
  private callbacks: SessionCoordinatorCallbacks;
  private pollInterval: number | null = null;
  private releaseWebLock: (() => void) | null = null;
  private tabId: string;

  constructor(callbacks: SessionCoordinatorCallbacks) {
    this.callbacks = callbacks;
    this.tabId = `tab_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel('genesis_session_channel');
        this.channel.onmessage = (event: MessageEvent<CoordinatorMessage>) => {
          if (!this.isLeader && event.data?.type === 'SNAPSHOT' && this.callbacks.onRemoteSnapshot) {
            this.callbacks.onRemoteSnapshot(event.data.snapshot);
          }
        };
      } catch {
        this.channel = null;
      }
    }
  }

  public async start(): Promise<void> {
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      // Primary: Modern Web Locks API
      this.acquireWebLock();
    } else {
      // Fallback: LocalStorage Heartbeat Lease
      this.startHeartbeatFallback();
    }
  }

  /**
   * Broadcasts the simulation snapshot from the leader to observer tabs
   */
  public broadcastSnapshot(snapshot: SimulationSnapshot): void {
    if (this.isLeader && this.channel) {
      try {
        this.channel.postMessage({ type: 'SNAPSHOT', snapshot });
      } catch {
        // Broadcast failures are safely ignored
      }
    }
  }

  private acquireWebLock(): void {
    this.abortController = new AbortController();

    navigator.locks
      .request(
        'genesis_world_writer_lock',
        { ifAvailable: true, signal: this.abortController.signal },
        async (lock) => {
          if (lock) {
            this.isLeader = true;
            this.callbacks.onBecameLeader();

            return new Promise<void>((resolve) => {
              this.releaseWebLock = resolve;
              const handleUnload = () => {
                window.removeEventListener('beforeunload', handleUnload);
                resolve();
              };
              window.addEventListener('beforeunload', handleUnload);
            });
          } else {
            // Lock held by another tab -> become observer
            this.isLeader = false;
            this.callbacks.onBecameObserver();

            // Queue up to take over leadership immediately if the leader closes
            return navigator.locks.request(
              'genesis_world_writer_lock',
              { signal: this.abortController?.signal },
              async () => {
                this.isLeader = true;
                this.callbacks.onBecameLeader();

                return new Promise<void>((resolve) => {
                  this.releaseWebLock = resolve;
                  const handleUnload = () => {
                    window.removeEventListener('beforeunload', handleUnload);
                    resolve();
                  };
                  window.addEventListener('beforeunload', handleUnload);
                });
              }
            );
          }
        }
      )
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.warn('[Genesis Coordinator] Web Lock fallback triggered:', err);
          this.startHeartbeatFallback();
        }
      });
  }

  private startHeartbeatFallback(): void {
    const LEASE_MS = 3000;
    const tabId = this.tabId;

    const checkLeader = () => {
      const currentLease = localStorage.getItem('genesis_writer_lease');
      const now = Date.now();

      if (!currentLease) {
        // Claim leadership
        localStorage.setItem('genesis_writer_lease', JSON.stringify({ tabId, expire: now + LEASE_MS }));
        if (!this.isLeader) {
          this.isLeader = true;
          this.callbacks.onBecameLeader();
        }
      } else {
        try {
          const parsed = JSON.parse(currentLease);
          if (parsed.tabId === tabId || parsed.expire < now) {
            // Renew or claim expired lease
            localStorage.setItem('genesis_writer_lease', JSON.stringify({ tabId, expire: now + LEASE_MS }));
            if (!this.isLeader) {
              this.isLeader = true;
              this.callbacks.onBecameLeader();
            }
          } else {
            // Another tab holds valid lease
            if (this.isLeader) {
              this.isLeader = false;
              this.callbacks.onBecameObserver();
            }
          }
        } catch {
          localStorage.removeItem('genesis_writer_lease');
        }
      }
    };

    checkLeader();
    this.pollInterval = window.setInterval(checkLeader, 1000);

    const handleUnload = () => {
      const lease = localStorage.getItem('genesis_writer_lease');
      if (lease) {
        try {
          const parsed = JSON.parse(lease);
          if (parsed.tabId === tabId) {
            localStorage.removeItem('genesis_writer_lease');
          }
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('beforeunload', handleUnload);
  }

  public getIsLeader(): boolean {
    return this.isLeader;
  }

  public stop(): void {
    if (this.releaseWebLock) {
      this.releaseWebLock();
      this.releaseWebLock = null;
    }
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
  }
}
