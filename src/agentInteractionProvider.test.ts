import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage, WebviewMessage } from './types.js';

const require = createRequire(path.resolve('package.json'));
interface Agent { id: string; name: string; role: string; summary: string; activity: string }
interface Fixture {
  workspaceRoot: string;
  messages: OutboundMessage[];
  sent: WebviewMessage[];
  calls: { documents: string[]; commands: Array<[string, string]>; information: string[]; terminals: unknown[] };
  send(message: WebviewMessage): void;
  removeAgent(id: string): void;
  noFocus(): void;
  dispose(): void;
  subscribe(listener: (message: OutboundMessage) => void): () => void;
}
const { createProviderFixture, agents } = require('./scripts/acceptance-interaction.cjs') as {
  createProviderFixture(options: { extensionCode: string }): Fixture; agents: Agent[];
};
const extensionCode = process.env.SQUAD_POD_EXTENSION_BUNDLE
  ? fs.readFileSync(process.env.SQUAD_POD_EXTENSION_BUNDLE, 'utf8')
  : buildSync({
    entryPoints: [path.resolve('src', 'extension.ts')], bundle: true, platform: 'node',
    format: 'cjs', external: ['vscode'], write: false,
  }).outputFiles[0].text;

describe('agent interaction through compiled extension/provider (mocked VS Code boundary)', () => {
  let fixture: Fixture;
  const details = () => fixture.messages.filter((m) => m.type === 'agentDetailLoaded');
  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createProviderFixture({ extensionCode });
    fixture.send({ type: 'webviewReady' });
  });
  afterEach(() => {
    try { fixture.noFocus(); } finally {
      fixture.dispose();
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it.each(['initial', 'replayed'])('sends workspace identity before the %s layout and roster', (phase) => {
    if (phase === 'replayed') {
      fixture.messages.length = 0;
      fixture.send({ type: 'webviewReady' });
    }
    const sourceIndex = fixture.messages.findIndex(message =>
      message.type === 'sourceStatus' && message.status.workspaceRoot === fixture.workspaceRoot);
    const layoutIndex = fixture.messages.findIndex(message => message.type === 'layoutLoaded');
    const rosterIndex = fixture.messages.findIndex(message => message.type === 'existingAgents');
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(layoutIndex).toBeGreaterThan(sourceIndex);
    expect(rosterIndex).toBeGreaterThan(layoutIndex);
    expect(fixture.messages.filter(message => message.type === 'existingAgents')).toHaveLength(1);
    expect(fixture.messages.filter(message => message.type === 'agentCreated')).toEqual([]);
  });

  it.each(agents)('returns exactly $name detail and opens that charter, never a terminal/session', (agent) => {
    const before = details().length;
    const requestId = `${agent.id}-detail-1`;
    fixture.send({ type: 'requestAgentDetail', agentId: agent.id, requestId });
    expect(details().slice(before)).toEqual([{
      type: 'agentDetailLoaded', requestId, detail: {
        id: agent.id, name: agent.name, role: agent.role, workspaceRoot: fixture.workspaceRoot, status: 'idle',
        charterSummary: agent.summary, charterContent: expect.stringContaining(agent.summary),
        charterStatus: 'available', expertise: `${agent.name} expertise`, responsibilities: `- ${agent.name} responsibilities`,
        modelSources: expect.arrayContaining([
          expect.objectContaining({ sourcePath: path.join(fixture.workspaceRoot, '.squad', 'agents', agent.id, 'charter.md'), state: 'missing', values: [] }),
          expect.objectContaining({ sourcePath: path.join(fixture.workspaceRoot, '.squad', 'config.json'), state: 'missing', values: [] }),
        ]),
        boundaries: expect.stringContaining(`${agent.name} boundaries`), recentActivity: [agent.activity],
        currentTask: null, currentTaskSource: null, lastActiveAt: null, lastActiveAtStatus: 'unobserved',
      },
    }]);
    fixture.send({ type: 'openSquadAgent', agentId: agent.id });
    expect(fixture.calls.documents).toEqual([path.join(fixture.workspaceRoot, '.squad', 'agents', agent.id, 'charter.md')]);
    expect(fixture.calls.commands).toEqual([]);
    expect(fixture.calls.information).toEqual([]);
  });

  it('marks missing and unreadable charters explicitly without inventing fields', () => {
    const directory = path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada');
    const charter = path.join(directory, 'charter.md');
    fs.unlinkSync(charter);
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    const missing = details().at(-1);
    expect(missing).toMatchObject({ type: 'agentDetailLoaded', detail: {
      id: 'ada', charterStatus: 'missing', charterContent: null, charterSummary: null,
      expertise: null, responsibilities: null, boundaries: null,
    } });

    fs.writeFileSync(charter, `# Oversized\n\n${'x'.repeat(65537)}`);
    const read = vi.spyOn(require('node:fs'), 'readSync');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)).toMatchObject({ type: 'agentDetailLoaded', detail: {
      id: 'ada', charterStatus: 'unreadable', charterContent: null, charterSummary: null,
    } });
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });

  it.each(agents)('uses history, folder reveal, then information only for $name', (agent) => {
    const directory = path.join(fixture.workspaceRoot, '.squad', 'agents', agent.id);
    fs.unlinkSync(path.join(directory, 'charter.md'));
    fixture.send({ type: 'openSquadAgent', agentId: agent.id });
    expect(fixture.calls.documents).toEqual([path.join(directory, 'history.md')]);
    fs.unlinkSync(path.join(directory, 'history.md'));
    fixture.send({ type: 'openSquadAgent', agentId: agent.id });
    expect(fixture.calls.commands).toEqual([['revealInExplorer', directory]]);
    fs.rmdirSync(directory);
    fixture.send({ type: 'openSquadAgent', agentId: agent.id });
    expect(fixture.calls.information).toEqual([`Squad Pod: ${agent.name} has no charter or history yet.`]);
    expect(fixture.calls.documents).toHaveLength(1);
    expect(fixture.calls.commands).toHaveLength(1);
  });

  it('keeps rich legacy charters while preferring .squad when both directories exist', () => {
    const squad = path.join(fixture.workspaceRoot, '.squad');
    const legacy = path.join(fixture.workspaceRoot, '.ai-team');
    fs.renameSync(squad, legacy);
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)?.detail).toMatchObject({
      charterStatus: 'available', charterSummary: agents[0].summary,
      expertise: 'Ada expertise', responsibilities: '- Ada responsibilities',
      boundaries: expect.stringContaining('Ada boundaries'),
    });
    fs.mkdirSync(squad);
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)?.detail).toMatchObject({ charterStatus: 'missing', charterContent: null });
  });

  it('withholds malformed UTF-8 rather than displaying replacement characters', () => {
    fs.writeFileSync(path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada', 'charter.md'), Buffer.from([0xff]));
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)?.detail).toMatchObject({
      charterStatus: 'unreadable', charterContent: null, charterSummary: null, expertise: null,
    });
  });

  it('does not disclose or open files for unknown or removed agents', () => {
    fixture.removeAgent('ada');
    vi.advanceTimersByTime(2000);
    expect(fixture.messages.filter((m) => m.type === 'existingAgents').at(-1))
      .toMatchObject({ agents: [expect.objectContaining({ id: 'grace' })] });
    const before = details().length;
    const read = vi.spyOn(require('node:fs'), 'readSync');
    for (const agentId of ['unknown', 'ada', 'Ada', 'grace-task', '../grace']) {
      fixture.send({ type: 'requestAgentDetail', agentId });
      fixture.send({ type: 'openSquadAgent', agentId });
    }
    expect(details()).toHaveLength(before);
    expect(fixture.calls.documents).toEqual([]);
    expect(fixture.calls.commands).toEqual([]);
    expect(fixture.calls.information).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });

  it('uses the exact parsed mixed-case/underscore ID without aliasing it', () => {
    const squad = path.join(fixture.workspaceRoot, '.squad');
    const team = path.join(squad, 'team.md');
    const id = '_Ada_2';
    fs.writeFileSync(team, fs.readFileSync(team, 'utf8').replace('/agents/ada/', `/agents/${id}/`));
    fs.renameSync(path.join(squad, 'agents', 'ada'), path.join(squad, 'agents', id));
    vi.advanceTimersByTime(2000);
    const before = details().length;
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    fixture.send({ type: 'requestAgentDetail', agentId: '_ada_2' });
    expect(details()).toHaveLength(before);
    const content = fs.readFileSync(path.join(squad, 'agents', id, 'charter.md'), 'utf8');
    fixture.send({ type: 'requestAgentDetail', agentId: id });
    expect(details().at(-1)?.detail).toMatchObject({
      id, charterStatus: 'available', charterContent: content,
      expertise: 'Ada expertise', responsibilities: '- Ada responsibilities',
      boundaries: expect.stringContaining('Ada boundaries'),
    });
  });

  it('keeps unstructured readable charter content without inventing rich fields', () => {
    fs.writeFileSync(path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada', 'charter.md'), 'unstructured');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)?.detail).toMatchObject({
      charterStatus: 'available', charterContent: 'unstructured', charterSummary: null,
      expertise: null, responsibilities: null, boundaries: null,
    });
  });

  it('sends visible Squad Info roster entries keyed by parsed charter IDs', () => {
    fixture.send({ type: 'openSquadInfo' });
    const info = fixture.messages.filter(message => message.type === 'squadInfoLoaded').at(-1);
    expect(info).toMatchObject({
      type: 'squadInfoLoaded',
      info: {
        workspaceRoot: fixture.workspaceRoot,
        members: [
          { id: 'ada', name: 'Ada' },
          { id: 'grace', name: 'Grace' },
        ],
        hiddenMembers: [{ name: 'Scribe', role: 'Scribe' }],
      },
    });
  });

  it('withholds rejected team sources through watcher refresh and Squad Info, then recovers', () => {
    const team = path.join(fixture.workspaceRoot, '.squad', 'team.md');
    const original = fs.readFileSync(team, 'utf8');
    for (const content of [original.padEnd(256 * 1024 + 1, ' '), Buffer.from([0xff])]) {
      fs.writeFileSync(team, content);
      vi.advanceTimersByTime(2000);
      expect(fixture.messages.filter(m => m.type === 'existingAgents').at(-1)).toMatchObject({ agents: [] });
      fixture.send({ type: 'openSquadInfo' });
      expect(fixture.messages.filter(m => m.type === 'squadInfoLoaded').at(-1)).toMatchObject({
        info: { teamName: null, projectContext: null, members: [], hiddenMembers: [] },
      });
    }
    const squad = path.dirname(team);
    const legacy = path.join(fixture.workspaceRoot, '.ai-team');
    fs.renameSync(squad, legacy);
    fs.writeFileSync(path.join(legacy, 'team.md'), original);
    fs.symlinkSync(legacy, squad, 'junction');
    vi.advanceTimersByTime(2000);
    expect(fixture.messages.filter(m => m.type === 'existingAgents').at(-1)).toMatchObject({ agents: [] });
    fixture.send({ type: 'openSquadInfo' });
    expect(fixture.messages.filter(m => m.type === 'squadInfoLoaded').at(-1)).toMatchObject({
      info: { members: [], hiddenMembers: [] },
    });
    fs.unlinkSync(squad);
    fs.mkdirSync(squad);
    fs.writeFileSync(team, '# Synthetic team\n\n## Project Context\nSynthetic context.\n\n' + original);
    vi.advanceTimersByTime(2000);
    expect(fixture.messages.filter(m => m.type === 'existingAgents').at(-1)).toMatchObject({
      agents: [{ id: 'ada' }, { id: 'grace' }],
    });
    fixture.send({ type: 'openSquadInfo' });
    expect(fixture.messages.filter(m => m.type === 'squadInfoLoaded').at(-1)).toMatchObject({
      info: { teamName: 'Synthetic team', projectContext: 'Synthetic context.',
        members: [{ id: 'ada', name: 'Ada' }, { id: 'grace', name: 'Grace' }],
        hiddenMembers: [{ name: 'Scribe', role: 'Scribe' }] },
    });
  });

  it.each(['oversize', 'invalid UTF-8'])('withholds startup agents when %s refusal occurs before watcher baseline', refusal => {
    fixture.dispose();
    fixture = createProviderFixture({ extensionCode });
    const team = path.join(fixture.workspaceRoot, '.squad', 'team.md');
    const original = fs.readFileSync(team, 'utf8');
    const nativeFs = require('node:fs') as typeof fs;
    let replaced = false;
    const bytes = vi.spyOn(nativeFs, 'readSync');
    const schedule = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((callback, delay, ...args) => {
      // Mutate only this synthetic roster immediately before the real baseline.
      if (delay === 2000 && !replaced) {
        replaced = true;
        fs.writeFileSync(team, refusal === 'oversize' ? original.padEnd(256 * 1024 + 1, ' ') : Buffer.from([0xff]));
      }
      return schedule(callback, delay, ...args);
    });
    fixture.send({ type: 'webviewReady' });
    expect(replaced).toBe(true);
    const refusalIndex = fixture.messages.findIndex(m =>
      m.type === 'sourceStatus' && !m.status.teamFound && m.status.error !== null);
    expect(refusalIndex).toBeGreaterThanOrEqual(0);
    expect(fixture.messages.filter(m => ['agentCreated', 'agentClosed', 'agentStatus'].includes(m.type))).toEqual([]);
    expect(fixture.messages.filter(m => m.type === 'existingAgents')).toMatchObject([{ agents: [] }]);
    const source = fixture.messages.filter(m => m.type === 'sourceStatus').at(-1);
    expect(source).toMatchObject({ status: {
      teamFound: false, error: expect.stringContaining('selected-project roster source unavailable'),
    } });
    const rosterReads = () => bytes.mock.calls.filter(call => call[3] === 256 * 1024 + 1).length;
    const readsAtBaseline = rosterReads();
    expect(readsAtBaseline).toBe(refusal === 'oversize' ? 0 : 1);
    fixture.messages.length = 0;
    vi.advanceTimersByTime(2000);
    expect(rosterReads()).toBe(readsAtBaseline);
    expect(fixture.messages.filter(m => m.type === 'sourceStatus')).toEqual([]);
    expect(fixture.messages.filter(m => ['existingAgents', 'agentCreated', 'agentClosed'].includes(m.type))).toEqual([]);
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details()).toEqual([]);
    fs.writeFileSync(team, original);
    vi.advanceTimersByTime(2000);
    const recoveryIndex = fixture.messages.findIndex(m => m.type === 'sourceStatus' && m.status.teamFound);
    expect(recoveryIndex).toBeGreaterThanOrEqual(0);
    expect(fixture.messages.findIndex(m => m.type === 'existingAgents')).toBeGreaterThan(recoveryIndex);
    expect(fixture.messages.filter(m => m.type === 'existingAgents').at(-1)).toMatchObject({
      agents: [{ id: 'ada' }, { id: 'grace' }],
    });
    expect(rosterReads()).toBe(readsAtBaseline + 1);
  });

  it.each(['missing', 'refused', 'membership', 'unchanged'])(
    'publishes only the current startup snapshot across a %s baseline transition', transition => {
      fixture.dispose();
      fixture = createProviderFixture({ extensionCode });
      const team = path.join(fixture.workspaceRoot, '.squad', 'team.md');
      const original = fs.readFileSync(team, 'utf8');
      const current = original.replaceAll('/agents/ada/', '/agents/current/');
      if (transition === 'missing') { fs.unlinkSync(team); }
      if (transition === 'refused') { fs.writeFileSync(team, Buffer.from([0xff])); }
      const schedule = globalThis.setInterval;
      let transitioned = false;
      const nativeFs = require('node:fs') as typeof fs;
      const bytes = vi.spyOn(nativeFs, 'readSync');
      vi.spyOn(globalThis, 'setInterval').mockImplementation((callback, delay, ...args) => {
        if (delay === 2000 && !transitioned) {
          transitioned = true;
          fs.writeFileSync(team, transition === 'unchanged' ? original : current);
        }
        return schedule(callback, delay, ...args);
      });
      fixture.send({ type: 'webviewReady' });
      expect(transitioned).toBe(true);
      const layoutIndex = fixture.messages.findIndex(m => m.type === 'layoutLoaded');
      const rosterIndex = fixture.messages.findIndex(m => m.type === 'existingAgents');
      expect(layoutIndex).toBeGreaterThanOrEqual(0);
      expect(rosterIndex).toBeGreaterThan(layoutIndex);
      const snapshots = fixture.messages.filter(m => m.type === 'existingAgents');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].agents.map(a => a.id).sort()).toEqual(
        [transition === 'unchanged' ? 'ada' : 'current', 'grace'].sort(),
      );
      expect(fixture.messages.slice(0, rosterIndex).filter(m =>
        ['agentCreated', 'agentClosed', 'agentStatus', 'agentToolStart', 'agentToolDone', 'agentToolsClear'].includes(m.type),
      )).toEqual([]);
      expect(fixture.messages.filter(m => m.type === 'sourceStatus').at(-1)).toMatchObject({
        status: { teamFound: true, error: null },
      });
      const reads = () => bytes.mock.calls.filter(call => call[3] === 256 * 1024 + 1).length;
      expect(reads()).toBe(1);
      fixture.messages.length = 0;
      vi.advanceTimersByTime(1100);
      expect(reads()).toBe(1);
      expect(fixture.messages.filter(m => ['sourceStatus', 'existingAgents', 'agentCreated', 'agentClosed'].includes(m.type))).toEqual([]);
      fixture.send({ type: 'webviewReady' });
      expect(reads()).toBe(1);
    },
  );

  it('clears status and roster on actual cached-source read denial, then restores the same source', () => {
    const nativeFs = require('node:fs') as typeof fs;
    const team = path.join(fixture.workspaceRoot, '.squad', 'team.md');
    const identity = nativeFs.statSync(team).ino;
    const read = nativeFs.readSync;
    const denied = vi.spyOn(nativeFs, 'readSync').mockImplementation((fd, buffer, offset, length, position) => {
      if (nativeFs.fstatSync(fd).ino === identity) {
        throw Object.assign(new Error('private synthetic details'), { code: 'EACCES' });
      }
      return read(fd, buffer, offset, length, position);
    });
    fixture.messages.length = 0;
    vi.advanceTimersByTime(2000);
    const statusIndex = fixture.messages.findIndex(m => m.type === 'sourceStatus' && !m.status.teamFound);
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(fixture.messages.findIndex(m => m.type === 'existingAgents')).toBeGreaterThan(statusIndex);
    expect(fixture.messages.filter(m => m.type === 'existingAgents').at(-1)).toMatchObject({ agents: [] });
    expect(fixture.messages[statusIndex]).toMatchObject({ status: { error: expect.stringContaining('(EACCES)') } });
    fixture.messages.length = 0;
    vi.advanceTimersByTime(2000);
    expect(fixture.messages.filter(m => ['sourceStatus', 'existingAgents'].includes(m.type))).toEqual([]);
    denied.mockRestore();
    vi.advanceTimersByTime(2000);
    const recoveryIndex = fixture.messages.findIndex(m => m.type === 'sourceStatus' && m.status.teamFound);
    expect(recoveryIndex).toBeGreaterThanOrEqual(0);
    expect(fixture.messages.findIndex(m => m.type === 'existingAgents')).toBeGreaterThan(recoveryIndex);
    expect(fixture.messages.filter(m => m.type === 'existingAgents').at(-1)).toMatchObject({
      agents: [{ id: 'ada' }, { id: 'grace' }],
    });
  });

  it('delivers activity observed during asset preparation only after layout and the startup roster', () => {
    fixture.dispose();
    fixture = createProviderFixture({ extensionCode });
    const log = path.join(fixture.workspaceRoot, '.squad', 'log', '2026-10-29-ada.md');
    let changed = false;
    const unsubscribe = fixture.subscribe(message => {
      if (changed || message.type !== 'characterAssetsLoaded'
        || !fixture.messages.some(m => m.type === 'sourceStatus' && m.status.observer === 'watching')) { return; }
      changed = true;
      fs.appendFileSync(log, '\n**Agent:** Ada\nSynthetic startup activity.\n');
      vi.advanceTimersByTime(1100);
    });
    fixture.send({ type: 'webviewReady' });
    unsubscribe();
    expect(changed).toBe(true);
    const layoutIndex = fixture.messages.findIndex(m => m.type === 'layoutLoaded');
    const rosterIndex = fixture.messages.findIndex(m => m.type === 'existingAgents');
    const statusIndex = fixture.messages.findIndex(m => m.type === 'agentStatus');
    expect(rosterIndex).toBeGreaterThan(layoutIndex);
    expect(statusIndex).toBeGreaterThan(rosterIndex);
    expect(fixture.messages[statusIndex]).toMatchObject({
      type: 'agentStatus', agentId: 'ada', status: 'active', currentTaskSource: 'file',
    });
    expect(fixture.messages.filter(m => m.type === 'existingAgents')).toHaveLength(1);
    fixture.messages.length = 0;
    fixture.send({ type: 'webviewReady' });
    expect(fixture.messages.filter(m => m.type === 'existingAgents')).toMatchObject([{
      agents: [{ id: 'ada', status: 'active' }, { id: 'grace', status: 'idle' }],
    }]);
  });

  it('stops roster and activity publication after disposal, including queued native notifications', () => {
    fixture.dispose();
    const watch = vi.spyOn(require('node:fs') as typeof fs, 'watch');
    fixture = createProviderFixture({ extensionCode });
    fixture.send({ type: 'webviewReady' });
    const team = path.join(fixture.workspaceRoot, '.squad', 'team.md');
    const registration = watch.mock.calls.find(([file]) => file === path.dirname(team));
    expect(registration).toBeDefined();
    const notify = registration?.[2];
    expect(notify).toBeTypeOf('function');
    fs.writeFileSync(team, Buffer.from([0xff]));
    notify!('change', 'team.md');
    const messages = fixture.messages;
    fixture.dispose();
    expect(messages.filter(m => m.type === 'sourceStatus').at(-1)).toMatchObject({
      status: { observer: 'stopped' },
    });
    const count = messages.length;
    notify!('change', 'team.md');
    vi.advanceTimersByTime(31_000);
    expect(messages).toHaveLength(count);
    fixture = createProviderFixture({ extensionCode });
  });

  it.each(['refusal', 'recovery', 'membership'])(
    'retains a %s observed while preparing assets until the startup handoff', transition => {
      fixture.dispose();
      fixture = createProviderFixture({ extensionCode });
      const team = path.join(fixture.workspaceRoot, '.squad', 'team.md');
      const original = fs.readFileSync(team, 'utf8');
      if (transition === 'recovery') { fs.writeFileSync(team, Buffer.from([0xff])); }
      let transitioned = false;
      const unsubscribe = fixture.subscribe(message => {
        if (transitioned || message.type !== 'characterAssetsLoaded'
          || !fixture.messages.some(m => m.type === 'sourceStatus' && m.status.observer === 'watching')) { return; }
        transitioned = true;
        fs.writeFileSync(team, transition === 'refusal' ? Buffer.from([0xff])
          : transition === 'membership' ? original.replaceAll('/agents/ada/', '/agents/current/') : original);
        vi.advanceTimersByTime(1100);
      });
      fixture.send({ type: 'webviewReady' });
      unsubscribe();
      expect(transitioned).toBe(true);
      const layoutIndex = fixture.messages.findIndex(m => m.type === 'layoutLoaded');
      const rosterIndex = fixture.messages.findIndex(m => m.type === 'existingAgents');
      expect(rosterIndex).toBeGreaterThan(layoutIndex);
      const snapshots = fixture.messages.filter(m => m.type === 'existingAgents');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].agents.map(a => a.id).sort()).toEqual(transition === 'refusal' ? []
        : [transition === 'membership' ? 'current' : 'ada', 'grace'].sort());
      expect(fixture.messages.slice(0, rosterIndex).filter(m =>
        ['agentCreated', 'agentClosed', 'agentStatus', 'agentToolStart', 'agentToolDone', 'agentToolsClear'].includes(m.type),
      )).toEqual([]);
      expect(fixture.messages.filter(m => m.type === 'sourceStatus').at(-1)).toMatchObject({
        status: { teamFound: transition !== 'refusal', error: transition === 'refusal' ? expect.stringContaining('UTF-8') : null },
      });
      fixture.messages.length = 0;
      vi.advanceTimersByTime(1100);
      expect(fixture.messages.filter(m => ['sourceStatus', 'existingAgents', 'agentCreated', 'agentClosed'].includes(m.type))).toEqual([]);
    },
  );

  it.each([true, false])('refreshes the office when the preferred blocker starts present=%s without legacy edits', blocked => {
    fixture.dispose();
    fixture = createProviderFixture({ extensionCode });
    const preferred = path.join(fixture.workspaceRoot, '.squad');
    const legacy = path.join(fixture.workspaceRoot, '.ai-team');
    fs.renameSync(preferred, legacy);
    const legacyTeam = path.join(legacy, 'team.md');
    const content = fs.readFileSync(legacyTeam, 'utf8');
    const stamp = fs.statSync(legacyTeam);
    if (blocked) { fs.writeFileSync(preferred, 'not a directory'); }
    fixture.send({ type: 'webviewReady' });
    const roster = () => fixture.messages.filter(m => m.type === 'existingAgents').at(-1);
    const assertAvailability = (refused: boolean) => {
      const sourceIndex = fixture.messages.findIndex(m => m.type === 'sourceStatus' && m.status.teamFound === !refused);
      const rosterIndex = fixture.messages.findLastIndex(m => m.type === 'existingAgents');
      expect(sourceIndex).toBeGreaterThanOrEqual(0);
      expect(rosterIndex).toBeGreaterThan(sourceIndex);
      expect(fixture.messages.filter(m => m.type === 'sourceStatus').at(-1)).toMatchObject({
        status: {
          teamFound: !refused,
          error: refused ? expect.stringContaining('selected-project roster source unavailable') : null,
        },
      });
    };
    expect(roster()).toMatchObject({ agents: blocked ? [] : [{ id: 'ada' }, { id: 'grace' }] });
    assertAvailability(blocked);
    fixture.messages.length = 0;

    if (blocked) { fs.unlinkSync(preferred); }
    else { fs.writeFileSync(preferred, 'not a directory'); }
    vi.advanceTimersByTime(2000);
    expect(roster()).toMatchObject({ agents: blocked ? [{ id: 'ada' }, { id: 'grace' }] : [] });
    assertAvailability(!blocked);
    fixture.send({ type: 'openSquadInfo' });
    expect(fixture.messages.filter(m => m.type === 'squadInfoLoaded').at(-1)).toMatchObject({
      info: {
        workspaceRoot: fixture.workspaceRoot,
        members: blocked ? [{ id: 'ada', name: 'Ada' }, { id: 'grace', name: 'Grace' }] : [],
        hiddenMembers: blocked ? [{ name: 'Scribe', role: 'Scribe' }] : [],
      },
    });
    fixture.messages.length = 0;
    if (blocked) { fs.writeFileSync(preferred, 'not a directory'); }
    else { fs.unlinkSync(preferred); }
    vi.advanceTimersByTime(2000);
    expect(roster()).toMatchObject({ agents: blocked ? [] : [{ id: 'ada' }, { id: 'grace' }] });
    assertAvailability(blocked);
    expect(fs.readFileSync(legacyTeam, 'utf8')).toBe(content);
    expect(fs.statSync(legacyTeam)).toMatchObject({ mtimeMs: stamp.mtimeMs, size: stamp.size });
  });

  it.each([false, true])('aligns source status and office membership across a legacy junction, initially refused=%s', refused => {
    fixture.dispose();
    fixture = createProviderFixture({ extensionCode });
    const preferred = path.join(fixture.workspaceRoot, '.squad');
    const legacy = path.join(fixture.workspaceRoot, '.ai-team');
    const target = path.join(fixture.workspaceRoot, 'legacy-target');
    fs.renameSync(preferred, legacy);
    const file = path.join(legacy, 'team.md');
    const stamp = fs.statSync(file);
    const original = fs.readFileSync(file, 'utf8');
    const link = () => {
      fs.renameSync(legacy, target);
      fs.symlinkSync(target, legacy, 'junction');
    };
    const restore = () => {
      fs.unlinkSync(legacy);
      fs.renameSync(target, legacy);
    };
    const assertSnapshot = (blocked: boolean) => {
      const sourceIndex = fixture.messages.findIndex(m => m.type === 'sourceStatus'
        && m.status.teamFound === !blocked && (blocked ? Boolean(m.status.error) : m.status.error === null));
      const rosterIndex = fixture.messages.findLastIndex(m => m.type === 'existingAgents');
      expect(sourceIndex).toBeGreaterThanOrEqual(0);
      expect(rosterIndex).toBeGreaterThan(sourceIndex);
      expect(fixture.messages[sourceIndex]).toMatchObject({
        status: { teamFound: !blocked, error: blocked ? expect.stringContaining('symlinks/junctions') : null },
      });
      expect(fixture.messages[rosterIndex]).toMatchObject({ agents: blocked ? [] : [{ id: 'ada' }, { id: 'grace' }] });
    };
    if (refused) { link(); }
    try {
      fixture.send({ type: 'webviewReady' });
      assertSnapshot(refused);
      fixture.messages.length = 0;
      if (refused) { restore(); } else { link(); }
      vi.advanceTimersByTime(1100);
      assertSnapshot(!refused);
      fixture.messages.length = 0;
      vi.advanceTimersByTime(1100);
      expect(fixture.messages.filter(m => m.type === 'existingAgents' || m.type === 'sourceStatus')).toEqual([]);
      if (refused) { link(); } else { restore(); }
      vi.advanceTimersByTime(1100);
      assertSnapshot(refused);
      expect(fs.statSync(file)).toMatchObject({ mtimeMs: stamp.mtimeMs, size: stamp.size });
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
    } finally {
      if (fs.lstatSync(legacy).isSymbolicLink()) { restore(); }
    }
  });

  it.each(['oversize', 'invalid UTF-8'])('publishes %s refusal before removing characters, then restores rich membership', refused => {
    const file = path.join(fixture.workspaceRoot, '.squad', 'team.md');
    const original = fs.readFileSync(file, 'utf8');
    fixture.messages.length = 0;
    fs.writeFileSync(file, refused === 'oversize' ? original.padEnd(256 * 1024 + 1, ' ') : Buffer.from([0xff]));
    vi.advanceTimersByTime(1100);
    const sourceIndex = fixture.messages.findIndex(m => m.type === 'sourceStatus');
    const rosterIndex = fixture.messages.findIndex(m => m.type === 'existingAgents');
    expect(sourceIndex).toBeGreaterThanOrEqual(0);
    expect(rosterIndex).toBeGreaterThan(sourceIndex);
    expect(fixture.messages[sourceIndex]).toMatchObject({
      status: { teamFound: false, error: expect.stringContaining(refused === 'oversize' ? '262144 bytes' : 'UTF-8') },
    });
    expect(fixture.messages[rosterIndex]).toMatchObject({ agents: [] });
    fixture.messages.length = 0;
    fs.writeFileSync(file, original);
    vi.advanceTimersByTime(1100);
    expect(fixture.messages.filter(m => m.type === 'sourceStatus').at(-1)).toMatchObject({
      status: { teamFound: true, error: null },
    });
    expect(fixture.messages.filter(m => m.type === 'existingAgents').at(-1)).toMatchObject({
      agents: [{ id: 'ada', name: 'Ada', role: 'Developer' }, { id: 'grace', name: 'Grace', role: 'Reviewer' }],
    });
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)?.detail).toMatchObject({ expertise: 'Ada expertise', responsibilities: '- Ada responsibilities' });
  });

  it('uses the watcher refusal rather than adopting a new roster from a replaced project root', () => {
    fixture.dispose();
    // Native directory handles prohibit root renames on Windows; exercise polling.
    const watch = vi.spyOn(require('node:fs'), 'watch').mockImplementation(() => {
      throw Object.assign(new Error('Synthetic native watch unavailable'), { code: 'ENOSYS' });
    });
    fixture = createProviderFixture({ extensionCode });
    fixture.send({ type: 'webviewReady' });
    const root = fixture.workspaceRoot;
    const original = `${root}-original`;
    fs.renameSync(root, original);
    try {
      fs.cpSync(original, root, { recursive: true });
      fixture.messages.length = 0;
      vi.advanceTimersByTime(1100);
      const sourceIndex = fixture.messages.findIndex(m => m.type === 'sourceStatus');
      const rosterIndex = fixture.messages.findIndex(m => m.type === 'existingAgents');
      expect(sourceIndex).toBeGreaterThanOrEqual(0);
      expect(rosterIndex).toBeGreaterThan(sourceIndex);
      expect(fixture.messages[sourceIndex]).toMatchObject({
        status: { teamFound: false, error: expect.stringContaining('Selected project root changed') },
      });
      expect(fixture.messages[rosterIndex]).toMatchObject({ agents: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.renameSync(original, root);
      watch.mockRestore();
    }
  });

  it('returns conflicting declarations separately with exact-name keys and refreshes without runtime inference', () => {
    const squad = path.join(fixture.workspaceRoot, '.squad');
    const charter = path.join(squad, 'agents', 'ada', 'charter.md');
    fs.appendFileSync(charter, '\n## Model\n- **Preferred:** auto\n- **Rationale:** Synthetic task policy\n- **Fallback:** synthetic-fallback\n');
    fs.writeFileSync(path.join(squad, 'config.json'), JSON.stringify({
      defaultModel: 'synthetic-default', agentModelOverrides: { Ada: 'synthetic-override', ada: 'not-the-name' },
    }));
    fs.writeFileSync(path.join(fixture.workspaceRoot, 'squad.config.ts'), 'throw new Error("never execute")');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada', requestId: 'models-1' });
    expect(details().at(-1)).toMatchObject({ requestId: 'models-1', detail: { modelSources: [
      { sourcePath: charter, state: 'ready', values: [
        { key: 'Preferred', value: 'auto' }, { key: 'Rationale', value: 'Synthetic task policy' }, { key: 'Fallback', value: 'synthetic-fallback' },
      ] },
      { sourcePath: path.join(squad, 'config.json'), state: 'ready', values: [
        { key: 'defaultModel', value: 'synthetic-default' }, { key: 'agentModelOverrides["Ada"]', value: 'synthetic-override' },
      ] },
      { state: 'unsupported', values: [] }, { state: 'missing', values: [] },
    ] } });
    fs.writeFileSync(path.join(squad, 'config.json'), '{');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada', requestId: 'models-2' });
    expect(details().at(-1)).toMatchObject({ requestId: 'models-2', detail: {
      modelSources: expect.arrayContaining([expect.objectContaining({ state: 'malformed', values: [] })]),
    } });
    fs.writeFileSync(charter, '## Model\n**Preferred:** first\n**Preferred:** second');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)?.detail.modelSources?.[0]).toMatchObject({ state: 'ambiguous', values: [] });
  });

  it('withholds charter declarations from an escaping agent-directory junction', () => {
    const squad = path.join(fixture.workspaceRoot, '.squad');
    const directory = path.join(squad, 'agents', 'ada');
    fs.renameSync(directory, path.join(fixture.workspaceRoot, 'original-agent'));
    fs.symlinkSync(path.join(fixture.workspaceRoot, 'original-agent'), directory, 'junction');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)?.detail).toMatchObject({
      charterStatus: 'unreadable', charterContent: null,
      modelSources: expect.arrayContaining([expect.objectContaining({ state: 'unreadable', values: [] })]),
    });
  });

  it('withholds legacy model declarations when the preferred directory becomes invalid', () => {
    const root = fixture.workspaceRoot;
    fs.renameSync(path.join(root, '.squad'), path.join(root, '.ai-team'));
    fs.writeFileSync(path.join(root, '.ai-team', 'config.json'), '{"defaultModel":"withheld-legacy"}');
    fs.writeFileSync(path.join(root, '.squad'), 'not a directory');
    const before = fixture.messages.length;
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada', requestId: 'invalid-preferred-models' });
    expect(fixture.messages.slice(before)).toEqual([
      expect.objectContaining({ type: 'agentDetailLoaded', requestId: 'invalid-preferred-models', detail: expect.objectContaining({
        id: 'ada', workspaceRoot: root, charterStatus: 'unreadable', charterContent: null, charterSummary: null,
        currentTask: null, currentTaskSource: null,
        modelSources: expect.arrayContaining([expect.objectContaining({
          sourcePath: path.join(root, '.squad', 'config.json'), state: 'unreadable', values: [],
        })]),
      }) }),
    ]);
    expect(details().at(-1)?.detail.modelSources?.every(source => source.values.length === 0)).toBe(true);
    expect(fixture.calls).toEqual({ documents: [], commands: [], information: [], terminals: [] });
  });
});
