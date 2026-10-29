import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.js';
import { vscode } from '../vscodeApi.js';
import { OfficeState } from '../office/engine/officeState.js';
import type { RecordedUsageSnapshot } from '../../../src/recordedUsage.js';

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
  const send = (snapshot: RecordedUsageSnapshot) => act(() => window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'recordedUsage', snapshot },
  })));
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(vscode, 'postMessage').mockImplementation(() => {});
    audio = vi.fn();
    vi.stubGlobal('AudioContext', audio);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App />));
    act(() => window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'layoutLoaded', layout: { cols: 20, rows: 15, tiles: Array(300).fill(1), furniture: [] },
      revision: 'usage-fixture', workspaceRoot: 'usage-workspace',
    } })));
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
    const before = vi.mocked(vscode.postMessage).mock.calls.length;
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
    expect(section.textContent).toContain('Partial sums (valid records only): 0 input / 0 output');
    expect(section.textContent).toContain('1 / 2 recorded starts');
    expect(section.textContent).toContain('unattributed (ambiguous roster identity)');
    expect(section.textContent).toContain('Reported model: unknown');
    expect(section.textContent).toContain('Zero is not evidence that usage was measured');
    expect(section.textContent).not.toContain('current model: unknown');
    expect(audio).not.toHaveBeenCalled();
    expect(vi.mocked(vscode.postMessage).mock.calls).toHaveLength(before);
    expect(addAgent).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Telemetry (0)');
    send({ ...empty, state: 'unavailable', sourcePath: null, diagnostic: 'No workspace selected.' });
    expect(section.textContent).not.toContain('old-session');
    expect(section.textContent).toContain('No usage totals available');
  });
});
