import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.js';
import { OfficeState } from '../office/engine/officeState.js';
import type { RecordedUsageSnapshot } from '../../../src/recordedUsage.js';
import type { OutboundMessage, SourceStatus } from '../../../src/types.js';
import type { CliUsageSnapshot } from '../../../src/cliUsage.js';
import { createHostClientFixture } from '../__tests__/hostClientFixture.js';
import type { HostClientFixture } from '../__tests__/hostClientFixture.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const empty: RecordedUsageSnapshot = {
  state: 'missing', sourcePath: 'C:\\fixture\\.squad\\log\\usage.jsonl', diagnostic: 'No local ledger.',
  checkedAt: '2026-10-29T19:00:00Z', lastRecordAt: null, lastUsageAt: null,
  invalidLines: 0, unsupportedLines: 0, pendingFinalLine: false, usageRecords: 0,
  attemptedTurns: 0, coveredTurns: 0, unlinkedUsageRecords: 0, normalizedValueRecords: 0, totals: null, history: [],
};

describe('recorded usage in the real App host-message path (mocked boundary)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let audio: ReturnType<typeof vi.fn>;
  let client: HostClientFixture;
  const send = (snapshot: RecordedUsageSnapshot) => act(() => client.emit({ type: 'recordedUsage', snapshot } as OutboundMessage));
  beforeEach(() => {
    client = createHostClientFixture();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    audio = vi.fn();
    vi.stubGlobal('AudioContext', audio);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App client={client} />));
    act(() => client.emit({
      type: 'layoutLoaded', layout: { cols: 20, rows: 15, tiles: Array(300).fill(1), furniture: [] },
      revision: 'usage-fixture', workspaceRoot: 'usage-workspace',
    } as OutboundMessage));
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Telemetry')!.click());
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('distinguishes missing data, partial valid sums, reported zero and unavailable live capabilities without activity side effects', () => {
    send(empty);
    const section = host.querySelector('[aria-label="Recorded Squad usage"]')!;
    expect(section.textContent).toContain('No usage totals available');
    expect(section.textContent).toContain('coverage unavailable (0 / 0 recorded starts)');
    expect(section.textContent).toContain('runtime bus not connected');
    expect(section.textContent).toContain('Parent-child hierarchy / roster promotion: unavailable');
    const before = vi.mocked(client.send).mock.calls.length;
    const addAgent = vi.spyOn(OfficeState.prototype, 'addAgent');
    send({
      ...empty, state: 'partial', diagnostic: 'Partial fixture',
      usageRecords: 1, attemptedTurns: 2, coveredTurns: 1, invalidLines: 1, pendingFinalLine: true,
      totals: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 }, normalizedValueRecords: 1,
      history: [{
        sessionId: 'old-session', turnId: 'old-turn', agentName: 'Collision',
        rosterName: null, attribution: 'ambiguous', model: 'unknown',
        timestamp: '2026-10-28T10:00:00Z', inputTokens: 0, outputTokens: 0, estimatedCost: 0,
      }],
    });

    it('keeps CLI exports separate, unknown and historical through the real App seam and explicit actions', () => {
      send(empty);
      const snapshot: CliUsageSnapshot = {
        state: 'ready', sourcePath: 'C:\\fixture\\cli.json', canRefresh: true, checkedAt: '2026-10-30T12:00:00Z', diagnostic: null,
        report: { sessionStartTime: '2026-10-28T15:00:00Z', userRequests: 2, premiumRequests: 0.5,
          apiDurationMs: 1200, nanoAiu: null, modelCount: 1, models: [{
            model: 'synthetic-model', requests: 3, premiumRequests: 0.5, inputTokens: 120, outputTokens: 30,
            cacheReadTokens: 40, cacheWriteTokens: 10, reasoningTokens: null, nanoAiu: 0,
          }] },
      };
      const addAgent = vi.spyOn(OfficeState.prototype, 'addAgent');
      act(() => client.emit({ type: 'cliUsage', snapshot }));
      const section = host.querySelector('[aria-label="Imported CLI usage"]')!;
      expect(section.textContent).toContain('0.5 premium-request cost');
      expect(section.textContent).toContain('nano-AI units: not reported');
      expect(section.textContent).toContain('nano-AI units: 0');
      expect(section.textContent).toContain('Session identity: unknown');
      expect(section.textContent).toContain('Completion, resumed history and all-agent coverage: unknown');
      expect(section.textContent).toContain('Historical model: synthetic-model');
      expect(section.textContent).toContain('real-export acceptance pending');
      expect(host.querySelector('[aria-label="Recorded Squad usage"]')?.textContent).toContain('No usage totals available');
      expect(host.textContent).toContain('Activity events (0)');
      expect(addAgent).not.toHaveBeenCalled();
      expect(audio).not.toHaveBeenCalled();
      const click = (name: string) => act(() => [...section.querySelectorAll('button')].find(b => b.textContent === name)!.click());
      click('Select CLI usage JSON...');
      click('Refresh selected export');
      click('Forget export');
      expect(vi.mocked(client.send).mock.calls.slice(-3).map(([m]) => m)).toEqual([
        { type: 'selectCliUsage' }, { type: 'refreshCliUsage' }, { type: 'clearCliUsage' },
      ]);
      act(() => client.emit({ type: 'cliUsage', snapshot: { ...snapshot, state: 'error', report: null, diagnostic: 'Rejected export' } }));
      expect(section.textContent).not.toContain('Historical model: synthetic-model');
      expect(section.textContent).toContain('Rejected export');
      expect(section.textContent).toContain('not zero consumption');
    });

    it.each([true, false])('does not expose CLI file actions in standalone (readOnly=%s)', readOnly => {
      act(() => root.render(<App client={client} standalone readOnly={readOnly} />));
      const section = host.querySelector('[aria-label="Imported CLI usage"]')!;
      expect(section.textContent).toContain('CLI usage import is unavailable in standalone/read-only observation');
      expect(section.querySelectorAll('button')).toHaveLength(0);
    });
    expect(section.textContent).toContain('Partial sums (valid records only): 0 input / 0 output');
    expect(section.textContent).toContain('1 / 2 recorded starts');
    expect(section.textContent).toContain('unattributed (ambiguous roster identity)');
    expect(section.textContent).toContain('Reported model: unknown');
    expect(section.textContent).toContain('Zero is not evidence that usage was measured');
    expect(section.textContent).not.toContain('current model: unknown');
    expect(audio).not.toHaveBeenCalled();
    expect(vi.mocked(client.send).mock.calls).toHaveLength(before);
    expect(addAgent).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Activity events (0)');
    send({ ...empty, state: 'unavailable', sourcePath: null, diagnostic: 'No workspace selected.' });
    expect(section.textContent).not.toContain('old-session');
    expect(section.textContent).toContain('No usage totals available');
  });

  const source: SourceStatus = {
    workspaceRoot: 'C:\\fixture', squadDir: 'C:\\fixture\\.squad', teamFound: true,
    observer: 'watching', nativeWatch: false, error: null, liveActivity: { state: 'off', sessionId: null },
  };
  it('keeps empty guidance and missing-ledger guidance outside diagnostics and opens consent settings without enabling', () => {
    send(empty);
    act(() => client.emit({ type: 'sourceStatus', status: source }));
    const guidance = [...host.querySelectorAll('div')].find(e => e.textContent?.startsWith('No activity events observed'))!;
    expect(guidance.closest('details')).toBeNull();
    expect(host.querySelector('[aria-label="Recorded Squad usage"] h3')!.closest('details')).toBeNull();
    expect(host.textContent).toContain('not recorded zero consumption');
    expect(host.textContent).toContain('File observer: Watching (polling)');
    expect(host.textContent).toContain('Live CLI observer: off');
    const before = vi.mocked(client.send).mock.calls.length;
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Observation settings and consent')!.click());
    expect(host.querySelector('#squad-pod-live-activity')).not.toBeNull();
    expect(vi.mocked(client.send).mock.calls).toHaveLength(before);
  });

  it.each(['searching', 'following', 'error'] as const)('reports live %s without changing file observation', state => {
    act(() => client.emit({ type: 'sourceStatus', status: { ...source, liveActivity: { state, sessionId: null } } }));
    const status = host.querySelector('[aria-label="Squad source status"]')!;
    expect(status.textContent).toContain(`Live CLI observer: ${state}`);
    expect(status.textContent).toContain('File observer: Watching (polling)');
  });

  it('shows absent sources as unavailable rather than off or searching', () => {
    act(() => client.emit({ type: 'sourceStatus', status: {
      ...source, squadDir: null, observer: 'stopped', liveActivity: undefined,
    } }));
    expect(host.textContent).toContain('File observer: Unavailable');
    expect(host.textContent).toContain('Live CLI observer: Unavailable');
  });

  it('allows scrolling empty activity to read usage and diagnostics', () => {
    send(empty);
    const content = host.querySelector<HTMLElement>('[aria-label="Telemetry content"]')!;
    Object.defineProperties(content, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
    act(() => {
      content.scrollTop = 120;
      content.dispatchEvent(new Event('scroll'));
    });
    expect(content.scrollTop).toBe(120);
  });

  it('counts a newly observed fixture event and clears only activity, retaining a valid historical report', () => {
    const historical: RecordedUsageSnapshot = {
      ...empty, state: 'ready', usageRecords: 1,
      totals: { inputTokens: 1400, outputTokens: 400, estimatedCost: 0.02 },
      history: [{
        sessionId: 'fixture-historical', turnId: 'old-turn', agentName: 'Fixture agent',
        rosterName: null, attribution: 'unattributed', model: 'fixture-model',
        timestamp: '2026-10-28T10:00:00Z', inputTokens: 1400, outputTokens: 400, estimatedCost: 0.02,
      }],
    };
    send(historical);
    expect(host.textContent).toContain('Activity events (0)');
    const usage = host.querySelector('[aria-label="Recorded Squad usage"]')!.textContent;
    act(() => client.emit({ type: 'telemetryEvent', event: {
      id: 'fixture-new', timestamp: Date.now(), category: 'log', summary: 'Fixture evidence: new file event',
      agentId: null, agentName: null, detail: null,
    } }));
    expect(host.textContent).toContain('Activity events (1)');
    expect(host.textContent).toContain('Fixture evidence: new file event');
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Clear activity')!.click());
    expect(host.textContent).toContain('Activity events (0)');
    expect(host.textContent).not.toContain('Fixture evidence: new file event');
    expect(host.querySelector('[aria-label="Recorded Squad usage"]')!.textContent).toBe(usage);
  });

  it('degrades visibly in the read-only observer without sending an unsupported settings action', () => {
    act(() => root.render(<App client={client} readOnly />));
    expect(host.textContent).toContain('Settings and live-log consent are unavailable in this read-only observer');
    expect(host.textContent).toContain('Live CLI observer: Unavailable in the read-only observer');
    expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Observation settings and consent')).toBe(false);
    expect(vi.mocked(client.send).mock.calls.some(([message]) => message.type === 'setLiveActivity')).toBe(false);
  });
});
