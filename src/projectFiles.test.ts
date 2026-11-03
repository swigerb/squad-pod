import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectFiles } from './projectFiles.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual };
});

describe('shared selected-project reads', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.resolve('.project-files-fixture-'));
    fs.writeFileSync(path.join(root, 'source'), 'declared');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('requires an explicit root and returns bounded content or explicit absence', () => {
    expect(() => new ProjectFiles('.')).toThrow('absolute');
    const files = new ProjectFiles(root);
    expect(files.read('source', 8)).toBe('declared');
    expect(files.read('missing', 8)).toBeNull();
    expect(() => files.read('source', 7)).toThrow('regular file');
    fs.writeFileSync(path.join(root, 'invalid'), Buffer.from([0xff]));
    expect(() => files.read('invalid', 8)).toThrow();
    expect(files.entries('.')).toEqual(['invalid', 'source']);
  });

  it('keeps metadata fingerprints stable across a guarded read', () => {
    const files = new ProjectFiles(root);
    fs.mkdirSync(path.join(root, '.squad'));
    fs.writeFileSync(path.join(root, '.squad', 'team.md'), 'declared');
    const relative = path.join('.squad', 'team.md');
    const directory = files.inspect('.squad');
    const before = files.inspect(relative);
    expect(files.read(relative, 8)).toBe('declared');
    expect(files.inspect('.squad')).toEqual(directory);
    expect(files.inspect(relative)).toEqual(before);
  });

  it('refuses traversal and internal junctions even when they point inside the root', () => {
    const files = new ProjectFiles(root);
    expect(() => files.read(path.join('..', 'outside'), 8)).toThrow('escapes');
    fs.mkdirSync(path.join(root, 'directory'));
    fs.writeFileSync(path.join(root, 'directory', 'source'), 'withheld');
    fs.symlinkSync(path.join(root, 'directory'), path.join(root, 'link'), 'junction');
    expect(() => files.read(path.join('link', 'source'), 8)).toThrow('symlinks');
    expect(() => files.entries('link')).toThrow('symlinks');
  });

  it('preserves a UTF-8 BOM only when a raw-content consumer requests it', () => {
    fs.writeFileSync(path.join(root, 'source'), '\uFEFFdeclared');
    const files = new ProjectFiles(root);
    expect(files.read('source', 11)).toBe('declared');
    expect(files.read('source', 11, { preserveBOM: true })).toBe('\uFEFFdeclared');
    expect(() => files.read('source', 10, { preserveBOM: true })).toThrow('regular file');
  });

  it('rejects a replaced selected root rather than adopting its new contents', () => {
    const selected = path.join(root, 'selected');
    fs.mkdirSync(selected);
    const files = new ProjectFiles(selected);
    fs.renameSync(selected, path.join(root, 'original'));
    fs.mkdirSync(selected);
    fs.writeFileSync(path.join(selected, 'source'), 'impostor');
    expect(() => files.read('source', 8)).toThrow('root changed');
  });

  it.each([false, true])('accepts stable files but rejects replacements (Windows zero-device stats: %s)', zeroDevice => {
    const files = new ProjectFiles(root);
    if (zeroDevice) {
      vi.stubGlobal('process', { ...process, platform: 'win32' });
      const lstat = fs.lstatSync;
      const fstat = fs.fstatSync;
      vi.spyOn(fs, 'lstatSync').mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
        const stat = lstat(...args);
        return typeof stat.dev === 'bigint' ? Object.assign(stat, { dev: 0n }) : stat;
      });
      vi.spyOn(fs, 'fstatSync').mockImplementation((...args: Parameters<typeof fs.fstatSync>) =>
        Object.assign(fstat(...args), { dev: 1n }));
    }
    expect(files.read('source', 8)).toBe('declared');
    const read = fs.readSync;
    vi.spyOn(fs, 'readSync').mockImplementationOnce((fd, buffer, offset, length, position) => {
      const size = read(fd, buffer, offset, length, position);
      fs.renameSync(path.join(root, 'source'), path.join(root, 'original'));
      fs.writeFileSync(path.join(root, 'source'), 'impostor');
      return size;
    });
    expect(() => files.read('source', 8)).toThrow('changed while reading');
  });
});
