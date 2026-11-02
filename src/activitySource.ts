import { ActivityLifecycle, type ActivityLifecycleOptions } from './activityLifecycle.js';
import type { LiveEvent } from './activityProjection.js';
import type { LiveSourceStatus } from './types.js';

export const LIVE_STALE_MS = 5 * 60_000;

/** Source-owned change facts, not an arrival timestamp or an event's activity clock. */
export interface ActivitySourceFacts {
  reset: boolean;
  revision: number | string;
  modifiedAt: number;
}

/** A bounded, sanitized read from one selected source. */
export interface ActivitySourceBatch extends ActivitySourceFacts {
  /** Adapter's validation/poll clock sample; reading must not advance freshness. */
  observedAt: number;
  limited: boolean;
  events: readonly LiveEvent[];
}

/** Outputs and authoritative roster for one source-independent projection owner. */
export interface ActivitySourceOptions extends Omit<ActivityLifecycleOptions, 'source'> {
  status: (status: LiveSourceStatus) => void;
}

/**
 * Owns freshness, clearing and ordered publication for a normalized source.
 * Adapters retain consent, discovery/authorization and bounded transport reads. Call
 * resetSelection before changing selection authority, select after discovery, and
 * lost on transport failure. A stale changed source requires a bounded reset read
 * before accept; replay must be preceded by adapter validation/read.
 */
export class ActivitySource {
  private sessionId: string | null = null;
  private limited = false;
  private lastBytesAt = 0;
  private lastRevision: number | string = -1;
  private stale = false;
  private source: LiveSourceStatus = { state: 'off', sessionId: null };
  private projection: ActivityLifecycle;

  constructor(private options: ActivitySourceOptions) {
    this.projection = new ActivityLifecycle({
      ...options, source: () => ({ sessionId: this.sessionId, limited: this.limited }),
    });
  }

  /** Clear under the old identity before the adapter changes selection authority. */
  resetSelection(): void {
    this.projection.clear();
    this.sessionId = null;
  }

  /** Select a validated identity; return whether transport state must be reset. */
  select(sessionId: string | null): boolean {
    if (sessionId === this.sessionId) {return false;}
    this.projection.clear();
    this.sessionId = sessionId;
    this.limited = false;
    this.lastRevision = -1;
    this.stale = false;
    if (sessionId) {this.projection.publishModels();}
    return true;
  }

  /** A changed stale source must be reconstructed, not resumed from an empty reducer. */
  requiresReseed(facts: Pick<ActivitySourceFacts, 'reset' | 'revision'>): boolean {
    return this.stale && (facts.reset || facts.revision !== this.lastRevision);
  }

  /** Apply source change freshness once, then reduce or silently seed normalized events. */
  accept(batch: ActivitySourceBatch): void {
    const now = batch.observedAt;
    this.limited = batch.limited;
    if (batch.reset || batch.revision !== this.lastRevision) {
      this.lastBytesAt = Math.min(now, batch.modifiedAt);
      this.lastRevision = batch.revision;
    }
    if (now - this.lastBytesAt >= LIVE_STALE_MS) {
      this.projection.clear();
      this.stale = true;
      this.searching();
      return;
    }
    this.stale = false;
    if (batch.reset) {
      this.projection.seed(batch.events);
    } else {
      for (const event of batch.events) {this.projection.accept(event);}
    }
    this.setSource('following');
    if (batch.reset) {this.replay();}
    this.projection.publishTasks();
  }

  /** Publish unavailability after an adapter finds no authorized matching source. */
  searching(): void { this.setSource('searching'); }

  /** Clear on loss, retaining coverage facts even when a bounded read fails partway. */
  lost(state: 'searching' | 'error', limited = this.limited): void {
    this.limited = limited;
    this.projection.clear();
    this.sessionId = null;
    this.stale = false;
    this.setSource(state);
  }

  /** Clear on disable/disposal without consulting the source transport. */
  stop(): void {
    this.projection.clear();
    this.sessionId = null;
    this.stale = false;
    this.setSource('off');
  }

  /** Replay only after the adapter has validated freshness; preserve output ordering. */
  replay(): void {
    this.projection.replayActivity();
    this.options.status(this.source);
    this.projection.publishModels();
    this.projection.publishTasks();
  }

  private setSource(state: LiveSourceStatus['state']): void {
    this.source = { state, sessionId: this.sessionId?.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8) || null };
    this.options.status(this.source);
  }
}
