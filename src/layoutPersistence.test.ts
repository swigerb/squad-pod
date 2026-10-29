/// <reference types="vitest/globals" />
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import type { LayoutData } from './types.js';
import {
  readPersistedLayout,
  writePersistedLayout,
  deletePersistedLayout,
  isValidLayout,
  parseLayoutJson,
  readLayoutRevision,
  saveLayoutIfUnchanged,
  watchLayoutFile,
} from './layoutPersistence.js';
import { LayoutDraft } from '../webview-ui/src/office/editor/layoutDraft.js';
import type { OfficeLayout } from '../webview-ui/src/office/types.js';
import { LAYOUT_FILE_POLL_INTERVAL_MS } from './constants.js';

describe('layoutPersistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleLayout: LayoutData = {
    version: 2,
    cols: 10,
    rows: 8,
    tiles: Array(80).fill(1),
    furniture: [{ uid: 'desk-1', type: 'desk', col: 3, row: 2, rotation: 0 }],
    pets: [],
  };

  it('round-trips a layout through write then read', () => {
    writePersistedLayout(tmpDir, sampleLayout);
    const result = readPersistedLayout(tmpDir);

    expect(result).toEqual(sampleLayout);
  });

  it('returns null when layout file does not exist', () => {
    expect(readPersistedLayout(tmpDir)).toBeNull();
  });

  it('returns null when layout file contains invalid JSON', () => {
    const dir = path.join(tmpDir, '.squad-pod');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'layout.json'), 'not valid json!!!', 'utf-8');

    expect(readPersistedLayout(tmpDir)).toBeNull();
  });

  it('deletes a persisted layout', () => {
    writePersistedLayout(tmpDir, sampleLayout);
    expect(readPersistedLayout(tmpDir)).not.toBeNull();

    deletePersistedLayout(tmpDir);
    expect(readPersistedLayout(tmpDir)).toBeNull();
  });

  it('migrates version-less layouts to version 2 without deleting user colors', () => {
    const layoutNoVersion = {
      cols: 5,
      rows: 5,
      tiles: Array(25).fill(1),
      furniture: [],
      tileColors: { '0,0': { h: 210, s: 25, b: 0, c: 0 } },
    };

    const dir = path.join(tmpDir, '.squad-pod');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'layout.json'),
      JSON.stringify(layoutNoVersion, null, 2),
      'utf-8',
    );

    const result = readPersistedLayout(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(2);
    expect(result!.tileColors).toEqual(layoutNoVersion.tileColors);
    expect(result).not.toHaveProperty('pets');
  });

  it('imports a real file without writing it, then saves exact selected contents and backs up the previous disk version', () => {
    writePersistedLayout(tmpDir, sampleLayout);
    const revision = readLayoutRevision(tmpDir);
    const imported = {
      ...sampleLayout, cols: 11, tiles: Array(88).fill(2),
      furniture: [{ uid: 'unknown', type: 'legacy-asset', col: 7, row: 3, rotation: 90,
        assetRole: 'desk', assetFootprint: { width: 3, height: 2 } }],
      customMetadata: { seats: { homer: 'unknown' }, workspace: 'original' },
    };
    const source = path.join(tmpDir, 'import.json');
    fs.writeFileSync(source, JSON.stringify(imported));
    const incoming = parseLayoutJson(fs.readFileSync(source, 'utf8'))!;
    const protection = new LayoutDraft();
    protection.receive(sampleLayout, 'external', revision, tmpDir);
    protection.receive(incoming, 'import', null, tmpDir);
    expect(protection.state.draft).toEqual(imported);
    expect(readPersistedLayout(tmpDir)).toEqual(sampleLayout);
    expect(fs.readFileSync(source, 'utf8')).toBe(JSON.stringify(imported));
    expect(protection.dirty).toBe(true);
    protection.beginSave();
    const saved = saveLayoutIfUnchanged(tmpDir, protection.state.draft!, protection.state.revision);
    expect(saved.saved).toBe(true);
    protection.acknowledge(saved.layout as OfficeLayout, saved.revision);
    expect(readPersistedLayout(tmpDir)).toEqual(imported);
    expect(protection.state.draft).toEqual(imported);
    expect(protection.dirty).toBe(false);
    const backupDir = path.join(tmpDir, '.squad-pod', 'recovery');
    expect(fs.readdirSync(backupDir).map((file) => fs.readFileSync(path.join(backupDir, file), 'utf8'))).toEqual([revision]);
  });

  it('refuses stale cross-window saves and preserves exact external disk contents', () => {
    writePersistedLayout(tmpDir, sampleLayout);
    const staleRevision = readLayoutRevision(tmpDir);
    const external = { ...sampleLayout, furniture: [{ uid: 'x', type: 'old-ID', col: 8, row: 4, rotation: 0 }] };
    writePersistedLayout(tmpDir, external);
    const result = saveLayoutIfUnchanged(tmpDir, sampleLayout, staleRevision);
    expect(result).toEqual({ saved: false, layout: external, revision: readLayoutRevision(tmpDir) });
    expect(readPersistedLayout(tmpDir)).toEqual(external);
    expect(fs.existsSync(path.join(tmpDir, '.squad-pod', 'recovery'))).toBe(false);
  });

  it('refuses malformed disk contents, invalid saves and competing writers without changing disk', () => {
    writePersistedLayout(tmpDir, sampleLayout);
    expect(() => saveLayoutIfUnchanged(tmpDir, { ...sampleLayout, tiles: [] }, readLayoutRevision(tmpDir))).toThrow('Invalid layout');
    expect(() => saveLayoutIfUnchanged(tmpDir, { ...sampleLayout, pets: [{ id: '', petType: 0 }] }, readLayoutRevision(tmpDir))).toThrow('Invalid layout');
    const lock = path.join(tmpDir, '.squad-pod', 'layout.json.lock');
    fs.writeFileSync(lock, 'other writer');
    expect(() => saveLayoutIfUnchanged(tmpDir, sampleLayout, readLayoutRevision(tmpDir))).toThrow();
    expect(readPersistedLayout(tmpDir)).toEqual(sampleLayout);
    fs.unlinkSync(lock);
    const file = path.join(tmpDir, '.squad-pod', 'layout.json');
    fs.writeFileSync(file, '{malformed');
    expect(() => saveLayoutIfUnchanged(tmpDir, sampleLayout, '{malformed')).toThrow('malformed');
    expect(fs.readFileSync(file, 'utf8')).toBe('{malformed');
  });

  it('serializes competing independent Node hosts: a paused writer holds the lock and stale retries cannot overwrite it', async () => {
    writePersistedLayout(tmpDir, sampleLayout);
    const revision = readLayoutRevision(tmpDir);
    const firstLayout = { ...sampleLayout, furniture: [{ uid: 'host-1', type: 'legacy-1', col: 2, row: 3, rotation: 0 }] };
    const secondLayout = { ...sampleLayout, furniture: [{ uid: 'host-2', type: 'legacy-2', col: 4, row: 5, rotation: 90 }] };
    const releaseFile = path.join(tmpDir, 'release-first-writer');
    function writer(layout: LayoutData, pause: boolean) {
      // Pause the real production rename, after revision check and backup.
      // Without the inter-process lock both hosts would accept the old revision.
      const script = `
        const fs = require('fs');
        if (${pause}) {
          const rename = fs.renameSync;
          fs.renameSync = (...args) => {
            if (args[1] !== ${JSON.stringify(path.join(tmpDir, '.squad-pod', 'layout.json'))}) return rename(...args);
            process.stdout.write('before-rename\\n');
            const deadline = Date.now() + 10000;
            while (!fs.existsSync(${JSON.stringify(releaseFile)})) {
              if (Date.now() > deadline) throw new Error('test release timeout');
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
            }
            return rename(...args);
          };
        }
        const { saveLayoutIfUnchanged } = require(${JSON.stringify(path.resolve('src', 'layoutPersistence.ts'))});
        try {
          console.log(JSON.stringify(saveLayoutIfUnchanged(
            ${JSON.stringify(tmpDir)}, ${JSON.stringify(layout)}, ${JSON.stringify(revision)}
          )));
        } catch (error) {
          console.log(JSON.stringify({ saved: false, code: error.code, error: String(error) }));
        }
      `;
      const child = spawn(process.execPath, ['--require', 'tsx/cjs', '--eval', script], {
        cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
      });
      const output = { stdout: '', stderr: '' };
      child.stdout.on('data', (data: Buffer) => { output.stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { output.stderr += data.toString(); });
      const done = new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      return { child, output, done };
    }
    const first = writer(firstLayout, true);
    try {
      await vi.waitFor(() => expect(first.output.stdout).toContain('before-rename'), { timeout: 5000 });
      const second = writer(secondLayout, false);
      expect(await second.done).toBe(0);
      expect(readPersistedLayout(tmpDir)).toEqual(sampleLayout);
      expect(JSON.parse(second.output.stdout)).toMatchObject({ saved: false, code: 'EEXIST' });
      fs.writeFileSync(releaseFile, 'release');
      expect(await first.done).toBe(0);
      expect(JSON.parse(first.output.stdout.trim().split('\n').at(-1)!)).toMatchObject({ saved: true, layout: firstLayout });
      expect(readPersistedLayout(tmpDir)).toEqual(firstLayout);
      const retry = writer(secondLayout, false);
      expect(await retry.done).toBe(0);
      expect(JSON.parse(retry.output.stdout)).toEqual({ saved: false, revision: readLayoutRevision(tmpDir), layout: firstLayout });
      expect(readPersistedLayout(tmpDir)).toEqual(firstLayout);
      const backups = path.join(tmpDir, '.squad-pod', 'recovery');
      expect(fs.readdirSync(backups).map((f) => fs.readFileSync(path.join(backups, f), 'utf8'))).toEqual([revision]);
    } finally {
      fs.writeFileSync(releaseFile, 'release');
      await first.done;
    }
  }, 20000);

  it('protects the real watcher regression: imported 20x15 -> local width21 -> external legacy four-item snapshot', async () => {
    const imported: OfficeLayout = {
      version: 2, cols: 20, rows: 15, tiles: Array(300).fill(1), furniture: [],
      pets: [],
      carpetTiles: Array(300).fill(null),
    };
    imported.carpetTiles![42] = { variant: 1, color: { h: 20, s: 70, b: -20, c: 0 }, accentColor: { h: 50, s: 80, b: 10, c: 0 }, order: 4 };
    writePersistedLayout(tmpDir, imported);
    let protection = new LayoutDraft();
    protection.receive(imported, 'external', readLayoutRevision(tmpDir), tmpDir);
    const local = { ...imported, cols: 21, tiles: Array(315).fill(1), carpetTiles: Array(315).fill(null) };
    local.carpetTiles[44] = { variant: 0, color: { h: 120, s: 70, b: -10, c: 0 }, accentColor: { h: 40, s: 80, b: 20, c: 0 }, order: 5 };
    protection.capture(local);
    const external: OfficeLayout = {
      ...imported, pets: [], carpetTiles: Array(300).fill(null), furniture: Array.from({ length: 4 }, (_, n) =>
        ({ uid: `legacy-${n}`, type: `unknown-${n}`, col: n + 1, row: n + 1, rotation: 0 })),
    };
    external.carpetTiles![42] = { variant: 2, color: { h: 210, s: 75, b: -25, c: 0 }, accentColor: { h: 0, s: 90, b: 30, c: 0 }, order: 6 };
    const errors: string[] = [];
    const watcher = watchLayoutFile(tmpDir, (layout, revision) => {
      protection.receive(layout, 'external', revision, tmpDir);
    }, (error) => errors.push(error));
    try {
      writePersistedLayout(tmpDir, external);
      await vi.waitFor(() => expect(protection.state.pending).toHaveLength(1));
      expect(protection.state.draft).toEqual(local);
      expect(protection.state.pending[0].layout).toEqual(external);
      expect(readPersistedLayout(tmpDir)).toEqual(external);
      const restored = new LayoutDraft(JSON.parse(JSON.stringify(protection.state)));
      protection = restored;
      restored.resolve(restored.state.pending[0].id, 'local');
      expect(restored.state.draft).toEqual(local);
      expect(restored.state.retained.some((s) => JSON.stringify(s.layout) === JSON.stringify(external))).toBe(true);
      restored.beginSave();
      const saved = saveLayoutIfUnchanged(tmpDir, restored.state.draft!, restored.state.revision);
      expect(saved.saved).toBe(true);
      restored.acknowledge(saved.layout as OfficeLayout, saved.revision);
      expect(restored.dirty).toBe(false);
      expect(readPersistedLayout(tmpDir)).toEqual(local);
      expect(restored.state.retained.some((s) => JSON.stringify(s.layout) === JSON.stringify(external))).toBe(true);
      // Let the watcher observe our acknowledged save before the malformed edit.
      await vi.waitFor(() => expect(protection.state.baseline).toEqual(local));
      const beforeMalformed = JSON.parse(JSON.stringify(protection.state));
      fs.writeFileSync(path.join(tmpDir, '.squad-pod', 'layout.json'), '{"cols":0}');
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(protection.state).toEqual(beforeMalformed);
      const later = { ...external, rows: 16, tiles: Array(320).fill(2), carpetTiles: [...external.carpetTiles!, ...Array(20).fill(null)] };
      writePersistedLayout(tmpDir, later);
      await vi.waitFor(() => expect(protection.state.draft).toEqual(later));
      expect(protection.state.retained.some((s) => JSON.stringify(s.layout) === JSON.stringify(external))).toBe(true);
    } finally {
      watcher.dispose();
    }
  });

  describe('watcher absence and failures', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it.each([false, true])('silently polls a missing file (directory exists: %s), then loads its creation', (directoryExists) => {
      if (directoryExists) {fs.mkdirSync(path.join(tmpDir, '.squad-pod'));}
      const onChange = vi.fn();
      const onInvalid = vi.fn();
      const watcher = watchLayoutFile(tmpDir, onChange, onInvalid);
      try {
        vi.advanceTimersByTime(3 * LAYOUT_FILE_POLL_INTERVAL_MS);
        expect(onInvalid).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(tmpDir, '.squad-pod'))).toBe(directoryExists);
        writePersistedLayout(tmpDir, sampleLayout);
        vi.advanceTimersByTime(LAYOUT_FILE_POLL_INTERVAL_MS);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(sampleLayout, readLayoutRevision(tmpDir));
        expect(onInvalid).not.toHaveBeenCalled();
      } finally {
        watcher.dispose();
      }
    });

    it('keeps the dirty draft and revision when deleted, and observes an identical restored file', () => {
      writePersistedLayout(tmpDir, sampleLayout);
      const revision = readLayoutRevision(tmpDir);
      const protection = new LayoutDraft();
      protection.receive(sampleLayout, 'external', revision, tmpDir);
      protection.capture({ ...sampleLayout, tiles: Array(80).fill(2) });
      const before = structuredClone(protection.state);
      const onChange = vi.fn((layout: LayoutData, raw: string) => protection.receive(layout, 'external', raw, tmpDir));
      const onInvalid = vi.fn();
      const watcher = watchLayoutFile(tmpDir, onChange, onInvalid);
      try {
        deletePersistedLayout(tmpDir);
        vi.advanceTimersByTime(3 * LAYOUT_FILE_POLL_INTERVAL_MS);
        expect(onInvalid).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(protection.state).toEqual(before);
        expect(protection.dirty).toBe(true);
        // Deletion must not authorize overwriting a changed disk revision.
        expect(saveLayoutIfUnchanged(tmpDir, protection.state.draft!, revision).saved).toBe(false);
        expect(readLayoutRevision(tmpDir)).toBeNull();
        writePersistedLayout(tmpDir, sampleLayout);
        vi.advanceTimersByTime(LAYOUT_FILE_POLL_INTERVAL_MS);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(sampleLayout, revision);
        expect(protection.state).toEqual(before);
      } finally {
        watcher.dispose();
      }
    });

    it.each(['directory', 'malformed JSON'])('reports %s exactly once across repeated polls, retaining the draft', (failure) => {
      fs.mkdirSync(path.join(tmpDir, '.squad-pod'));
      const file = path.join(tmpDir, '.squad-pod', 'layout.json');
      if (failure === 'directory') {fs.mkdirSync(file);}
      const protection = new LayoutDraft();
      protection.receive(sampleLayout, 'external', null, tmpDir);
      protection.capture({ ...sampleLayout, tiles: Array(80).fill(2) });
      const before = structuredClone(protection.state);
      const onChange = vi.fn((layout: LayoutData, raw: string) => protection.receive(layout, 'external', raw, tmpDir));
      const onInvalid = vi.fn((error: string) => { protection.watcherError = error; });
      const watcher = watchLayoutFile(tmpDir, onChange, onInvalid);
      try {
        if (failure === 'malformed JSON') {fs.writeFileSync(file, '{malformed');}
        vi.advanceTimersByTime(3 * LAYOUT_FILE_POLL_INTERVAL_MS);
        expect(onInvalid).toHaveBeenCalledTimes(1);
        expect(onInvalid.mock.calls[0][0]).toContain(failure === 'directory' ? 'not a regular file' : 'malformed');
        expect(onChange).not.toHaveBeenCalled();
        expect(protection.state).toEqual(before);
      } finally {
        watcher.dispose();
      }
    });
  });

  describe('validation', () => {
    it('accepts a well-formed layout and defaults missing furniture', () => {
      expect(isValidLayout(sampleLayout)).toBe(true);
      const parsed = parseLayoutJson(JSON.stringify({ cols: 2, rows: 1, tiles: [1, 1] }));
      expect(parsed?.furniture).toEqual([]);
    });

    it('accepts a UTF-8 BOM', () => {
      expect(parseLayoutJson('\uFEFF' + JSON.stringify(sampleLayout))).not.toBeNull();
    });

    it('keeps a legacy layout without pets byte-shape compatible while runtime treats it as empty', () => {
      const { pets: _pets, ...legacy } = sampleLayout;
      expect(parseLayoutJson(JSON.stringify(legacy))).toEqual(legacy);
    });

    it('does not add a pets field when saving a legacy layout that has no pet edits', () => {
      const { pets: _pets, ...legacy } = sampleLayout;
      const content = JSON.stringify(legacy, null, 2);
      fs.mkdirSync(path.join(tmpDir, '.squad-pod'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.squad-pod', 'layout.json'), content);
      const parsed = readPersistedLayout(tmpDir)!;
      const result = saveLayoutIfUnchanged(tmpDir, parsed, content);
      expect(result.saved).toBe(true);
      expect(JSON.parse(readLayoutRevision(tmpDir)!)).not.toHaveProperty('pets');
    });

    it('preserves legacy layouts without Area fields and accepts stable-ID mappings to unavailable directories', () => {
      const { pets: _pets, ...legacy } = sampleLayout;
      const parsedLegacy = parseLayoutJson(JSON.stringify(legacy));
      expect(parsedLegacy).not.toHaveProperty('areas');
      expect(parsedLegacy).not.toHaveProperty('areaTiles');
      expect(parsedLegacy).not.toHaveProperty('areaMappings');

      const withAreas = {
        ...legacy,
        areas: [{ label: 'Engineering', color: '#50c878' }],
        areaTiles: Array(80).fill(null).map((value, index) => index === 0 ? 'Engineering' : value),
        areaMappings: { 'saved-id-no-longer-in-catalog': ['Engineering'] },
      };
      expect(parseLayoutJson(JSON.stringify(withAreas))).toEqual(withAreas);
    });

    it.each([
      ['unknown label', { areas: [{ label: 'Engineering', color: '#50c878' }], areaTiles: ['Missing', ...Array(79).fill(null)] }],
      ['wall membership', { areas: [{ label: 'Engineering', color: '#50c878' }], areaTiles: ['Engineering', ...Array(79).fill(null)], tiles: [0, ...Array(79).fill(1)] }],
      ['void membership', { areas: [{ label: 'Engineering', color: '#50c878' }], areaTiles: ['Engineering', ...Array(79).fill(null)], tiles: [8, ...Array(79).fill(1)] }],
      ['duplicate labels', { areas: [{ label: 'Engineering', color: '#50c878' }, { label: 'engineering', color: '#123456' }] }],
      ['malformed mapping', { areas: [{ label: 'Engineering', color: '#50c878' }], areaMappings: { saved: ['Missing'] } }],
    ])('rejects invalid Area %s', (_label, fields) => {
      expect(isValidLayout({ ...sampleLayout, ...fields })).toBe(false);
    });

    it.each([
      ['not JSON', '{oops'],
      ['an array', '[]'],
      ['tile count mismatch', JSON.stringify({ cols: 2, rows: 2, tiles: [1] })],
      ['non-integer tiles', JSON.stringify({ cols: 1, rows: 1, tiles: ['x'] })],
      ['zero size', JSON.stringify({ cols: 0, rows: 0, tiles: [] })],
      ['oversized grid', JSON.stringify({ cols: 1000, rows: 1, tiles: Array(1000).fill(1) })],
      ['bad furniture', JSON.stringify({ cols: 1, rows: 1, tiles: [1], furniture: [{ type: 'desk' }] })],
    ])('rejects %s', (_label, content) => {
      expect(parseLayoutJson(content)).toBeNull();
    });

    it('ignores a malformed file on disk instead of loading it', () => {
      writePersistedLayout(tmpDir, sampleLayout);
      const file = path.join(tmpDir, '.squad-pod', 'layout.json');
      fs.writeFileSync(file, JSON.stringify({ cols: 3, rows: 3, tiles: [1] }));
      expect(readPersistedLayout(tmpDir)).toBeNull();
    });

    it('leaves no temp files after saving', () => {
      writePersistedLayout(tmpDir, sampleLayout);
      expect(fs.readdirSync(path.join(tmpDir, '.squad-pod'))).toEqual(['layout.json']);
    });
  });
});
