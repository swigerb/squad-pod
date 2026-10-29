/// <reference types="vitest/globals" />
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SourceStatus } from './types.js';
import {
  parseSessionFile,
  parseLogEntry,
  SquadWatcher,
  detectAgentFromFilename,
  summarizeHistory,
  type AgentActivityEvent,
} from './squadWatcher.js';

describe('parseSessionFile', () => {
  it('parses valid session JSON with messages', () => {
    const content = JSON.stringify({
      id: 'sess-001',
      createdAt: '2025-01-15T10:00:00Z',
      lastActiveAt: '2025-01-15T10:05:00Z',
      agent: 'homer-simpson',
      messages: [
        { role: 'user', content: 'Fix the bug', timestamp: '2025-01-15T10:00:00Z' },
        { role: 'assistant', content: 'On it', timestamp: '2025-01-15T10:01:00Z' },
      ],
    });

    const session = parseSessionFile(content);

    expect(session).not.toBeNull();
    expect(session!.id).toBe('sess-001');
    expect(session!.createdAt).toBe('2025-01-15T10:00:00Z');
    expect(session!.agent).toBe('homer-simpson');
    expect(session!.messages).toHaveLength(2);
    expect(session!.messages[0].role).toBe('user');
    expect(session!.messages[0].content).toBe('Fix the bug');
  });

  it('returns null for invalid JSON', () => {
    expect(parseSessionFile('not json {')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    // Missing 'id'
    const noId = JSON.stringify({ createdAt: '2025-01-15T10:00:00Z' });
    expect(parseSessionFile(noId)).toBeNull();

    // Missing 'createdAt'
    const noDate = JSON.stringify({ id: 'test-1' });
    expect(parseSessionFile(noDate)).toBeNull();
  });

  it('handles session with no messages array', () => {
    const content = JSON.stringify({
      id: 'sess-002',
      createdAt: '2025-01-15T10:00:00Z',
    });
    const session = parseSessionFile(content);
    expect(session).not.toBeNull();
    expect(session!.messages).toEqual([]);
  });
});

describe('parseLogEntry', () => {
  it('extracts agent and timestamp from **Agent:** and **Timestamp:** fields', () => {
    const content = `# Log Entry

**Timestamp:** 2025-01-15T10:30:00Z
**Agent:** Lisa Simpson (Core Dev)

Implemented the new feature for the extension.
`;

    const result = parseLogEntry(content);

    expect(result).not.toBeNull();
    expect(result!.agent).toBe('lisa-simpson');
    expect(result!.timestamp).toBe('2025-01-15T10:30:00Z');
    expect(result!.summary).toBe('Implemented the new feature for the extension.');
  });

  it('extracts agent from heading-based format (# Log — Agent Name)', () => {
    const content = `# Orchestration Log — Lisa Simpson

Some orchestration details here.
`;

    const result = parseLogEntry(content);

    expect(result).not.toBeNull();
    expect(result!.agent).toBe('lisa-simpson');
    expect(result!.summary).toBe('Some orchestration details here.');
  });

  it('returns null for empty content', () => {
    expect(parseLogEntry('')).toBeNull();
    expect(parseLogEntry('   \n  \n  ')).toBeNull();
  });

  it('returns null when there is no agent and no meaningful summary', () => {
    // Only headings and metadata fields — no agent, no summary
    const content = `# Title
**Timestamp:** 2025-01-15
**Status:** done
`;
    const result = parseLogEntry(content);
    expect(result).toBeNull();
  });

  it('extracts timestamp from ISO date in first line when no **Timestamp:** field', () => {
    const content = `2025-01-15T10:30:00Z — something happened

**Agent:** Homer Simpson (Lead)

Built the new donut feature.
`;
    const result = parseLogEntry(content);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe('2025-01-15T10:30:00Z');
    expect(result!.agent).toBe('homer-simpson');
  });

  it('returns a result with summary even without agent if summary is meaningful', () => {
    const content = `# Activity Log

This is a meaningful summary of what happened during the session.
`;
    const result = parseLogEntry(content);
    // Has summary but no agent — still should return a result
    expect(result).not.toBeNull();
    expect(result!.agent).toBeNull();
    expect(result!.summary).toContain('meaningful summary');
  });
});

describe('detectAgentFromFilename', () => {
  it('extracts the agent slug from orchestration-log names', () => {
    expect(detectAgentFromFilename('2026-03-05T21-46-29Z-lisa-simpson.md')).toBe('lisa-simpson');
    expect(detectAgentFromFilename('2026-03-05T21-46-29Z.md')).toBeNull();
  });
});

describe('summarizeHistory', () => {
  it('returns the latest meaningful line', () => {
    expect(summarizeHistory('# History\n\n## Learnings\n- Added **retry** logic\n')).toBe('Added retry logic');
  });
});

describe('SquadWatcher', () => {
  let root: string;
  let events: AgentActivityEvent[];
  let rosterChanges: number;
  let watcher: SquadWatcher;

  function write(rel: string, content: string, squadDir = '.squad') {
    const file = path.join(root, squadDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    const future = new Date(Date.now() + Math.random() * 1000 + 1000);
    fs.utimesSync(file, future, future);
  }

  function start() {
    watcher = new SquadWatcher(
      root,
      {
        onRosterChanged: () => { rosterChanges++; },
        onAgentActivity: e => { events.push(e); },
      },
      { useFsWatch: false },
    );
    watcher.scan();
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad pod watcher '));
    events = [];
    rosterChanges = 0;
  });

  afterEach(() => {
    watcher?.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('does not replay existing history as live activity on startup', () => {
    write('team.md', '# Team');
    write('agents/homer/history.md', '- old work');
    write('orchestration-log/2026-01-01T00-00-00Z-homer.md', '**Task:** old');
    start();
    expect(events).toEqual([]);
    expect(rosterChanges).toBe(0);
  });

  it('emits activity for agent file edits, inbox decisions and orchestration logs', () => {
    write('team.md', '# Team');
    start();

    write('agents/homer/history.md', '# History\n- Implemented login flow');
    write('decisions/inbox/lisa-cache-strategy.md', '# Use Redis cache\nDetails');
    write('orchestration-log/2026-01-02T10-00-00Z-bart.md', '**Task:** Write E2E tests');
    watcher.scan();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: 'homer', task: 'Implemented login flow', source: 'agent-files' }),
        expect.objectContaining({ agentId: 'lisa-cache-strategy', task: 'Decision: Use Redis cache', source: 'decision' }),
        expect.objectContaining({ agentId: 'bart', task: 'Write E2E tests', source: 'orchestration-log' }),
      ]),
    );
    expect(events).toHaveLength(3);

    events = [];
    watcher.scan();
    expect(events).toEqual([]);
  });

  it('reports roster changes when team.md changes', () => {
    write('team.md', '# Team');
    start();
    write('team.md', '# Team\n| Homer | Lead |');
    watcher.scan();
    expect(rosterChanges).toBe(1);
  });

  it('supports the legacy .ai-team directory', () => {
    write('team.md', '# Team', '.ai-team');
    start();
    write('agents/marge/history.md', '- Reviewed PR', '.ai-team');
    watcher.scan();
    expect(events).toEqual([expect.objectContaining({ agentId: 'marge', source: 'agent-files' })]);
  });

  it('notices a squad directory created after startup', () => {
    start();
    write('team.md', '# Team');
    watcher.scan();
    expect(rosterChanges).toBe(1);
  });

  it('reports real polling, team creation/removal, and disposal without emitting invented activity', () => {
    const statuses: SourceStatus[] = [];
    watcher = new SquadWatcher(root, {
      onRosterChanged: () => { rosterChanges++; },
      onAgentActivity: e => events.push(e),
      onStatusChanged: status => statuses.push(status),
    }, { useFsWatch: false });
    watcher.start();
    expect(statuses.at(-1)).toEqual({
      workspaceRoot: root, squadDir: path.join(root, '.squad'),
      teamFound: false, observer: 'watching', nativeWatch: false, error: null,
    });
    watcher.start();
    watcher.scan();
    expect(statuses).toHaveLength(1);
    write('team.md', '# Team');
    watcher.scan();
    expect(statuses.at(-1)?.teamFound).toBe(true);
    fs.unlinkSync(path.join(root, '.squad', 'team.md'));
    watcher.scan();
    expect(statuses.at(-1)?.teamFound).toBe(false);
    expect(rosterChanges).toBe(2);
    expect(events).toEqual([]);
    watcher.dispose();
    expect(statuses.at(-1)).toMatchObject({ observer: 'stopped', nativeWatch: false });
  });

  it('reports legacy team presence and native watcher registration separately from polling', () => {
    write('team.md', '# Legacy team', '.ai-team');
    const statuses: SourceStatus[] = [];
    watcher = new SquadWatcher(root, {
      onRosterChanged: () => {},
      onAgentActivity: e => events.push(e),
      onStatusChanged: status => statuses.push(status),
    });
    watcher.start();
    expect(statuses.at(-1)).toMatchObject({
      squadDir: path.join(root, '.ai-team'), teamFound: true, observer: 'watching',
    });
    // Native recursive watch is platform-dependent; it must either register
    // or explain why polling is the only observer.
    const status = statuses.at(-1)!;
    expect(status.nativeWatch || status.error?.includes('polling fallback')).toBeTruthy();
    expect(events).toEqual([]);
  });

  it('surfaces filesystem inspection failures instead of claiming a healthy source', () => {
    fs.writeFileSync(path.join(root, '.squad'), 'not a directory');
    const statuses: SourceStatus[] = [];
    watcher = new SquadWatcher(root, {
      onRosterChanged: () => {},
      onAgentActivity: e => events.push(e),
      onStatusChanged: status => statuses.push(status),
    }, { useFsWatch: false });
    watcher.start();
    expect(statuses.at(-1)).toMatchObject({
      teamFound: false, observer: 'watching', nativeWatch: false,
      error: expect.stringContaining('Cannot inspect Squad team file'),
    });
    expect(events).toEqual([]);
  });
});