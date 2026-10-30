import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage } from './types.js';

const providerCode = buildSync({
  entryPoints: [path.resolve('src', 'SquadPodViewProvider.ts')],
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false,
}).outputFiles[0].text;
const nodeRequire = createRequire(path.resolve('package.json'));
const report = {
  version: 1, kind: 'usage', sessionId: 'session', turnId: 'turn', agentName: 'Ada',
  model: 'historical-model', inputTokens: 123, outputTokens: 45, estimatedCost: 0.02,
  timestamp: '2026-10-28T15:00:00Z',
};
const team = '## Members\n| Name | Role | Charter |\n| --- | --- | --- |\n| Ada | Dev | .squad/agents/ada/charter.md |\n';
const disposable = { dispose() {} };
interface MockView {
  webview: {
    cspSource: string;
    asWebviewUri: (value: { fsPath: string }) => string;
    onDidReceiveMessage: (listener: (message: { type: 'webviewReady' }) => void) => typeof disposable;
    postMessage: (message: OutboundMessage) => Promise<boolean>;
  };
  onDidDispose: () => typeof disposable;
}
interface Provider {
  resolveWebviewView(view: MockView, context: object, token: object): void;
  dispose(): void;
}

describe('recorded usage through compiled provider (mocked VS Code boundary)', () => {
  let root: string;
  let ledger: string;
  let provider: Provider;
  let receive: (message: { type: 'webviewReady' }) => void;
  let retarget: () => void;
  let messages: OutboundMessage[];
  const workspace: { workspaceFolders: Array<{ uri: { fsPath: string } }>; onDidChangeWorkspaceFolders?: unknown;
    getConfiguration: () => { get: (_key: string, fallback: unknown) => unknown } } = {
    workspaceFolders: [],
    getConfiguration: () => ({ get: (key, fallback) =>
      key === 'liveActivity' || key === 'directorySuggestions' ? false : fallback }),
  };
  const snapshots = () => messages.filter((m): m is Extract<OutboundMessage, { type: 'recordedUsage' }> => m.type === 'recordedUsage');

  beforeEach(() => {
    vi.useFakeTimers();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-recorded-provider-'));
    ledger = path.join(root, '.squad', 'log', 'usage.jsonl');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    fs.writeFileSync(path.join(root, '.squad', 'team.md'), team);
    workspace.workspaceFolders = [{ uri: { fsPath: root } }];
    workspace.onDidChangeWorkspaceFolders = (listener: () => void) => { retarget = listener; return disposable; };
    messages = [];
    const storage = { get: (_key: string, fallback: unknown) => fallback, update: async () => {} };
    const vscode = {
      workspace,
      Uri: {
        file: (fsPath: string) => ({ fsPath }),
        joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: path.join(base.fsPath, ...parts) }),
      },
      window: { createOutputChannel: () => ({ appendLine() {}, dispose() {} }) },
    };
    const module: { exports: { SquadPodViewProvider?: new (context: unknown) => Provider } } = { exports: {} };
    const require = (specifier: string): unknown => specifier === 'vscode' ? vscode : nodeRequire(specifier);
    new Function('require', 'module', 'exports', providerCode)(require, module, module.exports);
    provider = new module.exports.SquadPodViewProvider!({
      extensionPath: path.resolve('.'), workspaceState: storage, globalState: storage,
    });
    provider.resolveWebviewView({
      webview: {
        cspSource: 'mock:', asWebviewUri: value => value.fsPath,
        onDidReceiveMessage: listener => { receive = listener; return disposable; },
        postMessage: async message => { messages.push(message); return true; },
      },
      onDidDispose: () => disposable,
    }, {}, {});
  });
  afterEach(() => {
    provider.dispose();
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('publishes startup history, polls append/rewrite and clears stale values on unavailable sources and retarget', { timeout: 20_000 }, () => {
    fs.writeFileSync(ledger, JSON.stringify(report) + '\n');
    receive({ type: 'webviewReady' });
    expect(snapshots().at(-1)?.snapshot).toMatchObject({
      state: 'ready', usageRecords: 1, history: [expect.objectContaining({ attribution: 'roster-match', rosterName: 'Ada' })],
    });
    // Reload must not duplicate observers.
    const count = vi.getTimerCount();
    receive({ type: 'webviewReady' });
    expect(vi.getTimerCount()).toBe(count);
    fs.appendFileSync(ledger, JSON.stringify({ ...report, model: 'second-model' }) + '\n');
    vi.advanceTimersByTime(2000);
    expect(snapshots().at(-1)?.snapshot).toMatchObject({ usageRecords: 2, totals: { inputTokens: 246, outputTokens: 90 } });
    expect(messages.filter(m => ['agentStatus', 'agentToolStart', 'agentToolDone', 'telemetryEvent', 'agentCreated'].includes(m.type))).toEqual([]);
    fs.writeFileSync(ledger, '');
    vi.advanceTimersByTime(2000);
    expect(snapshots().at(-1)?.snapshot).toMatchObject({ usageRecords: 0, totals: null });
    fs.unlinkSync(ledger);
    vi.advanceTimersByTime(2000);
    expect(snapshots().at(-1)?.snapshot).toMatchObject({ state: 'missing', totals: null });
    workspace.workspaceFolders = [];
    retarget();
    expect(snapshots().at(-1)?.snapshot).toMatchObject({ state: 'unavailable', sourcePath: null, totals: null, history: [] });
    const stopped = snapshots().length;
    vi.advanceTimersByTime(10_000);
    expect(snapshots()).toHaveLength(stopped);
  });

  it('updates roster attribution and resolves legacy-to-current state migration without changing character identity from usage', { timeout: 20_000 }, () => {
    fs.writeFileSync(ledger, JSON.stringify({ ...report, agentName: 'Mystery' }) + '\n');
    receive({ type: 'webviewReady' });
    expect(snapshots().at(-1)?.snapshot.history[0].attribution).toBe('unattributed');
    fs.writeFileSync(path.join(root, '.squad', 'team.md'), team.replace('| Ada |', '| Mystery |'));
    vi.advanceTimersByTime(2000);
    expect(snapshots().at(-1)?.snapshot.history[0].rosterName).toBe('Mystery');
    expect(messages.filter(m => m.type === 'agentCreated')).toEqual([]);
    fs.renameSync(path.join(root, '.squad'), path.join(root, '.ai-team'));
    vi.advanceTimersByTime(2000);
    expect(snapshots().at(-1)?.snapshot.sourcePath).toBe(path.join(root, '.ai-team', 'log', 'usage.jsonl'));
    provider.dispose();
    const stopped = snapshots().length;
    vi.advanceTimersByTime(10_000);
    expect(snapshots()).toHaveLength(stopped);
  });
});
