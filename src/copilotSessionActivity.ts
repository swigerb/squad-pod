import * as fs from 'node:fs';
import * as path from 'node:path';
import { sameDirectoryPath } from './directories.js';
import { findCopilotSession, listCopilotSessions, readSessionCwd, resolveCopilotHome } from './copilotSessionState.js';
import { ActivitySource, type ActivitySourceOptions } from './activitySource.js';
import { projectActivityEvent, type LiveEvent } from './activityProjection.js';
export type { LiveEvent } from './activityProjection.js';
export { exactLiveAgent, liveToolLabel } from './activityLifecycle.js';

export { LIVE_STALE_MS } from './activitySource.js';
export const SEED_BYTES = 2 * 1024 * 1024;
export const MAX_LINE_BYTES = 64 * 1024;
/** Decode CLI JSONL through the shared sanitizer; raw records never leave the projector. */
export function parseLiveEvent(line: string): LiveEvent | null {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  return projectActivityEvent(value);
}

function openEventFile(file: string): { fd: number; stat: fs.Stats } {
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) { throw new Error('Unsupported live event file'); }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0) | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    // Windows lstat can report an unknown (zero) volume ID while fstat supplies it.
    const differentDevice = metadata.dev !== 0 && stat.dev !== 0 && stat.dev !== metadata.dev;
    if (!stat.isFile() || differentDevice || stat.ino !== metadata.ino) {
      throw new Error('Live event file changed during open');
    }
    return { fd, stat };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

/** Fixed-size reads and bounded line carry, including when a single line is gigabytes long. */
export class EventTail {
  private offset = 0;
  private carry = Buffer.alloc(0);
  private skipping = false;
  private identity = '';
  reset = false;
  limited = false;

  read(file: string, emit: (event: LiveEvent) => void): fs.Stats {
    const { fd, stat } = openEventFile(file);
    try {
      const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
      this.reset = this.identity !== identity || stat.size < this.offset;
      if (this.reset) {
        this.identity = identity;
        this.offset = Math.max(0, stat.size - SEED_BYTES);
        this.carry = Buffer.alloc(0);
        this.skipping = this.offset > 0;
        this.limited = this.skipping;
      }
      const end = Math.min(stat.size, this.offset + SEED_BYTES);
      const buffer = Buffer.alloc(MAX_LINE_BYTES);
      while (this.offset < end) {
        const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, end - this.offset), this.offset);
        if (!count) {break;}
        this.offset += count;
        let start = 0;
        for (let i = 0; i < count; i++) {
          if (buffer[i] !== 10) {continue;}
          this.consume(buffer.subarray(start, i), true, emit);
          start = i + 1;
        }
        this.consume(buffer.subarray(start, count), false, emit);
      }
      return stat;
    } finally { fs.closeSync(fd); }
  }

  private consume(part: Buffer, newline: boolean, emit: (event: LiveEvent) => void): void {
    if (this.carry.length + part.length > MAX_LINE_BYTES) {
      this.limited = true;
      this.carry = Buffer.alloc(0);
      this.skipping = true;
    }
    if (!this.skipping) {
      this.carry = Buffer.concat([this.carry, part]);
      if (newline) {
        const event = parseLiveEvent(this.carry.toString('utf8'));
        if (event) {emit(event);}
      }
    }
    if (newline) {
      this.carry = Buffer.alloc(0);
      this.skipping = false;
    }
  }
}

function isSquadSession(file: string): boolean {
  const { fd, stat } = openEventFile(file);
  try {
    const size = stat.size;
    // Both scans are bounded. The head preserves a marker even after a long session.
    for (const offset of new Set([0, Math.max(0, size - MAX_LINE_BYTES)])) {
      const buffer = Buffer.alloc(Math.min(MAX_LINE_BYTES, size - offset));
      const count = fs.readSync(fd, buffer, 0, buffer.length, offset);
      const lines = buffer.subarray(0, count).toString('utf8').split('\n');
      if (offset > 0) {lines.shift();}
      if (lines.some(line => parseLiveEvent(line)?.squad)) {return true;}
    }
    return false;
  } finally { fs.closeSync(fd); }
}

export interface LiveSessionSelection {
  /** undefined: project discovery; null: explicitly unavailable, never fall back. */
  preferredId: string | null | undefined;
  excludedIds: readonly string[];
  reason?: string;
}

interface ActivityOptions extends ActivitySourceOptions {
  workspaceRoot: string;
  copilotHome?: string;
  sessionSelection?: () => LiveSessionSelection;
}

export class CopilotSessionActivity {
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private home = '';
  private session: { id: string; dir: string } | undefined;
  private tail = new EventTail();
  private discoveryAt = -Infinity;
  private preferredId: string | null | undefined;
  private projection: ActivitySource;

  constructor(private options: ActivityOptions) {
    this.projection = new ActivitySource({
      roster: () => this.options.roster(),
      post: message => this.options.post(message),
      lifecycle: (...args) => this.options.lifecycle(...args),
      status: status => this.options.status(status),
      now: () => (this.options.now ?? Date.now)(),
    });
  }

  /** Hosts with their own snapshot clock can drive poll/replay without a second timer. */
  start(pollAutomatically = true): void {
    if (this.enabled) {return;}
    this.enabled = true;
    this.home = this.options.copilotHome ?? resolveCopilotHome();
    this.poll();
    if (pollAutomatically) { this.timer = setInterval(() => this.poll(), 1000); }
  }

  stop(): void {
    this.enabled = false;
    if (this.timer) {clearInterval(this.timer);}
    this.timer = undefined;
    this.projection.stop();
    this.session = undefined;
    this.discoveryAt = -Infinity;
    this.preferredId = undefined;
  }

  replay(): void {
    // Validate the current source before replay; a reconnect must not revive stale state.
    if (this.enabled) { this.poll(); }
    this.projection.replay();
  }

  poll(): void {
    if (!this.enabled) {return;}
    const now = (this.options.now ?? Date.now)();
    try {
      const selection = this.options.sessionSelection?.();
      if (selection?.preferredId !== this.preferredId) {
        this.preferredId = selection?.preferredId;
        this.projection.resetSelection();
        this.session = undefined;
        this.discoveryAt = -Infinity;
      }
      if (selection?.preferredId === null) {
        this.projection.searching();
        return;
      }
      if (now - this.discoveryAt >= 5000) {
        this.discoveryAt = now;
        const exact = selection?.preferredId ? findCopilotSession(this.home, selection.preferredId) : undefined;
        const sessions = selection?.preferredId ? exact ? [exact] : [] : listCopilotSessions(this.home, { limit: 32 });
        const match = sessions.find(session => {
          if (!selection?.preferredId && selection?.excludedIds.includes(session.id)) {return false;}
          const cwd = readSessionCwd(session.dir);
          if (!cwd || !sameDirectoryPath(cwd, this.options.workspaceRoot)) {return false;}
          try { return isSquadSession(path.join(session.dir, 'events.jsonl')); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return false;}
            throw error;
          }
        });
        if (this.projection.select(match?.id ?? null)) {
          this.session = match;
          this.tail = new EventTail();
        }
      }
      if (!this.session) { this.projection.searching(); return; }
      const file = path.join(this.session.dir, 'events.jsonl');
      const events: LiveEvent[] = [];
      let stat = this.tail.read(file, event => events.push(event));
      if (this.projection.requiresReseed({ reset: this.tail.reset, revision: stat.size })) {
        this.tail = new EventTail();
        events.length = 0;
        stat = this.tail.read(file, event => events.push(event));
      }
      this.projection.accept({
        reset: this.tail.reset, revision: stat.size, modifiedAt: stat.mtimeMs,
        observedAt: now, limited: this.tail.limited, events,
      });
    } catch (error) {
      this.session = undefined;
      this.discoveryAt = -Infinity;
      this.projection.lost(
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'searching' : 'error', this.tail.limited,
      );
    }
  }
}
