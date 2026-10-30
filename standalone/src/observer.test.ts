import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createObserver } from './observer.js';
import { ProjectFiles } from './projectFiles.js';
import { decodeEvent } from './events.js';

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
});

describe('direction-specific browser event parsing', () => {
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
