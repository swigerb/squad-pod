import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOBAL_KEY_DIRECTORIES } from './constants.js';
import type { SavedDirectory } from './directories.js';
import type { OutboundMessage, WebviewMessage } from './types.js';

interface ProviderUnderTest {
  addDirectory(path?: string, name?: string): Promise<void>;
  changeDirectoryPath(id: string): Promise<void>;
  updateDirectoryName(id: string, name: string): Promise<void>;
  removeDirectory(id: string): Promise<void>;
  handleWebviewMessage(message: WebviewMessage): void;
  view: { webview: { postMessage(message: OutboundMessage): Promise<boolean> } };
}

interface ProviderExports {
  SquadPodViewProvider: new (context: unknown) => ProviderUnderTest;
}

const providerCode = buildSync({
  entryPoints: [path.resolve('src', 'SquadPodViewProvider.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  write: false,
}).outputFiles[0].text;
const nodeRequire = createRequire(path.resolve('package.json'));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('compiled provider directory transactions with delayed VS Code dialogs', () => {
  let root: string;
  let first: SavedDirectory;
  let secondPath: string;
  let stored: SavedDirectory[];
  let provider: ProviderUnderTest;
  let picker: ReturnType<typeof deferred<Array<{ fsPath: string }>>>;
  let nameInput: ReturnType<typeof deferred<string>>;
  const showInputBox = vi.fn();
  const configurationGet = vi.fn(() => false);
  const workspace: {
    workspaceFolders: Array<{ name: string; uri: { fsPath: string; toString(): string } }>;
    getConfiguration(): { get(): boolean };
  } = {
    workspaceFolders: [],
    getConfiguration: () => ({ get: configurationGet }),
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-provider-directories-'));
    vi.stubEnv('COPILOT_HOME', path.join(root, 'synthetic-copilot-home'));
    configurationGet.mockReturnValue(false);
    const firstPath = path.join(root, 'First & (project)');
    secondPath = path.join(root, 'Second project');
    fs.mkdirSync(firstPath);
    fs.mkdirSync(secondPath);
    first = { id: 'first', name: 'First', path: fs.realpathSync.native(firstPath) };
    stored = [first];
    picker = deferred<Array<{ fsPath: string }>>();
    nameInput = deferred<string>();
    showInputBox.mockReset().mockResolvedValue('Second');
    workspace.workspaceFolders = [];
    const storage = {
      get<T>(key: string, fallback: T): T | SavedDirectory[] {
        return key === GLOBAL_KEY_DIRECTORIES ? structuredClone(stored) : fallback;
      },
      async update(key: string, value: SavedDirectory[]) {
        if (key !== GLOBAL_KEY_DIRECTORIES) { throw new Error(`Unexpected storage key: ${key}`); }
        stored = structuredClone(value);
      },
    };
    const vscode = {
      Uri: { file: (fsPath: string) => ({ fsPath }) },
      workspace,
      window: {
        showOpenDialog: () => picker.promise,
        showInputBox,
      },
    };
    const module: { exports: Partial<ProviderExports> } = { exports: {} };
    const require = (specifier: string): unknown => specifier === 'vscode' ? vscode : nodeRequire(specifier);
    new Function('require', 'module', 'exports', providerCode)(require, module, module.exports);
    if (!module.exports.SquadPodViewProvider) { throw new Error('Compiled provider export is missing.'); }
    provider = new module.exports.SquadPodViewProvider({ globalState: storage });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function addUntilNameInput() {
    showInputBox.mockReturnValue(nameInput.promise);
    const pending = provider.addDirectory();
    picker.resolve([{ fsPath: secondPath }]);
    await Promise.resolve();
    expect(showInputBox).toHaveBeenCalledOnce();
    return { pending };
  }

  it('does not resurrect a directory removed while the add picker is pending', async () => {
    const pending = provider.addDirectory();
    await provider.removeDirectory(first.id);
    picker.resolve([{ fsPath: secondPath }]);
    await pending;
    expect(stored).toEqual([expect.objectContaining({ name: 'Second', path: fs.realpathSync.native(secondPath) })]);
  });

  it('keeps additions and removals made while the add name dialog is pending', async () => {
    const { pending } = await addUntilNameInput();
    await provider.removeDirectory(first.id);
    const intervening = { ...first, id: 'other', name: 'Other' };
    stored = [intervening];
    nameInput.resolve('Second');
    await pending;
    expect(stored).toEqual([
      intervening,
      expect.objectContaining({ name: 'Second', path: fs.realpathSync.native(secondPath) }),
    ]);
  });

  it.each(['name', 'path', 'workspace', 'cap'] as const)(
    'revalidates the latest %s constraint after the add name dialog', async (constraint) => {
      const { pending } = await addUntilNameInput();
      if (constraint === 'name') {
        stored = [{ ...first, name: 'Second' }];
      } else if (constraint === 'path') {
        stored = [{ ...first, path: secondPath }];
      } else if (constraint === 'workspace') {
        workspace.workspaceFolders = [{
          name: 'Workspace Second',
          uri: { fsPath: secondPath, toString: () => `file:${secondPath}` },
        }];
      } else {
        stored = Array.from({ length: 100 }, (_, index) => ({
          ...first, id: `saved-${index}`, name: `Saved ${index}`,
        }));
      }
      const expected = structuredClone(stored);
      nameInput.resolve('Second');
      await expect(pending).rejects.toThrow(constraint === 'cap' ? 'At most 100' : 'already');
      expect(stored).toEqual(expected);
    },
  );

  it('preserves a rename made while the change-folder picker is pending', async () => {
    const pending = provider.changeDirectoryPath(first.id);
    await provider.updateDirectoryName(first.id, 'Renamed while choosing folder');
    picker.resolve([{ fsPath: secondPath }]);
    await pending;
    expect(stored).toEqual([{
      ...first, name: 'Renamed while choosing folder', path: fs.realpathSync.native(secondPath),
    }]);
  });

  it('rejects a folder change when its directory was removed during the picker', async () => {
    const pending = provider.changeDirectoryPath(first.id);
    await provider.removeDirectory(first.id);
    picker.resolve([{ fsPath: secondPath }]);
    await expect(pending).rejects.toThrow('no longer exists');
    expect(stored).toEqual([]);
  });

  it.each(['saved', 'workspace'] as const)('rejects a new %s duplicate after the change-folder picker', async (source) => {
    const pending = provider.changeDirectoryPath(first.id);
    if (source === 'saved') {
      stored = [first, { id: 'other', name: 'Other', path: secondPath }];
    } else {
      workspace.workspaceFolders = [{
        name: 'Workspace Second',
        uri: { fsPath: secondPath, toString: () => `file:${secondPath}` },
      }];
    }
    const expected = structuredClone(stored);
    picker.resolve([{ fsPath: secondPath }]);
    await expect(pending).rejects.toThrow('already');
    expect(stored).toEqual(expected);
  });

  it('only reads synthetic cwd metadata into outbound catalogs, and honors the setting', async () => {
    const home = path.join(root, 'synthetic-copilot-home');
    const dir = path.join(home, 'session-state', 'fixture');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(secondPath, '.squad'));
    fs.writeFileSync(path.join(secondPath, '.squad', 'team.md'), 'Synthetic roster');
    fs.writeFileSync(path.join(dir, 'workspace.yaml'),
      `cwd: ${JSON.stringify(secondPath)}\nsecret: OUTBOUND_SENTINEL_SECRET\nnested:\n  cwd: secret-path\n`);
    fs.mkdirSync(path.join(dir, 'events.jsonl'));
    const messages: OutboundMessage[] = [];
    provider.view = { webview: { postMessage: async (message) => { messages.push(message); return true; } } };
    configurationGet.mockReturnValue(true);
    provider.handleWebviewMessage({ type: 'getDirectories' });
    await vi.waitFor(() => {
      expect(messages.some((message) => message.type === 'directoryCatalog' && message.catalog.squadHistory.length === 1)).toBe(true);
    });
    const last = messages.at(-1);
    expect(last).toMatchObject({
      type: 'directoryCatalog',
      catalog: { squadHistory: [{ name: path.basename(secondPath), path: fs.realpathSync.native(secondPath) }] },
    });
    expect(JSON.stringify(messages)).not.toContain('OUTBOUND_SENTINEL_SECRET');
    expect(JSON.stringify(messages)).not.toContain('secret-path');

    configurationGet.mockReturnValue(false);
    messages.length = 0;
    provider.handleWebviewMessage({ type: 'getDirectories' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: 'directoryCatalog', catalog: { squadHistory: [] } });
  });

  it('saves a filled form only on an explicit add message, preserving host validation', async () => {
    expect(stored).toEqual([first]);
    await provider.addDirectory(secondPath, 'Suggested folder');
    expect(showInputBox).not.toHaveBeenCalled();
    expect(stored).toEqual([first, expect.objectContaining({
      name: 'Suggested folder', path: fs.realpathSync.native(secondPath),
    })]);
    await expect(provider.addDirectory(secondPath, 'Duplicate')).resolves.toBeUndefined();
    expect(stored).toHaveLength(2);
    await expect(provider.addDirectory('relative', 'Invalid')).rejects.toThrow('absolute path');
    await expect(provider.addDirectory(root, 'First')).rejects.toThrow('already exists');
  });
});
