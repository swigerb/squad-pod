import * as path from 'path';
import { createRequire } from 'module';
import { buildSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import type { LayoutData, WebviewMessage } from './types.js';
import { exportLayoutToFile } from './layoutPersistence.js';

const extensionCode = buildSync({
  entryPoints: [path.resolve('src', 'extension.ts')],
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false,
}).outputFiles[0].text;
const nodeRequire = createRequire(path.resolve('package.json'));
const disposable = { dispose() {} };
const layout: LayoutData = { version: 2, cols: 1, rows: 1, tiles: [1], furniture: [] };
const selected = { fsPath: 'C:\\synthetic-export\\layout.json' };

interface Provider {
  handleWebviewMessage(message: WebviewMessage): void;
}
interface Extension {
  activate(context: unknown): void;
  deactivate(): void;
}

function boundary() {
  return {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      onDidChangeWorkspaceFolders: () => disposable,
      fs: { writeFile: vi.fn().mockResolvedValue(undefined) },
    },
    window: {
      showSaveDialog: vi.fn().mockResolvedValue(selected),
      showErrorMessage: vi.fn().mockResolvedValue(undefined),
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function host() {
  const vscode = boundary();
  const commands = new Map<string, () => unknown>();
  let provider: Provider | undefined;
  const api = {
    ...vscode,
    window: {
      ...vscode.window,
      registerWebviewViewProvider: (_id: string, value: Provider) => { provider = value; return disposable; },
    },
    commands: {
      registerCommand: (id: string, callback: () => unknown) => { commands.set(id, callback); return disposable; },
    },
  };
  const module: { exports: Partial<Extension> } = { exports: {} };
  const require = (specifier: string): unknown => {
    if (specifier === 'vscode') { return api; }
    if (specifier === 'fs' || specifier === 'node:fs') {
      return {
        accessSync: () => {},
        existsSync: () => true,
        readFileSync: () => JSON.stringify(layout),
      };
    }
    return nodeRequire(specifier);
  };
  new Function('require', 'module', 'exports', extensionCode)(require, module, module.exports);
  const extension = module.exports;
  if (!extension.activate || !extension.deactivate) { throw new Error('Extension entry points missing'); }
  const storage = { get: (_key: string, fallback: unknown) => fallback, update: async () => {} };
  extension.activate({
    subscriptions: [], extensionPath: 'synthetic-extension', globalState: storage, workspaceState: storage,
  });
  if (!provider) { throw new Error('Provider was not registered'); }
  return { vscode, provider, commands, dispose: extension.deactivate };
}

describe('layout export failure reporting (mocked VS Code, no native dialog)', () => {
  it('reports a rejected write and returns false without mutating the layout', async () => {
    const vscode = boundary();
    vscode.workspace.fs.writeFile.mockRejectedValue(new Error('Synthetic write denied'));
    const before = structuredClone(layout);
    expect(await exportLayoutToFile(layout, vscode as typeof import('vscode'))).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/Could not export layout: Error: Synthetic write denied.*destination and permissions/),
    );
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledExactlyOnceWith(
      selected, Buffer.from(JSON.stringify(layout, null, 2), 'utf-8'),
    );
    expect(layout).toEqual(before);
  });

  it('reports a rejected dialog without attempting a write', async () => {
    const vscode = boundary();
    vscode.window.showSaveDialog.mockRejectedValue(new Error('Synthetic dialog failure'));
    expect(await exportLayoutToFile(layout, vscode as typeof import('vscode'))).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Synthetic dialog failure'));
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
  });

  it('cancels quietly and writes only the exact selected URI on success', async () => {
    const vscode = boundary();
    vscode.window.showSaveDialog.mockResolvedValueOnce(undefined);
    expect(await exportLayoutToFile(layout, vscode as typeof import('vscode'))).toBe(false);
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(await exportLayoutToFile(layout, vscode as typeof import('vscode'))).toBe(true);
    expect(vscode.workspace.fs.writeFile.mock.calls[0][0]).toBe(selected);
  });

  it.each(['settings', 'default', 'recovery'] as const)('reports write failure through the production %s entry point', async (entry) => {
    const runtime = host();
    runtime.vscode.workspace.fs.writeFile.mockRejectedValue(new Error('Synthetic write denied'));
    try {
      if (entry === 'default') {
        const command = runtime.commands.get('squad-pod.exportDefaultLayout');
        if (!command) { throw new Error('Export command not registered'); }
        command();
      } else {
        runtime.provider.handleWebviewMessage(entry === 'settings'
          ? { type: 'exportLayout' }
          : { type: 'exportLayoutSnapshot', layout });
      }
      await vi.waitFor(() => expect(runtime.vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining('Synthetic write denied'),
      ));
      expect(runtime.vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      expect(runtime.vscode.workspace.fs.writeFile.mock.calls[0]).toEqual([
        selected, Buffer.from(JSON.stringify(layout, null, 2), 'utf-8'),
      ]);
      expect(runtime.vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(runtime.vscode.window.showWarningMessage).not.toHaveBeenCalled();
    } finally {
      runtime.dispose();
    }
  });

  it.each(['settings', 'default', 'recovery'] as const)('reports dialog failure through the production %s entry point', async (entry) => {
    const runtime = host();
    runtime.vscode.window.showSaveDialog.mockRejectedValue(new Error('Synthetic dialog failure'));
    try {
      if (entry === 'default') {
        const command = runtime.commands.get('squad-pod.exportDefaultLayout');
        if (!command) { throw new Error('Export command not registered'); }
        command();
      } else {
        runtime.provider.handleWebviewMessage(entry === 'settings'
          ? { type: 'exportLayout' }
          : { type: 'exportLayoutSnapshot', layout });
      }
      await vi.waitFor(() => expect(runtime.vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining('Synthetic dialog failure'),
      ));
      expect(runtime.vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
      expect(runtime.vscode.window.showInformationMessage).not.toHaveBeenCalled();
    } finally {
      runtime.dispose();
    }
  });
});
