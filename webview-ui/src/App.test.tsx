import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { isSoundEnabled } from './notificationSound.js';
import { resetPetTemplates } from './office/sprites/petSpriteData.js';
import type { DirectoryCatalog, OutboundMessage, SourceStatus } from '../../src/types.js';
import type { AssetSnapshot } from '../../src/manifestAssets.js';
import type { LayoutRecovery } from './office/editor/layoutDraft.js';
import type { OfficeLayout } from './office/types.js';
import { createHostClientFixture } from './__tests__/hostClientFixture.js';
import type { HostClientFixture } from './__tests__/hostClientFixture.js';
import { getFloorSprite, setFloorSprites } from './office/floorTiles.js';
import { getWallSprite, setWallSprites } from './office/wallTiles.js';
import { getCharacterSprites, setCharacterTemplates } from './office/sprites/defaultCharacters.js';
import { createVSCodeClient } from './hostClient.js';
import { OfficeState } from './office/engine/officeState.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('layout conflict UI and panel-state recovery (simulated host boundary)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let persisted: LayoutRecovery | undefined;
  let client: HostClientFixture;
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
    act(() => client.emit(message));
  }
  function click(text: string) {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
    expect(button, text).toBeDefined();
    act(() => button!.click());
  }
  function snapshot(layout: OfficeLayout, revision: string, source: 'external' | 'import' = 'external') {
    send({ type: 'layoutLoaded', layout, revision, source, workspaceRoot: 'workspace-A' });
  }
  async function nextFrame() {
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
  function saves() {
    return vi.mocked(client.send).mock.calls.map(([m]) => m).filter((m) => m.type === 'saveLayout');
  }
  function remount() {
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<App client={client} />));
  }
  beforeEach(() => {
    resetPetTemplates();
    persisted = undefined;
    client = createHostClientFixture();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.mocked(client.getState).mockImplementation(() => persisted);
    vi.spyOn(client, 'setState');
    vi.mocked(client.setState).mockImplementation((value) => {
      persisted = JSON.parse(JSON.stringify(value)) as LayoutRecovery;
      return value;
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App client={client} />));
    snapshot(imported, 'disk-original');
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetPetTemplates();
    setFloorSprites([]);
    setWallSprites([]);
    setCharacterTemplates([]);
    vi.restoreAllMocks();
  });

  it('subscribes before the readiness handshake and sends the initial host messages in order', () => {
    expect(client.subscribe).toHaveBeenCalledOnce();
    expect(client.events.slice(0, 3)).toEqual([
      'subscribe', 'send:webviewReady', 'send:diagnosticReport',
    ]);
  });

  it('disables standalone mutations without optimistic settings or seat persistence', async () => {
    act(() => root.unmount());
    client = createHostClientFixture();
    vi.spyOn(client, 'setState');
    root = createRoot(host);
    act(() => root.render(<App client={client} readOnly />));
    snapshot(imported, 'observer');
    send({ type: 'sourceStatus', status: {
      workspaceRoot: 'workspace-A', squadDir: 'workspace-A/.squad',
      teamFound: true, observer: 'watching', nativeWatch: false, error: null,
    } });
    send({ type: 'existingAgents', agents: [{
      id: 'test-agent-1', name: 'TestBot', role: 'Developer', paletteIndex: 0,
      seatId: null, status: 'idle', currentTask: 'Approximate observed activity',
    }] });
    await nextFrame();
    for (const label of ['Edit Layout', 'Settings', 'Directories']) {
      const button = [...host.querySelectorAll('button')].find(button => button.textContent === label);
      expect(button?.disabled).toBe(true);
      act(() => button?.click());
    }
    const squadInfo = [...host.querySelectorAll('button')].find(button => button.textContent === 'Squad Info');
    expect(squadInfo?.disabled).toBe(false);
    act(() => squadInfo?.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('TestBot');
    expect(host.querySelector('[data-edit-mode="true"]')).toBeNull();
    expect(vi.mocked(client.send).mock.calls.map(([message]) => message.type)).toEqual(['webviewReady']);
    expect(client.setState).not.toHaveBeenCalled();
    const detailToggle = host.querySelector<HTMLButtonElement>('[aria-label="Show details for TestBot"]');
    expect(detailToggle).not.toBeNull();
    act(() => detailToggle?.click());
    const detailRequest = vi.mocked(client.send).mock.calls
      .map(([message]) => message).filter((message) => message.type === 'requestAgentDetail').at(-1);
    expect(detailRequest?.type).toBe('requestAgentDetail');
    send({ type: 'agentDetailLoaded',
      requestId: detailRequest?.type === 'requestAgentDetail' ? detailRequest.requestId : undefined,
      detail: {
      id: 'test-agent-1', name: 'TestBot', role: 'Developer', workspaceRoot: 'workspace-A',
      status: 'active', currentTask: 'Approximate observed activity', charterSummary: null,
      charterContent: null, charterStatus: 'unavailable', expertise: null,
      responsibilities: null, boundaries: null, recentActivity: [], lastActiveAt: 0,
      } });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Charter content is unavailable.');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Declared model metadata is unavailable in the read-only observer.');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Current-session model: unavailable');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Observed status: active');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Observed activity: Approximate observed activity');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('unavailable in the read-only observer');
    const collapseToggle = host.querySelector<HTMLButtonElement>('[aria-label="Hide details for TestBot"]');
    expect(collapseToggle).not.toBeNull();
    act(() => collapseToggle?.click());
    send({ type: 'existingAgents', agents: [{
      id: 'test-agent-1', name: 'TestBot', role: 'Developer', paletteIndex: 0,
      seatId: null, status: 'waiting', currentTask: 'Refreshed observed activity',
    }] });
    const refreshedToggle = host.querySelector<HTMLButtonElement>('[aria-label="Show details for TestBot"]');
    expect(refreshedToggle).not.toBeNull();
    act(() => refreshedToggle?.click());
    const refreshedRequest = vi.mocked(client.send).mock.calls
      .map(([message]) => message).filter((message) => message.type === 'requestAgentDetail').at(-1);
    expect(refreshedRequest?.type).toBe('requestAgentDetail');
    expect(refreshedRequest?.type === 'requestAgentDetail' ? refreshedRequest.requestId : undefined)
      .not.toBe(detailRequest?.type === 'requestAgentDetail' ? detailRequest.requestId : undefined);
    send({ type: 'agentDetailLoaded',
      requestId: detailRequest?.type === 'requestAgentDetail' ? detailRequest.requestId : undefined,
      detail: {
        id: 'test-agent-1', name: 'TestBot', role: 'Developer', workspaceRoot: 'workspace-A',
        status: 'active', currentTask: 'Stale observed activity', charterSummary: null,
        charterContent: null, charterStatus: 'unavailable', expertise: null,
        responsibilities: null, boundaries: null, recentActivity: [], lastActiveAt: 0,
      } });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Loading observed details');
    send({ type: 'agentDetailLoaded',
      requestId: refreshedRequest?.type === 'requestAgentDetail' ? refreshedRequest.requestId : undefined,
      detail: {
        id: 'test-agent-1', name: 'TestBot', role: 'Developer', workspaceRoot: 'workspace-A',
        status: 'waiting', currentTask: 'Refreshed observed activity', charterSummary: null,
        charterContent: null, charterStatus: 'unavailable', expertise: null,
        responsibilities: null, boundaries: null, recentActivity: [], lastActiveAt: 0,
      } });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Observed status: waiting');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Observed activity: Refreshed observed activity');
    expect(host.querySelector('[role="dialog"]')?.textContent).not.toContain('Stale observed activity');
    expect(vi.mocked(client.send).mock.calls.map(([message]) => message.type)).toEqual([
      'webviewReady', 'requestAgentDetail', 'requestAgentDetail',
    ]);
    click('Telemetry');
    expect(host.textContent).toContain('Live transient tasks are unavailable in the read-only observer.');
    expect(host.textContent).not.toContain('Enable it in Settings');
  });

  it('keeps observed Squad Info and correlated details available with standalone control but no native charter action', async () => {
    act(() => root.unmount());
    client = createHostClientFixture();
    root = createRoot(host);
    act(() => root.render(<App client={client} standalone />));
    snapshot(imported, 'observer');
    send({ type: 'sourceStatus', status: {
      workspaceRoot: 'workspace-A', squadDir: 'workspace-A/.squad',
      teamFound: true, observer: 'watching', nativeWatch: false, error: null,
    } });
    send({ type: 'existingAgents', agents: [{
      id: 'test-agent-1', name: 'TestBot', role: 'Developer', paletteIndex: 0,
      seatId: null, status: 'idle', currentTask: null,
    }] });
    await nextFrame();
    for (const label of ['Edit Layout', 'Settings', 'Squad Info']) {
      expect([...host.querySelectorAll('button')].find(button => button.textContent === label)?.disabled).toBe(false);
    }
    expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Directories')?.disabled).toBe(true);
    click('Squad Info');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('TestBot');
    const detailToggle = host.querySelector<HTMLButtonElement>('[aria-label="Show details for TestBot"]');
    act(() => detailToggle?.click());
    const request = vi.mocked(client.send).mock.calls.map(([message]) => message)
      .filter(message => message.type === 'requestAgentDetail').at(-1);
    expect(request?.requestId).toBeTruthy();
    send({ type: 'agentDetailLoaded', requestId: request?.requestId, detail: {
      id: 'test-agent-1', name: 'TestBot', role: 'Developer', workspaceRoot: 'workspace-A',
      status: 'idle', currentTask: null, charterSummary: null, charterContent: null,
      charterStatus: 'unavailable', expertise: null, responsibilities: null, boundaries: null,
      recentActivity: [], lastActiveAt: 0,
    } });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Charter content is unavailable.');
    const open = [...host.querySelectorAll('button')].find(button => button.textContent === 'Open charter');
    expect(open?.disabled).toBe(true);
    expect(vi.mocked(client.send).mock.calls.map(([message]) => message.type)
      .filter(type => ['openSquadInfo', 'openSquadAgent', 'saveAgentSeats'].includes(type))).toEqual([]);
  });

  it.each([false, true])('reconciles authoritative standalone seats before the next whole-map gesture with readOnly=%s', async readOnly => {
    act(() => root.unmount());
    client = createHostClientFixture();
    const assignments = vi.spyOn(OfficeState.prototype, 'getSeatAssignments');
    root = createRoot(host);
    act(() => root.render(<App client={client} standalone readOnly={readOnly} />));
    const chairCols = [2, 5, 8, 11];
    snapshot({ ...imported, furniture: chairCols.flatMap((col, index) => [
      { uid: `desk-${index}`, type: 'desk', col, row: 1, rotation: 0 },
      { uid: `chair-${index}`, type: 'chair', col, row: 2, rotation: 0 },
    ]) }, 'seat-layout');
    const agents = ['test-agent-1', 'test-agent-2'].map((id, index) => ({
      id, name: id, role: 'Developer', paletteIndex: index, seatId: `chair-${index * 2 + 1}`,
      status: 'idle' as const, currentTask: null,
    }));
    send({ type: 'existingAgents', agents });
    await nextFrame();
    const office = assignments.mock.contexts.at(-1)!;
    if (!(office instanceof OfficeState)) throw new Error('Expected the actual App OfficeState');
    const first = office.characters.get('test-agent-1')!;
    expect(office.getSeatAssignments()).toEqual({ 'test-agent-1': 'chair-1', 'test-agent-2': 'chair-3' });
    send({ type: 'existingAgents', agents: [{ ...agents[0], seatId: 'chair-0', paletteIndex: 13 }, agents[1]] });
    expect(office.characters.get('test-agent-1')).toBe(first);
    expect(office.getSeatAssignments()).toEqual({ 'test-agent-1': 'chair-0', 'test-agent-2': 'chair-3' });
    expect([first.palette, first.hueShift]).toEqual([1, 90]);
    expect(vi.mocked(client.send).mock.calls.filter(([message]) => message.type === 'saveAgentSeats')).toEqual([]);
    if (!readOnly) {
      office.selectedAgentId = 'test-agent-2';
      act(() => host.querySelector('canvas')!.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button: 0, clientX: 8.5 * 32, clientY: 2.5 * 32,
      })));
      expect(client.send).toHaveBeenCalledWith({
        type: 'saveAgentSeats', seats: { 'test-agent-1': 'chair-0', 'test-agent-2': 'chair-2' },
      });
    }
  });

  it('updates existing roster identity and restores only the observed task from snapshots', async () => {
    const roster = (name: string, role: string, currentTask: string | null, status: 'active' | 'idle') => ({
      type: 'existingAgents' as const,
      agents: [{
        id: 'homer',
        name,
        role,
        paletteIndex: 7,
        seatId: null,
        status,
        currentTask,
      }],
    });

    send(roster('Homer', 'Dev', 'writing tests', 'active'));
    await nextFrame();
    const labels = () => [...host.querySelectorAll('button')]
      .filter((button) => button.querySelector('[role="img"]'));
    expect(labels()).toHaveLength(1);
    expect(labels()[0].textContent).toContain('Homer');
    expect(labels()[0].textContent).toContain('Dev');
    expect(labels()[0].querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Active');
    expect(host.textContent).toContain('Observed activity: writing tests');

    send({
      type: 'agentToolStart',
      agentId: 'homer',
      tool: 'stale-live-tool',
      status: 'Stale live activity',
    });
    await nextFrame();
    expect(host.textContent).toContain('stale-live-tool');
    expect(host.textContent).toContain('Stale live activity');

    send(roster('Homer Simpson', 'Architect', 'reviewing the snapshot', 'active'));
    send(roster('Homer Simpson', 'Architect', 'reviewing the snapshot', 'active'));
    await nextFrame();
    expect(labels()).toHaveLength(1);
    expect(labels()[0].textContent).toContain('Homer Simpson');
    expect(labels()[0].textContent).toContain('Architect');
    expect(host.textContent.match(/Observed activity: reviewing the snapshot/g)).toHaveLength(1);
    expect(host.textContent).not.toContain('Observed activity: writing tests');
    expect(host.textContent).not.toContain('stale-live-tool');
    expect(host.textContent).not.toContain('Stale live activity');
    expect(vi.mocked(client.send).mock.calls.map(([message]) => message.type))
      .not.toContain('agentToolStart');
    expect(vi.mocked(client.send).mock.calls.map(([message]) => message.type))
      .not.toContain('telemetryEvent');

    send(roster('Homer Simpson', 'Architect', 'writing tests', 'idle'));
    await nextFrame();
    expect(labels()[0].querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Idle');
    expect(host.textContent).not.toContain('Observed activity: writing tests');

    send({ type: 'existingAgents', agents: [] });
    await nextFrame();
    expect(labels()).toHaveLength(0);
    expect(host.textContent).not.toContain('Observed activity:');
  });

  it('shows an actionable unsupported-host screen without functional office controls', () => {
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<App />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Squad Pod: Show Panel');
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.textContent).not.toContain('Save Layout');
    expect(host.textContent).not.toContain('Launch directory');
  });

  it('surfaces adapter acquisition failures alongside the host recovery action', () => {
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<App client={null} hostError="Error: API acquisition failed" />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('API acquisition failed');
    expect(host.textContent).toContain('Squad Pod: Show Panel');
  });

  it('shows recovery-state read failures without replacing or saving state', () => {
    click('Edit Layout');
    click('→');
    const previousRecovery = structuredClone(persisted);
    vi.mocked(client.getState).mockImplementation(() => {
      throw new Error('state unavailable');
    });
    vi.mocked(client.setState).mockClear();
    vi.mocked(client.subscribe).mockClear();
    vi.mocked(client.send).mockClear();
    const previousEvents = [...client.events];
    remount();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('state unavailable');
    expect(host.textContent).toContain('existing recovery data was not replaced');
    expect(host.textContent).not.toContain('Save Layout');
    expect(client.setState).not.toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
    expect(persisted).toEqual(previousRecovery);
    expect(client.events).toEqual(previousEvents);
  });

  it('guards legacy sprite payloads at the real adapter boundary without replacing valid assets', () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => root.unmount());
    const adapter = createVSCodeClient(() => ({
      postMessage: vi.fn(), getState: () => undefined, setState: (value) => value,
    }), window);
    root = createRoot(host);
    act(() => root.render(<App client={adapter} />));
    const dispatch = (message: unknown) => act(() => window.dispatchEvent(new MessageEvent('message', { data: message })));
    dispatch({ type: 'layoutLoaded', layout: imported, revision: 'legacy-test' });
    const tile = { width: 2, height: 1, pixels: [0xabcdef80, 0] };
    const sprite = [['#abcdef80', '']];
    const frames = { 0: [sprite], 1: [sprite], 2: [sprite], 3: [sprite] };
    const character = { walk: frames, typing: frames, reading: frames };
    dispatch({ type: 'characterSpritesLoaded', sprites: [character] });
    expect(getCharacterSprites(0, 0)).toEqual(character);
    dispatch({ type: 'floorTilesLoaded', tiles: [sprite] });
    expect(getFloorSprite(0)).toEqual([['#abcdef80', '']]);
    dispatch({ type: 'wallTilesLoaded', sprites: Array.from({ length: 16 }, () => sprite) });
    expect(getWallSprite([0], 1, 1, 0, 0).sprite).toEqual([['#abcdef80', '']]);
    const before = getCharacterSprites(0, 0);
    dispatch({ type: 'characterSpritesLoaded', sprites: [{
      paletteIndex: 0, directions: { down: { idle: [tile], walk: [tile] } },
    }] });
    expect(getCharacterSprites(0, 0)).toBe(before);
    dispatch({ type: 'floorTilesLoaded', tiles: [sprite, tile] });
    dispatch({ type: 'wallTilesLoaded' });
    expect(getFloorSprite(0)).toEqual([['#abcdef80', '']]);
    expect(getWallSprite([0], 1, 1, 0, 0).sprite).toEqual([['#abcdef80', '']]);
    for (const type of ['characterSpritesLoaded', 'floorTilesLoaded', 'wallTilesLoaded']) {
      expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining(`${type}: unsupported legacy sprite format`));
      expect(host.textContent).toContain(`${type}: unsupported legacy sprite format`);
    }
    dispatch({ type: 'manifestAssetsLoaded', snapshot: {
      furniture: [], floors: [[['#123456']]], walls: Array.from({ length: 16 }, () => [['#654321']]),
      carpets: [], pets: [], directories: [], diagnostics: ['Manifest warning retained'],
    } });
    expect(getFloorSprite(0)).toEqual([['#123456']]);
    expect(getWallSprite([0], 1, 1, 0, 0).sprite).toEqual([['#654321']]);
    expect(host.textContent).toContain('characterSpritesLoaded: unsupported legacy sprite format');
    expect(host.textContent).toContain('Manifest warning retained');
    dispatch({ type: 'floorTilesLoaded', tiles: [sprite] });
    expect(host.textContent).not.toContain('floorTilesLoaded:');
    expect(host.textContent).toContain('wallTilesLoaded:');
    expect(host.textContent).toContain('Manifest warning retained');
  });

  it('keeps tool choice, dirty draft and undo history independent of zoom and editor control rearrangement', () => {
    click('Edit Layout');
    const panel = host.querySelector('.office-panel')!;
    expect(panel.getAttribute('data-edit-mode')).toBe('true');
    click('♥Pets');
    expect(host.querySelector('[title="Pets"]')?.getAttribute('aria-pressed')).toBe('true');
    click('→');
    const draft = structuredClone(persisted!.draft);
    const recovery = structuredClone(persisted);
    const zoom = host.querySelector('[aria-label="Office zoom"]')!;
    const initialZoom = zoom.textContent;
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click());
    expect(zoom.textContent).not.toBe(initialZoom);
    expect(persisted).toEqual(recovery);
    expect(host.querySelector('[title="Pets"]')?.getAttribute('aria-pressed')).toBe('true');
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!.click());
    expect(zoom.textContent).toBe(initialZoom);
    click('◎Select');
    expect(host.querySelector('[title="Select"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(persisted!.draft).toEqual(draft);
    click('Exit Layout Editor');
    expect(panel.getAttribute('data-edit-mode')).toBe('false');
    click('Edit Layout');
    expect(host.querySelector('[title="Select"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(persisted!.draft).toEqual(draft);
    click('Undo');
    expect(persisted!.draft).toEqual(imported);
    click('Redo');
    expect(persisted!.draft).toEqual(draft);
    expect(saves()).toEqual([]);
  });

  it('keeps directory text editing native and suspends layout shortcuts until the modal closes', () => {
    const layout: OfficeLayout = {
      ...imported,
      furniture: [{
        uid: 'selected-desk', type: 'fixture-desk', col: 2, row: 2, rotation: 0,
        assetFootprint: { width: 2, height: 1 }, assetRole: 'desk',
      }],
    };
    snapshot(layout, 'directory-keyboard-base');
    click('Edit Layout');
    click('→');
    const select = host.querySelector<HTMLButtonElement>('button[title="Select"]')!;
    act(() => select.click());
    const canvas = host.querySelector('canvas')!;
    for (const type of ['mousedown', 'mouseup']) {
      act(() => canvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true, button: 0, buttons: type === 'mousedown' ? 1 : 0,
        clientX: 2 * 32 + 16, clientY: 2 * 32 + 16,
      })));
    }
    expect(host.querySelector('button[title="Delete (Del)"]')).not.toBeNull();
    const draft = structuredClone(persisted!.draft);
    expect(draft!.cols).toBe(21);
    send({
      type: 'directoryCatalog',
      catalog: {
        workspaceDirectories: [], recentLaunches: [], squadHistory: [],
        savedDirectories: [{ id: 'saved-1', name: 'Original', path: 'C:\\Projects\\Original', valid: true }],
      },
    });
    click('Directories');
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Name for Original"]')!;
    input.focus();
    for (const options of [
      { key: 'Backspace' }, { key: 'Delete' }, { key: 'r' }, { key: ' ', code: 'Space' },
      { key: 'z', ctrlKey: true }, { key: 'z', metaKey: true },
      { key: 'z', ctrlKey: true, shiftKey: true }, { key: 'y', ctrlKey: true },
    ]) {
      const event = new KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true });
      act(() => input.dispatchEvent(event));
      expect(event.defaultPrevented, JSON.stringify(options)).toBe(false);
      expect(persisted!.draft).toEqual(draft);
      expect(host.querySelector('button[title="Delete (Del)"]')).not.toBeNull();
    }
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Native rename');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click('Save name');
    expect(client.send).toHaveBeenLastCalledWith({
      type: 'updateDirectoryName', id: 'saved-1', name: 'Native rename',
    });
    click('Close');
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
    expect(persisted!.draft!.furniture).toEqual([]);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
    expect(persisted!.draft).toEqual(draft);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
    expect(persisted!.draft).toEqual(layout);
  });

  it('keeps Area names and directory mapping controls native while protecting selected furniture and layout history', () => {
    const layout: OfficeLayout = {
      ...imported,
      furniture: [{
        uid: 'selected-desk', type: 'fixture-desk', col: 2, row: 2, rotation: 0,
        assetFootprint: { width: 2, height: 1 }, assetRole: 'desk',
      }],
    };
    snapshot(layout, 'area-keyboard-base');
    send({
      type: 'directoryCatalog',
      catalog: {
        workspaceDirectories: [], recentLaunches: [], squadHistory: [],
        savedDirectories: [{ id: 'saved-stable-id', name: 'Synthetic Repo', path: 'C:\\Projects\\Synthetic', valid: true }],
      },
    });
    click('Edit Layout');
    act(() => host.querySelector<HTMLButtonElement>('button[title="Select"]')!.click());
    const canvas = host.querySelector('canvas')!;
    for (const type of ['mousedown', 'mouseup']) {
      act(() => canvas.dispatchEvent(new MouseEvent(type, {
        bubbles: true, button: 0, buttons: type === 'mousedown' ? 1 : 0,
        clientX: 2 * 32 + 16, clientY: 2 * 32 + 16,
      })));
    }
    expect(host.querySelector('button[title="Delete (Del)"]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('button[title="Area"]')!.click());

    const setInputValue = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const nameInput = host.querySelector<HTMLInputElement>('[data-testid="new-area-name"]')!;
    act(() => {
      nameInput.focus();
      setInputValue(nameInput, 'Engineering');
    });
    const dispatchShortcut = (target: HTMLElement, options: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true });
      act(() => target.dispatchEvent(event));
      expect(event.defaultPrevented, JSON.stringify(options)).toBe(false);
    };
    for (const options of [
      { key: 'Backspace' }, { key: 'Delete' }, { key: 'r' }, { key: ' ', code: 'Space' },
      { key: 'z', ctrlKey: true }, { key: 'z', metaKey: true },
      { key: 'z', ctrlKey: true, shiftKey: true }, { key: 'y', ctrlKey: true },
    ]) dispatchShortcut(nameInput, options);
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="add-area"]')!.click());
    expect(persisted!.draft!.areas).toEqual([{ label: 'Engineering', color: '#50c878' }]);
    expect(persisted!.draft!.furniture).toEqual(layout.furniture);
    expect(host.querySelector('button[title="Delete (Del)"]')).not.toBeNull();

    const renameInput = host.querySelector<HTMLInputElement>('[aria-label="Rename Area Engineering"]')!;
    const afterAdd = structuredClone(persisted!.draft);
    act(() => {
      renameInput.focus();
      setInputValue(renameInput, 'Engineering Floor');
    });
    dispatchShortcut(renameInput, { key: 'z', ctrlKey: true });
    expect(persisted!.draft).toEqual(afterAdd);
    act(() => renameInput.blur());
    expect(persisted!.draft!.areas).toEqual([{ label: 'Engineering Floor', color: '#50c878' }]);

    const directorySelect = host.querySelector<HTMLSelectElement>('[data-testid="area-directory"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(directorySelect, 'saved-stable-id');
      directorySelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const beforeMappingKey = structuredClone(persisted!.draft);
    dispatchShortcut(directorySelect, { key: 'Delete' });
    dispatchShortcut(directorySelect, { key: 'r' });
    dispatchShortcut(directorySelect, { key: 'z', ctrlKey: true });
    expect(persisted!.draft).toEqual(beforeMappingKey);
    const mapping = host.querySelector<HTMLInputElement>('[data-testid="area-mapping"]')!;
    act(() => mapping.click());
    expect(persisted!.draft!.areaMappings).toEqual({ 'saved-stable-id': ['Engineering Floor'] });
    expect(persisted!.draft!.furniture).toEqual(layout.furniture);
    expect(host.querySelector('button[title="Delete (Del)"]')).not.toBeNull();
  });

  it('selects a painted Area through Shift-Eyedrop on the real canvas and preserves regular Eyedrop', () => {
    snapshot(imported, 'area-eyedrop-base');
    click('Edit Layout');
    act(() => host.querySelector<HTMLButtonElement>('button[title="Area"]')!.click());
    const nameInput = host.querySelector<HTMLInputElement>('[data-testid="new-area-name"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput, 'Engineering');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="add-area"]')!.click());

    const canvas = host.querySelector('canvas')!;
    const tileX = 1 * 32 + 16;
    const tileY = 1 * 32 + 16;
    act(() => canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, buttons: 1, clientX: tileX, clientY: tileY,
    })));
    act(() => canvas.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, button: 0, buttons: 0, clientX: tileX, clientY: tileY,
    })));
    expect(persisted!.draft!.areaTiles?.[21]).toBe('Engineering');

    act(() => host.querySelector<HTMLButtonElement>('button[title="Eyedrop"]')!.click());
    act(() => canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, buttons: 1, shiftKey: true, clientX: tileX, clientY: tileY,
    })));
    expect(host.querySelector<HTMLButtonElement>('[data-testid="select-area-Engineering"]')?.getAttribute('aria-pressed'))
      .toBe('true');

    act(() => host.querySelector<HTMLButtonElement>('button[title="Eyedrop"]')!.click());
    act(() => canvas.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, buttons: 1, clientX: 2 * 32 + 16, clientY: tileY,
    })));
    expect(host.querySelector<HTMLButtonElement>('button[title="Floor"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shifts Area tiles with grid expansion and restores them through undo and redo', () => {
    const layout: OfficeLayout = {
      ...imported,
      areas: [{ label: 'Engineering', color: '#50c878' }],
      areaTiles: Array(300).fill(null).map((value, index) => index === 0 ? 'Engineering' : value),
      areaMappings: { 'saved-stable-id': ['Engineering'] },
    };
    snapshot(layout, 'area-grid-base');
    click('Edit Layout');
    act(() => host.querySelector<HTMLButtonElement>('button[title="Expand Left"]')!.click());
    expect(persisted!.draft!.cols).toBe(21);
    expect(persisted!.draft!.areaTiles).toHaveLength(315);
    expect(persisted!.draft!.areaTiles?.[1]).toBe('Engineering');
    expect(persisted!.draft!.areaMappings).toEqual(layout.areaMappings);
    click('Undo');
    expect(persisted!.draft).toEqual(layout);
    click('Redo');
    expect(persisted!.draft!.areaTiles?.[1]).toBe('Engineering');
  });

  it('paints, right-erases and removes Areas as undoable editor transactions', () => {
    snapshot(imported, 'area-paint-base');
    click('Edit Layout');
    act(() => host.querySelector<HTMLButtonElement>('button[title="Area"]')!.click());
    const nameInput = host.querySelector<HTMLInputElement>('[data-testid="new-area-name"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput, 'Engineering');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="add-area"]')!.click());

    const canvas = host.querySelector('canvas')!;
    const tileX = 1 * 32 + 16;
    const tileY = 1 * 32 + 16;
    const stroke = (button: number) => {
      act(() => canvas.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button, buttons: button === 0 ? 1 : 2, clientX: tileX, clientY: tileY,
      })));
      act(() => canvas.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, button, buttons: 0, clientX: tileX, clientY: tileY,
      })));
    };
    stroke(0);
    expect(persisted!.draft!.areaTiles?.[21]).toBe('Engineering');
    stroke(2);
    expect(persisted!.draft).not.toHaveProperty('areaTiles');
    click('Undo');
    expect(persisted!.draft!.areaTiles?.[21]).toBe('Engineering');

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Remove Area Engineering"]')!.click());
    expect(persisted!.draft).not.toHaveProperty('areas');
    expect(persisted!.draft).not.toHaveProperty('areaTiles');
    click('Undo');
    expect(persisted!.draft!.areas).toEqual([{ label: 'Engineering', color: '#50c878' }]);
    expect(persisted!.draft!.areaTiles?.[21]).toBe('Engineering');
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
    expect(client.send).toHaveBeenLastCalledWith({ type: 'exportLayoutSnapshot', layout: local });
  });

  it.each(['workspace mismatch', 'malformed recovery', 'malformed acknowledgement', 'unclassified host error'])(
    'does not clear %s on a valid external load', (failure) => {
      let expected: string;
      if (failure === 'workspace mismatch') {
        send({ type: 'layoutLoaded', layout: external, workspaceRoot: 'workspace-B', revision: 'other-disk' });
        expected = 'Workspace changed';
      } else if (failure === 'malformed recovery') {
        vi.mocked(client.getState).mockReturnValue({ malformedRecovery: 'preserve me' });
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
    expect(client.send).toHaveBeenLastCalledWith({ type: 'exportLayoutSnapshot', layout: local });
    click(`Export snapshot #${id}`);
    expect(client.send).toHaveBeenLastCalledWith({ type: 'exportLayoutSnapshot', layout: incoming });
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
    expect(client.send).toHaveBeenLastCalledWith({ type: 'exportLayoutSnapshot', layout: local });
    click(`Export snapshot #${id}`);
    expect(client.send).toHaveBeenLastCalledWith({ type: 'exportLayoutSnapshot', layout: external });
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
    vi.mocked(client.setState).mockImplementation(() => { throw new Error('state quota'); });
    click('Edit Layout');
    click('→');
    snapshot(external, 'disk-external');
    expect(host.textContent).toContain('Recovery persistence failed');
    expect(host.textContent).toContain('state quota');
    click('Export local draft');
    const exported = vi.mocked(client.send).mock.calls.map(([m]) => m).filter((m) => m.type === 'exportLayoutSnapshot').at(-1)!;
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
    act(() => client.emit({
      type: 'layoutLoaded', layout: { ...external, tiles: [] }, revision: 'bad',
    }));
    expect(persisted).toEqual(before);
    expect(host.textContent).toContain('Incoming layout is malformed');
    vi.mocked(client.getState).mockReturnValue({ malformedRecovery: 'copy me' });
    vi.mocked(client.setState).mockClear();
    remount();
    snapshot(external, 'disk-external');
    expect(client.setState).not.toHaveBeenCalled();
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
  let client: HostClientFixture;
  const status: SourceStatus = {
    workspaceRoot: 'C:\\project', squadDir: 'C:\\project\\.squad',
    teamFound: true, observer: 'watching', nativeWatch: false, error: null,
  };
  function send(message: OutboundMessage) {
    act(() => client.emit(message));
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
    client = createHostClientFixture();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App client={client} />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('restores both settings on startup/reload, sends changes, and persists Debug Close as off', () => {
    send({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: false });
    load();
    expect(isSoundEnabled()).toBe(false);
    click('Settings');
    const sound = host.querySelector<HTMLInputElement>('#squad-pod-sound')!;
    const debug = host.querySelector<HTMLInputElement>('#squad-pod-debug-view')!;
    const showAreas = host.querySelector<HTMLInputElement>('#squad-pod-show-areas')!;
    expect(sound.checked).toBe(false);
    expect(debug.checked).toBe(false);
    expect(showAreas.checked).toBe(false);
    act(() => sound.click());
    expect(isSoundEnabled()).toBe(true);
    expect(client.send).toHaveBeenCalledWith({ type: 'setSoundEnabled', enabled: true });
    act(() => debug.click());
    expect(client.send).toHaveBeenCalledWith({ type: 'setDebugEnabled', enabled: true });
    act(() => showAreas.click());
    expect(client.send).toHaveBeenCalledWith({ type: 'setShowAreas', enabled: true });
    expect(host.textContent).toContain('opt-in live member lifecycle, tools and context');
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<App client={client} />));
    send({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: true, showAreas: true });
    load();
    expect(isSoundEnabled()).toBe(false);
    expect(host.textContent).toContain('opt-in live member lifecycle, tools and context');
    click('Close');
    expect(client.send).toHaveBeenCalledWith({ type: 'setDebugEnabled', enabled: false });
    click('Settings');
    expect(host.querySelector<HTMLInputElement>('#squad-pod-debug-view')!.checked).toBe(false);
    expect(host.querySelector<HTMLInputElement>('#squad-pod-show-areas')!.checked).toBe(true);
  });

  it('shows only host-reported observer status and labels absent producers/launch explicitly', () => {
    load();
    click('Settings');
    expect(host.textContent).toContain('Team file: Found');
    expect(host.textContent).toContain('Watching (polling)');
    expect(host.textContent).toContain('EventBus / WebSocket bridge: Not connected (no producer)');
    expect(host.textContent).toContain('Automatic launch on startup/refocus: Off');
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
    const before = vi.mocked(client.send).mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(client.send).toHaveBeenCalledTimes(before);
    send({ type: 'sourceStatus', status });
    expect(host.querySelector('[aria-label="Set up Squad"]')).toBeNull();
    expect(host.textContent).toContain('Squad Info');
    expect(host.textContent).toContain('Telemetry');
  });

  it('shows the no-workspace guidance before any layout and recovers after a folder opens', () => {
    send({ type: 'noWorkspace' });
    expect(host.textContent).toContain('Open a folder to get started');
    expect(host.textContent).not.toContain('Loading office');
    click('Manage / Launch Directories');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('No workspace folders are open.');
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close directories"]')!.click());
    load();
    expect(host.textContent).not.toContain('Open a folder to get started');
    expect(host.querySelector('canvas')).not.toBeNull();
  });

  it('lists workspace and saved folders in a scrollable directory picker and launches only the selected entry', () => {
    load();
    const catalog: DirectoryCatalog = {
      workspaceDirectories: [{
        id: 'workspace:project', name: 'Workspace & Repo',
        path: 'C:\\Users\\Me\\Work & Projects\\Repo', valid: true,
      }],
      savedDirectories: Array.from({ length: 35 }, (_, index) => ({
        id: `saved-${index}`, name: `Saved ${index}`,
        path: `C:\\Projects\\Saved ${index}`, valid: true,
      })),
      recentLaunches: [{
        id: 'recent-1', name: 'Recently launched',
        path: 'C:\\Projects\\Recent', valid: true, lastLaunchedAt: '2026-10-29T18:00:00.000Z',
      }],
      squadHistory: [],
    };
    send({ type: 'directoryCatalog', catalog });
    click('Directories');
    expect(client.send).toHaveBeenCalledWith({ type: 'getDirectories' });
    expect(host.textContent).not.toContain('Recent Squad directories');
    expect(host.textContent).toContain('Recent launch requests below are recorded by Squad Pod');
    expect(host.textContent).toContain('Workspace & Repo');
    expect(host.textContent).toContain('Saved 34');
    expect(host.textContent).toContain('Recently launched');

    const list = host.querySelector<HTMLElement>('[aria-label="Directory list"]')!;
    expect(list.style.overflowY).toBe('auto');
    const launch = host.querySelector<HTMLButtonElement>('[aria-label="Launch Workspace & Repo"]')!;
    act(() => launch.click());
    expect(client.send).toHaveBeenLastCalledWith({
      type: 'launchDirectory', id: 'workspace:project', source: 'workspace',
    });

    send({ type: 'directoryError', error: 'Copilot CLI not found on PATH.' });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('not found on PATH');
  });

  it('routes saved-directory edits, folder changes, removals, and recent-record forgetting to the host', () => {
    load();
    send({
      type: 'directoryCatalog',
      catalog: {
        workspaceDirectories: [],
        savedDirectories: [{ id: 'saved-1', name: 'Original', path: 'C:\\Projects\\Original', valid: true }],
        recentLaunches: [{ id: 'recent-1', name: 'Recent', path: 'C:\\Projects\\Recent', valid: true }],
        squadHistory: [],
      },
    });
    click('Directories');
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Name for Original"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Renamed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const buttons = [...host.querySelectorAll('button')];
    const saveName = buttons.find((button) => button.textContent === 'Save name')!;
    act(() => saveName.click());
    expect(client.send).toHaveBeenLastCalledWith({
      type: 'updateDirectoryName', id: 'saved-1', name: 'Renamed',
    });
    const changeFolder = buttons.find((button) => button.textContent === 'Change folder')!;
    act(() => changeFolder.click());
    expect(client.send).toHaveBeenLastCalledWith({ type: 'changeDirectoryPath', id: 'saved-1' });
    const remove = buttons.find((button) => button.textContent === 'Remove')!;
    act(() => remove.click());
    expect(client.send).toHaveBeenLastCalledWith({ type: 'removeDirectory', id: 'saved-1' });
    const forget = buttons.find((button) => button.textContent === 'Forget')!;
    act(() => forget.click());
    expect(client.send).toHaveBeenLastCalledWith({ type: 'forgetDirectoryLaunch', id: 'recent-1' });
    click('Add directory');
    expect(client.send).toHaveBeenLastCalledWith({ type: 'addDirectory' });
  });

  it('fills the directory form from a suggestion without sending any save or launch request', () => {
    load();
    const suggestion = {
      id: 'session:fixture', name: 'Suggested Squad',
      path: 'C:\\Synthetic\\Suggested Squad', valid: true,
      lastLaunchedAt: '2026-10-29T18:00:00.000Z',
    };
    send({
      type: 'directoryCatalog',
      catalog: { workspaceDirectories: [], savedDirectories: [], recentLaunches: [], squadHistory: [suggestion] },
    });
    click('Directories');
    const before = vi.mocked(client.send).mock.calls.length;
    const button = [...host.querySelectorAll('button')].find((entry) => entry.textContent === suggestion.name)!;
    expect(button.title).toBe(suggestion.path);
    expect(button.type).toBe('button');
    act(() => button.click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Directory path"]')?.value).toBe(suggestion.path);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Directory name"]')?.value).toBe(suggestion.name);
    expect(client.send).toHaveBeenCalledTimes(before);
    act(() => {
      host.querySelector('form[aria-label="Add directory"]')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    expect(client.send).toHaveBeenLastCalledWith({
      type: 'addDirectory', path: suggestion.path, name: suggestion.name,
    });
    expect(vi.mocked(client.send).mock.calls.slice(before).map(([message]) => message.type)).toEqual(['addDirectory']);
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
    expect(vi.mocked(client.send).mock.calls.filter(([m]) => m.type === 'saveLayout')).toEqual([]);
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
    expect(vi.mocked(client.send).mock.calls.filter(([m]) => m.type === 'saveLayout')).toEqual([]);
    click('● Save Layout');
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'saveLayout', layout: expect.objectContaining({ cols: 7, rows: 6, furniture: [] }),
    }));
    const saved = vi.mocked(client.send).mock.calls.map(([m]) => m).filter((m) => m.type === 'saveLayout').at(-1)!;
    if (saved.type !== 'saveLayout') throw new Error('Expected save');
    send({ type: 'layoutSaved', layout: saved.layout, revision: JSON.stringify(saved.layout) });
    click('Undo');
    click('● Save Layout');
    expect(client.send).toHaveBeenLastCalledWith(expect.objectContaining({
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
    expect(client.send).toHaveBeenCalledWith({ type: 'addAssetDirectory' });
    click('Unload');
    expect(client.send).toHaveBeenCalledWith({ type: 'removeAssetDirectory', directory: 'C:\\fixture-assets' });
    send({ type: 'manifestAssetsLoaded', snapshot: { ...snapshot, directories: [], diagnostics: [] } });
    expect(host.textContent).not.toContain('Bad fixture manifest rejected');
    expect(host.textContent).toContain('Unavailable asset: unknown-old-id');
    expect(vi.mocked(client.send).mock.calls.filter(([m]) => m.type === 'saveLayout')).toEqual([]);
    expect(layout.furniture[0]).toEqual({ uid: 'old', type: 'unknown-old-id', col: 2, row: 2, rotation: 0 });
  });
});
