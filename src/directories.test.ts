import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLOBAL_KEY_DIRECTORIES, GLOBAL_KEY_DIRECTORY_LAUNCH_HISTORY } from './constants.js';
import {
  asDirectoryEntry,
  createSavedDirectory,
  ensureUniqueDirectoryName,
  readLaunchHistory,
  readSavedDirectories,
  recordDirectoryLaunch,
  sameDirectoryPath,
  validateDirectoryName,
  validateDirectoryPath,
  writeSavedDirectories,
  forgetDirectoryLaunch,
} from './directories.js';
import { findCopilotExecutable, launchSquadInTerminal, SQUAD_CLI_COMMAND } from './directoryLaunch.js';

const temporaryDirectories: string[] = [];

function makeDirectory(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-directories-'));
  temporaryDirectories.push(root);
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function makeStorage(initial = new Map<string, unknown>()) {
  return {
    values: initial,
    get<T>(key: string, defaultValue: T): T {
      return (initial.has(key) ? initial.get(key) : defaultValue) as T;
    },
    async update(key: string, value: unknown) {
      initial.set(key, value);
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('saved launch directories', () => {
  it('requires a usable name and an existing absolute directory, then canonicalizes it', () => {
    const root = makeDirectory('Project & (one)');
    const entry = createSavedDirectory('  Demo Project  ', root);
    expect(entry.name).toBe('Demo Project');
    expect(entry.path).toBe(fs.realpathSync.native(root));
    expect(() => validateDirectoryName(' \n ')).toThrow('1–80 characters');
    expect(() => validateDirectoryName('line\nbreak')).toThrow('control characters');
    expect(() => validateDirectoryPath('relative\\project')).toThrow('absolute path');
    expect(() => validateDirectoryPath(path.join(root, 'missing'))).toThrow('does not exist');
    const file = path.join(root, 'readme.txt');
    fs.writeFileSync(file, 'fixture');
    expect(() => validateDirectoryPath(file)).toThrow('not a directory');
  });

  it('persists named records and prevents duplicate names without replacing the existing entry', async () => {
    const storage = makeStorage();
    const first = createSavedDirectory('Example', makeDirectory('first'));
    await writeSavedDirectories(storage, [first]);
    expect(storage.values.get(GLOBAL_KEY_DIRECTORIES)).toEqual([first]);
    expect(readSavedDirectories(storage)).toEqual([first]);
    expect(() => ensureUniqueDirectoryName('example', [first])).toThrow('already exists');
    expect(ensureUniqueDirectoryName('Renamed', [first], first.id)).toBe('Renamed');
  });

  it('keeps stale saved paths visible and invalid instead of dropping them', async () => {
    const storage = makeStorage();
    const entry = createSavedDirectory('Gone', makeDirectory('gone'));
    await writeSavedDirectories(storage, [entry]);
    fs.rmSync(entry.path, { recursive: true });
    const [loaded] = readSavedDirectories(storage).map((record) => asDirectoryEntry(record));
    expect(loaded).toMatchObject({ id: entry.id, name: 'Gone', valid: false });
    expect(loaded.error).toContain('does not exist');
  });

  it('records only explicit app-owned launches, de-duplicates by path, and supports forgetting a record', async () => {
    const storage = makeStorage();
    const first = createSavedDirectory('Project', makeDirectory('project'));
    const second = { ...first, name: 'Renamed' };
    await recordDirectoryLaunch(storage, first, '2026-10-29T18:00:00.000Z');
    await recordDirectoryLaunch(storage, second, '2026-10-29T19:00:00.000Z');
    expect(readLaunchHistory(storage)).toEqual([{ ...second, lastLaunchedAt: '2026-10-29T19:00:00.000Z' }]);
    await forgetDirectoryLaunch(storage, first.id);
    expect(storage.values.get(GLOBAL_KEY_DIRECTORY_LAUNCH_HISTORY)).toEqual([]);
  });

  it('compares paths case-insensitively only for Windows', () => {
    expect(sameDirectoryPath('C:\\Work\\Demo', 'c:\\work\\demo', 'win32')).toBe(true);
    expect(sameDirectoryPath('/Work/Demo', '/work/demo', 'linux')).toBe(false);
  });

  it('recognizes existing directory aliases while retaining lexical comparison for removed paths', () => {
    const directory = makeDirectory('canonical');
    const alias = path.join(path.dirname(directory), 'alias');
    fs.symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(sameDirectoryPath(alias, fs.realpathSync.native(directory))).toBe(true);
    const removed = path.join(path.dirname(directory), 'removed');
    expect(sameDirectoryPath(removed, path.join(removed, '..', 'removed'))).toBe(true);
  });
});

describe('explicit Squad CLI launch', () => {
  it('passes the selected cwd through the terminal API and sends only the supported command', () => {
    const cwd = makeDirectory('Repo with spaces & (special)');
    const createTerminal = vi.fn(() => ({
      show: vi.fn(),
      sendText: vi.fn(),
    }));
    const host = { isTrusted: true, createTerminal };

    expect(launchSquadInTerminal('Test Repo', cwd, host, () => true)).toBe(fs.realpathSync.native(cwd));
    expect(createTerminal).toHaveBeenCalledWith('Squad: Test Repo', fs.realpathSync.native(cwd));
    const terminal = createTerminal.mock.results[0]!.value;
    expect(terminal.show).toHaveBeenCalledOnce();
    expect(terminal.sendText).toHaveBeenCalledOnce();
    expect(terminal.sendText).toHaveBeenCalledWith(SQUAD_CLI_COMMAND, true);
    expect(SQUAD_CLI_COMMAND).toBe('copilot --agent squad');
  });

  it('refuses untrusted workspaces, invalid directories, and a missing CLI before creating a terminal', () => {
    const cwd = makeDirectory('Repo');
    const createTerminal = vi.fn();
    const host = { isTrusted: false, createTerminal };
    expect(() => launchSquadInTerminal('Repo', cwd, host, () => true)).toThrow('Trust this VS Code workspace');
    expect(() => launchSquadInTerminal('Repo', cwd, { ...host, isTrusted: true }, () => false))
      .toThrow('not found on PATH');
    expect(() => launchSquadInTerminal('Repo', path.join(cwd, 'gone'), { ...host, isTrusted: true }, () => true))
      .toThrow('does not exist');
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it('resolves the executable from PATH without shell evaluation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-path-'));
    temporaryDirectories.push(root);
    const command = path.join(root, process.platform === 'win32' ? 'copilot.CMD' : 'copilot');
    fs.writeFileSync(command, '');
    const env = {
      PATH: root,
      PATHEXT: process.platform === 'win32' ? '.COM;.EXE;.BAT;.CMD' : undefined,
    };
    if (process.platform !== 'win32') {
      fs.chmodSync(command, 0o644);
      expect(findCopilotExecutable(env)).toBeNull();
      fs.chmodSync(command, 0o755);
    }
    expect(findCopilotExecutable(env)).toBe(command);
  });
});
