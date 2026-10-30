import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage, WebviewMessage } from './types.js';

// The same host contract can exercise the shipped production bundle after build.
const extensionCode = process.env.SQUAD_POD_EXTENSION_BUNDLE
  ? fs.readFileSync(path.resolve(process.env.SQUAD_POD_EXTENSION_BUNDLE), 'utf8')
  : buildSync({
    entryPoints: [path.resolve('src', 'extension.ts')],
    bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false,
  }).outputFiles[0].text;
const nodeRequire = createRequire(path.resolve('package.json'));
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const setting = 'squad-pod.autoShowPanel';
const focusCommand = 'squad-pod.panelView.focus';
const disposable = { dispose() {} };
const report = {
  version: 1, kind: 'usage', sessionId: 'old-session', turnId: 'old-turn', agentName: 'Ada',
  model: 'historical-model', inputTokens: 123, outputTokens: 45, estimatedCost: 0.02,
  timestamp: '2026-10-28T15:00:00Z',
};
const team = '## Members\n| Name | Role | Charter |\n| --- | --- | --- |\n| Ada | Dev | .squad/agents/ada/charter.md |\n';
interface Provider {
  resolveWebviewView(view: unknown, context: object, token: object): void;
}
interface Extension {
  activate(context: unknown): void;
  deactivate(): void;
}

describe('activation-only auto-show through real extension/provider (mocked VS Code boundary)', () => {
  let root: string;
  let extension: Extension | undefined;
  let provider: Provider;
  let receive: (message: WebviewMessage) => void;
  let retarget: () => void;
  let messages: OutboundMessage[];
  let visibleListeners: Array<() => void>;
  let commands: Map<string, () => unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-auto-show-'));
    fs.mkdirSync(path.join(root, '.squad', 'log'), { recursive: true });
    fs.writeFileSync(path.join(root, '.squad', 'team.md'), team);
    fs.writeFileSync(path.join(root, '.squad', 'log', 'usage.jsonl'), JSON.stringify(report) + '\n');
    fs.writeFileSync(path.join(root, '.squad', 'log', 'old-activity.md'), 'Ada historically worked on a task');
    messages = [];
    visibleListeners = [];
    commands = new Map();
  });

  afterEach(() => {
    extension?.deactivate();
    extension = undefined;
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function load(configured?: boolean, alreadyVisible = false) {
    const storage = { get: (_key: string, fallback: unknown) => fallback, update: async () => {} };
    const view = {
      visible: alreadyVisible,
      webview: {
        cspSource: 'mock:',
        asWebviewUri: (value: { fsPath: string }) => value.fsPath,
        onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return disposable; },
        postMessage: async (message: OutboundMessage) => { messages.push(message); return true; },
      },
      onDidChangeVisibility: (listener: () => void) => { visibleListeners.push(listener); return disposable; },
      onDidDispose: () => disposable,
    };
    let resolved = false;
    const resolveView = () => {
      if (!resolved) {
        provider.resolveWebviewView(view, {}, {});
        resolved = true;
      }
    };
    const get = vi.fn((key: string, fallback: unknown) => {
      expect(key).toBe(setting);
      expect(fallback).toBe(false);
      return configured ?? manifest.contributes.configuration.properties[setting].default;
    });
    const executeCommand = vi.fn(async (command: string) => {
      expect(command).toBe(focusCommand);
      resolveView();
      view.visible = true;
      visibleListeners.forEach(listener => listener());
    });
    const createTerminal = vi.fn(() => { throw new Error('Automatic terminal creation is forbidden'); });
    const showErrorMessage = vi.fn();
    const vscode = {
      Uri: {
        file: (fsPath: string) => ({ fsPath, toString: () => `file:${fsPath}` }),
        joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: path.join(base.fsPath, ...parts) }),
      },
      workspace: {
        workspaceFolders: [{ name: 'Synthetic fixture', uri: { fsPath: root, toString: () => `file:${root}` } }],
        getConfiguration: (section?: string) => section === 'squad-pod'
          ? { get: (key: string, fallback: unknown) => key === 'directorySuggestions' ? false : fallback }
          : { get },
        onDidChangeWorkspaceFolders: (listener: () => void) => { retarget = listener; return disposable; },
      },
      window: {
        registerWebviewViewProvider: (id: string, value: Provider) => {
          expect(id).toBe('squad-pod.panelView');
          provider = value;
          if (alreadyVisible) { resolveView(); }
          return disposable;
        },
        createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
        createTerminal,
        showErrorMessage,
      },
      commands: {
        registerCommand: (id: string, handler: () => unknown) => { commands.set(id, handler); return disposable; },
        executeCommand,
      },
    };
    const module = { exports: {} };
    const require = (specifier: string): unknown => specifier === 'vscode' ? vscode : nodeRequire(specifier);
    new Function('require', 'module', 'exports', extensionCode)(require, module, module.exports);
    extension = module.exports as Extension;
    const context = {
      subscriptions: [], extensionPath: path.resolve('.'), workspaceState: storage, globalState: storage,
    };
    return {
      activate: () => extension!.activate(context),
      get, executeCommand, createTerminal, showErrorMessage, resolveView, view,
      setVisible: (visible: boolean) => {
        view.visible = visible;
        visibleListeners.forEach(listener => listener());
      },
    };
  }

  function assertReplayedHistory() {
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'existingAgents',
      agents: [expect.objectContaining({ id: 'ada', status: 'idle', currentTask: null })],
    }));
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'recordedUsage', snapshot: expect.objectContaining({ usageRecords: 1 }),
    }));
    expect(messages.filter(m => ['agentToolStart', 'agentToolDone', 'agentStatus', 'telemetryEvent'].includes(m.type))).toEqual([]);
  }

  it('contributes a discoverable boolean with a literal false default', () => {
    expect(manifest.contributes.configuration).toMatchObject({
      title: 'Squad Pod',
      properties: { [setting]: { type: 'boolean', default: false, scope: 'window', description: expect.any(String) } },
    });
  });

  it.each([undefined, false])('does not focus for default/disabled setting %s, roster, history or visibility replay', async (configured) => {
    const host = load(configured);
    await host.activate();
    expect(host.executeCommand).not.toHaveBeenCalled();
    host.resolveView();
    receive({ type: 'webviewReady' });
    assertReplayedHistory();
    for (let i = 0; i < 3; i++) {
      host.setVisible(true);
      receive({ type: 'webviewReady' });
      host.setVisible(false);
      retarget();
      vi.advanceTimersByTime(2000);
    }
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(host.createTerminal).not.toHaveBeenCalled();
    expect(host.get).toHaveBeenCalledExactlyOnceWith(setting, false);
  }, 20_000);

  it('focuses once on opt-in activation, before any roster/history handshake, never on replay or hide', async () => {
    const host = load(true);
    await host.activate();
    expect(host.executeCommand).toHaveBeenCalledExactlyOnceWith(focusCommand);
    expect(messages).toEqual([]);
    receive({ type: 'webviewReady' });
    assertReplayedHistory();
    for (let i = 0; i < 3; i++) {
      host.setVisible(true);
      receive({ type: 'webviewReady' });
      retarget();
      vi.advanceTimersByTime(2000);
      await commands.get('squad-pod.showPanel')!();
      host.setVisible(false);
      receive({ type: 'webviewReady' });
    }
    expect(host.executeCommand).toHaveBeenCalledExactlyOnceWith(focusCommand);
    expect(host.createTerminal).not.toHaveBeenCalled();
    expect(host.get).toHaveBeenCalledExactlyOnceWith(setting, false);
  }, 20_000);

  it('does not focus an already-visible provider during opt-in activation or repeated explicit refocus', async () => {
    const host = load(true, true);
    await host.activate();
    for (let i = 0; i < 3; i++) {
      receive({ type: 'webviewReady' });
      host.setVisible(true);
      await commands.get('squad-pod.showPanel')!();
    }
    expect(host.executeCommand).not.toHaveBeenCalled();
    expect(host.createTerminal).not.toHaveBeenCalled();
  }, 20_000);

  it('retains the explicit Show Panel command when automatic focus is disabled', async () => {
    const host = load(false);
    await host.activate();
    await commands.get('squad-pod.showPanel')!();
    expect(host.executeCommand).toHaveBeenCalledExactlyOnceWith(focusCommand);
    expect(host.createTerminal).not.toHaveBeenCalled();
  });

  it('does not make extension activation wait for the focus command', () => {
    const host = load(true);
    host.executeCommand.mockImplementationOnce(() => new Promise<void>(() => {}));
    expect(host.activate()).toBeUndefined();
    expect(host.executeCommand).toHaveBeenCalledExactlyOnceWith(focusCommand);
  });

  it('surfaces a rejected automatic focus instead of silently reporting success', async () => {
    const host = load(true);
    host.executeCommand.mockRejectedValueOnce(new Error('Synthetic focus failure'));
    host.activate();
    await vi.waitFor(() => {
      expect(host.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
        'Squad Pod could not show panel: Error: Synthetic focus failure',
      );
    });
  });
});
