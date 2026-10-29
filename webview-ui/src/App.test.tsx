import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { vscode } from './vscodeApi.js';
import { isSoundEnabled } from './notificationSound.js';
import { resetPetTemplates } from './office/sprites/petSpriteData.js';
import type { OutboundMessage, SourceStatus } from '../../src/types.js';
import type { AssetSnapshot } from '../../src/manifestAssets.js';
import type { LayoutRecovery } from './office/editor/layoutDraft.js';
import type { OfficeLayout } from './office/types.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('layout conflict UI and panel-state recovery (simulated host boundary)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let persisted: LayoutRecovery | undefined;
  const imported: OfficeLayout = {
    version: 2, cols: 20, rows: 15, tiles: Array(300).fill(1), furniture: [],
    tileColors: { '0,0': { h: 40, s: 20, b: -5, c: 10 } },
  };
  const external: OfficeLayout = {
    ...imported, furniture: Array.from({ length: 4 }, (_, n) => ({
      uid: `legacy-${n}`, type: `unknown-${n}`, col: n + 2, row: n + 1, rotation: 90,
      assetFootprint: { width: 2, height: 1 }, assetRole: 'desk',
    })),
  };
  function send(message: OutboundMessage) {
    act(() => window.dispatchEvent(new MessageEvent('message', { data: message })));
  }
  function click(text: string) {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
    expect(button, text).toBeDefined();
    act(() => button!.click());
  }
  function snapshot(layout: OfficeLayout, revision: string, source: 'external' | 'import' = 'external') {
    send({ type: 'layoutLoaded', layout, revision, source, workspaceRoot: 'workspace-A' });
  }
  function saves() {
    return vi.mocked(vscode.postMessage).mock.calls.map(([m]) => m).filter((m) => m.type === 'saveLayout');
  }
  function remount() {
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<App />));
  }
  beforeEach(() => {
    resetPetTemplates();
    persisted = undefined;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(vscode, 'postMessage').mockImplementation(() => {});
    vi.spyOn(vscode, 'getState').mockImplementation(() => persisted);
    vi.spyOn(vscode, 'setState').mockImplementation((value) => {
      persisted = JSON.parse(JSON.stringify(value)) as LayoutRecovery;
      return value;
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App />));
    snapshot(imported, 'disk-original');
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetPetTemplates();
    vi.restoreAllMocks();
  });

  it('clears only a watcher error after a valid external load, not an import or malformed message', () => {
    const error = 'External layout could not be read; current draft was kept.';
    send({ type: 'layoutError', error, source: 'watcher' });
    expect(host.querySelector('[aria-label="Layout recovery"]')).not.toBeNull();
    snapshot(imported, 'ignored-import', 'import');
    expect(host.textContent).toContain(error);
    send({ type: 'layoutLoaded', layout: { ...imported, tiles: [] }, revision: 'bad' });
    expect(host.textContent).toContain('Incoming layout is malformed');
    // A watcher error cannot mask a protection error.
    send({ type: 'layoutError', error, source: 'watcher' });
    snapshot(imported, 'disk-original');
    expect(host.textContent).toContain('Incoming layout is malformed');
    remount();
    snapshot(imported, 'disk-original');
    send({ type: 'layoutError', error, source: 'watcher' });
    snapshot(imported, 'disk-original');
    expect(host.querySelector('[aria-label="Layout recovery"]')).toBeNull();
  });

  it('clears a stale watcher alert while keeping dirty-draft conflicts and exports', () => {
    click('Edit Layout');
    click('→');
    const local = structuredClone(persisted!.draft);
    send({ type: 'layoutError', error: 'Transient watcher failure', source: 'watcher' });
    snapshot(external, 'disk-external');
    expect(host.textContent).not.toContain('Transient watcher failure');
    expect(persisted!.draft).toEqual(local);
    expect(persisted!.pending[0].layout).toEqual(external);
    expect(host.querySelector('[aria-label="Layout recovery"]')).not.toBeNull();
    click('● Save Layout');
    expect(saves()).toEqual([]);
    click('Export local draft');
    expect(vscode.postMessage).toHaveBeenLastCalledWith({ type: 'exportLayoutSnapshot', layout: local });
  });

  it.each(['workspace mismatch', 'malformed recovery', 'malformed acknowledgement', 'unclassified host error'])(
    'does not clear %s on a valid external load', (failure) => {
      let expected: string;
      if (failure === 'workspace mismatch') {
        send({ type: 'layoutLoaded', layout: external, workspaceRoot: 'workspace-B', revision: 'other-disk' });
        expected = 'Workspace changed';
      } else if (failure === 'malformed recovery') {
        vi.mocked(vscode.getState).mockReturnValue({ malformedRecovery: 'preserve me' });
        remount();
        expected = 'Layout recovery state is malformed';
      } else if (failure === 'malformed acknowledgement') {
        send({ type: 'layoutSaved', layout: { ...imported, tiles: [] }, revision: 'bad' });
        expected = 'Malformed save acknowledgement';
      } else {
        send({ type: 'layoutError', error: 'Disk locked; retry Save.' });
        expected = 'Disk locked; retry Save.';
      }
      send({ type: 'layoutError', error: 'Transient watcher failure', source: 'watcher' });
      snapshot(imported, 'disk-original');
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(expected);
    },
  );

  it('keeps colorless layouts clean on open and preserves baseline, raw revision and Save contents', () => {
    const layout: OfficeLayout = {
      version: 2, cols: 20, rows: 15,
      tiles: Array.from({ length: 300 }, (_, i) => i < 20 ? 0 : 1), furniture: [],
      carpetTiles: Array.from({ length: 300 }, (_, i) => i === 41 ? { variant: 0 } : null),
    };
    const revision = '\uFEFF' + JSON.stringify(layout, null, 4) + '\r\n';
    snapshot(layout, revision);
    click('Edit Layout');
    expect(host.textContent).not.toContain('● Save Layout');
    expect(persisted!.draft).toEqual(layout);
    expect(persisted!.baseline).toEqual(layout);
    expect(persisted!.revision).toBe(revision);
    expect(persisted!.draft).not.toHaveProperty('tileColors');
    click('Save Layout');
    expect(saves().at(-1)).toEqual({
      type: 'saveLayout', layout, expectedRevision: revision, workspaceRoot: 'workspace-A',
    });
    expect(persisted!.revision).toBe(revision);
    expect(JSON.stringify(saves().at(-1)!.layout)).toBe(JSON.stringify(layout));
  });

  it('preserves colorless snapshots through import, external update and Use incoming', () => {
    const layout: OfficeLayout = {
      version: 2, cols: 20, rows: 15, tiles: Array(300).fill(1), furniture: [],
    };
    snapshot(layout, 'colorless-import', 'import');
    expect(persisted!.draft).toEqual(layout);
    expect(persisted!.revision).toBe('disk-original');
    snapshot(layout, 'colorless-external');
    expect(persisted!.baseline).toEqual(layout);
    expect(persisted!.pending).toEqual([]);
    click('Edit Layout');
    click('→');
    const incoming = { ...layout, tiles: layout.tiles.map(() => 2) };
    snapshot(incoming, 'colorless-incoming');
    const id = persisted!.pending[0].id;
    click(`Use incoming #${id}...`);
    click(`Confirm incoming #${id}`);
    expect(persisted!.draft).toEqual(incoming);
    expect(persisted!.baseline).toEqual(incoming);
    expect(persisted!.revision).toBe('colorless-incoming');
    expect(host.textContent).not.toContain('● Save Layout');
    expect(persisted!.draft).not.toHaveProperty('tileColors');
  });

  it('adds a pet through the editor, persists identity, acknowledges the save and restores the pet', () => {
    const sheet = Array.from({ length: 96 }, () => Array(96).fill('#abcdef'));
    send({ type: 'manifestAssetsLoaded', snapshot: {
      furniture: [], floors: [], walls: [], carpets: [],
      pets: [{ id: 'claudio', name: 'Claudio', petType: 0, sprite: sheet }],
      directories: [], diagnostics: [],
    } });
    const layout: OfficeLayout = { ...imported, pets: [] };
    snapshot(layout, 'pet-disk-revision');
    click('Edit Layout');
    click('♥Pets');
    const petButton = [...host.querySelectorAll('button')].find((button) => button.title === 'Claudio');
    expect(petButton).toBeDefined();
    expect(petButton!.getAttribute('aria-pressed')).toBe('false');
    act(() => petButton!.click());
    const draftPets = persisted!.draft!.pets!;
    expect(draftPets).toHaveLength(1);
    expect(draftPets[0]).toMatchObject({ petType: 0 });
    expect(draftPets[0].id).toBeTruthy();
    expect(petButton!.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('● Save Layout');
    const incomingPets: OfficeLayout = { ...layout, pets: [{ id: 'remote-companion', petType: 0 }] };
    snapshot(incomingPets, 'pet-external-revision');
    expect(persisted!.draft!.pets).toEqual(draftPets);
    expect(persisted!.pending[0].layout).toEqual(incomingPets);
    click('● Save Layout');
    expect(saves()).toEqual([]);
    const conflictId = persisted!.pending[0].id;
    click(`Keep local draft #${conflictId}`);
    expect(persisted!.draft!.pets).toEqual(draftPets);
    expect(persisted!.retained.map((retained) => retained.layout)).toContainEqual(incomingPets);
    click('● Save Layout');
    const savedMessage = saves().at(-1);
    expect(savedMessage).toMatchObject({
      type: 'saveLayout', expectedRevision: 'pet-external-revision',
      layout: { pets: draftPets },
    });
    if (savedMessage?.type !== 'saveLayout') throw new Error('Expected pet layout save');
    send({ type: 'layoutSaved', layout: savedMessage.layout, revision: 'pet-saved-revision' });
    expect(persisted!.baseline?.pets).toEqual(draftPets);
    expect(persisted!.revision).toBe('pet-saved-revision');
    remount();
    snapshot(savedMessage.layout, 'pet-saved-revision');
    expect(persisted!.draft?.pets).toEqual(draftPets);
    expect(host.textContent).not.toContain('● Save Layout');
    click('Edit Layout');
    expect(host.textContent).not.toContain('● Save Layout');
  });

  it.each(['local', 'incoming'] as const)('retains real carpet edits and different external carpets through %s resolution, exports, acknowledgement, recovery and staged imports', (choice) => {
    const base: OfficeLayout = { ...imported, carpetTiles: Array(300).fill(null) };
    base.carpetTiles![41] = {
      variant: 1, color: { h: 90, s: 70, b: -20, c: 0 },
      accentColor: { h: 40, s: 60, b: 10, c: 0 }, order: 5,
    };
    snapshot(base, 'carpet-base');
    send({ type: 'manifestAssetsLoaded', snapshot: {
      furniture: [], floors: [], walls: [], pets: [], directories: [], diagnostics: [],
      carpets: [0, 1, 2].map(() => Array.from({ length: 16 }, () => [['#111111', '#eeeeee']])),
    } });
    click('Edit Layout');
    click('▦Carpet');
    const canvas = host.querySelector('canvas')!;
    const mouse = (type: string, col: number) => act(() => canvas.dispatchEvent(new MouseEvent(type, {
      bubbles: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      clientX: col * 32 + 16, clientY: 2 * 32 + 16,
    })));
    mouse('mousedown', 2); mouse('mousemove', 3); mouse('mouseup', 3);
    const local = structuredClone(persisted!.draft!);
    expect(local.carpetTiles?.[41]).toEqual(base.carpetTiles![41]);
    expect(local.carpetTiles?.[42]).toEqual({
      variant: 0, color: { h: 0, s: 71, b: -32, c: 0, colorize: true },
      accentColor: { h: 34, s: 64, b: 21, c: 0, colorize: true }, order: 6,
    });
    expect(local.carpetTiles?.[43]?.order).toBe(7);
    const incoming: OfficeLayout = { ...external, carpetTiles: Array(300).fill(null) };
    incoming.carpetTiles![61] = {
      variant: 2, color: { h: 210, s: 80, b: -30, c: 0 },
      accentColor: { h: 30, s: 100, b: 20, c: 0 }, order: 10,
    };
    snapshot(incoming, 'carpet-external');
    expect(persisted!.draft).toEqual(local);
    expect(persisted!.pending[0].layout).toEqual(incoming);
    click('● Save Layout');
    expect(saves()).toEqual([]);
    const id = persisted!.pending[0].id;
    click('Export local draft');
    expect(vscode.postMessage).toHaveBeenLastCalledWith({ type: 'exportLayoutSnapshot', layout: local });
    click(`Export snapshot #${id}`);
    expect(vscode.postMessage).toHaveBeenLastCalledWith({ type: 'exportLayoutSnapshot', layout: incoming });
    remount();
    snapshot(incoming, 'carpet-external');
    expect(persisted!.draft).toEqual(local);
    expect(persisted!.pending[0].layout).toEqual(incoming);
    if (choice === 'local') click(`Keep local draft #${id}`);
    else {
      click(`Use incoming #${id}...`);
      expect(persisted!.draft).toEqual(local);
      click(`Confirm incoming #${id}`);
    }
    const selected = choice === 'local' ? local : incoming;
    expect(persisted!.draft).toEqual(selected);
    expect(persisted!.retained.map((s) => s.layout)).toContainEqual(local);
    click('Edit Layout');
    click(choice === 'local' ? '● Save Layout' : 'Save Layout');
    expect(saves().at(-1)).toEqual({
      type: 'saveLayout', layout: selected, expectedRevision: 'carpet-external', workspaceRoot: 'workspace-A',
    });
    // Saving is not a successful acknowledgement, and edits remain protected.
    send({ type: 'layoutSaved', layout: selected, revision: 'carpet-saved' });
    expect(persisted!.baseline?.carpetTiles).toEqual(selected.carpetTiles);
    remount();
    snapshot(selected, 'carpet-saved');
    expect(persisted!.draft?.carpetTiles).toEqual(selected.carpetTiles);
    const importedCarpets = { ...incoming, carpetTiles: structuredClone(incoming.carpetTiles!) };
    importedCarpets.carpetTiles[61]!.accentColor!.h = 270;
    const saveCount = saves().length;
    snapshot(importedCarpets, 'ignored-import-revision', 'import');
    expect(saves()).toHaveLength(saveCount);
    expect(persisted!.draft).toEqual(importedCarpets);
    expect(persisted!.baseline).toEqual(selected);
    expect(persisted!.revision).toBe('carpet-saved');
    click('Edit Layout');
    click('→');
    expect(persisted!.draft?.carpetTiles).toHaveLength(315);
    expect(persisted!.draft?.carpetTiles?.[64]).toEqual(importedCarpets.carpetTiles[61]);
    click('Undo');
    expect(persisted!.draft).toEqual(importedCarpets);
    click('Redo');
    expect(persisted!.draft?.carpetTiles?.[64]).toEqual(importedCarpets.carpetTiles[61]);
  });

  it.each(['local', 'incoming'] as const)('protects width21 and four legacy items through explicit %s resolution, export, save and reload', (choice) => {
    // Same user-visible sequence as the confirmed real-file-watcher loss case.
    snapshot(imported, 'disk-original', 'import');
    click('Edit Layout');
    click('→');
    const local = JSON.parse(JSON.stringify(persisted!.draft)) as OfficeLayout;
    expect(local).toEqual({ ...imported, cols: 21, tiles: [...imported.tiles.slice(0, 20), 8,
      ...Array.from({ length: 14 }, (_, row) => [...imported.tiles.slice((row + 1) * 20, (row + 2) * 20), 8]).flat()] });
    snapshot(external, 'disk-external');
    expect(persisted!.draft).toEqual(local);
    expect(persisted!.pending[0].layout).toEqual(external);
    expect(host.querySelector('[aria-label="Layout recovery"]')?.textContent).toContain('"cols": 21');
    expect(host.querySelector('[aria-label="Layout recovery"]')?.textContent).toContain('legacy-3');
    click('● Save Layout');
    expect(saves()).toEqual([]);
    const id = persisted!.pending[0].id;
    click('Export local draft');
    expect(vscode.postMessage).toHaveBeenLastCalledWith({ type: 'exportLayoutSnapshot', layout: local });
    click(`Export snapshot #${id}`);
    expect(vscode.postMessage).toHaveBeenLastCalledWith({ type: 'exportLayoutSnapshot', layout: external });
    remount();
    snapshot(external, 'disk-external');
    expect(persisted!.draft).toEqual(local);
    expect(persisted!.pending[0].layout).toEqual(external);
    // Dirty protection works even with Edit Layout switched off after remount.
    expect(host.textContent).toContain('Layout conflict');
    if (choice === 'local') click(`Keep local draft #${id}`);
    else {
      click(`Use incoming #${id}...`);
      expect(persisted!.draft).toEqual(local);
      click(`Cancel replacement`);
      expect(persisted!.draft).toEqual(local);
      click(`Use incoming #${id}...`);
      click(`Confirm incoming #${id}`);
    }
    const selected = choice === 'local' ? local : external;
    expect(persisted!.draft).toEqual(selected);
    expect(persisted!.pending).toEqual([]);
    expect(persisted!.retained.map((s) => s.layout)).toContainEqual(local);
    if (choice === 'local') expect(persisted!.retained.map((s) => s.layout)).toContainEqual(external);
    click('Edit Layout');
    click(choice === 'local' ? '● Save Layout' : 'Save Layout');
    expect(saves().at(-1)).toEqual({
      type: 'saveLayout', layout: selected, expectedRevision: 'disk-external', workspaceRoot: 'workspace-A',
    });
    send({ type: 'layoutSaved', layout: selected, revision: 'disk-saved' });
    expect(persisted!.baseline).toEqual(selected);
    expect(host.textContent).not.toContain('● Save Layout');
    remount();
    snapshot(selected, 'disk-saved');
    expect(persisted!.draft).toEqual(selected);
    expect(persisted!.retained.map((s) => s.layout)).toContainEqual(local);
  });

  it('queues dirty file imports without replacing either side or suppressing subsequent cross-window snapshots', () => {
    click('Edit Layout');
    click('→');
    const local = JSON.parse(JSON.stringify(persisted!.draft));
    snapshot(external, 'ignored-import-revision', 'import');
    const importedId = persisted!.pending[0].id;
    expect(persisted!.revision).toBe('disk-original');
    expect(persisted!.draft).toEqual(local);
    expect(persisted!.pending[0].layout).toEqual(external);
    click(`Keep local draft #${importedId}`);
    const later = { ...external, rows: 16, tiles: Array(320).fill(2) };
    snapshot(later, 'disk-later');
    const laterId = persisted!.pending[0].id;
    expect(laterId).not.toBe(importedId);
    expect(persisted!.pending[0].layout).toEqual(later);
    expect(persisted!.draft).toEqual(local);
    click('Reset');
    expect(persisted!.draft).toEqual(local);
    click(`Keep local draft #${laterId}`);
    click('● Save Layout');
    expect(saves().at(-1)?.layout).toEqual(local);
    send({ type: 'layoutError', error: 'Disk locked; retry Save.' });
    expect(host.textContent).toContain('Disk locked');
    expect(host.textContent).toContain('● Save Layout');
    click('● Save Layout');
    send({ type: 'layoutSaved', layout: local, revision: 'disk-final' });
    expect(persisted!.baseline).toEqual(local);
    expect(persisted!.retained.map((s) => s.layout)).toContainEqual(external);
    expect(persisted!.retained.map((s) => s.layout)).toContainEqual(later);
  });

  it('applies clean imports as unsaved contents, preserves edits made during an in-flight save, and clears dirty on exact undo', () => {
    snapshot(external, 'ignored', 'import');
    expect(persisted!.draft).toEqual(external);
    expect(persisted!.baseline).toEqual(imported);
    expect(persisted!.pending).toEqual([]);
    click('Edit Layout');
    click('● Save Layout');
    click('→');
    const duringSave = JSON.parse(JSON.stringify(persisted!.draft));
    send({ type: 'layoutSaved', layout: external, revision: 'new-disk' });
    expect(persisted!.draft).toEqual(duringSave);
    expect(persisted!.baseline).toEqual(external);
    expect(host.textContent).toContain('● Save Layout');
    click('Undo');
    expect(persisted!.draft).toEqual(external);
    expect(host.textContent).not.toContain('● Save Layout');
  });

  it('keeps live draft/snapshot exports available when panel-state persistence fails', () => {
    vi.mocked(vscode.setState).mockImplementation(() => { throw new Error('state quota'); });
    click('Edit Layout');
    click('→');
    snapshot(external, 'disk-external');
    expect(host.textContent).toContain('Recovery persistence failed');
    expect(host.textContent).toContain('state quota');
    click('Export local draft');
    const exported = vi.mocked(vscode.postMessage).mock.calls.map(([m]) => m).filter((m) => m.type === 'exportLayoutSnapshot').at(-1)!;
    expect(exported.layout.cols).toBe(21);
    expect(exported.layout.furniture).toEqual([]);
    // The failed storage operation never pretends that the stale persisted copy is current.
    expect(persisted!.draft).toEqual(imported);
    expect(host.querySelector('[aria-label="Layout recovery"]')?.textContent).toContain('legacy-3');
  });

  it('isolates malformed incoming messages and preserves malformed recovery state for inspection', () => {
    click('Edit Layout');
    click('→');
    const before = JSON.parse(JSON.stringify(persisted));
    act(() => window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'layoutLoaded', layout: { ...external, tiles: [] }, revision: 'bad',
    } })));
    expect(persisted).toEqual(before);
    expect(host.textContent).toContain('Incoming layout is malformed');
    vi.mocked(vscode.getState).mockReturnValue({ malformedRecovery: 'copy me' });
    vi.mocked(vscode.setState).mockClear();
    remount();
    snapshot(external, 'disk-external');
    expect(vscode.setState).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Layout recovery state is malformed');
    expect(host.textContent).toContain('copy me');
  });

  it('blocks saving an original draft into a different workspace', () => {
    click('Edit Layout');
    click('→');
    const local = JSON.parse(JSON.stringify(persisted!.draft));
    send({ type: 'layoutLoaded', layout: external, workspaceRoot: 'workspace-B', revision: 'other-disk' });
    expect(persisted!.draft).toEqual(local);
    expect(persisted!.workspaceRoot).toBe('workspace-A');
    expect(persisted!.pending[0].workspaceRoot).toBe('workspace-B');
    const id = persisted!.pending[0].id;
    click(`Keep local draft #${id}`);
    click('● Save Layout');
    expect(saves()).toEqual([]);
    expect(host.textContent).toContain('Recovery/workspace is blocked');
    expect(persisted!.draft).toEqual(local);
    expect(persisted!.retained.map((s) => s.layout)).toContainEqual(external);
  });
});

describe('settings and source UI with simulated host messages', () => {
  let host: HTMLDivElement;
  let root: Root;
  const status: SourceStatus = {
    workspaceRoot: 'C:\\project', squadDir: 'C:\\project\\.squad',
    teamFound: true, observer: 'watching', nativeWatch: false, error: null,
  };
  function send(message: OutboundMessage) {
    act(() => window.dispatchEvent(new MessageEvent('message', { data: message })));
  }
  function click(text: string) {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === text);
    expect(button, text).toBeDefined();
    act(() => button!.click());
  }
  function load() {
    send({ type: 'layoutLoaded', layout: { version: 2, cols: 6, rows: 6, tiles: Array(36).fill(1), furniture: [] } });
    send({ type: 'sourceStatus', status });
  }
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(vscode, 'postMessage').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('restores both settings on startup/reload, sends changes, and persists Debug Close as off', () => {
    send({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: false });
    load();
    expect(isSoundEnabled()).toBe(false);
    click('Settings');
    const sound = host.querySelector<HTMLInputElement>('#squad-pod-sound')!;
    const debug = host.querySelector<HTMLInputElement>('#squad-pod-debug-view')!;
    expect(sound.checked).toBe(false);
    expect(debug.checked).toBe(false);
    act(() => sound.click());
    expect(isSoundEnabled()).toBe(true);
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'setSoundEnabled', enabled: true });
    act(() => debug.click());
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'setDebugEnabled', enabled: true });
    expect(host.textContent).toContain('Authoritative tool/context data is unavailable');
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<App />));
    send({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: true });
    load();
    expect(isSoundEnabled()).toBe(false);
    expect(host.textContent).toContain('Authoritative tool/context data is unavailable');
    click('Close');
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'setDebugEnabled', enabled: false });
    click('Settings');
    expect(host.querySelector<HTMLInputElement>('#squad-pod-debug-view')!.checked).toBe(false);
  });

  it('shows only host-reported observer status and labels absent producers/launch explicitly', () => {
    load();
    click('Settings');
    expect(host.textContent).toContain('Team file: Found');
    expect(host.textContent).toContain('Watching (polling)');
    expect(host.textContent).toContain('EventBus / WebSocket bridge: Not connected (no producer)');
    expect(host.textContent).toContain('Automatic launch on startup/refocus: Off (unavailable)');
    send({ type: 'sourceStatus', status: { ...status, observer: 'stopped', nativeWatch: false, error: 'Observer stopped' } });
    expect(host.textContent).toContain('File observer: Stopped');
    expect(host.querySelector('[role=alert]')?.textContent).toBe('Observer stopped');
  });

  it('onboards a missing team, removes guidance on discovery and never launches on focus', () => {
    load();
    send({ type: 'sourceStatus', status: { ...status, teamFound: false } });
    expect(host.querySelector('[aria-label="Set up Squad"]')?.textContent).toContain('No Squad team found');
    expect(host.textContent).toContain('Your saved office is kept');
    expect(host.querySelector('a')?.href).toBe('https://github.com/bradygaster/squad#readme');
    const before = vi.mocked(vscode.postMessage).mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(vscode.postMessage).toHaveBeenCalledTimes(before);
    send({ type: 'sourceStatus', status });
    expect(host.querySelector('[aria-label="Set up Squad"]')).toBeNull();
    expect(host.textContent).toContain('Squad Info');
    expect(host.textContent).toContain('Telemetry');
  });

  it('shows the no-workspace guidance before any layout and recovers after a folder opens', () => {
    send({ type: 'noWorkspace' });
    expect(host.textContent).toContain('Open a folder to get started');
    expect(host.textContent).not.toContain('Loading office');
    load();
    expect(host.textContent).not.toContain('Open a folder to get started');
    expect(host.querySelector('canvas')).not.toBeNull();
  });

  it('reacts to later layout messages alone to show and clear missing-art warnings after ready', () => {
    load();
    expect(host.textContent).not.toContain('Asset warnings');
    const furniture = [
      { uid: 'legacy', type: 'desk', col: 1, row: 1, rotation: 0 },
      { uid: 'unknown', type: 'unknown-imported-id', col: 4, row: 4, rotation: 0 },
    ];
    const layout = { version: 2, cols: 6, rows: 6, tiles: Array(36).fill(1), furniture };
    const original = JSON.stringify(layout);
    send({ type: 'layoutLoaded', layout });
    expect(host.textContent).toContain('Asset warnings (2)');
    expect(host.textContent).toContain('unknown-imported-id');
    expect(host.textContent).toContain('desk');
    expect(JSON.stringify(layout)).toBe(original);
    send({ type: 'layoutLoaded', layout: { ...layout, furniture: [] } });
    expect(host.textContent).not.toContain('Asset warnings');
    expect(vi.mocked(vscode.postMessage).mock.calls.filter(([m]) => m.type === 'saveLayout')).toEqual([]);
  });

  it('keeps unsaved editor work and undo history when asset diagnostics refresh', () => {
    load();
    click('Edit Layout');
    click('→');
    expect(host.textContent).toContain('● Save Layout');
    send({ type: 'manifestAssetsLoaded', snapshot: {
      furniture: [], floors: [], walls: [], carpets: [], pets: [], directories: [], diagnostics: ['Root read budget exceeded'],
    } });
    expect(host.textContent).toContain('Root read budget exceeded');
    expect(host.textContent).toContain('● Save Layout');
    expect(vi.mocked(vscode.postMessage).mock.calls.filter(([m]) => m.type === 'saveLayout')).toEqual([]);
    click('● Save Layout');
    expect(vscode.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'saveLayout', layout: expect.objectContaining({ cols: 7, rows: 6, furniture: [] }),
    }));
    const saved = vi.mocked(vscode.postMessage).mock.calls.map(([m]) => m).filter((m) => m.type === 'saveLayout').at(-1)!;
    if (saved.type !== 'saveLayout') throw new Error('Expected save');
    send({ type: 'layoutSaved', layout: saved.layout, revision: JSON.stringify(saved.layout) });
    click('Undo');
    click('● Save Layout');
    expect(vscode.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'saveLayout', layout: expect.objectContaining({ cols: 6, rows: 6, furniture: [] }),
    }));
  });

  it('updates the live asset palette and visible diagnostics through simulated host snapshots without saving/resetting layouts', () => {
    const layout = {
      version: 2, cols: 6, rows: 6, tiles: Array(36).fill(1),
      furniture: [{ uid: 'old', type: 'unknown-old-id', col: 2, row: 2, rotation: 0 }],
    };
    const snapshot: AssetSnapshot = {
      furniture: [{
        type: 'local_TEST_TEST', label: 'Test fixture asset', width: 1, height: 1,
        sprite: [['#abcdef']], isDesk: false, category: 'decor', canPlaceOnSurfaces: false, canPlaceOnWalls: false,
      }],
      floors: [], walls: [], carpets: [], pets: [], directories: ['C:\\fixture-assets'], diagnostics: ['Bad fixture manifest rejected'],
    };
    send({ type: 'manifestAssetsLoaded', snapshot });
    send({ type: 'layoutLoaded', layout });
    send({ type: 'sourceStatus', status });
    expect(host.textContent).toContain('Unavailable asset: unknown-old-id');
    expect(host.textContent).toContain('Bad fixture manifest rejected');
    click('Settings');
    click('Add Asset Directory');
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'addAssetDirectory' });
    click('Unload');
    expect(vscode.postMessage).toHaveBeenCalledWith({ type: 'removeAssetDirectory', directory: 'C:\\fixture-assets' });
    send({ type: 'manifestAssetsLoaded', snapshot: { ...snapshot, directories: [], diagnostics: [] } });
    expect(host.textContent).not.toContain('Bad fixture manifest rejected');
    expect(host.textContent).toContain('Unavailable asset: unknown-old-id');
    expect(vi.mocked(vscode.postMessage).mock.calls.filter(([m]) => m.type === 'saveLayout')).toEqual([]);
    expect(layout.furniture[0]).toEqual({ uid: 'old', type: 'unknown-old-id', col: 2, row: 2, rotation: 0 });
  });
});
