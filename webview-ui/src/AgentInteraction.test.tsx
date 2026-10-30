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
import { setSoundEnabled } from './notificationSound.js';

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
  let received: OutboundMessage[];
  const requests = () => fixture.sent.filter((m) => m.type === 'requestAgentDetail');
  const card = () => host.querySelector<HTMLElement>('[role="dialog"]');
  const memberDetail = () => host.querySelector<HTMLElement>('[id^="agent-detail-"]');
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
    frames = new Map(); next = 0; hold = false; held = []; received = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const originalAdd = OfficeState.prototype.addAgent;
    vi.spyOn(OfficeState.prototype, 'addAgent').mockImplementation(function (this: OfficeState, ...args) {
      office = this;
      return originalAdd.apply(this, args);
    });
    // Lifecycle tests advance 30s of polling; bundled asset bytes have separate acceptance coverage.
    fixture = createProviderFixture({ artifactRoot: path.join(repo, 'src', '__fixtures__'), extensionCode });
    const client: HostClient = {
      send: (message) => fixture.send(message),
      subscribe: (listener) => {
        deliver = listener;
        const unsubscribe = fixture.subscribe((message) => {
          received.push(message);
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
    act(() => deliver({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: false }));
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
    const requested = requests().slice(before);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({ type: 'requestAgentDetail', agentId: agent.id });
    expect(requested[0].requestId).toEqual(expect.any(String));
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
    expect(requests().map(({ type, agentId }) => ({ type, agentId }))).toEqual([
      { type: 'requestAgentDetail', agentId: 'ada' }, { type: 'requestAgentDetail', agentId: 'ada' },
    ]);
    expect(new Set(requests().map((request) => request.requestId)).size).toBe(2);
  });

  it('labels comment-only history as a file hint and expires open current-task text through the real watcher', () => {
    setSoundEnabled(false);
    const historyPath = path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada', 'history.md');
    const history = '# History\n\n## Learnings\n<!-- Append only work actually completed. -->';
    fs.writeFileSync(historyPath, history);
    act(() => vi.advanceTimersByTime(2000));
    frame();
    expect(host.querySelector('[data-agent-tools="ada"]')?.textContent)
      .toContain('File activity hint: File changed: history.md');
    expect(host.textContent).not.toContain('Append only work actually completed');
    click('AdaDeveloper');
    expect(card()?.textContent).toContain('File activity hint');
    expect(card()?.textContent).toContain('File changed: history.md');
    act(() => vi.advanceTimersByTime(31000));
    frame();
    expect(card()?.textContent).not.toContain('File changed: history.md');
    expect(host.querySelector('[data-agent-tools="ada"]')).toBeNull();
    expect(received.filter(message => message.type === 'agentStatus').at(-1)).toMatchObject({
      status: 'idle', currentTask: null, currentTaskSource: null,
    });
    expect(fs.readFileSync(historyPath, 'utf8')).toBe(history);
    fs.appendFileSync(historyPath, '\n- Fixed retry handling\n');
    act(() => vi.advanceTimersByTime(2000));
    frame();
    expect(card()?.textContent).toContain('File activity hint');
    expect(card()?.textContent).toContain('Fixed retry handling');
    expect(host.querySelector('[data-agent-tools="ada"]')?.textContent)
      .toContain('File activity hint: Fixed retry handling');
    click('Close agent details');
    click('Squad Info');
    click('Show details for Ada');
    expect(memberDetail()?.textContent).toContain('File activity hint:');
    expect(memberDetail()?.textContent).toContain('Fixed retry handling');
    act(() => vi.advanceTimersByTime(31000));
    expect(memberDetail()?.textContent).not.toContain('Fixed retry handling');
  });

  it('loads a delayed correlated charter without resurrecting its expired file hint in AgentCard', () => {
    setSoundEnabled(false);
    fs.appendFileSync(path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada', 'history.md'),
      '\n- Synthetic completed work\n');
    act(() => vi.advanceTimersByTime(2000));
    hold = true;
    click('AdaDeveloper');
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      type: 'agentDetailLoaded', detail: { status: 'active', currentTask: 'Synthetic completed work', currentTaskSource: 'file' },
    });
    act(() => vi.advanceTimersByTime(31000));
    act(() => deliver(held[0]));
    expect(card()?.textContent).toContain(agents[0].summary);
    expect(card()?.textContent).toContain('idle');
    expect(card()?.textContent).not.toContain('Synthetic completed work');
    expect(card()?.textContent).not.toContain('File activity hint');
    hold = false;
  });

  it('uses the shared live projection when an older correlated file detail arrives during a live task', () => {
    fs.appendFileSync(path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada', 'history.md'),
      '\n- Old synthetic file hint\n');
    act(() => vi.advanceTimersByTime(2000));
    hold = true;
    click('AdaDeveloper');
    expect(held).toHaveLength(1);
    act(() => deliver({
      type: 'agentStatus', agentId: 'ada', status: 'active',
      currentTask: 'Current synthetic live task', currentTaskSource: 'live',
    }));
    act(() => deliver(held[0]));
    expect(card()?.textContent).toContain(agents[0].summary);
    expect(card()?.textContent).toContain('Live task');
    expect(card()?.textContent).toContain('Current synthetic live task');
    expect(card()?.textContent).not.toContain('Old synthetic file hint');
    expect(card()?.textContent).not.toContain('File activity hint');
    hold = false;
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
        workspaceRoot: fixture.workspaceRoot, currentTask: null, charterSummary: 'Must not appear',
        charterContent: null, charterStatus: 'available', expertise: null, responsibilities: null,
        boundaries: null, recentActivity: [], lastActiveAt: 0 },
    }));
    expect(card()?.textContent).toContain(agents[0].summary);
    expect(host.textContent).not.toContain('Must not appear');
  });

  it('expands each authoritative roster ID independently and opens only that member charter', () => {
    click('Squad Info');
    expect(card()?.textContent).toContain('Ada');
    expect(card()?.textContent).toContain('Grace');

    click('Show details for Ada');
    expect(requests().at(-1)).toMatchObject({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(requests().at(-1)?.requestId).toEqual(expect.any(String));
    expect(memberDetail()?.textContent).toContain('Ada builds precise interaction contracts.');
    expect(memberDetail()?.textContent).toContain('Ada expertise');
    expect(memberDetail()?.textContent).toContain('Ada responsibilities');
    expect(memberDetail()?.textContent).toContain('Ada boundaries');
    expect(memberDetail()?.textContent).not.toContain('Grace builds');
    const before = fixture.calls.documents.length;
    click('Open charter');
    expect(fixture.calls.documents.slice(before)).toEqual([
      path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada', 'charter.md'),
    ]);

    click('Show details for Grace');
    expect(requests().at(-1)).toMatchObject({ type: 'requestAgentDetail', agentId: 'grace' });
    expect(requests().at(-1)?.requestId).toEqual(expect.any(String));
    expect(memberDetail()?.textContent).toContain('Grace reviews the complete user transaction.');
    expect(memberDetail()?.textContent).not.toContain('Ada builds');
    expect(card()?.querySelector('[aria-label="Show details for Scribe"]')).toBeNull();
    fixture.noFocus();
  });

  it('shows missing charter state and rejects a delayed detail from a prior workspace', () => {
    click('Squad Info');
    const adaCharter = path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada', 'charter.md');
    fs.unlinkSync(adaCharter);
    click('Show details for Ada');
    expect(memberDetail()?.textContent).toContain('Charter content is missing.');

    hold = true;
    click('Show details for Grace');
    const stale = held.at(-1);
    expect(stale?.type).toBe('agentDetailLoaded');
    const nextRoot = path.join(fixture.workspaceRoot, 'next-workspace');
    const source = received.find(message => message.type === 'sourceStatus');
    const info = received.filter(message => message.type === 'squadInfoLoaded').at(-1);
    if (source?.type !== 'sourceStatus' || info?.type !== 'squadInfoLoaded') throw new Error('Fixture did not emit workspace context.');
    act(() => deliver({ ...source, status: { ...source.status, workspaceRoot: nextRoot } }));
    const roster = received.find(message => message.type === 'existingAgents');
    if (roster?.type !== 'existingAgents') throw new Error('Fixture did not emit a roster.');
    act(() => deliver(roster));
    act(() => deliver({ ...info, info: { ...info.info, workspaceRoot: nextRoot } }));
    hold = false;
    click('Show details for Ada');
    if (stale?.type === 'agentDetailLoaded') act(() => deliver(stale));
    expect(memberDetail()?.textContent ?? '').not.toContain('Grace reviews');
    expect(memberDetail()?.textContent ?? '').not.toContain('Charter content is missing');
    expect(memberDetail()?.textContent).toContain('Loading observed details');
    hold = false;
  });

  it('clears expanded details when the roster removes that agent', () => {
    click('Squad Info');
    click('Show details for Ada');
    expect(memberDetail()?.textContent).toContain('Ada builds precise interaction contracts.');
    fixture.removeAgent('ada');
    act(() => vi.advanceTimersByTime(2000));
    expect(card()?.textContent).not.toContain('Ada builds precise interaction contracts.');
  });

  it('keeps open Squad Info live through idle-active-task-change-idle without requesting metadata again', () => {
    click('Squad Info');
    click('Show details for Ada');
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Hide details for Ada"]')!;
    button.focus();
    const before = fixture.sent.length;
    expect(memberDetail()?.textContent).toContain('Observed status: idle');
    expect(card()?.textContent).toContain('0 active');
    const transition = (status: 'active' | 'idle', currentTask: string | null) => act(() => deliver({
      type: 'agentStatus', agentId: 'ada', status, currentTask,
    }));
    transition('active', 'Verifying live dialog');
    expect(memberDetail()?.textContent).toContain('Observed status: active');
    expect(memberDetail()?.textContent).toContain('Observed activity: Verifying live dialog');
    expect(card()?.textContent).toContain('1 active');
    transition('active', 'Second observed task');
    expect(memberDetail()?.textContent).toContain('Observed activity: Second observed task');
    expect(memberDetail()?.textContent).not.toContain('Verifying live dialog');
    transition('idle', null);
    expect(memberDetail()?.textContent).toContain('Observed status: idle');
    expect(memberDetail()?.textContent).toContain('No current task observed.');
    expect(card()?.textContent).toContain('0 active');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button);
    expect(fixture.sent.slice(before)).toEqual([]);
    expect(memberDetail()?.textContent).toContain(agents[0].summary);
  });

  it('uses the current snapshot, not delayed detail or roster replies, for live fields and membership', () => {
    click('Squad Info');
    hold = true;
    click('Show details for Ada');
    act(() => deliver({ type: 'agentStatus', agentId: 'ada', status: 'active', currentTask: 'Current observation' }));
    act(() => deliver(held.at(-1)!));
    expect(memberDetail()?.textContent).toContain('Observed status: active');
    expect(memberDetail()?.textContent).toContain('Observed activity: Current observation');
    const staleInfo = received.filter(message => message.type === 'squadInfoLoaded').at(-1)!;
    act(() => deliver({ type: 'agentClosed', agentId: 'ada' }));
    act(() => deliver(staleInfo));
    act(() => deliver(held.at(-1)!));
    expect(host.querySelector('[aria-label="Show details for Ada"]')).toBeNull();
    expect(host.textContent).not.toContain(agents[0].summary);
    expect(card()?.textContent).toContain('1 agent');
    hold = false;
  });

  it('projects reconnect snapshots and unknown observation state without stale detail fallback', () => {
    click('Squad Info');
    click('Show details for Ada');
    const roster = received.find(message => message.type === 'existingAgents');
    if (roster?.type !== 'existingAgents') throw new Error('Fixture did not emit a roster.');
    act(() => deliver({ ...roster, agents: roster.agents.map(agent => ({
      ...agent, status: 'active', currentTask: 'Snapshot task', currentTaskSource: 'live',
    })) }));
    expect(memberDetail()?.textContent).toContain('Live task: Snapshot task');
    expect(card()?.textContent).toContain('2 active');
    act(() => deliver({ type: 'agentStatus', agentId: 'ada', status: 'active' }));
    expect(memberDetail()?.textContent).not.toContain('Snapshot task');
    expect(memberDetail()?.textContent).toContain('No current task observed.');
    act(() => deliver({ type: 'agentStatus', agentId: 'ada', status: 'active',
      currentTask: 'File evidence', currentTaskSource: 'file' }));
    expect(memberDetail()?.textContent).toContain('File activity hint: File evidence');
    act(() => deliver({ type: 'agentClosed', agentId: 'ada' }));
    act(() => deliver({ type: 'agentCreated', agent: {
      id: 'ada', name: 'Ada', role: 'Developer', paletteIndex: 0,
    } }));
    click('Show details for Ada');
    expect(memberDetail()?.textContent).toContain('Observed status: unavailable');
    expect(memberDetail()?.textContent).not.toContain('File evidence');
  });

  it('does not let the mounted canvas consume Space from dialog buttons or text editing', () => {
    click('Squad Info');
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Show details for Ada"]')!;
    button.focus();
    const key = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    act(() => button.dispatchEvent(key));
    expect(key.defaultPrevented).toBe(false);
    // jsdom does not synthesize native keyboard activation; production-browser coverage does.
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button);
    const input = document.createElement('input');
    card()!.appendChild(input);
    input.focus();
    const textKey = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    act(() => input.dispatchEvent(textKey));
    expect(textKey.defaultPrevented).toBe(false);
    input.remove();
    click('Close Squad Info');
    const canvas = host.querySelector('canvas')!;
    canvas.focus();
    const canvasKey = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    act(() => canvas.dispatchEvent(canvasKey));
    expect(canvasKey.defaultPrevented).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })));
  });

  it('refreshes the same agent charter and activity on re-expansion and ignores its older reply', () => {
    hold = true;
    click('Squad Info');
    click('Show details for Ada');
    expect(held).toHaveLength(1);
    click('Hide details for Ada');

    const charter = path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada', 'charter.md');
    const activity = path.join(fixture.workspaceRoot, '.squad', 'log', '2026-10-29-ada.md');
    fs.writeFileSync(charter, '# Ada\n\nAda now verifies refreshed charter details.');
    fs.writeFileSync(activity, '# Activity\nAda confirmed refreshed activity.');

    click('Show details for Ada');
    expect(held).toHaveLength(2);
    expect(held[0].type).toBe('agentDetailLoaded');
    expect(held[1].type).toBe('agentDetailLoaded');
    act(() => deliver(held[0]));
    expect(memberDetail()?.textContent).toContain('Loading observed details');
    act(() => deliver(held[1]));
    expect(memberDetail()?.textContent).toContain('Ada now verifies refreshed charter details.');
    expect(memberDetail()?.textContent).toContain('Ada confirmed refreshed activity.');
    expect(memberDetail()?.textContent).not.toContain('Ada builds precise interaction contracts.');
    expect(memberDetail()?.textContent).not.toContain('Ada verified character navigation.');
    hold = false;
  });

  it('keeps auto, charter and JSON conflicts separate, refreshes on reopen, and withholds stale model replies', () => {
    const squad = path.join(fixture.workspaceRoot, '.squad');
    const charter = path.join(squad, 'agents', 'ada', 'charter.md');
    fs.appendFileSync(charter, '\n## Model\n- **Preferred:** auto\n- **Rationale:** Synthetic policy\n- **Fallback:** synthetic-fallback\n');
    fs.writeFileSync(path.join(squad, 'config.json'), JSON.stringify({
      defaultModel: 'synthetic-default', agentModelOverrides: { Ada: 'synthetic-override', ada: 'not-the-name' },
    }));
    click('Squad Info');
    click('Show details for Ada');
    const text = memberDetail()?.textContent;
    for (const expected of ['Current-session model: unavailable', 'Automatic selection (auto; not a concrete model)',
      'Rationale: Synthetic policy', 'Fallback: synthetic-fallback', 'defaultModel: synthetic-default',
      'agentModelOverrides["Ada"]: synthetic-override', path.join(squad, 'config.json'),
      'not effective runtime selection']) expect(text).toContain(expected);
    expect(text).not.toContain('not-the-name');
    hold = true;
    click('Show details for Grace');
    const stale = held.at(-1)!;
    click('Close Squad Info');
    fs.writeFileSync(path.join(squad, 'config.json'), '{');
    click('Squad Info');
    click('Show details for Ada');
    act(() => deliver(stale));
    expect(memberDetail()?.textContent).toContain('Loading observed details');
    act(() => deliver(held.at(-1)!));
    expect(memberDetail()?.textContent).toContain('malformed');
    expect(memberDetail()?.textContent).not.toContain('synthetic-default');
    expect(memberDetail()?.textContent).not.toContain('synthetic-override');
    expect(memberDetail()?.textContent).toContain('Current-session model: unavailable');
    hold = false;
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
