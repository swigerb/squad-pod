import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectFiles } from './projectFiles.js';
import { MAX_LAYOUT_SOURCE_BYTES, readLayoutSnapshot } from './layoutSnapshot.js';
import type { LayoutData, OutboundMessage } from './types.js';

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }));
const nodeRequire = createRequire(path.resolve('package.json'));
const providerCode = buildSync({
  entryPoints: [path.resolve('src', 'SquadPodViewProvider.ts')], bundle: true,
  platform: 'node', format: 'cjs', external: ['vscode'], write: false,
}).outputFiles[0].text;
const layout: LayoutData = { version: 2, cols: 1, rows: 1, tiles: [1], furniture: [] };
interface Provider {
  view: unknown;
  loadAndSendLayout(root: string): void;
}

describe('selected-project layout snapshots and compiled provider loading', () => {
  let base: string, root: string, file: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.resolve('.layout-snapshot-fixture-'));
    root = path.join(base, 'project');
    file = path.join(root, '.squad-pod', 'layout.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(base, { recursive: true, force: true });
  });
  const snapshot = () => readLayoutSnapshot(new ProjectFiles(root));
  function consumer(cached?: LayoutData, bundled?: LayoutData) {
    const module = { exports: {} as { SquadPodViewProvider: new (context: unknown) => Provider } };
    const require = (id: string): unknown => id === 'vscode' ? {}
      : id === 'fs' || id === 'node:fs' ? fs : nodeRequire(id);
    new Function('require', 'module', 'exports', providerCode)(require, module, module.exports);
    const get = vi.fn(() => cached ? structuredClone(cached) : undefined);
    const update = vi.fn();
    const provider = new module.exports.SquadPodViewProvider({
      extensionPath: base, workspaceState: { get, update },
    });
    const messages: OutboundMessage[] = [];
    provider.view = { webview: { postMessage: (message: OutboundMessage) => messages.push(message) } };
    if (bundled) {
      const target = path.join(base, 'dist', 'assets', 'layout.json');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(bundled));
    }
    return { provider, messages, get, update };
  }
  function failRootLookupDuringRead() {
    const realpath = fs.realpathSync;
    let inspectedFile = false;
    const fail = vi.fn(() => {
      throw Object.assign(new Error(`private ${root}`), { code: 'ENOENT' });
    });
    vi.spyOn(fs, 'realpathSync').mockImplementation((target, options) => {
      // The file's final inspection lookup precedes read()'s root lookup.
      if (target === root && inspectedFile && fail.mock.calls.length === 0) {return fail();}
      const resolved = realpath(target, options);
      if (target === file) {inspectedFile = true;}
      return resolved;
    });
    return fail;
  }
  it('refuses a null read after present inspections even when root identity recovers unchanged', () => {
    const raw = JSON.stringify(layout);
    fs.writeFileSync(file, raw);
    const files = new ProjectFiles(root);
    const inspect = vi.spyOn(files, 'inspect');
    const fail = failRootLookupDuringRead();
    const result = readLayoutSnapshot(files);
    expect(fail).toHaveBeenCalledTimes(1);
    const observations = inspect.mock.results.map(result => result.value);
    expect(observations).toHaveLength(4);
    expect(observations.every(observation => observation.status === 'present')).toBe(true);
    expect(observations.slice(2)).toEqual(observations.slice(0, 2));
    expect(result).toEqual({ status: 'unreadable', diagnostic: expect.any(String) });
    expect(result).not.toHaveProperty('revision');
    expect(JSON.stringify(result)).not.toContain(root);
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
  });
  it('keeps the compiled provider layout and revision on a read-only transient root ENOENT', () => {
    const raw = JSON.stringify(layout);
    fs.writeFileSync(file, raw);
    const host = consumer({ ...layout, tiles: [2] });
    host.provider.loadAndSendLayout(root);
    expect(host.messages).toEqual([{ type: 'layoutLoaded', layout, revision: raw, workspaceRoot: root }]);
    host.messages.length = 0;
    host.get.mockClear();
    const files = new ProjectFiles(root);
    const before = [files.inspect('.squad-pod'), files.inspect(path.join('.squad-pod', 'layout.json'))];
    const fail = failRootLookupDuringRead();
    host.provider.loadAndSendLayout(root);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(host.messages).toEqual([{ type: 'layoutError', error: expect.any(String) }]);
    expect(host.messages[0]).not.toHaveProperty('revision');
    expect(JSON.stringify(host.messages)).not.toContain(root);
    expect(host.get).not.toHaveBeenCalled();
    expect(host.update).not.toHaveBeenCalled();
    expect([files.inspect('.squad-pod'), files.inspect(path.join('.squad-pod', 'layout.json'))]).toEqual(before);
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
  });
  it('keeps exact BOM/formatting/metadata revision while migrating only the parsed layout', () => {
    const raw = '\uFEFF{\n "cols":1,"rows":1,"tiles":[1],"metadata":{"custom":true}\n}';
    fs.writeFileSync(file, raw);
    const expected = { ...layout, metadata: { custom: true } };
    expect(snapshot()).toEqual({ status: 'valid', revision: raw, layout: expected });
    const host = consumer({ ...layout, tiles: [2] });
    host.provider.loadAndSendLayout(root);
    expect(host.messages).toEqual([{ type: 'layoutLoaded', layout: expected, revision: raw, workspaceRoot: root }]);
    expect(host.get).not.toHaveBeenCalled();
    expect(host.update).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
    const colored = { ...layout, tileColors: { '0,0': { h: 12, s: 34, b: -5, c: 6 } } };
    fs.writeFileSync(file, JSON.stringify(colored));
    host.messages.length = 0;
    host.provider.loadAndSendLayout(root);
    expect(host.messages[0]).toMatchObject({ layout: colored, revision: JSON.stringify(colored) });
  });
  it.each(['cache', 'bundled', 'minimal'])('uses %s fallback only with a confirmed missing revision and fills tileColors', source => {
    if (source === 'minimal') {fs.rmdirSync(path.dirname(file));}
    expect(snapshot()).toEqual({ status: 'missing', revision: null });
    const host = consumer(source === 'cache' ? layout : undefined, source === 'bundled' ? layout : undefined);
    host.provider.loadAndSendLayout(root);
    expect(host.messages).toEqual([expect.objectContaining({
      type: 'layoutLoaded', revision: null, workspaceRoot: root,
      layout: expect.objectContaining({ tileColors: expect.any(Object) }),
    })]);
    if (source !== 'minimal') {expect(host.messages[0]).toMatchObject({ layout: { cols: 1, rows: 1 } });}
    expect(fs.existsSync(file)).toBe(false);
  });
  it('retains the malformed raw revision and recovery guard without writing a fallback to disk', () => {
    const raw = '\uFEFF{ invalid private content';
    fs.writeFileSync(file, raw);
    expect(snapshot()).toEqual({ status: 'malformed', revision: raw, diagnostic: expect.stringContaining('recover') });
    const host = consumer(layout);
    host.provider.loadAndSendLayout(root);
    expect(host.messages).toEqual([
      { type: 'layoutLoaded', layout, revision: raw, workspaceRoot: root },
      { type: 'layoutError', error: expect.stringContaining('recover') },
    ]);
    expect(host.update).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
  });
  it.each(['oversize', 'utf8', 'denied', 'directory', 'junction', 'root-change', 'root-missing', 'disappeared'])(
    'refuses %s without broadcasting a replacement or a fabricated missing revision', refusal => {
      fs.writeFileSync(file, JSON.stringify(layout));
      const files = new ProjectFiles(root);
      const host = consumer(layout);
      host.provider.loadAndSendLayout(root);
      expect(host.messages).toEqual([{ type: 'layoutLoaded', layout, revision: JSON.stringify(layout), workspaceRoot: root }]);
      host.messages.length = 0;
      host.get.mockClear();
      if (refusal === 'root-missing') {fs.rmSync(root, { recursive: true });}
      if (refusal === 'oversize') {fs.writeFileSync(file, ' '.repeat(MAX_LAYOUT_SOURCE_BYTES + 1));}
      if (refusal === 'utf8') {fs.writeFileSync(file, Buffer.from([0xff]));}
      if (refusal === 'directory') {
        fs.rmSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(path.dirname(file), 'invalid directory');
      }
      if (refusal === 'junction') {
        fs.renameSync(path.dirname(file), path.join(root, 'actual'));
        fs.symlinkSync(path.join(root, 'actual'), path.dirname(file), 'junction');
      }
      if (refusal === 'denied') {
        vi.spyOn(fs, 'readSync').mockImplementation(() => {
          throw Object.assign(new Error(`private ${root}`), { code: 'EACCES' });
        });
      }
      if (refusal === 'root-change' || refusal === 'disappeared') {
        const read = fs.readSync;
        vi.spyOn(fs, 'readSync').mockImplementation((...args) => {
          const count = read(...args);
          if (refusal === 'disappeared') {fs.unlinkSync(file);}
          else {
            fs.renameSync(root, path.join(base, 'original'));
            fs.mkdirSync(root);
          }
          return count;
        });
      }
      host.provider.loadAndSendLayout(root);
      if (refusal === 'disappeared') {fs.writeFileSync(file, JSON.stringify(layout));}
      const result = readLayoutSnapshot(files);
      expect(result).toMatchObject({ status: 'unreadable', diagnostic: expect.any(String) });
      expect(result).not.toHaveProperty('revision');
      expect(JSON.stringify(result)).not.toContain(root);
      expect(host.messages).toEqual([{ type: 'layoutError', error: expect.any(String) }]);
      expect(JSON.stringify(host.messages)).not.toContain(root);
      expect(host.messages[0]).not.toHaveProperty('revision');
      expect(host.get).not.toHaveBeenCalled();
      expect(host.update).not.toHaveBeenCalled();
    },
  );
});
