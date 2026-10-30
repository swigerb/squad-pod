import { randomBytes } from 'node:crypto';
import { accessSync, closeSync, constants, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { authorizeTerminal, runId, type RunId, type TerminalCommand } from '../../src/core/terminalFrames.js';
import { TerminalHistory } from '../../src/core/terminalReplay.js';
import type { OwnedRun } from '../../src/core/ownedTerminalProtocol.js';
import { launchOwnedPty } from './ownedPtyProcess.js';
import { fileURLToPath } from 'node:url';

export const ENVIRONMENT_KEYS = [
  'PATH', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
] as const;

export function terminalEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ENVIRONMENT_KEYS) {
    const actual = Object.keys(source).find(candidate => process.platform === 'win32'
      ? candidate.toLowerCase() === key.toLowerCase() : candidate === key);
    if (actual && source[actual] !== undefined) result[key] = source[actual]!;
  }
  result.TERM = 'xterm-256color';
  result.COLORTERM = 'truecolor';
  return result;
}

export interface LaunchSpec { file: string; args: string[] }

/** Search only absolute PATH entries, never cwd, PATHEXT, a shell, or a .cmd shim. */
export function resolveCopilot(env: Record<string, string>): LaunchSpec {
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, process.platform === 'win32' ? 'copilot.exe' : 'copilot');
    let file: string;
    try {
      file = realpathSync(candidate);
      if (!statSync(file).isFile()) continue;
      accessSync(file, process.platform === 'win32' ? constants.R_OK : constants.X_OK);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
      throw error;
    }
    const fd = openSync(file, 'r');
    const bytes = Buffer.alloc(256);
    try { readSync(fd, bytes, 0, bytes.length, 0); }
    finally { closeSync(fd); }
    if (process.platform === 'win32') {
      if (path.extname(file).toLowerCase() !== '.exe' || bytes.toString('ascii', 0, 2) !== 'MZ') continue;
    } else if (bytes.toString('ascii', 0, 2) === '#!') {
      const interpreter = bytes.toString('utf8').split('\n')[0].trim();
      if (!['#!/usr/bin/env node', '#!/usr/bin/node'].includes(interpreter)) continue;
      return { file: realpathSync(process.execPath), args: [file, '--agent', 'squad'] };
    } else {
      // execvp may implicitly invoke /bin/sh for ENOEXEC text files. Admit only
      // native ELF/Mach-O headers or the explicit Node entry point above.
      const magic = bytes.readUInt32BE(0);
      if (![0x7f454c46, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
        0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) continue;
    }
    return { file, args: ['--agent', 'squad'] };
  }
  throw new Error('No supported shell-free Copilot executable on absolute PATH entries. Install the official executable (Windows: copilot.exe); .cmd and shell wrappers are not supported.');
}

interface Entry {
  info: OwnedRun;
  history: TerminalHistory;
  pty: Awaited<ReturnType<typeof launchOwnedPty>>;
  identity: { kind: 'owned'; runId: RunId };
  inputBytes: number;
}

export interface OwnedRunsOptions {
  project: string;
  enabled: boolean;
  /** CLI-only, fixed synthetic profile. Never populated from network data. */
  fixture?: string;
  broker?: string;
}

export class OwnedRuns {
  private readonly root: string;
  private readonly rootIdentity: { dev: number; ino: number };
  private readonly entries = new Map<RunId, Entry>();
  private readonly listeners = new Set<() => void>();
  private launching = false;
  private launchCompletion: Promise<void> = Promise.resolve();
  private disposed = false;
  private disposal?: Promise<void>;
  readonly reason: string | null;
  readonly available: boolean;

  constructor(private readonly options: OwnedRunsOptions) {
    this.root = realpathSync(options.project);
    const stat = statSync(this.root);
    if (!path.isAbsolute(options.project) || !stat.isDirectory()) throw new Error('Selected project must be an absolute directory.');
    this.rootIdentity = { dev: stat.dev, ino: stat.ino };
    let reason: string | null = options.enabled ? null : 'Terminals disabled. Restart with --terminals to enable separate owned-terminal authority.';
    if (options.enabled) {
      try {
        createRequire(import.meta.url)('node-pty');
        if (!options.fixture) resolveCopilot(terminalEnvironment(process.env));
      } catch (error) {
        reason = `Owned terminals unavailable: ${String(error)}`;
      }
    }
    this.reason = reason?.slice(0, 1024) ?? null;
    this.available = reason === null;
  }

  status() {
    return { version: 1 as const, type: 'runs' as const, available: this.available && !this.disposed,
      reason: this.disposed ? 'Server stopped.' : this.reason,
      runs: [...this.entries.values()].map(entry => ({ ...entry.info })) };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed() { for (const listener of this.listeners) listener(); }

  async launch(authorized: () => boolean = () => true): Promise<OwnedRun> {
    if (this.disposed || !this.available) throw new Error(this.reason ?? 'Owned runtime stopped.');
    if (this.launching) throw new Error('Owned native launch in progress; launch was not queued.');
    if (this.entries.size >= 8) throw new Error('Owned run limit reached (8). Explicitly close an old run first.');
    // Revalidate the canonical directory and its identity immediately before native spawn.
    const current = realpathSync(this.options.project);
    const stat = statSync(current);
    const differentDevice = stat.dev !== this.rootIdentity.dev && !(process.platform === 'win32' && this.rootIdentity.dev === 0);
    if (current !== this.root || !stat.isDirectory() || differentDevice || stat.ino !== this.rootIdentity.ino) {
      throw new Error('Selected project changed since server startup; restart and select the intended project.');
    }
    const env = terminalEnvironment(process.env);
    const launch = this.options.fixture
      ? { file: realpathSync(process.execPath), args: [this.options.fixture, 'argument with spaces', 'literal"quote', 'trailing\\'] }
      : resolveCopilot(env);
    const id = runId(randomBytes(24).toString('base64url'));
    const info: OwnedRun = { runId: id, pid: 0, state: 'running', exitCode: null };
    const history = new TerminalHistory(id);
    // node-pty streaming-decodes UTF-8. Retain a possible split surrogate until the next event.
    let trailing = '';
    let sourceFailed = false;
    const append = (data: string) => {
      let chunk = '';
      let length = 0;
      for (const character of data) {
        // JSON escaping can cost six bytes per UTF-16 code unit. 8 KiB keeps frames <64 KiB.
        if (length + character.length > 8192) { history.append(chunk); chunk = ''; length = 0; }
        chunk += character;
        length += character.length;
      }
      if (chunk) history.append(chunk);
    };
    const onData = (data: string) => {
      if (sourceFailed) return;
      let text = trailing + data;
      trailing = '';
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) { trailing = text.slice(-1); text = text.slice(0, -1); }
      if (text) append(text);
    };
    const onExit = (code: number) => {
      if (trailing && !sourceFailed) { append('\ufffd'); trailing = ''; }
      info.state = 'exited';
      info.exitCode = code;
      this.changed();
    };
    this.launching = true;
    let completed!: () => void;
    this.launchCompletion = new Promise<void>(resolve => { completed = resolve; });
    try {
      const broker = this.options.broker ?? fileURLToPath(new URL('./ptyHost.mjs', import.meta.url));
      const pty = await launchOwnedPty(broker, launch, current, env,
        () => !this.disposed && authorized(), onData, onExit, () => {
          sourceFailed = true;
          history.fail();
        }, this.rootIdentity);
      info.pid = pty.pid;
      this.entries.set(id, { info, history, pty, identity: { kind: 'owned', runId: id },
        inputBytes: 0 });
      this.changed();
      return { ...info };
    } finally { this.launching = false; completed(); }
  }

  source(id: RunId): TerminalHistory {
    const entry = this.entries.get(id);
    if (!entry || this.disposed) throw new Error('Unknown owned run. Roster/observed identities have no terminal authority.');
    return entry.history;
  }

  command(command: TerminalCommand) {
    const entry = this.entries.get(command.runId);
    if (!entry || this.disposed) throw new Error('Unknown owned run.');
    authorizeTerminal(entry.identity, command);
    if (command.type === 'attach') return;
    if (command.type === 'terminate') throw new Error('Use close for asynchronous owned cleanup.');
    if (entry.info.state !== 'running') throw new Error('Owned run has exited.');
    if (command.type === 'input') {
      const bytes = Buffer.byteLength(command.data);
      if (entry.inputBytes + bytes > 1024 * 1024) throw new Error('Outstanding owned input budget exceeded (1 MiB); input was not queued.');
      entry.inputBytes += bytes;
      return entry.pty.action({ type: 'input', data: command.data }).finally(() => { entry.inputBytes -= bytes; });
    }
    else return entry.pty.action({ type: 'resize', cols: command.cols, rows: command.rows });
  }

  async close(id: RunId): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Unknown owned run.');
    if (entry.info.state === 'running') {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([entry.pty.kill(), new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Owned PTY cleanup timed out; run remains registered.')), 8000);
        })]);
      } finally { clearTimeout(timeout); }
    }
    await entry.pty.exited;
    this.entries.delete(id);
    this.changed();
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.disposal = this.launchCompletion.then(() => Promise.all([...this.entries.keys()].map(id => this.close(id))))
      .then(() => { this.listeners.clear(); });
    return this.disposal;
  }
}
