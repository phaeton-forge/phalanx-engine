/**
 * DesyncDetector - Handles desync detection for lockstep synchronization
 *
 * Stores local state hashes and compares them with remote hashes
 * received from other players via the server.
 */

import { EventEmitter } from './EventEmitter.js';

/**
 * Configuration for desync detection
 */
export interface DesyncConfig {
  /** Whether desync detection is enabled */
  enabled: boolean;
  /** Maximum number of hashes to store (default: 100) */
  maxStoredHashes?: number;
}

/**
 * Event emitted when a desync is detected
 */
export interface DesyncEvent {
  /** The tick where desync occurred */
  tick: number;
  /** The local hash for this tick */
  localHash: string;
  /** Hashes from all players (playerId -> hash) */
  remoteHashes: Record<string, string>;
}

/**
 * Events emitted by DesyncDetector
 */
export interface DesyncDetectorEvents {
  desync: (event: DesyncEvent) => void;
}

/**
 * DesyncDetector - Internal class for managing desync detection
 *
 * The game computes state hashes and submits them via the client.
 * This class stores local hashes and compares with remote hashes
 * when the server broadcasts a comparison.
 */
export class DesyncDetector extends EventEmitter<DesyncDetectorEvents> {
  private config: Required<DesyncConfig> = {
    enabled: true,
    maxStoredHashes: 100,
  };
  private hashHistory: Map<number, string> = new Map();

  /**
   * Configure the desync detector
   */
  configure(config: Partial<DesyncConfig>): void {
    if (config.enabled !== undefined) {
      this.config.enabled = config.enabled;
    }
    if (config.maxStoredHashes !== undefined) {
      this.config.maxStoredHashes = config.maxStoredHashes;
    }
  }

  /**
   * Check if desync detection is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Record local hash (called by game via client.submitStateHash)
   * @param tick - The tick this hash is for
   * @param hash - Hash computed by game
   */
  recordLocalHash(tick: number, hash: string): void {
    if (!this.config.enabled) return;

    this.hashHistory.set(tick, hash);

    // Prune old hashes
    if (this.hashHistory.size > this.config.maxStoredHashes) {
      const oldestTick = Math.min(...this.hashHistory.keys());
      this.hashHistory.delete(oldestTick);
    }
  }

  /**
   * Get local hash for a specific tick
   * @param tick - The tick to get hash for
   * @returns The hash string or undefined if not found
   */
  getLocalHash(tick: number): string | undefined {
    return this.hashHistory.get(tick);
  }

  /**
   * Compare local hash with remote hashes
   * @param tick - The tick to compare
   * @param remoteHashes - Hashes from all players (playerId -> hash)
   * @returns true if all hashes match, false if desync detected
   */
  compareWithRemote(tick: number, remoteHashes: Record<string, string>): boolean {
    const localHash = this.hashHistory.get(tick);
    if (!localHash) {
      // Can't compare - no local hash for this tick
      return true;
    }

    const allMatch = Object.values(remoteHashes).every((h) => h === localHash);

    if (!allMatch) {
      this.emit('desync', { tick, localHash, remoteHashes });
      return false;
    }

    return true;
  }

  /**
   * Clear all stored hashes
   */
  clear(): void {
    this.hashHistory.clear();
  }

  /**
   * Get the current configuration
   */
  getConfig(): Required<DesyncConfig> {
    return { ...this.config };
  }
}
