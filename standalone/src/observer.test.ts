import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createObserver } from './observer.js';
import { ProjectFiles } from './projectFiles.js';
import { decodeEvent } from './events.js';
import type { OutboundMessage } from '../../src/types.js';

const owned: string[] = [];
const packageRoot = fileURLToPath(new URL('../../webview-ui/public/assets', import.meta.url));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad observer test '));
  owned.push(root);
  fs.mkdirSync(path.join(root, '.squad', 'log'), { recursive: true });
  fs.mkdirSync(path.join(root, '.squad-pod'));
  fs.writeFileSync(path.join(root, '.squad', 'team.md'), '# Test team\n## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n| TestBot | Developer | .squad/agents/test-agent-1/charter.md | Active |\n');
  return root;
}
afterEach(() => {
  vi.useRealTimers();
  for (const root of owned.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('read-only selected-project observer', () => {
  it('uses the production parsers and bundled assets within measured frame/queue budgets', async () => {
    const root = fixture();
    const before = fs.readdirSync(root, { recursive: true });
    const observer = createObserver(root, packageRoot);
    try {
      const messages = await observer.snapshot();
      const frames = messages.map(message => JSON.stringify({ version: 1, kind: 'office', message }));
      for (const [index, frame] of frames.entries()) {
        expect(() => decodeEvent(frame), messages[index].type).not.toThrow();
        expect(Buffer.byteLength(frame)).toBeLessThan(8 * 1024 * 1024);
      }
      const assets = messages.find(message => message.type === 'manifestAssetsLoaded');
      expect(assets?.type).toBe('manifestAssetsLoaded');
      if (assets?.type !== 'manifestAssetsLoaded') throw new Error('Missing bundled asset snapshot.');
      expect(assets.snapshot.furniture.find(asset => asset.type === 'pa_WOODEN_CHAIR_SIDE')?.backgroundTiles).toBe(1);
      expect(decodeEvent(JSON.stringify({ version: 1, kind: 'office', message: assets }))).toEqual(assets);
      const total = frames.reduce((sum, frame) => sum + Buffer.byteLength(frame), 0);
      expect(total).toBeLessThan(16 * 1024 * 1024);
      expect(total).toBeGreaterThan(100_000);
      console.log(`Measured built-in office frames: ${frames.map(frame => Buffer.byteLength(frame)).join(', ')} bytes; total ${total}.`);
      expect(messages.find(m => m.type === 'existingAgents')).toMatchObject({ agents: [{ id: 'test-agent-1', name: 'TestBot' }] });
      expect(fs.readdirSync(root, { recursive: true })).toEqual(before);
    } finally { observer.dispose(); }
  });

  it('observes real roster/layout/recorded usage/activity changes and disposes polling', async () => {
    vi.useFakeTimers();
    const root = fixture();
    const observer = createObserver(root, packageRoot, 100);
    const received: unknown[] = [];
    const unsubscribe = observer.subscribe(messages => received.push(messages));
    try {
      const initial = await observer.snapshot();
      const initialLayout = initial.find(m => m.type === 'layoutLoaded');
      if (initialLayout?.type !== 'layoutLoaded') throw new Error('Missing layout.');
      const layout = { ...initialLayout.layout, cols: 2, rows: 2, tiles: [1, 1, 1, 1], furniture: [], tileColors: {}, carpetTiles: undefined, areaTiles: undefined };
      fs.writeFileSync(path.join(root, '.squad-pod', 'layout.json'), JSON.stringify(layout));
      fs.writeFileSync(path.join(root, '.squad', 'log', 'usage.jsonl'), JSON.stringify({
        version: 1, kind: 'usage', sessionId: 'fixture', timestamp: new Date().toISOString(),
        model: 'test-model', inputTokens: 123, outputTokens: 45, estimatedCost: 0.1, agentName: 'TestBot',
      }) + '\n');
      const activity = path.join(root, '.squad', 'log', '2026-10-30T12-00-00Z-test-agent-1.md');
      fs.writeFileSync(activity, '**Agent:** test-agent-1\nBaseline');
      await vi.advanceTimersByTimeAsync(100);
      fs.appendFileSync(activity, '\nNew observed activity');
      await vi.advanceTimersByTimeAsync(100);
      const latest = received.flat();
      expect(latest).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'layoutLoaded', layout: expect.objectContaining({ cols: 2 }) }),
        expect.objectContaining({ type: 'existingAgents', agents: [expect.objectContaining({ status: 'active' })] }),
        expect.objectContaining({ type: 'recordedUsage', snapshot: expect.objectContaining({ totals: { inputTokens: 123, outputTokens: 45, estimatedCost: 0.1 } }) }),
      ]));
      fs.appendFileSync(path.join(root, '.squad', 'team.md'), '| TestBot2 | Tester | .squad/agents/test-agent-2/charter.md | Active |\n');
      await vi.advanceTimersByTimeAsync(100);
      expect(received.at(-1)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'existingAgents', agents: expect.arrayContaining([expect.objectContaining({ id: 'test-agent-2' })]) }),
      ]));
      unsubscribe();
      expect(observer.subscriptionCount).toBe(0);
      const count = received.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(received).toHaveLength(count);
    } finally { unsubscribe(); observer.dispose(); }
    expect(() => observer.subscribe(() => {})).toThrow('disposed');
  });

  it('serves bounded detail reads with an explicit read-only charter limitation', async () => {
    const root = fixture();
    const observer = createObserver(root, packageRoot);
    try {
      await observer.snapshot();
      const requestId = 'observer-detail-1';
      const messages = await observer.onRead({ type: 'requestAgentDetail', agentId: 'test-agent-1', requestId });
      expect(messages).toEqual([expect.objectContaining({
        type: 'agentDetailLoaded', requestId,
        detail: expect.objectContaining({
          id: 'test-agent-1', workspaceRoot: observer.root, charterStatus: 'unavailable',
          lastActiveAt: 0, lastActiveAtStatus: 'unobserved',
          charterContent: null, expertise: null, responsibilities: null, boundaries: null,
        }),
      })]);
      expect(() => decodeEvent(JSON.stringify({ version: 1, kind: 'office', message: messages[0] }))).not.toThrow();
      await expect(observer.onRead({ type: 'requestAgentDetail', agentId: 'removed-agent' })).rejects.toThrow('Unknown observed agent.');
    } finally { observer.dispose(); }
  });

  it('explains missing/malformed sources, rejects escapes and enforces bounded reads', async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, '.squad-pod', 'layout.json'), '{"cols":null}');
    fs.writeFileSync(path.join(root, '.squad', 'team.md'), 'not a roster');
    const observer = createObserver(root, packageRoot);
    try {
      const snapshot = await observer.snapshot();
      expect(snapshot.find(m => m.type === 'sourceStatus')).toMatchObject({ status: { error: expect.stringContaining('malformed') } });
      expect(snapshot.find(m => m.type === 'recordedUsage')).toMatchObject({ snapshot: { state: 'missing' } });
      const files = new ProjectFiles(root);
      expect(() => files.read(path.join('..', 'outside'), 10)).toThrow('escapes');
      expect(() => files.read(path.join('.squad', 'team.md'), 1)).toThrow('regular file');
      fs.mkdirSync(path.join(root, 'outside'));
      fs.writeFileSync(path.join(root, 'outside', 'secret'), 'must not read');
      fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'link'), 'junction');
      expect(() => files.read(path.join('link', 'secret'), 100)).toThrow('symlinks');
    } finally { observer.dispose(); }
  });

  it('animates newly created sources and ordinary edits, but unchanged reads do not extend the 30-second window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const root = fixture();
    const historical = path.join(root, '.squad', 'log', '2026-10-30T12-00-00Z-test-agent-1.md');
    fs.writeFileSync(historical, '**Agent:** test-agent-1\nHistorical activity');
    const observer = createObserver(root, packageRoot, 1000);
    const received: OutboundMessage[] = [];
    const unsubscribe = observer.subscribe(messages => received.push(...messages));
    const expectStatus = async (status: string) => {
      const message = (await observer.snapshot()).find(message => message.type === 'existingAgents');
      expect(message).toMatchObject({
        agents: [expect.objectContaining({ status, currentTaskSource: status === 'active' ? 'file' : null })],
      });
      expect(decodeEvent(JSON.stringify({ version: 1, kind: 'office', message }))).toEqual(message);
      const details = await observer.onRead({ type: 'requestAgentDetail', agentId: 'test-agent-1', requestId: 'provenance' });
      expect(details[0]).toMatchObject({
        type: 'agentDetailLoaded', detail: { currentTaskSource: status === 'active' ? 'file' : null },
      });
      expect(decodeEvent(JSON.stringify({ version: 1, kind: 'office', message: details[0] }))).toEqual(details[0]);
    };
    try {
      await expectStatus('idle');
      fs.writeFileSync(path.join(root, '.squad', 'log', '2026-10-30T13-00-00Z-test-agent-1.md'), '**Agent:** test-agent-1\nNewly observed file');
      // A readiness snapshot can observe a genuinely new event before the next poll.
      await expectStatus('active');
      await vi.advanceTimersByTimeAsync(1000);
      expect(received).toContainEqual(expect.objectContaining({
        type: 'existingAgents', agents: [expect.objectContaining({ status: 'active' })],
      }));
      const count = received.length;
      await vi.advanceTimersByTimeAsync(1000);
      await expectStatus('active');
      expect(received).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(28_000);
      await expectStatus('idle');
      fs.appendFileSync(historical, '\nOrdinary observed edit');
      await vi.advanceTimersByTimeAsync(1000);
      await expectStatus('active');
      expect(received.at(-1)).toMatchObject({
        type: 'existingAgents', agents: [expect.objectContaining({ status: 'active' })],
      });
    } finally { unsubscribe(); observer.dispose(); }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rebaselines paused edits and new files on reconnect without historical animation', async () => {
    vi.useFakeTimers();
    const root = fixture();
    const source = path.join(root, '.squad', 'log', '2026-10-30T12-00-00Z-test-agent-1.md');
    fs.writeFileSync(source, '**Agent:** test-agent-1\nHistorical activity');
    const observer = createObserver(root, packageRoot, 1000);
    let unsubscribe = observer.subscribe(() => {});
    const status = async () => (await observer.snapshot()).find(message => message.type === 'existingAgents');
    try {
      fs.appendFileSync(source, '\nObserved edit');
      await vi.advanceTimersByTimeAsync(1000);
      expect(await status()).toMatchObject({ agents: [expect.objectContaining({ status: 'active' })] });
      unsubscribe();
      fs.appendFileSync(source, '\nEdit while observation is stopped');
      fs.writeFileSync(path.join(root, '.squad', 'log', '2026-10-30T13-00-00Z-test-agent-1.md'), '**Agent:** test-agent-1\nCreated while stopped');
      await vi.advanceTimersByTimeAsync(31_000);
      const resumed: OutboundMessage[] = [];
      unsubscribe = observer.subscribe(messages => resumed.push(...messages));
      expect(await status()).toMatchObject({ agents: [expect.objectContaining({ status: 'idle' })] });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await status()).toMatchObject({ agents: [expect.objectContaining({ status: 'idle' })] });
      expect(resumed.filter(message => message.type === 'existingAgents')).toEqual([
        expect.objectContaining({ agents: [expect.objectContaining({ status: 'idle' })] }),
      ]);
      fs.appendFileSync(source, '\nNew observed edit after reconnect');
      await vi.advanceTimersByTimeAsync(1000);
      expect(await status()).toMatchObject({ agents: [expect.objectContaining({ status: 'active' })] });
    } finally { unsubscribe(); observer.dispose(); }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['TestBot', false, 'active'],
    ['test', false, 'active'],
    ['test-agent-1-review', false, 'active'],
    ['test', true, 'idle'],
    ['unknown', false, 'idle'],
  ])('resolves observed file alias %j with ambiguity=%j as %s', async (alias, ambiguous, expected) => {
    const root = fixture();
    if (ambiguous) fs.appendFileSync(path.join(root, '.squad', 'team.md'), '| Other Test | Tester | .squad/agents/test-agent-2/charter.md | Active |\n');
    const observer = createObserver(root, packageRoot);
    const unsubscribe = observer.subscribe(() => {});
    try {
      fs.writeFileSync(path.join(root, '.squad', 'log', 'activity.md'), `**Agent:** ${alias} (Developer)\nNew observed activity`);
      const message = (await observer.snapshot()).find(message => message.type === 'existingAgents');
      expect(message).toMatchObject({
        agents: expect.arrayContaining([expect.objectContaining({ id: 'test-agent-1', status: expected })]),
      });
      if (ambiguous) expect(message).toMatchObject({ agents: [
        expect.objectContaining({ status: 'idle' }), expect.objectContaining({ status: 'idle' }),
      ] });
    } finally { unsubscribe(); observer.dispose(); }
  });

  it('keeps bounded identity-based appearances across insertion, reorder, removal and fresh viewers', async () => {
    const root = fixture();
    const teamPath = path.join(root, '.squad', 'team.md');
    const initialTeam = fs.readFileSync(teamPath, 'utf8');
    const observer = createObserver(root, packageRoot);
    const appearances = async (target = observer) => {
      const message = (await target.snapshot()).find(message => message.type === 'existingAgents');
      if (message?.type !== 'existingAgents') throw new Error('Missing roster snapshot.');
      return Object.fromEntries(message.agents.map(agent => [agent.id, agent.paletteIndex]));
    };
    try {
      const initial = await appearances();
      const newRow = '| NewBot | Tester | .squad/agents/new-bot/charter.md | Active |\n';
      fs.writeFileSync(teamPath, initialTeam.replace('| TestBot', newRow + '| TestBot'));
      const inserted = await appearances();
      expect(inserted['test-agent-1']).toBe(initial['test-agent-1']);
      fs.writeFileSync(teamPath, initialTeam + newRow);
      expect(await appearances()).toEqual(inserted);
      fs.writeFileSync(teamPath, initialTeam.split('| TestBot')[0] + newRow);
      await appearances();
      fs.writeFileSync(teamPath, initialTeam + newRow);
      expect(await appearances()).toEqual(inserted);
      const freshViewer = createObserver(root, packageRoot);
      try { expect(await appearances(freshViewer)).toEqual(inserted); }
      finally { freshViewer.dispose(); }
      const boundedRoster = Array.from({ length: 127 }, (_, i) =>
        `| Member ${i} | Tester | .squad/agents/member-${i}/charter.md | Active |\n`).join('');
      fs.writeFileSync(teamPath, initialTeam.replace('| TestBot', boundedRoster + '| TestBot'));
      const bounded = await appearances();
      expect(Object.keys(bounded)).toHaveLength(128);
      expect(bounded['test-agent-1']).toBe(initial['test-agent-1']);
      for (const palette of Object.values(bounded)) {
        expect(Number.isInteger(palette) && palette >= 0 && palette < 6).toBe(true);
      }
    } finally { observer.dispose(); }
  });

  it('observes a real saved-project Floor10 while preserving VOID8 and rejecting unsupported tiles', async () => {
    const root = fixture();
    const layoutPath = path.join(root, '.squad-pod', 'layout.json');
    const saved = { version: 2, cols: 2, rows: 2, tiles: [10, 8, 9, 1], furniture: [] };
    fs.writeFileSync(layoutPath, JSON.stringify(saved));
    const observer = createObserver(root, packageRoot);
    try {
      const message = (await observer.snapshot()).find(message => message.type === 'layoutLoaded');
      expect(message).toMatchObject({ layout: { tiles: [10, 8, 9, 1] } });
      expect(decodeEvent(JSON.stringify({ version: 1, kind: 'office', message }))).toEqual(message);
      expect(JSON.parse(fs.readFileSync(layoutPath, 'utf8'))).toEqual(saved);
      fs.writeFileSync(layoutPath, JSON.stringify({ ...saved, tiles: [11, 8, 9, 1] }));
      const rejected = await observer.snapshot();
      expect(rejected.find(message => message.type === 'sourceStatus')).toMatchObject({
        status: { error: expect.stringContaining('malformed') },
      });
      expect(rejected.find(message => message.type === 'layoutLoaded')).not.toMatchObject({ layout: { tiles: [11, 8, 9, 1] } });
    } finally { observer.dispose(); }
  });
});

describe('direction-specific browser event parsing', () => {
  it.each([0, 1, 16])('accepts backgroundTiles=%i and preserves it through the standalone event boundary', backgroundTiles => {
    const message = {
      type: 'manifestAssetsLoaded',
      snapshot: {
        furniture: [{
          type: 'local_TEST_CHAIR', label: 'Test Chair', width: 1, height: 2,
          sprite: Array.from({ length: 32 }, () => Array(16).fill('#ffffff')),
          isDesk: false, category: 'chairs', canPlaceOnSurfaces: false, canPlaceOnWalls: false,
          backgroundTiles,
        }],
        floors: [], walls: [], carpets: [], pets: [], directories: [], diagnostics: [],
      },
    };

    expect(decodeEvent(JSON.stringify({ version: 1, kind: 'office', message }))).toEqual(message);
  });

  it.each([-1, 1.5, 17, '1', null])('rejects invalid backgroundTiles=%j at the standalone event boundary', backgroundTiles => {
    const message = {
      type: 'manifestAssetsLoaded',
      snapshot: {
        furniture: [{
          type: 'local_TEST_CHAIR', label: 'Test Chair', width: 1, height: 2, sprite: [['#ffffff']],
          isDesk: false, category: 'chairs', canPlaceOnSurfaces: false, canPlaceOnWalls: false,
          backgroundTiles,
        }],
        floors: [], walls: [], carpets: [], pets: [], directories: [], diagnostics: [],
      },
    };

    expect(() => decodeEvent(JSON.stringify({ version: 1, kind: 'office', message })))
      .toThrow('Invalid server office frame');
  });

  it.each([
    { version: 2, kind: 'office', message: { type: 'noWorkspace' } },
    { version: 1, kind: 'terminal', message: { type: 'settingsLoaded' } },
    { version: 1, kind: 'office', message: { type: 'saveLayout', layout: {} } },
    { version: 1, kind: 'office', message: { type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: false, extra: true } },
    { version: 1, kind: 'office', message: { type: 'layoutLoaded', layout: { cols: 1, rows: 1, tiles: [1], furniture: [{ col: null }] } } },
    { version: 1, kind: 'error', code: 'secret must not be echoed' },
  ])('rejects unsupported, extra and invalid event shape %#', frame => {
    expect(() => decodeEvent(JSON.stringify(frame))).toThrow();
  });
});
