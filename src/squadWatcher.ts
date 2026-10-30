/**
 * squadWatcher.ts — Watch the `.squad/` directory for team and activity changes.
 *
 * Uses a combination of `fs.watch` (for instant notification where available)
 * and stat-based polling (for reliability across platforms).  Calls back into
 * the extension host whenever agent activity is detected so the pixel-art
 * characters can animate accordingly.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FILE_WATCHER_POLL_INTERVAL_MS } from './constants.js';
import { resolveSquadDir } from './squadPaths.js';
import type { SourceStatus, SquadSession } from './types.js';

// ─── Types ──────────────────────────────────────────────────────────

export type AgentActivityStatus = 'active' | 'idle' | 'waiting';

export type ActivitySource = 'session' | 'log' | 'orchestration-log' | 'agent-files' | 'decision';

export interface AgentActivityEvent {
  agentId: string;          // agent slug
  status: AgentActivityStatus;
  task: string | null;      // brief description of current work
  source: ActivitySource;
}

export interface SquadWatcherCallbacks {
  onStatusChanged?: (status: SourceStatus) => void;
  /** Called when the team roster file changes (re-read and refresh agents). */
  onRosterChanged: () => void;
  /** Called when agent activity is detected from any watched source. */
  onAgentActivity: (event: AgentActivityEvent) => void;
}

// ─── Parsing Helpers ────────────────────────────────────────────────

/**
 * Parse a `.squad/sessions/*.json` file into a SquadSession.
 * Returns null if the content is not valid JSON or doesn't match the shape.
 */
export function parseSessionFile(content: string): SquadSession | null {
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    if (typeof data.id !== 'string' || typeof data.createdAt !== 'string') {
      return null;
    }

    const messages = Array.isArray(data.messages)
      ? (data.messages as Array<Record<string, unknown>>).map(m => ({
          role: String(m.role ?? 'unknown'),
          content: String(m.content ?? ''),
          timestamp: String(m.timestamp ?? ''),
        }))
      : [];

    return {
      id: data.id as string,
      createdAt: data.createdAt as string,
      lastActiveAt: (data.lastActiveAt as string) ?? data.createdAt as string,
      agent: typeof data.agent === 'string' ? data.agent : undefined,
      messages,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a `.squad/log/*.md` or `.squad/orchestration-log/*.md` entry and
 * extract the referenced agent (if any), a timestamp, and a one-line summary.
 */
export function parseLogEntry(
  content: string,
): { agent: string | null; timestamp: string; summary: string } | null {
  content = stripHtmlComments(content);
  if (!content.trim()) {
    return null;
  }

  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

  // Try to extract a timestamp from the filename-style header or **Timestamp:** field
  let timestamp = '';
  const tsMatch = /\*\*Timestamp:\*\*\s*(.+)/i.exec(content);
  if (tsMatch?.[1]) {
    timestamp = tsMatch[1].trim();
  } else {
    // Fall back: first line often has date info
    const dateMatch = /(\d{4}-\d{2}-\d{2}T[\d:Z-]+)/i.exec(lines[0] ?? '');
    if (dateMatch?.[1]) {
      timestamp = dateMatch[1];
    }
  }

  // Extract agent from **Agent:** line
  let agent: string | null = null;
  const agentMatch = /\*\*Agent:\*\*[ \t]*([^\r\n(]+)/i.exec(content);
  if (agentMatch?.[1]) {
    agent = agentMatch[1]
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // If no **Agent:** field, try to detect agent from the filename embedded in
  // the first heading (e.g. "# Orchestration Log — Lisa Simpson")
  if (!agent) {
    const headingMatch = /^#\s+.*?—\s*(.+)/i.exec(lines[0] ?? '');
    if (headingMatch?.[1]) {
      agent = headingMatch[1]
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
  }

  // Build a one-line summary from the first meaningful non-heading line
  let summary = '';
  for (const [index, line] of lines.entries()) {
    if (/^[-=]+$/.test(lines[index + 1] ?? '')) {
      continue;
    }
    if (line.startsWith('#')) {
      continue;
    }
    if (/^\*\*(Timestamp|Agent|Task|Status):\*\*/i.test(line)) {
      continue;
    }
    const meaningful = meaningfulLine(line);
    if (meaningful) {
      summary = meaningful.slice(0, 120);
      break;
    }
  }

  if (!summary && !agent) {
    return null;
  }

  return { agent, timestamp, summary };
}

/**
 * Agent slug from a log/orchestration-log filename such as
 * `2026-03-05T21-46-29Z-lisa-simpson.md`. Plain session logs
 * (`2026-03-05T21-46-29Z.md`) carry no agent.
 */
export function detectAgentFromFilename(filename: string): string | null {
  const match = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-(.+)\.md$/i.exec(filename);
  return match?.[1] ?? null;
}

/** Agent candidate from a decisions-inbox file such as `lisa-simpson-auth-choice.md`. */
export function detectAgentFromInboxFile(filename: string): string | null {
  const stem = filename.replace(/\.md$/i, '');
  return stem && stem !== filename ? stem : null;
}

function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
}

function meaningfulLine(line: string): string | null {
  if (/^#{1,6}(?:\s|$)/.test(line) || /^[-=|:\s]+$/.test(line)) { return null; }
  const cleaned = line.replace(/^[-*+]\s+|^\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s*/, '').replace(/\*\*/g, '').trim();
  if (cleaned.length <= 3 || /^[\w -]+:\s*$/.test(cleaned)) { return null; }
  return cleaned;
}

/** Most recent non-structural content, never a claim that the work is live. */
export function summarizeHistory(content: string): string | null {
  const lines = stripHtmlComments(content).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^[-=]+$/.test(lines[i + 1] ?? '')) { continue; }
    const cleaned = meaningfulLine(line);
    if (cleaned) {
      return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
    }
  }
  return null;
}

// ─── File Tracking ──────────────────────────────────────────────────

interface FileStamp {
  mtimeMs: number;
  size: number;
}

function statFile(filePath: string): FileStamp | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? { mtimeMs: stat.mtimeMs, size: stat.size } : null;
  } catch {
    return null;
  }
}

function listEntries(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true }).filter(e => !e.name.startsWith('.'));
  } catch {
    return [];
  }
}

function safeReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function extractSessionTask(session: SquadSession): string | null {
  const last = session.messages[session.messages.length - 1];
  if (!last) {
    return null;
  }
  return summarizeHistory(last.content);
}

// ─── Squad Watcher ──────────────────────────────────────────────────

export interface SquadWatcherOptions {
  pollIntervalMs?: number;
  /** Disable native fs.watch (tests use explicit `scan()` calls). */
  useFsWatch?: boolean;
}

/**
 * Watches one workspace's Squad state directory.
 *
 * The first scan records a baseline without emitting events, so opening the
 * office does not replay every historical log as live activity. Afterwards,
 * any new or changed file in a watched source emits one activity event.
 */
export class SquadWatcher {
  private readonly known = new Map<string, FileStamp>();
  private teamStamp: FileStamp | null = null;
  private baselined = false;
  private disposed = false;
  private fsWatcher: fs.FSWatcher | null = null;
  private watchedDir: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private scanQueued: ReturnType<typeof setTimeout> | null = null;
  private lastStatus: string | undefined;
  private watchError: string | null = null;

  constructor(
    private readonly workspaceRoot: string,
    private readonly callbacks: SquadWatcherCallbacks,
    private readonly options: SquadWatcherOptions = {},
  ) {}

  start(): void {
    if (this.pollTimer || this.disposed) { return; }
    this.pollTimer = setInterval(() => this.scan(), this.options.pollIntervalMs ?? FILE_WATCHER_POLL_INTERVAL_MS);
    this.scan();
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    if (this.scanQueued) {
      clearTimeout(this.scanQueued);
    }
    this.fsWatcher?.close();
    this.fsWatcher = null;
    this.pollTimer = null;
    this.publishStatus();
  }

  private publishStatus(): void {
    const squadDir = resolveSquadDir(this.workspaceRoot);
    let error = this.watchError;
    let teamFound = false;
    try {
      if (!fs.statSync(squadDir).isDirectory()) {
        error = `Cannot inspect Squad team file: ${squadDir} is not a directory`;
      } else {
        teamFound = fs.statSync(path.join(squadDir, 'team.md')).isFile();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        error = `Cannot inspect Squad team file: ${String(e)}`;
      }
    }
    const status: SourceStatus = {
      workspaceRoot: this.workspaceRoot,
      squadDir,
      teamFound,
      observer: this.pollTimer && !this.disposed ? 'watching' : 'stopped',
      nativeWatch: this.fsWatcher !== null,
      error,
    };
    const serialized = JSON.stringify(status);
    if (serialized !== this.lastStatus) {
      this.lastStatus = serialized;
      this.callbacks.onStatusChanged?.(status);
    }
  }

  /** Compare the Squad directory with the last scan and emit changes. */
  scan(): void {
    if (this.disposed) {
      return;
    }
    const squadDir = resolveSquadDir(this.workspaceRoot);
    this.ensureFsWatch(squadDir);
    this.publishStatus();

    const emit = this.baselined;
    this.baselined = true;

    const teamStamp = statFile(path.join(squadDir, 'team.md'));
    if (!sameStamp(teamStamp, this.teamStamp)) {
      const hadTeam = this.teamStamp !== null || emit;
      this.teamStamp = teamStamp;
      if (hadTeam) {
        this.callbacks.onRosterChanged();
      }
    }

    this.scanFlat(path.join(squadDir, 'sessions'), emit, (file, name) => this.onSessionFile(file, name));
    this.scanFlat(path.join(squadDir, 'log'), emit, file => this.onLogFile(file));
    this.scanFlat(path.join(squadDir, 'orchestration-log'), emit, (file, name) => this.onOrchestrationFile(file, name));
    this.scanFlat(path.join(squadDir, 'decisions', 'inbox'), emit, (file, name) => this.onInboxFile(file, name));

    const agentsDir = path.join(squadDir, 'agents');
    for (const entry of listEntries(agentsDir)) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) {
        continue;
      }
      const slug = entry.name;
      this.scanFlat(path.join(agentsDir, slug), emit, (file, name) => this.onAgentFile(slug, file, name));
    }
  }

  private ensureFsWatch(squadDir: string): void {
    if (this.options.useFsWatch === false || (this.watchedDir === squadDir && fs.existsSync(squadDir))) {
      return;
    }
    this.fsWatcher?.close();
    this.fsWatcher = null;
    this.watchedDir = null;
    this.watchError = null;
    try {
      if (!fs.existsSync(squadDir)) {
        return;
      }
      this.fsWatcher = fs.watch(squadDir, { persistent: false, recursive: true }, () => this.queueScan());
      this.fsWatcher.on('error', (error) => {
        this.fsWatcher?.close();
        this.fsWatcher = null;
        this.watchedDir = null;
        this.watchError = `Native watch unavailable; polling fallback: ${error.message}`;
        this.publishStatus();
      });
      this.watchedDir = squadDir;
    } catch (error) {
      this.watchError = `Native watch unavailable; polling fallback: ${String(error)}`;
    }
  }

  private queueScan(): void {
    if (this.disposed || this.scanQueued) {
      return;
    }
    this.scanQueued = setTimeout(() => {
      this.scanQueued = null;
      this.scan();
    }, 150);
  }

  private scanFlat(dir: string, emit: boolean, onChanged: (filePath: string, filename: string) => void): void {
    for (const entry of listEntries(dir)) {
      if (!entry.isFile()) {
        continue;
      }
      // The structured ledger is historical data, never an activity signal.
      if (entry.name.toLowerCase() === 'usage.jsonl') {
        continue;
      }
      const filePath = path.join(dir, entry.name);
      const stamp = statFile(filePath);
      if (!stamp) {
        continue;
      }
      const prev = this.known.get(filePath);
      if (sameStamp(prev ?? null, stamp)) {
        continue;
      }
      this.known.set(filePath, stamp);
      if (emit) {
        onChanged(filePath, entry.name);
      }
    }
  }

  private emitActivity(agentId: string, task: string | null, source: ActivitySource, filePath: string): void {
    this.callbacks.onAgentActivity({
      agentId, status: 'active', task: task ?? `File changed: ${path.basename(filePath)}`, source,
    });
  }

  private onSessionFile(filePath: string, filename: string): void {
    const content = safeReadFile(filePath);
    const session = content ? parseSessionFile(content) : null;
    if (!session) {
      return;
    }
    const agentId = session.agent ?? detectAgentFromFilename(filename);
    if (agentId) {
      this.emitActivity(agentId, extractSessionTask(session), 'session', filePath);
    }
  }

  private onLogFile(filePath: string): void {
    const content = safeReadFile(filePath);
    const entry = content ? parseLogEntry(content) : null;
    if (entry?.agent) {
      this.emitActivity(entry.agent, entry.summary || null, 'log', filePath);
    }
  }

  private onOrchestrationFile(filePath: string, filename: string): void {
    const content = stripHtmlComments(safeReadFile(filePath) ?? '');
    let agentId = detectAgentFromFilename(filename);
    const taskField = /\*\*Task:\*\*[ \t]*([^\r\n]*)/i.exec(content)?.[1]?.trim();
    let task: string | null = taskField ? meaningfulLine(taskField) : null;
    if (!agentId || !task) {
      const entry = parseLogEntry(content);
      agentId = agentId ?? entry?.agent ?? null;
      task = task ?? (entry?.summary || null);
    }
    if (agentId) {
      this.emitActivity(agentId, task, 'orchestration-log', filePath);
    }
  }

  private onInboxFile(filePath: string, filename: string): void {
    const agentId = detectAgentFromInboxFile(filename);
    if (!agentId) {
      return;
    }
    const content = stripHtmlComments(safeReadFile(filePath) ?? '');
    const title = /^#\s+(.+)/m.exec(content)?.[1]?.trim();
    const meaningfulTitle = title && !/^(?:decisions?|inbox|history|learnings)\s*$/i.test(title) ? meaningfulLine(title) : null;
    this.emitActivity(agentId, meaningfulTitle ? `Decision: ${meaningfulTitle}` : summarizeHistory(content), 'decision', filePath);
  }

  private onAgentFile(slug: string, filePath: string, filename: string): void {
    let task: string | null = null;
    if (/^history\.md$/i.test(filename)) {
      task = summarizeHistory(safeReadFile(filePath) ?? '');
    }
    this.emitActivity(slug, task, 'agent-files', filePath);
  }
}

function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
  if (!a || !b) {
    return a === b;
  }
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/**
 * Start watching a workspace's Squad directory. Returns a dispose function.
 */
export function startSquadWatching(
  workspaceRoot: string,
  callbacks: SquadWatcherCallbacks,
  options?: SquadWatcherOptions,
): () => void {
  const watcher = new SquadWatcher(workspaceRoot, callbacks, options);
  watcher.start();
  return () => watcher.dispose();
}