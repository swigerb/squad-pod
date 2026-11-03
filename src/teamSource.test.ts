import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectFiles } from './projectFiles.js';
import { MAX_TEAM_SOURCE_BYTES, readTeamSource, selectTeamSourceDirectory, TeamSourceState } from './teamSource.js';

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }));

describe('guarded team source state', () => {
  let root: string;
  const content = '\uFEFF## Members\n| Name | Role | Charter |\n|---|---|---|\n'
    + '| Ada | Developer | .squad/agents/Mixed_Name-2/charter.md |\n';
  function write(value: string | Buffer = content, directory = '.squad') {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, 'team.md'), value);
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.resolve('.team-source-fixture-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('validates once, preserves raw BOM, and performs only one-byte probes on unchanged scans', () => {
    write();
    const state = new TeamSourceState(new ProjectFiles(root));
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    expect(state.scan()).toMatchObject({
      changed: true, source: { status: 'available', content, byteLength: Buffer.byteLength(content) },
    });
    const bytes = vi.spyOn(fs, 'readSync');
    expect(state.scan().changed).toBe(false);
    expect(state.scan().changed).toBe(false);
    expect(bytes.mock.calls.map(call => call[3])).toEqual([1, 1]);
    expect(read).toHaveBeenCalledExactlyOnceWith(path.join('.squad', 'team.md'), MAX_TEAM_SOURCE_BYTES, { preserveBOM: true });
  });

  it.each([
    ['.squad', content], ['.squad', ''], ['.ai-team', content], ['.ai-team', ''],
  ] as const)('refuses actual read denial with unchanged metadata and recovers (%s, bytes: %s)', (directory, value) => {
    write(value, directory);
    const files = new ProjectFiles(root);
    const state = new TeamSourceState(files);
    expect(state.scan().source.status).toBe('available');
    const before = files.inspect(path.join(directory, 'team.md'));
    const read = fs.readSync;
    const denied = vi.spyOn(fs, 'readSync').mockImplementation(() => {
      throw Object.assign(new Error('private synthetic read denial'), { code: 'EACCES' });
    });
    expect(files.inspect(path.join(directory, 'team.md'))).toEqual(before);
    expect(state.scan()).toMatchObject({
      changed: true, source: { status: 'unreadable', directory, byteLength: 0,
        reason: 'Filesystem inspection/read failed (EACCES).' },
    });
    expect(state.scan().changed).toBe(false);
    expect(readTeamSource(files).status).toBe('unreadable');
    denied.mockImplementation(read);
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'available', content: value } });
    expect(state.scan().changed).toBe(false);
  });

  it('invalidates cached content on a ctime-only change', () => {
    write();
    const state = new TeamSourceState(root);
    state.scan();
    const file = path.join(root, '.squad', 'team.md');
    const identity = fs.statSync(file, { bigint: true }).ino;
    const lstat = fs.lstatSync;
    vi.spyOn(fs, 'lstatSync').mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
      const stat = lstat(...args);
      return args[0] === file && typeof stat.ctimeNs === 'bigint'
        ? Object.assign(stat, { ctimeNs: stat.ctimeNs + 1n }) : stat;
    });
    const fstat = fs.fstatSync;
    vi.spyOn(fs, 'fstatSync').mockImplementation((...args: Parameters<typeof fs.fstatSync>) => {
      const stat = fstat(...args);
      return stat.ino === identity && typeof stat.ctimeNs === 'bigint'
        ? Object.assign(stat, { ctimeNs: stat.ctimeNs + 1n }) : stat;
    });
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'available', content } });
    expect(read).toHaveBeenCalledTimes(1);
    expect(state.scan().changed).toBe(false);
  });

  it('refuses a directory replacement during a cached one-byte probe even when the file survives', () => {
    write();
    const state = new TeamSourceState(root);
    state.scan();
    const read = fs.readSync;
    vi.spyOn(fs, 'readSync').mockImplementationOnce((fd, buffer, offset, length, position) => {
      expect(length).toBe(1);
      const size = read(fd, buffer, offset, length, position);
      const directory = path.join(root, '.squad');
      const original = path.join(root, 'original');
      fs.renameSync(directory, original);
      fs.mkdirSync(directory);
      fs.renameSync(path.join(original, 'team.md'), path.join(directory, 'team.md'));
      return size;
    });
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'unreadable' } });
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'available', content } });
    expect(state.scan().changed).toBe(false);
  });

  it.each([Buffer.from([0xff]), ' '.repeat(MAX_TEAM_SOURCE_BYTES + 1)])('caches a stable bounded refusal and recovers', refused => {
    write(refused);
    const state = new TeamSourceState(root);
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    const first = state.scan();
    expect(first).toMatchObject({ changed: true, source: { status: 'unreadable', byteLength: 0 } });
    const reads = read.mock.calls.length;
    expect(reads).toBe(Buffer.isBuffer(refused) ? 1 : 0);
    expect(state.scan()).toEqual({ source: first.source, changed: false });
    expect(read).toHaveBeenCalledTimes(reads);
    write();
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'available', content } });
    expect(read).toHaveBeenCalledTimes(reads + 1);
    expect(state.scan().changed).toBe(false);
    expect(read).toHaveBeenCalledTimes(reads + 1);
  });

  it('notices a new file identity even with identical content, mtime and size', () => {
    write();
    const file = path.join(root, '.squad', 'team.md');
    const date = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(file, date, date);
    const state = new TeamSourceState(root);
    state.scan();
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    fs.renameSync(file, path.join(root, 'original-team'));
    write();
    fs.utimesSync(file, date, date);
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'available', content } });
    expect(read).toHaveBeenCalledTimes(1);
    expect(state.scan().changed).toBe(false);
  });

  it.each(['.squad', '.ai-team'])('guards selected directory and file junctions for %s', directory => {
    write(content, directory);
    const files = new ProjectFiles(root);
    const selected = path.join(root, directory);
    const target = path.join(root, 'original');
    fs.renameSync(selected, target);
    fs.symlinkSync(target, selected, 'junction');
    try {
      expect(() => selectTeamSourceDirectory(files)).toThrow('symlinks/junctions');
      expect(readTeamSource(files)).toMatchObject({ status: 'unreadable', directory });
    } finally { fs.unlinkSync(selected); }
    fs.renameSync(target, selected);
    const file = path.join(selected, 'team.md');
    fs.renameSync(file, path.join(root, 'original-team'));
    fs.mkdirSync(file);
    expect(readTeamSource(files)).toMatchObject({ status: 'unreadable', directory });
    fs.rmdirSync(file);
    // Directory junction at the file position needs no elevated symlink privilege.
    fs.symlinkSync(selected, file, 'junction');
    try {
      expect(readTeamSource(files)).toMatchObject({ status: 'unreadable', directory });
    } finally { fs.unlinkSync(file); }
  });

  it('distinguishes missing, invalid directory, recovery and preferred selection without fallback leaks', () => {
    const state = new TeamSourceState(root);
    expect(state.scan().source.status).toBe('missing');
    expect(state.scan().changed).toBe(false);
    write(content, '.ai-team');
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'available', directory: '.ai-team' } });
    fs.writeFileSync(path.join(root, '.squad'), 'not a directory');
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'unreadable', directory: '.squad' } });
    expect(state.scan().changed).toBe(false);
    fs.unlinkSync(path.join(root, '.squad'));
    fs.mkdirSync(path.join(root, '.squad'));
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'missing', directory: '.squad' } });
    write();
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'available', directory: '.squad' } });
    fs.unlinkSync(path.join(root, '.squad', 'team.md'));
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'missing', directory: '.squad' } });
  });

  it('retains the authorized root identity and never adopts an identical replacement', () => {
    const selected = path.join(root, 'selected');
    fs.mkdirSync(selected);
    const state = new TeamSourceState(new ProjectFiles(selected));
    fs.mkdirSync(path.join(selected, '.squad'));
    fs.writeFileSync(path.join(selected, '.squad', 'team.md'), content);
    expect(state.scan().source.status).toBe('available');
    fs.renameSync(selected, path.join(root, 'original'));
    fs.mkdirSync(selected);
    fs.mkdirSync(path.join(selected, '.squad'));
    fs.writeFileSync(path.join(selected, '.squad', 'team.md'), content);
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'unreadable', reason: 'Selected project root changed.' } });
    expect(state.scan().changed).toBe(false);
    fs.rmSync(selected, { recursive: true });
    fs.renameSync(path.join(root, 'original'), selected);
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'available', content } });
  });

  it('retries unexpected failures with unchanged metadata and privacy-safe diagnostics', () => {
    write();
    const state = new TeamSourceState(root);
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    read.mockImplementationOnce(() => { throw new Error('private synthetic details and raw content'); });
    expect(state.scan()).toMatchObject({
      changed: true, source: { status: 'unreadable', reason: 'Unexpected filesystem inspection/read failure.' },
    });
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'available', content } });
    expect(state.scan().changed).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('refuses a directory replacement during validation even when the file identity and metadata survive', () => {
    write();
    const state = new TeamSourceState(root);
    const originalRead = ProjectFiles.prototype.read;
    vi.spyOn(ProjectFiles.prototype, 'read').mockImplementationOnce(function (this: ProjectFiles, relative, limit, options) {
      const result = originalRead.call(this, relative, limit, options);
      const directory = path.join(root, '.squad');
      const stamp = fs.statSync(directory);
      const original = path.join(root, 'original');
      fs.renameSync(directory, original);
      fs.mkdirSync(directory);
      fs.renameSync(path.join(original, 'team.md'), path.join(directory, 'team.md'));
      fs.utimesSync(directory, stamp.atime, stamp.mtime);
      return result;
    });
    expect(state.scan()).toMatchObject({
      source: { status: 'unreadable', reason: expect.stringContaining('changed while reading') },
    });
    expect(state.scan()).toMatchObject({ changed: true, source: { status: 'available', content } });
    expect(state.scan().changed).toBe(false);
  });

  it('does not share cached availability or content across selected projects', () => {
    write();
    const other = path.join(root, 'other');
    fs.mkdirSync(other);
    const first = new TeamSourceState(new ProjectFiles(root));
    const second = new TeamSourceState(new ProjectFiles(other));
    expect(first.scan().source.status).toBe('available');
    expect(second.scan().source.status).toBe('missing');
    fs.mkdirSync(path.join(other, '.squad'));
    fs.writeFileSync(path.join(other, '.squad', 'team.md'), 'other project');
    expect(second.scan()).toMatchObject({ changed: true, source: { status: 'available', content: 'other project' } });
    expect(first.scan()).toMatchObject({ changed: false, source: { status: 'available', content } });
  });
});
