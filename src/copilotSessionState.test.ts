import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listCopilotSessions, readSessionCwd, resolveCopilotHome } from './copilotSessionState.js';
import { SquadDirectorySuggestions } from './directories.js';

describe('read-only Copilot session metadata (synthetic homes only)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-session-metadata-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function session(id: string, metadata: string, time = 1700000000000) {
    const dir = path.join(root, 'session-state', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), metadata);
    fs.utimesSync(dir, time / 1000, time / 1000);
    return dir;
  }
  function squad(name: string, legacy = false) {
    const cwd = path.join(root, name);
    fs.mkdirSync(path.join(cwd, legacy ? '.ai-team' : '.squad'), { recursive: true });
    fs.writeFileSync(path.join(cwd, legacy ? '.ai-team' : '.squad', 'team.md'), 'Synthetic roster');
    return fs.realpathSync.native(cwd);
  }

  it('resolves an absolute override and falls back for missing, empty or relative overrides', () => {
    expect(resolveCopilotHome({ COPILOT_HOME: root }, root)).toBe(root);
    for (const override of [undefined, '', '   ', 'relative-home']) {
      expect(resolveCopilotHome({ COPILOT_HOME: override }, root)).toBe(path.join(root, '.copilot'));
    }
  });

  it('returns empty/null for missing or non-directory session roots and missing metadata', () => {
    expect(listCopilotSessions(root)).toEqual([]);
    expect(readSessionCwd(root)).toBeNull();
    fs.writeFileSync(path.join(root, 'session-state'), 'not a directory');
    expect(listCopilotSessions(root)).toEqual([]);
  });

  it('lists only directories, newest first, respects the requested limit and skips escaping links', () => {
    const older = session('older', '', 1700000000000);
    const newer = session('newer', '', 1700000100000);
    fs.writeFileSync(path.join(root, 'session-state', 'not-a-session'), '');
    fs.symlinkSync(root, path.join(root, 'session-state', 'escape'), 'junction');
    expect(listCopilotSessions(root)).toEqual([
      { id: 'newer', dir: fs.realpathSync.native(newer), mtimeMs: 1700000100000 },
      { id: 'older', dir: fs.realpathSync.native(older), mtimeMs: 1700000000000 },
    ]);
    expect(listCopilotSessions(root, { limit: 1 })).toHaveLength(1);
    expect(listCopilotSessions(path.join(root, 'session-state', 'escape'))).toEqual(listCopilotSessions(root));
    expect(listCopilotSessions(root, { limit: 0 })).toEqual([]);
    expect(listCopilotSessions(root, { limit: Infinity })).toEqual([]);
  });

  it('examines at most 500 entries even when a larger result is requested', () => {
    for (let index = 0; index < 510; index++) { session(String(index), ''); }
    const stat = vi.spyOn(fs, 'statSync');
    expect(listCopilotSessions(root, { limit: 1000 })).toHaveLength(500);
    expect(stat).toHaveBeenCalledTimes(500);
  });

  it.each(['plain', 'single', 'double'] as const)('reads a %s top-level cwd, ignoring all other keys', (format) => {
    const cwd = path.join(root, "A project's folder #1");
    const scalar = format === 'plain' ? cwd
      : format === 'single' ? `'${cwd.replace(/'/g, "''")}'` : JSON.stringify(cwd);
    const dir = session(format, `secret: SENTINEL_NEVER_RETAIN\nnested:\n  cwd: ignored\ncwd: ${scalar}\nother: ignored\n`);
    // A plain scalar's space-hash introduces a YAML comment.
    expect(readSessionCwd(dir)).toBe(format === 'plain' ? cwd.split(' #')[0] : cwd);
  });

  it('handles comments, CRLF, and an unquoted Windows-style cwd on Windows', () => {
    const cwd = path.join(root, 'project');
    const dir = session('comments', `cwd: '${cwd}' # metadata comment\r\nsecret: hidden\r\n`);
    expect(readSessionCwd(dir)).toBe(cwd);
  });

  it('handles YAML-specific double-quoted escapes without parsing other keys', () => {
    const cwd = path.join(root, 'quoted space');
    const scalar = JSON.stringify(cwd).replace(' space', '\\x20space');
    expect(readSessionCwd(session('yaml-escapes', `cwd: ${scalar}\n`))).toBe(cwd);
  });

  it('rejects symlink metadata without opening the target', () => {
    const dir = session('linked-metadata', '');
    const target = session('target', `cwd: ${JSON.stringify(root)}\n`);
    fs.unlinkSync(path.join(dir, 'workspace.yaml'));
    // Directory junctions are available without symlink privileges on Windows.
    fs.symlinkSync(target, path.join(dir, 'workspace.yaml'), 'junction');
    const open = vi.spyOn(fs, 'openSync');
    expect(readSessionCwd(dir)).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    'parent:\n  cwd: /nested\n',
    'cwd: |\n  /block\n',
    'cwd: [not, a, scalar]\n',
    'cwd: &anchor /anchored\n',
    'cwd: *alias\n',
    'cwd: relative/path\n',
    'cwd: "/first"\ncwd: "/second"\n',
    'cwd: "unterminated\n',
    'cwd: "/path\\nwith-control"\n',
  ])('ignores unsupported or malformed metadata: %s', (metadata) => {
    expect(readSessionCwd(session('invalid', metadata))).toBeNull();
  });

  it('never reads more than 8 KiB and rejects oversized metadata without reading it', () => {
    const dir = session('oversized', `cwd: ${JSON.stringify(root)}\n${'x'.repeat(8192)}`);
    const read = vi.spyOn(fs, 'readSync');
    expect(readSessionCwd(dir)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), `cwd: ${JSON.stringify(root)}\n`);
    expect(readSessionCwd(dir)).toBe(root);
    expect(read.mock.calls[0][3]).toBe(8192);
  });

  it('does not open any other session files', () => {
    const dir = session('only-workspace', `cwd: ${JSON.stringify(root)}\nsecret: SENTINEL_NEVER_RETAIN\n`);
    fs.mkdirSync(path.join(dir, 'events.jsonl'));
    const open = vi.spyOn(fs, 'openSync');
    expect(readSessionCwd(dir)).toBe(root);
    expect(open.mock.calls.map(([file]) => file)).toEqual([path.join(dir, 'workspace.yaml')]);
  });

  it('drops non-existent and non-Squad cwds, deduplicates aliases and excludes shown folders', async () => {
    const current = squad('current');
    const saved = squad('saved');
    const legacy = squad('legacy', true);
    const recent = squad('recent');
    const alias = path.join(root, 'recent-alias');
    fs.symlinkSync(recent, alias, 'junction');
    const plain = path.join(root, 'plain');
    fs.mkdirSync(plain);
    const paths = [current, saved, legacy, recent, alias, plain, path.join(root, 'gone')];
    paths.forEach((cwd, index) => session(`s${index}`, `cwd: ${JSON.stringify(cwd)}\nsecret: SENTINEL_NEVER_RETAIN\n`,
      1700000000000 + index * 1000));
    const entries = await new SquadDirectorySuggestions().list(true, [{ path: current }, { path: saved }], root);
    expect(entries.map((entry) => entry.path)).toEqual([recent, legacy]);
    expect(entries[0]).toEqual({
      id: 'session:s4', name: 'recent', path: recent, valid: true,
      lastLaunchedAt: new Date(1700000004000).toISOString(),
    });
    expect(JSON.stringify(entries)).not.toContain('SENTINEL_NEVER_RETAIN');
  });

  it('caps suggestions at ten in recency order', async () => {
    for (let index = 0; index < 12; index++) {
      const cwd = squad(`squad-${index}`);
      session(`s${index}`, `cwd: ${JSON.stringify(cwd)}\n`, 1700000000000 + index * 1000);
    }
    const entries = await new SquadDirectorySuggestions().list(true, [], root);
    expect(entries.map((entry) => entry.name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `squad-${11 - index}`),
    );
  });

  it('reuses cwd reads by session mtime but refreshes exclusions and roster validity', async () => {
    const cwd = squad('cached');
    const dir = session('cached', `cwd: ${JSON.stringify(cwd)}\n`);
    const suggestions = new SquadDirectorySuggestions();
    const open = vi.spyOn(fs, 'openSync');
    expect(await suggestions.list(true, [], root)).toHaveLength(1);
    expect(await suggestions.list(true, [{ path: cwd }], root)).toEqual([]);
    expect(open).toHaveBeenCalledTimes(1);
    fs.utimesSync(dir, 1700000100, 1700000100);
    expect(await suggestions.list(true, [], root)).toHaveLength(1);
    expect(open).toHaveBeenCalledTimes(2);
    fs.unlinkSync(path.join(cwd, '.squad', 'team.md'));
    expect(await suggestions.list(true, [], root)).toEqual([]);
  });

  it('reads nothing and returns no cached suggestions when disabled', async () => {
    const cwd = squad('disabled');
    session('disabled', `cwd: ${JSON.stringify(cwd)}\n`);
    const suggestions = new SquadDirectorySuggestions();
    expect(await suggestions.list(true, [], root)).toHaveLength(1);
    const openDir = vi.spyOn(fs, 'opendirSync');
    const open = vi.spyOn(fs, 'openSync');
    const stat = vi.spyOn(fs.promises, 'stat');
    expect(await suggestions.list(false, [], root)).toEqual([]);
    expect(openDir).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });

  it('does not start a scheduled scan if suggestions are disabled before the asynchronous read', async () => {
    const openDir = vi.spyOn(fs, 'opendirSync');
    let enabled = true;
    const result = new SquadDirectorySuggestions().list(true, [], root, () => enabled);
    enabled = false;
    expect(await result).toEqual([]);
    expect(openDir).not.toHaveBeenCalled();
  });

  it('refreshes cached cwd when metadata changes without changing the session directory mtime', async () => {
    const first = squad('first');
    const second = squad('second');
    const dir = session('edited', `cwd: ${JSON.stringify(first)}\n`);
    const suggestions = new SquadDirectorySuggestions();
    expect((await suggestions.list(true, [], root))[0].path).toBe(first);
    fs.writeFileSync(path.join(dir, 'workspace.yaml'), `cwd: ${JSON.stringify(second)}\n`);
    fs.utimesSync(path.join(dir, 'workspace.yaml'), 1700000200, 1700000200);
    expect((await suggestions.list(true, [], root))[0].path).toBe(second);
  });
});
