/// <reference types="vitest/globals" />
import fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { readTeamFile, readTeamRoster } from './teamParser.js';
import { ProjectFiles } from './projectFiles.js';
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
  it('ignores commented identity and setext headings, retaining only visible meaningful content', () => {
    expect(parseLogEntry('<!-- **Agent:** hidden-agent -->\nLog\n===\n<!-- template -->')).toBeNull();
    expect(parseLogEntry('**Agent:** TestBot\nLog\n===\n**Context:**\n- Verified retry behavior'))
      .toMatchObject({ agent: 'testbot', summary: 'Verified retry behavior' });
  });

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
  it.each([
    '# TestBot History\n\n## Learnings\n<!-- Append only work actually completed. -->',
    '# History\n<!-- multi-line\n- Not completed work\n-->\n## Completed Work\n---\n- [ ]\n**Task:**',
    '# History\n## Empty section\n===\n| --- | :---: |',
    'TestBot History\n===\nLearnings\n---',
    '# History\n**Context:**\n<!-- unfinished\n- Not completed work',
  ])('does not infer work from scaffolding: %s', content => {
    expect(summarizeHistory(content)).toBeNull();
  });

  it('removes inline comments without discarding meaningful work', () => {
    expect(summarizeHistory('# History\n- Added **retry** logic <!-- template -->\n## Learnings'))
      .toBe('Added retry logic');
  });

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
    root = fs.mkdtempSync(path.resolve('.squad-watcher-fixture-'));
    events = [];
    rosterChanges = 0;
  });

  afterEach(() => {
    watcher?.dispose();
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refreshes through the guarded legacy APIs after rejected content and recovery', () => {
    const content = '# Synthetic team\n## Members\n| Name | Role | Charter |\n|---|---|---|\n'
      + '| Ada | Developer | .squad/agents/Mixed_Name-2/charter.md |\n';
    const snapshots: Array<{ raw: string | null; ids: string[] }> = [];
    write('team.md', content);
    watcher = new SquadWatcher(root, {
      onRosterChanged: () => snapshots.push({
        raw: readTeamFile(root), ids: readTeamRoster(root).map(member => member.slug),
      }),
      onAgentActivity: () => {},
    }, { useFsWatch: false });
    watcher.scan();
    write('team.md', content.padEnd(256 * 1024 + 1, ' '));
    watcher.scan();
    expect(snapshots.at(-1)).toEqual({ raw: null, ids: [] });
    write('team.md', content);
    watcher.scan();
    expect(snapshots.at(-1)).toEqual({ raw: content, ids: ['Mixed_Name-2'] });
    fs.renameSync(path.join(root, '.squad'), path.join(root, '.ai-team'));
    fs.mkdirSync(path.join(root, '.squad'));
    watcher.scan();
    expect(snapshots.at(-1)).toEqual({ raw: null, ids: [] });
  });

  it('does not replay existing history as live activity on startup', () => {
    write('team.md', '# Team');
    write('agents/homer/history.md', '- old work');
    write('orchestration-log/2026-01-01T00-00-00Z-homer.md', '**Task:** old');
    start();
    expect(events).toEqual([]);
    expect(rosterChanges).toBe(1);
  });

  it.each([false, true])('refreshes unchanged legacy content across junction refusal, initially refused=%s', refused => {
    const content = '## Members\n| Name | Role | Charter |\n|---|---|---|\n'
      + '| Ada | Developer | .ai-team/agents/ada/charter.md |\n';
    write('team.md', content, '.ai-team');
    const legacy = path.join(root, '.ai-team');
    const target = path.join(root, 'legacy-target');
    const stamp = fs.statSync(path.join(legacy, 'team.md'));
    const link = () => {
      fs.renameSync(legacy, target);
      fs.symlinkSync(target, legacy, 'junction');
    };
    const restore = () => {
      fs.unlinkSync(legacy);
      fs.renameSync(target, legacy);
    };
    if (refused) { link(); }
    const statuses: SourceStatus[] = [];
    const snapshots: Array<{ ids: string[]; status: SourceStatus | undefined }> = [];
    watcher = new SquadWatcher(root, {
      onStatusChanged: status => statuses.push(status),
      onRosterChanged: () => snapshots.push({
        ids: readTeamRoster(root).map(member => member.slug), status: statuses.at(-1),
      }),
      onAgentActivity: e => events.push(e),
    }, { useFsWatch: false });
    try {
      watcher.scan();
      expect(statuses.at(-1)).toMatchObject({ teamFound: !refused, error: refused ? expect.any(String) : null });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({
        ids: refused ? [] : ['ada'], status: { teamFound: !refused },
      });
      if (refused) { restore(); } else { link(); }
      watcher.scan();
      expect(snapshots).toHaveLength(2);
      expect(snapshots[1]).toMatchObject({
        ids: refused ? ['ada'] : [],
        status: { teamFound: refused, error: refused ? null : expect.any(String) },
      });
      watcher.scan();
      expect(snapshots).toHaveLength(2);
      if (refused) { link(); } else { restore(); }
      watcher.scan();
      expect(snapshots).toHaveLength(3);
      expect(snapshots[2]).toMatchObject({
        ids: refused ? [] : ['ada'],
        status: { teamFound: !refused, error: refused ? expect.any(String) : null },
      });
      expect(events).toEqual([]);
      expect(fs.statSync(path.join(legacy, 'team.md'))).toMatchObject({ size: stamp.size, mtimeMs: stamp.mtimeMs });
      expect(fs.readFileSync(path.join(legacy, 'team.md'), 'utf8')).toBe(content);
    } finally {
      // Remove only the junction itself; recursive fixture cleanup must not traverse it.
      if (fs.lstatSync(legacy).isSymbolicLink()) { restore(); }
    }
  });

  it.each(['oversize', 'invalid UTF-8'])('publishes %s refusal before roster refresh and recovers', refusal => {
    const content = '## Members\n| Name | Role | Charter |\n|---|---|---|\n'
      + '| Ada | Developer | .squad/agents/ada/charter.md |\n';
    write('team.md', content);
    const statuses: SourceStatus[] = [];
    const snapshots: Array<{ ids: string[]; status: SourceStatus | undefined }> = [];
    watcher = new SquadWatcher(root, {
      onStatusChanged: status => statuses.push(status),
      onRosterChanged: () => snapshots.push({
        ids: readTeamRoster(root).map(member => member.slug), status: statuses.at(-1),
      }),
      onAgentActivity: () => {},
    }, { useFsWatch: false });
    watcher.scan();
    expect(statuses.at(-1)).toMatchObject({ teamFound: true, error: null });
    expect(snapshots).toEqual([{ ids: ['ada'], status: statuses.at(-1) }]);
    fs.writeFileSync(path.join(root, '.squad', 'team.md'),
      refusal === 'oversize' ? content.padEnd(256 * 1024 + 1, ' ') : Buffer.from([0xff]));
    watcher.scan();
    expect(snapshots.at(-1)).toMatchObject({
      ids: [], status: { teamFound: false, error: expect.any(String) },
    });
    watcher.scan();
    expect(snapshots).toHaveLength(2);
    write('team.md', content);
    watcher.scan();
    expect(snapshots.at(-1)).toMatchObject({
      ids: ['ada'], status: { teamFound: true, error: null },
    });
  });

  it('reuses bounded validation and snapshot callbacks without redundant reads or events', () => {
    write('team.md', '# Synthetic team');
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    const statuses: SourceStatus[] = [];
    const roster = vi.fn<() => void>(() => {
      expect(watcher.getTeamSource()?.status === 'available').toBe(statuses.at(-1)?.teamFound);
    });
    watcher = new SquadWatcher(root, {
      onRosterChanged: roster, onStatusChanged: status => statuses.push(status),
      onAgentActivity: e => events.push(e),
    }, { useFsWatch: false });
    expect(watcher.getTeamSource()).toBeNull();
    watcher.start();
    const initial = watcher.getTeamSource();
    watcher.scan();
    expect(watcher.getTeamSource()).toBe(initial);
    expect(read).toHaveBeenCalledTimes(1);
    expect(roster).toHaveBeenCalledExactlyOnceWith();
    expect(statuses).toHaveLength(1);
    write('team.md', '# Updated synthetic team');
    watcher.scan();
    expect(roster).toHaveBeenCalledTimes(2);
    expect(roster.mock.calls).toEqual([[], []]);
    expect(watcher.getTeamSource()).toMatchObject({ status: 'available', content: '# Updated synthetic team' });
    watcher.scan();
    expect(read).toHaveBeenCalledTimes(2);
    fs.writeFileSync(path.join(root, '.squad', 'team.md'), Buffer.from([0xff]));
    watcher.scan();
    expect(roster).toHaveBeenCalledTimes(3);
    expect(roster.mock.calls).toEqual([[], [], []]);
    expect(watcher.getTeamSource()).toMatchObject({ status: 'unreadable', reason: 'Source is not valid UTF-8.' });
    watcher.scan();
    expect(read).toHaveBeenCalledTimes(3);
    expect(statuses).toHaveLength(2);
    watcher.dispose();
    watcher.scan();
    expect(read).toHaveBeenCalledTimes(3);
    expect(roster).toHaveBeenCalledTimes(3);
    expect(events).toEqual([]);
    expect(statuses.at(-1)).toMatchObject({ teamFound: false, observer: 'stopped', error: expect.stringContaining('UTF-8') });
  });

  it('does not replay historical activity when a refused source recovers', () => {
    write('team.md', '# Synthetic team');
    write('agents/ada/history.md', '- Historical work');
    fs.writeFileSync(path.join(root, '.squad', 'team.md'), Buffer.from([0xff]));
    start();
    expect(events).toEqual([]);
    write('team.md', '# Recovered team');
    watcher.scan();
    expect(events).toEqual([]);
    write('agents/ada/history.md', '- Newly observed work');
    watcher.scan();
    expect(events).toEqual([expect.objectContaining({ agentId: 'ada', task: 'Newly observed work' })]);
  });

  it.each([true, false])('refreshes unchanged legacy content when the preferred blocker starts present=%s', blocked => {
    const content = '## Members\n| Name | Role | Charter |\n|---|---|---|\n'
      + '| Ada | Developer | .ai-team/agents/Mixed_Name-2/charter.md |\n';
    write('team.md', content, '.ai-team');
    const preferred = path.join(root, '.squad');
    const legacyTeam = path.join(root, '.ai-team', 'team.md');
    const stamp = fs.statSync(legacyTeam);
    if (blocked) { fs.writeFileSync(preferred, 'not a directory'); }
    const snapshots: Array<{ raw: string | null; ids: string[] }> = [];
    const statuses: SourceStatus[] = [];
    const rosterStatuses: Array<SourceStatus | undefined> = [];
    const snapshot = () => ({
      raw: readTeamFile(root), ids: readTeamRoster(root).map(member => member.slug),
    });
    watcher = new SquadWatcher(root, {
      onRosterChanged: () => {
        snapshots.push(snapshot());
        rosterStatuses.push(statuses.at(-1));
      },
      onAgentActivity: e => events.push(e),
      onStatusChanged: status => statuses.push(status),
    }, { useFsWatch: false });
    watcher.scan();
    const availability = (refused: boolean) => ({
      teamFound: !refused,
      error: refused ? expect.stringContaining('selected-project roster source unavailable') : null,
    });
    expect(statuses.at(-1)).toMatchObject(availability(blocked));
    expect(snapshot()).toEqual(blocked ? { raw: null, ids: [] } : { raw: content, ids: ['Mixed_Name-2'] });
    expect(snapshots).toEqual([blocked ? { raw: null, ids: [] } : { raw: content, ids: ['Mixed_Name-2'] }]);
    expect(rosterStatuses.at(-1)).toMatchObject(availability(blocked));

    if (blocked) { fs.unlinkSync(preferred); }
    else { fs.writeFileSync(preferred, 'not a directory'); }
    watcher.scan();
    expect(snapshots).toEqual([
      blocked ? { raw: null, ids: [] } : { raw: content, ids: ['Mixed_Name-2'] },
      blocked ? { raw: content, ids: ['Mixed_Name-2'] } : { raw: null, ids: [] },
    ]);
    expect(statuses.at(-1)).toMatchObject(availability(!blocked));
    expect(rosterStatuses.at(-1)).toMatchObject(availability(!blocked));
    watcher.scan();
    expect(snapshots).toHaveLength(2);
    if (blocked) { fs.writeFileSync(preferred, 'not a directory'); }
    else { fs.unlinkSync(preferred); }
    watcher.scan();
    expect(statuses.at(-1)).toMatchObject(availability(blocked));
    expect(rosterStatuses.at(-1)).toMatchObject(availability(blocked));
    expect(snapshots.at(-1)).toEqual(blocked ? { raw: null, ids: [] } : { raw: content, ids: ['Mixed_Name-2'] });
    expect(events).toEqual([]);
    expect(fs.readFileSync(legacyTeam, 'utf8')).toBe(content);
    expect(fs.statSync(legacyTeam)).toMatchObject({ mtimeMs: stamp.mtimeMs, size: stamp.size });
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

  it('uses neutral hints for scaffolding across file sources and leaves history untouched', () => {
    write('team.md', '# Team');
    start();
    const history = '# TestBot History\n## Learnings\n<!-- Append only work actually completed. -->';
    write('agents/testbot/history.md', history);
    write('log/test.md', '**Agent:** TestBot\n<!-- Not work -->\n## Activity');
    write('orchestration-log/2026-01-02T10-00-00Z-testbot.md', '**Task:** <!-- Not work -->');
    write('decisions/inbox/testbot-choice.md', '# Decision\n<!-- Write a decision here -->');
    write('sessions/test.json', JSON.stringify({
      id: 'test', createdAt: '2026-01-02', agent: 'testbot',
      messages: [{ content: '# Session\n<!-- Not work -->' }],
    }));
    watcher.scan();
    expect(events.map(event => event.task).sort()).toEqual([
      'File changed: history.md', 'File changed: test.md',
      'File changed: 2026-01-02T10-00-00Z-testbot.md',
      'File changed: testbot-choice.md', 'File changed: test.json',
    ].sort());
    expect(fs.readFileSync(path.join(root, '.squad', 'agents', 'testbot', 'history.md'), 'utf8')).toBe(history);
    events = [];
    write('agents/testbot/history.md', `${history}\n- Fixed retry handling\n`);
    watcher.scan();
    expect(events).toEqual([expect.objectContaining({ task: 'Fixed retry handling', source: 'agent-files' })]);
  });

  it('reports roster changes when team.md changes', () => {
    write('team.md', '# Team');
    start();
    expect(rosterChanges).toBe(1);
    write('team.md', '# Team\n| Homer | Lead |');
    watcher.scan();
    expect(rosterChanges).toBe(2);
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
    expect(rosterChanges).toBe(1);
    write('team.md', '# Team');
    watcher.scan();
    expect(rosterChanges).toBe(2);
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
    expect(rosterChanges).toBe(3);
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

  it('explicitly surfaces unexpected selection failures without exposing their details or reading content', () => {
    write('team.md', '# Synthetic legacy team', '.ai-team');
    const stat = fs.statSync;
    const inspect = vi.spyOn(fs, 'statSync').mockImplementation((...args: Parameters<typeof fs.statSync>) => {
      if (args[0] === root) { throw new Error('private synthetic details'); }
      return stat(...args);
    });
    const read = vi.spyOn(fs, 'readFileSync');
    const readBytes = vi.spyOn(fs, 'readSync');
    syncBuiltinESMExports();
    const statuses: SourceStatus[] = [];
    watcher = new SquadWatcher(root, {
      onRosterChanged: () => {},
      onAgentActivity: () => {},
      onStatusChanged: status => statuses.push(status),
    }, { useFsWatch: false });
    watcher.scan();
    watcher.scan();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      teamFound: false, observer: 'stopped',
      error: 'Cannot inspect Squad team file: selected-project roster source unavailable. Unexpected filesystem inspection/read failure.',
    });
    expect(inspect).toHaveBeenCalledWith(root, { bigint: true });
    expect(read).not.toHaveBeenCalled();
    expect(readBytes).not.toHaveBeenCalled();
    inspect.mockRestore();
    syncBuiltinESMExports();
    watcher.scan();
    watcher.scan();
    expect(statuses).toHaveLength(2);
    expect(statuses.at(-1)).toMatchObject({ teamFound: true, error: null });
    expect(read).not.toHaveBeenCalled();
    expect(readBytes).toHaveBeenCalledTimes(1);
  });

  it('retains native-watch errors alongside refusal, clears recovered errors, and ignores late disposed errors', () => {
    write('team.md', '# Synthetic legacy team', '.ai-team');
    const native = Object.assign(new EventEmitter(), { close: vi.fn() });
    const watch = vi.spyOn(fs, 'watch').mockReturnValue(native as unknown as fs.FSWatcher);
    syncBuiltinESMExports();
    const statuses: SourceStatus[] = [];
    watcher = new SquadWatcher(root, {
      onRosterChanged: () => {},
      onAgentActivity: () => {},
      onStatusChanged: status => statuses.push(status),
    });
    watcher.start();
    native.emit('error', new Error('synthetic native failure'));
    expect(statuses.at(-1)).toMatchObject({
      teamFound: true, nativeWatch: false, error: expect.stringContaining('Native watch unavailable; polling fallback'),
    });
    watch.mockImplementation(() => { throw new Error('synthetic retry failure'); });
    fs.writeFileSync(path.join(root, '.squad'), 'not a directory');
    watcher.scan();
    expect(statuses.at(-1)).toMatchObject({ teamFound: false, nativeWatch: false });
    expect(statuses.at(-1)?.error).toContain('selected-project roster source unavailable');
    expect(statuses.at(-1)?.error).toContain('polling fallback');
    fs.unlinkSync(path.join(root, '.squad'));
    watcher.scan();
    expect(statuses.at(-1)).toMatchObject({
      teamFound: true, nativeWatch: false, error: expect.stringContaining('Native watch unavailable; polling fallback'),
    });
    expect(statuses.at(-1)?.error).not.toContain('selected-project roster source unavailable');
    watch.mockReturnValue(native as unknown as fs.FSWatcher);
    watcher.scan();
    expect(statuses.at(-1)).toMatchObject({ teamFound: true, nativeWatch: true, error: null });
    watcher.dispose();
    const count = statuses.length;
    native.emit('error', new Error('synthetic late error'));
    watcher.scan();
    expect(statuses).toHaveLength(count);
    expect(statuses.at(-1)).toMatchObject({ observer: 'stopped', nativeWatch: false, error: null });
  });
});