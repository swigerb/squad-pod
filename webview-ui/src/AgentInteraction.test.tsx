import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import type { HostClient } from './hostClient.js';
import type { OutboundMessage, WebviewMessage } from '../../src/types.js';
import { OfficeState } from './office/engine/officeState.js';
import { placeOverlay } from './components/AgentLabels.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const repo = path.resolve('..');
const require = createRequire(path.join(repo, 'package.json'));
interface Agent { id: string; name: string; role: string; summary: string; activity: string }
interface Fixture {
  workspaceRoot: string;
  sent: WebviewMessage[];
  calls: { documents: string[]; commands: Array<[string, string]>; information: string[]; terminals: unknown[] };
  send(message: WebviewMessage): void;
  subscribe(listener: (message: OutboundMessage) => void): () => void;
  removeAgent(id: string): void;
  noFocus(): void;
  dispose(): void;
}
const { createProviderFixture, agents } = require('./scripts/acceptance-interaction.cjs') as {
  createProviderFixture(options: { artifactRoot: string; extensionCode: string }): Fixture; agents: Agent[];
};
const extensionCode = process.env.SQUAD_POD_EXTENSION_BUNDLE
  ? fs.readFileSync(process.env.SQUAD_POD_EXTENSION_BUNDLE, 'utf8')
  // Compile in Node's realm: jsdom's Uint8Array is incompatible with esbuild.
  : execFileSync(process.execPath, ['-e',
    "process.stdout.write(require('esbuild').buildSync({entryPoints:['src/extension.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false}).outputFiles[0].text)",
  ], { cwd: repo, encoding: 'utf8' });

describe('real App -> compiled provider -> real message handler -> card (mocked VS Code)', () => {
  let fixture: Fixture;
  let host: HTMLDivElement;
  let root: Root;
  let frames: Map<number, FrameRequestCallback>;
  let next: number;
  let office: OfficeState;
  let deliver: (message: OutboundMessage) => void;
  let hold: boolean;
  let held: OutboundMessage[];
  const requests = () => fixture.sent.filter((m) => m.type === 'requestAgentDetail');
  const card = () => host.querySelector<HTMLElement>('[role="dialog"]');
  const frame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => callbacks.forEach((callback) => callback(0)));
  };
  const click = (name: string) => {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name);
    expect(button, name).toBeDefined();
    act(() => button!.click());
  };
  const canvasClick = (x: number, y: number) => act(() => host.querySelector('canvas')!.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y })));

  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map(); next = 0; hold = false; held = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const originalAdd = OfficeState.prototype.addAgent;
    vi.spyOn(OfficeState.prototype, 'addAgent').mockImplementation(function (this: OfficeState, ...args) {
      office = this;
      return originalAdd.apply(this, args);
    });
    fixture = createProviderFixture({ artifactRoot: repo, extensionCode });
    const client: HostClient = {
      send: (message) => fixture.send(message),
      subscribe: (listener) => {
        deliver = listener;
        const unsubscribe = fixture.subscribe((message) => {
          if (hold && message.type === 'agentDetailLoaded') held.push(message);
          else listener(message);
        });
        return unsubscribe;
      },
      getState: () => undefined,
      setState: (state) => state,
    };
    host = document.createElement('div'); document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App client={client} />));
    frame();
    // Canvas has no drawing context in jsdom, so pan stays at its real initial 0,0.
    // Move only characters, leaving occupied desk/chair hit tests independent.
    Object.assign(office.characters.get('ada')!, { x: 80, y: 180 });
    Object.assign(office.characters.get('grace')!, { x: 130, y: 180 });
    frame();
  });
  afterEach(() => {
    try { fixture.noFocus(); } finally {
      act(() => root.unmount()); host.remove(); fixture.dispose();
      vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    }
  });

  function assertCard(agent: Agent, action: () => void) {
    const before = requests().length;
    action();
    expect(requests().slice(before)).toEqual([{ type: 'requestAgentDetail', agentId: agent.id }]);
    for (const text of [agent.name, agent.role, 'idle', agent.summary, agent.activity]) expect(card()?.textContent).toContain(text);
    const other = agents.find((a) => a.id !== agent.id)!;
    expect(card()?.textContent).not.toContain(other.summary);
    expect(card()?.textContent).not.toContain(other.activity);
    const documents = fixture.calls.documents.length;
    click('View Charter');
    expect(fixture.calls.documents.slice(documents)).toEqual([path.join(fixture.workspaceRoot, '.squad', 'agents', agent.id, 'charter.md')]);
    fixture.noFocus();
    click('Close agent details');
  }

  it.each(agents)('opens exactly $name from character, native name, occupied chair and desk', (agent) => {
    const index = agents.indexOf(agent);
    assertCard(agent, () => canvasClick((index ? 130 : 80) * 2, 350));
    assertCard(agent, () => click(`${agent.name}${agent.role}`));
    // Clear selection as an ordinary floor click would; clicking another seat with
    // a selection deliberately remains the existing seat reassignment gesture.
    office.selectedAgentId = null;
    assertCard(agent, () => canvasClick((3 + index * 2) * 32 + 16, 7 * 32 + 28));
    assertCard(agent, () => canvasClick((3 + index * 2) * 32 + 16, 6 * 32 + 4));
  });

  it('keeps repeated character clicks selected and requests detail once per click', () => {
    canvasClick(160, 350);
    expect(office.selectedAgentId).toBe('ada');
    canvasClick(160, 350);
    expect(office.selectedAgentId).toBe('ada');
    expect(requests()).toEqual([
      { type: 'requestAgentDetail', agentId: 'ada' }, { type: 'requestAgentDetail', agentId: 'ada' },
    ]);
  });

  it('clears A while B loads, rejects delayed A after B, and hides a removed card and its stale replies', () => {
    click('AdaDeveloper');
    expect(card()?.textContent).toContain(agents[0].summary);
    hold = true;
    click('GraceReviewer');
    expect(card()).toBeNull();
    expect(held).toHaveLength(1);
    act(() => deliver(held[0]));
    expect(card()?.textContent).toContain(agents[1].summary);
    hold = false;
    act(() => fixture.send({ type: 'requestAgentDetail', agentId: 'ada' }));
    expect(card()?.textContent).toContain(agents[1].summary);
    fixture.removeAgent('grace');
    act(() => vi.advanceTimersByTime(2000));
    expect(card()).toBeNull();
    act(() => deliver(held[0]));
    expect(card()).toBeNull();
    expect(host.textContent).not.toContain(agents[1].summary);
    act(() => deliver({ type: 'agentCreated', agent: {
      id: 'grace', name: 'Grace', role: 'New role', paletteIndex: 1, seatId: null,
    } }));
    expect(card()).toBeNull();
  });

  it('makes View Charter use provider history, reveal and information fallbacks through the real card', () => {
    click('AdaDeveloper');
    const directory = path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada');
    fs.unlinkSync(path.join(directory, 'charter.md'));
    click('View Charter');
    expect(fixture.calls.documents).toEqual([path.join(directory, 'history.md')]);
    fs.unlinkSync(path.join(directory, 'history.md'));
    click('View Charter');
    expect(fixture.calls.commands).toEqual([['revealInExplorer', directory]]);
    fs.rmdirSync(directory);
    click('View Charter');
    expect(fixture.calls.information).toEqual(['Squad Pod: Ada has no charter or history yet.']);
  });

  it('does not display an unknown detail even if a stale host delivers it', () => {
    click('AdaDeveloper');
    act(() => deliver({
      type: 'agentDetailLoaded',
      detail: { id: 'unknown', name: 'Unknown', role: 'Unknown', status: 'idle',
        currentTask: null, charterSummary: 'Must not appear', recentActivity: [], lastActiveAt: 0 },
    }));
    expect(card()?.textContent).toContain(agents[0].summary);
    expect(host.textContent).not.toContain('Must not appear');
  });

  it('clamps the measured border-box card rather than an estimated content size at 360x640', () => {
    vi.stubGlobal('innerWidth', 360);
    vi.stubGlobal('innerHeight', 640);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = this.getAttribute('role') === 'dialog' ? 500 : 0;
      return { x: 0, y: 0, left: 0, top: 0, right: 320, bottom: height,
        width: 320, height, toJSON: () => ({}) };
    });
    canvasClick(160, 350);
    expect(card()?.style.left).toBe('30px');
    expect(card()?.style.top).toBe('130px');
    expect(card()?.style.width).toBe('320px');
    expect(card()?.style.boxSizing).toBe('border-box');
    expect(card()?.style.maxHeight).toBe('calc(100vh - 20px)');
    expect(card()?.style.overflowY).toBe('auto');
  });
});

describe('deterministic measured overlay lanes', () => {
  it('clamps wide text and stacks adjacent labels clear of name and tool boxes at 2x', () => {
    const occupied: Parameters<typeof placeOverlay>[6] = [];
    const a = placeOverlay(132, 314, 105, 26, 360, 640, occupied);
    const b = placeOverlay(196, 314, 105, 26, 360, 640, occupied);
    const toolA = placeOverlay(132, 288, 200, 60, 360, 640, occupied);
    const toolB = placeOverlay(196, 288, 200, 60, 360, 640, occupied);
    expect([a, b, toolA, toolB]).toEqual([
      { left: 79.5, top: 314, width: 105, height: 26 },
      { left: 143.5, top: 284, width: 105, height: 26 },
      { left: 32, top: 220, width: 200, height: 60 },
      { left: 96, top: 156, width: 200, height: 60 },
    ]);
  });
});
