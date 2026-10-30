import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OfficeStore, MAX_OFFICE_BYTES } from './officeStore.js';
import type { OfficePreferences } from './officeStore.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
    renameSync: vi.fn(actual.renameSync),
  };
});

const owned: string[] = [];
const layout = {
  version: 2, cols: 2, rows: 2, tiles: [1, 1, 1, 1],
  furniture: [{ uid: 'seat-1', type: 'chair', col: 0, row: 0, rotation: 0 }],
  tileColors: { '0': { h: 12, s: 13, b: 14, c: 15 } },
  carpetTiles: [{ variant: 0, order: 1 }, null, null, null],
  pets: [{ id: 'pet-1', petType: 0 }],
  areas: [{ label: 'Test area', color: '#123456' }],
  areaTiles: ['Test area', null, null, null],
  areaMappings: { 'project-1': ['Test area'] },
  customMetadata: { savedIdentity: 'test-office' },
};
const preferences: OfficePreferences = {
  version: 1,
  settings: { soundEnabled: false, debugEnabled: true, showAreas: true },
  agents: { 'test-agent-1': { palette: 7, seatId: 'seat-1' } },
};
const agents = new Set(['test-agent-1']);
const authorized = () => {};

function fixture() {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'squad office storage '));
  owned.push(outer);
  const root = path.join(outer, 'selected project with spaces');
  fs.mkdirSync(root);
  return { outer, root, store: new OfficeStore(root), file: path.join(root, '.squad-pod', 'layout.json') };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of owned.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('guarded selected-project office persistence', () => {
  it('does not create files on reads or denied control (including observer and terminal-only callers)', () => {
    const { store, root } = fixture();
    expect(store.readLayout()).toEqual({ value: null, revision: null });
    expect(store.readPreferences()).toEqual({ value: null, revision: null });
    for (const role of ['observer', 'terminal-only', 'disconnected', 'revoked']) {
      const denied = () => { throw new Error(`${role}: office control denied`); };
      expect(() => store.saveLayout(layout, null, denied)).toThrow(`${role}: office control denied`);
      expect(() => store.savePreferences(preferences, null, agents, denied)).toThrow(`${role}: office control denied`);
    }
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('commits exact validated bytes, preserves every layout layer and saved identity, and reloads preferences', () => {
    const { store, root, outer, file } = fixture();
    const result = store.saveLayout(layout, null, authorized);
    expect(result).toEqual({ saved: true, value: layout, revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify(layout, null, 2));
    const savedPreferences = store.savePreferences(preferences, null, agents, authorized);
    const reloaded = new OfficeStore(root);
    expect(reloaded.readLayout()).toEqual({ value: layout, revision: result.revision });
    expect(reloaded.readPreferences()).toEqual({ value: preferences, revision: savedPreferences.revision });
    expect(fs.readFileSync(path.join(root, '.squad-pod', 'office-preferences.json'), 'utf8'))
      .toBe(JSON.stringify(preferences, null, 2));
    expect(fs.readdirSync(outer)).toEqual(['selected project with spaces']);
    expect(fs.readdirSync(path.join(root, '.squad-pod')).sort()).toEqual(['layout.json', 'office-preferences.json']);
  });

  it('rejects stale two-viewer layout and preferences revisions without overwriting the winner', () => {
    const { store, root, file } = fixture();
    const viewer = new OfficeStore(root);
    const initial = store.saveLayout(layout, null, authorized);
    const winner = { ...layout, pets: [{ id: 'pet-2', petType: 1 }] };
    const saved = viewer.saveLayout(winner, initial.revision, authorized);
    expect(store.saveLayout(layout, initial.revision, authorized))
      .toEqual({ saved: false, value: winner, revision: saved.revision });
    expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify(winner, null, 2));
    const first = store.savePreferences(preferences, null, agents, authorized);
    const next = { ...preferences, settings: { ...preferences.settings, showAreas: false } };
    const second = viewer.savePreferences(next, first.revision, agents, authorized);
    expect(store.savePreferences(preferences, first.revision, agents, authorized))
      .toEqual({ saved: false, value: next, revision: second.revision });
    const recovery = fs.readdirSync(path.join(root, '.squad-pod', 'recovery'));
    expect(recovery).toHaveLength(2);
    const backups = recovery.map(name => fs.readFileSync(path.join(root, '.squad-pod', 'recovery', name), 'utf8'));
    expect(backups).toContain(JSON.stringify(layout, null, 2));
    expect(backups).toContain(JSON.stringify(preferences, null, 2));
  });

  it('detects an external formatting-only edit as a conflict and retains its exact bytes', () => {
    const { store, file } = fixture();
    const initial = store.saveLayout(layout, null, authorized);
    const external = JSON.stringify(layout) + '\n';
    fs.writeFileSync(file, external);
    const conflict = store.saveLayout({ ...layout, pets: [] }, initial.revision, authorized);
    expect(conflict.saved).toBe(false);
    expect(conflict.revision).not.toBe(initial.revision);
    expect(fs.readFileSync(file, 'utf8')).toBe(external);
    expect(store.saveLayout({ ...layout, pets: [] }, conflict.revision, authorized).saved).toBe(true);
    const recovery = path.join(path.dirname(file), 'recovery');
    expect(fs.readdirSync(recovery).map(name => fs.readFileSync(path.join(recovery, name), 'utf8'))).toEqual([external]);
  });

  it.each([3, 4])('rechecks authority at commit barrier %s after validation/staging', (barrier) => {
    const { store, root, file } = fixture();
    const initial = store.saveLayout(layout, null, authorized);
    let checks = 0;
    const revoked = () => { if (++checks === barrier) throw new Error('Control generation revoked'); };
    expect(() => store.saveLayout({ ...layout, pets: [] }, initial.revision, revoked)).toThrow('Control generation revoked');
    expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify(layout, null, 2));
    expect(fs.readdirSync(path.join(root, '.squad-pod')).filter(name => /\.(tmp|lock)$/.test(name))).toEqual([]);
  });

  it.each([3, 4])('detects external writes at commit barrier %s without acknowledging or overwriting them', (barrier) => {
    const { store, file } = fixture();
    const initial = store.saveLayout(layout, null, authorized);
    let checks = 0;
    const external = JSON.stringify({ ...layout, pets: [{ id: 'external-pet', petType: 2 }] });
    const edit = () => { if (++checks === barrier) fs.writeFileSync(file, external); };
    const result = store.saveLayout({ ...layout, pets: [] }, initial.revision, edit);
    expect(result.saved).toBe(false);
    expect(result.value?.pets).toEqual([{ id: 'external-pet', petType: 2 }]);
    expect(fs.readFileSync(file, 'utf8')).toBe(external);
  });

  it('surfaces staging storage failure without truncation, false acknowledgment, or leftover locks', () => {
    const { store, root, file } = fixture();
    const initial = store.saveLayout(layout, null, authorized);
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => { throw new Error('fixture disk full'); });
    expect(() => store.saveLayout({ ...layout, pets: [] }, initial.revision, authorized)).toThrow('fixture disk full');
    expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify(layout, null, 2));
    expect(fs.readdirSync(path.join(root, '.squad-pod'))).toEqual(['layout.json']);
    expect(store.saveLayout({ ...layout, pets: [] }, initial.revision, authorized).saved).toBe(true);
  });

  it('surfaces an atomic rename failure and retains the original plus its recovery bytes', () => {
    const { store, root, file } = fixture();
    const initial = store.saveLayout(layout, null, authorized);
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('fixture rename denied'); });
    expect(() => store.saveLayout({ ...layout, pets: [] }, initial.revision, authorized)).toThrow('fixture rename denied');
    expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify(layout, null, 2));
    const recovery = path.join(root, '.squad-pod', 'recovery');
    expect(fs.readdirSync(recovery).map(name => fs.readFileSync(path.join(recovery, name), 'utf8')))
      .toEqual([JSON.stringify(layout, null, 2)]);
    expect(fs.readdirSync(path.join(root, '.squad-pod')).sort()).toEqual(['layout.json', 'recovery']);
  });

  it('applies the same commit-time revocation and storage-failure gates to preferences', () => {
    const { store, root } = fixture();
    const initial = store.savePreferences(preferences, null, agents, authorized);
    const next = { ...preferences, settings: { ...preferences.settings, soundEnabled: true } };
    let checks = 0;
    expect(() => store.savePreferences(next, initial.revision, agents, () => {
      if (++checks === 3) throw new Error('Preferences authority revoked');
    })).toThrow('Preferences authority revoked');
    expect(store.readPreferences()).toEqual({ value: preferences, revision: initial.revision });
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('fixture preferences rename denied'); });
    expect(() => store.savePreferences(next, initial.revision, agents, authorized)).toThrow('fixture preferences rename denied');
    expect(store.readPreferences()).toEqual({ value: preferences, revision: initial.revision });
    expect(fs.readdirSync(path.join(root, '.squad-pod')).sort()).toEqual(['office-preferences.json', 'recovery']);
  });

  it('does not overwrite malformed or oversized existing sources', () => {
    const { store, file } = fixture();
    store.saveLayout(layout, null, authorized);
    for (const source of ['{broken', '{"cols":null}', ' '.repeat(MAX_OFFICE_BYTES + 1)]) {
      fs.writeFileSync(file, source);
      expect(() => store.readLayout()).toThrow();
      expect(() => store.saveLayout(layout, null, authorized)).toThrow();
      expect(fs.readFileSync(file, 'utf8')).toBe(source);
    }
  });

  it('rejects malformed, oversized, unsupported settings, unknown agents and target substitution inputs before writing', () => {
    const { store, root } = fixture();
    for (const invalid of [null, {}, { ...layout, cols: 257 }, { ...layout, tiles: [NaN] },
      { ...layout, customMetadata: 'x'.repeat(MAX_OFFICE_BYTES) }]) {
      expect(() => store.saveLayout(invalid, null, authorized)).toThrow();
    }
    for (const invalid of [
      { ...preferences, liveActivity: true },
      { ...preferences, settings: { ...preferences.settings, liveActivity: true } },
      { ...preferences, settings: { ...preferences.settings, soundEnabled: 'true' } },
      { ...preferences, agents: { '../outside': { palette: 0 } } },
      { ...preferences, agents: { 'test-agent-1': { palette: -1 } } },
      { ...preferences, agents: { 'test-agent-1': { seatId: 'x'.repeat(257) } } },
      { ...preferences, agents: { 'test-agent-2': { palette: 0 } } },
    ]) expect(() => store.savePreferences(invalid, null, agents, authorized)).toThrow();
    for (const invalid of [undefined, '../layout.json', root, 1, 'f'.repeat(65)]) {
      expect(() => store.saveLayout(layout, invalid, authorized)).toThrow('revision');
    }
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('rejects project identity replacement and non-directory storage', () => {
    const { store, root, outer } = fixture();
    fs.renameSync(root, path.join(outer, 'original project'));
    fs.mkdirSync(root);
    expect(() => store.readLayout()).toThrow('identity changed');
    expect(() => store.saveLayout(layout, null, authorized)).toThrow('identity changed');
    const replacement = new OfficeStore(root);
    fs.writeFileSync(path.join(root, '.squad-pod'), 'not a directory');
    expect(() => replacement.saveLayout(layout, null, authorized)).toThrow('not a directory');
  });

  it('rejects junction storage and linked layout/recovery targets without changing outside bytes', () => {
    const { store, root, outer, file } = fixture();
    const outside = path.join(outer, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'layout.json'), JSON.stringify(layout));
    fs.symlinkSync(outside, path.join(root, '.squad-pod'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => store.readLayout()).toThrow('symlinks/junctions');
    expect(() => store.saveLayout(layout, null, authorized)).toThrow('symlinks/junctions');
    fs.unlinkSync(path.join(root, '.squad-pod'));
    const first = store.saveLayout(layout, null, authorized);
    fs.unlinkSync(file);
    fs.symlinkSync(outside, file, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => store.readLayout()).toThrow('symlinks/junctions');
    expect(() => store.saveLayout(layout, first.revision, authorized)).toThrow('symlinks/junctions');
    fs.unlinkSync(file);
    fs.writeFileSync(file, JSON.stringify(layout, null, 2));
    fs.symlinkSync(outside, path.join(root, '.squad-pod', 'recovery'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => store.saveLayout({ ...layout, pets: [] }, first.revision, authorized)).toThrow('symlinks/junctions');
    expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify(layout, null, 2));
    expect(fs.readdirSync(outside)).toEqual(['layout.json']);
    expect(fs.readFileSync(path.join(outside, 'layout.json'), 'utf8')).toBe(JSON.stringify(layout));
  });

  it('fails closed on an existing exclusive lock and leaves that lock untouched', () => {
    const { store, file } = fixture();
    const initial = store.saveLayout(layout, null, authorized);
    fs.writeFileSync(`${file}.lock`, 'other writer');
    expect(() => store.saveLayout({ ...layout, pets: [] }, initial.revision, authorized)).toThrow();
    expect(fs.readFileSync(`${file}.lock`, 'utf8')).toBe('other writer');
    expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify(layout, null, 2));
  });
});
