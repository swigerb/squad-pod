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
import {
  SQUAD_TEAM_FILE,
  SQUAD_SESSIONS_DIR,
  SQUAD_LOG_DIR,
  SQUAD_ORCHESTRATION_LOG_DIR,
  FILE_WATCHER_POLL_INTERVAL_MS,
} from './constants.js';
import type { SquadSession } from './types.js';

// ─── Types ──────────────────────────────────────────────────────────

export type AgentActivityStatus = 'active' | 'idle' | 'waiting';

export interface AgentActivityEvent {
  agentId: string;          // agent slug
  status: AgentActivityStatus;
  task: string | null;      // brief description of current work
  source: 'session' | 'log' | 'orchestration-log';
}

export interface SquadWatcherCallbacks {
  /** Called when the team roster file changes (re-read and refresh agents). */
  onRosterChanged: () => void;
  /** Called when agent activity is detected from any watched source. */
  onAgentActivity: (event: AgentActivityEvent) => void;
}

interface WatchedFile {
  path: string;
  lastMtimeMs: number;
  lastSize: number;
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
  const agentMatch = /\*\*Agent:\*\*\s*(.+?)(?:\s*\(|$)/i.exec(content);
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
  for (const line of lines) {
    if (line.startsWith('#')) {
      continue;
    }
    if (/^\*\*(Timestamp|Agent|Task|Status):\*\*/i.test(line)) {
      continue;
    }
    if (line.length > 3) {
      summary = line.replace(/^\*\*\w+:\*\*\s*/, '').slice(0, 120);
      break;
    }
  }

  if (!summary && !agent) {
    return null;
  }

  return { agent, timestamp, summary };
}

/**
 * Try to identify the agent slug from a session file's messages.
 * Heuristic: look for agent names mentioned in system/assistant messages,
 * or derive from the filename pattern `{timestamp}_{id}.json`.
 */
function detectAgentFromSession(session: SquadSession, _filename: string): string | null {
  if (session.agent) {
    return session.agent;
  }

  // Check messages for agent mentions — look for known patterns like
  // "Lisa Simpson" or "homer-simpson" in message content.
  // This is a heuristic; the extension doesn't have the full roster at
  // this layer, so we return null and let the agentManager resolve it.
  return null;
}

/**
 * Try to identify the agent slug from a log/orch-log filename.
 * Orchestration logs: `2026-03-05T21-46-29Z-lisa-simpson.md`
 * Regular logs: `2026-03-05T21-46-29Z.md` (no agent info)
 */
function detectAgentFromFilename(filename: string): string | null {
  // Orchestration log filenames: {timestamp}-{agent-slug}.md
  // The timestamp is like 2026-03-05T21-46-29Z, so everything after that is the slug.
  const match = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-(.+)\.md$/i.exec(filename);
  if (match?.[1]) {
    return match[1];
  }
  return null;
}

// ─── File Tracking ──────────────────────────────────────────────────

function statFile(filePath: string): { mtimeMs: number; size: number } | null {
  try {
    const stat = fs.statSync(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

function listFiles(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath).filter(f => !f.startsWith('.'));
  } catch {
    return [];
  }
}

// ─── Squad Watcher ──────────────────────────────────────────────────

interface ActiveWatcher {
  fsWatcher: fs.FSWatcher | null;
  pollTimer: ReturnType<typeof setInterval>;
}

let activeWatchers: ActiveWatcher[] = [];
let disposed = false;

/**
 * Start watching the `.squad/` directory for changes.
 * Sets up watchers on:
 *   - `.squad/team.md` — roster changes
 *   - `.squad/sessions/` — new/updated session files
 *   - `.squad/log/` — session logs
 *   - `.squad/orchestration-log/` — orchestration activity
 *
 * Returns a dispose function to tear down all watchers.
 */
export function startSquadWatching(
  workspaceRoot: string,
  callbacks: SquadWatcherCallbacks,
): () => void {
  disposed = false;
  activeWatchers = [];

  // ── team.md watcher ────────────────────────────────────────────
  const teamFilePath = path.join(workspaceRoot, SQUAD_TEAM_FILE);
  let teamFileState = statFile(teamFilePath);

  const teamWatcher = watchPath(teamFilePath, () => {
    const newState = statFile(teamFilePath);
    if (
      newState &&
      (newState.mtimeMs !== teamFileState?.mtimeMs || newState.size !== teamFileState?.size)
    ) {
      teamFileState = newState;
      callbacks.onRosterChanged();
    }
  });
  activeWatchers.push(teamWatcher);

  // ── Session directory watcher ──────────────────────────────────
  const sessionsDir = path.join(workspaceRoot, SQUAD_SESSIONS_DIR);
  const knownSessionFiles = new Map<string, WatchedFile>();

  const sessionWatcher = watchDirectory(sessionsDir, () => {
    scanDirectory(sessionsDir, knownSessionFiles, (filePath, filename) => {
      const content = safeReadFile(filePath);
      if (!content) {return;}

      const session = parseSessionFile(content);
      if (!session) {return;}

      const agentId = detectAgentFromSession(session, filename) ?? detectAgentFromFilename(filename);
      if (agentId) {
        callbacks.onAgentActivity({
          agentId,
          status: 'active',
          task: extractSessionTask(session),
          source: 'session',
        });
      }
    });
  });
  activeWatchers.push(sessionWatcher);

  // ── Log directory watcher ──────────────────────────────────────
  const logDir = path.join(workspaceRoot, SQUAD_LOG_DIR);
  const knownLogFiles = new Map<string, WatchedFile>();

  const logWatcher = watchDirectory(logDir, () => {
    scanDirectory(logDir, knownLogFiles, (filePath, _filename) => {
      const content = safeReadFile(filePath);
      if (!content) {return;}

      const entry = parseLogEntry(content);
      if (entry?.agent) {
        callbacks.onAgentActivity({
          agentId: entry.agent,
          status: 'active',
          task: entry.summary || null,
          source: 'log',
        });
      }
    });
  });
  activeWatchers.push(logWatcher);

  // ── Orchestration log directory watcher ────────────────────────
  const orchDir = path.join(workspaceRoot, SQUAD_ORCHESTRATION_LOG_DIR);
  const knownOrchFiles = new Map<string, WatchedFile>();

  const orchWatcher = watchDirectory(orchDir, () => {
    scanDirectory(orchDir, knownOrchFiles, (filePath, filename) => {
      // Try filename first (faster)
      let agentId = detectAgentFromFilename(filename);
      let task: string | null = null;

      if (!agentId) {
        const content = safeReadFile(filePath);
        if (content) {
          const entry = parseLogEntry(content);
          if (entry) {
            agentId = entry.agent;
            task = entry.summary || null;
          }
        }
      } else {
        // Still try to get a task summary from the content
        const content = safeReadFile(filePath);
        if (content) {
          const taskMatch = /\*\*Task:\*\*\s*(.+)/i.exec(content);
          task = taskMatch?.[1]?.trim() ?? null;
        }
      }

      if (agentId) {
        callbacks.onAgentActivity({
          agentId,
          status: 'active',
          task,
          source: 'orchestration-log',
        });
      }
    });
  });
  activeWatchers.push(orchWatcher);

  // Return a dispose function
  return () => {
    disposed = true;
    for (const w of activeWatchers) {
      w.fsWatcher?.close();
      clearInterval(w.pollTimer);
    }
    activeWatchers = [];
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────

function watchPath(
  filePath: string,
  onChange: () => void,
): ActiveWatcher {
  let fsWatcher: fs.FSWatcher | null = null;
  try {
    fsWatcher = fs.watch(filePath, { persistent: false }, () => {
      if (!disposed) {onChange();}
    });
    fsWatcher.on('error', () => {
      // Silently ignore — polling will still work
    });
  } catch {
    // fs.watch not available or file doesn't exist yet — rely on polling
  }

  const pollTimer = setInterval(() => {
    if (!disposed) {onChange();}
  }, FILE_WATCHER_POLL_INTERVAL_MS);

  return { fsWatcher, pollTimer };
}

function watchDirectory(
  dirPath: string,
  onChange: () => void,
): ActiveWatcher {
  let fsWatcher: fs.FSWatcher | null = null;
  try {
    if (fs.existsSync(dirPath)) {
      fsWatcher = fs.watch(dirPath, { persistent: false }, () => {
        if (!disposed) {onChange();}
      });
      fsWatcher.on('error', () => {});
    }
  } catch {
    // Rely on polling
  }

  const pollTimer = setInterval(() => {
    if (!disposed) {onChange();}
  }, FILE_WATCHER_POLL_INTERVAL_MS);

  return { fsWatcher, pollTimer };
}

function scanDirectory(
  dirPath: string,
  known: Map<string, WatchedFile>,
  onChanged: (filePath: string, filename: string) => void,
): void {
  const files = listFiles(dirPath);
  for (const filename of files) {
    const filePath = path.join(dirPath, filename);
    const stat = statFile(filePath);
    if (!stat) {continue;}

    const prev = known.get(filename);
    if (!prev || prev.lastMtimeMs !== stat.mtimeMs || prev.lastSize !== stat.size) {
      known.set(filename, { path: filePath, lastMtimeMs: stat.mtimeMs, lastSize: stat.size });
      onChanged(filePath, filename);
    }
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
  // Use the last message as a rough indicator of the current task
  if (session.messages.length === 0) {
    return null;
  }
  const last = session.messages[session.messages.length - 1];
  if (!last) {return null;}
  // Truncate for display
  const cleaned = last.content.replace(/\n/g, ' ').trim();
  return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
}
