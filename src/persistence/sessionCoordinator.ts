/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SessionCoordinatorCallbacks {
  onBecameLeader: () => void;
  onBecameObserver: () => void;
}

export class SessionCoordinator {
  private isLeader = false;
  private channel: BroadcastChannel | null = null;
  private abortController: AbortController | null = null;
  private callbacks: SessionCoordinatorCallbacks;
  private pollInterval: number | null = null;

  constructor(callbacks: SessionCoordinatorCallbacks) {
    this.callbacks = callbacks;
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('genesis_session_channel');
    }
  }

  public async start(): Promise<void> {
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      // Primary: Web Locks API
      this.acquireWebLock();
    } else {
      // Fallback: Heartbeat channel
      this.startHeartbeatFallback();
    }
  }

  private acquireWebLock(): void {
    this.abortController = new AbortController();

    navigator.locks.request(
      'genesis_world_writer_lock',
      { ifAvailable: true, signal: this.abortController.signal },
      async (lock) => {
        if (lock) {
          this.isLeader = true;
          this.callbacks.onBecameLeader();

          // Keep lock alive until page unload
          return new Promise<void>((resolve) => {
            const handleUnload = () => {
              window.removeEventListener('beforeunload', handleUnload);
              resolve();
            };
            window.addEventListener('beforeunload', handleUnload);
          });
        } else {
          // Lock held by another tab -> Become observer
          this.isLeader = false;
          this.callbacks.onBecameObserver();

          // Retry acquiring the lock when the other tab closes
          navigator.locks.request(
            'genesis_world_writer_lock',
            { signal: this.abortController?.signal },
            async () => {
              this.isLeader = true;
              this.callbacks.onBecameLeader();
              return new Promise<void>((resolve) => {
                window.addEventListener('beforeunload', () => resolve(), { once: true });
              });
            }
          );
        }
      }
    ).catch((err) => {
      if (err.name !== 'AbortError') {
        console.warn('[Genesis Coordinator] Web Lock fallback triggered:', err);
        this.startHeartbeatFallback();
      }
    });
  }

  private startHeartbeatFallback(): void {
    const LEASE_MS = 3000;
    const tabId = `tab_${Math.random().toString(36).slice(2, 9)}`;

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

    window.addEventListener('beforeunload', () => {
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
    });
  }

  public getIsLeader(): boolean {
    return this.isLeader;
  }

  public stop(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    if (this.channel) {
      this.channel.close();
    }
  }
}
