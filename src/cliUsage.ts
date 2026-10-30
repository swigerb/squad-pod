import * as fs from 'fs';
import * as path from 'path';

export const MAX_CLI_USAGE_BYTES = 2 * 1024 * 1024;
export const MAX_CLI_USAGE_MODELS = 128;
export const MAX_CLI_USAGE_ROWS = 40;

export interface CliModelUsage {
  model: string;
  requests: number;
  premiumRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number | null;
  nanoAiu: number | null;
}

export interface CliUsageSnapshot {
  state: 'unselected' | 'ready' | 'error';
  sourcePath: string | null;
  canRefresh: boolean;
  checkedAt: string;
  diagnostic: string | null;
  report: {
    sessionStartTime: string;
    userRequests: number;
    premiumRequests: number;
    apiDurationMs: number;
    nanoAiu: number | null;
    modelCount: number;
    models: CliModelUsage[];
  } | null;
}

export function emptyCliUsage(): CliUsageSnapshot {
  return { state: 'unselected', sourcePath: null, canRefresh: false, checkedAt: new Date().toISOString(), diagnostic: null, report: null };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {throw new Error('Expected a metrics object.');}
  return value as Record<string, unknown>;
}

function quantity(value: unknown, counter = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
    || value > Number.MAX_SAFE_INTEGER || (counter && !Number.isSafeInteger(value))) {
    throw new Error('Invalid or unsafe numeric metric.');
  }
  return value;
}

function optionalQuantity(value: Record<string, unknown>, key: string, counter = false): number | null {
  return Object.hasOwn(value, key) ? quantity(value[key], counter) : null;
}

function boundDocument(value: unknown, depth = 0, budget = { entries: 0 }): void {
  if (depth > 8) {throw new Error('Metrics document exceeds depth 8.');}
  if (value && typeof value === 'object') {
    if (Object.keys(value).length > 1000) {throw new Error('Metrics object exceeds 1,000 entries.');}
    for (const child of Object.values(value)) {
      if (++budget.entries > 10_000) {throw new Error('Metrics document exceeds 10,000 fields/entries.');}
      boundDocument(child, depth + 1, budget);
    }
  }
}

function rejectDuplicateKeys(content: string): void {
  const scopes: Array<Set<string> | null> = [];
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '{') {scopes.push(new Set());}
    else if (c === '[') {scopes.push(null);}
    else if (c === '}' || c === ']') {scopes.pop();}
    else if (c === '"') {
      const start = i++;
      for (; i < content.length && content[i] !== '"'; i++) {
        if (content[i] === '\\') {i++;}
      }
      let next = i + 1;
      while (/\s/.test(content[next] ?? '') && next < content.length) {next++;}
      if (content[next] === ':') {
        const key: string = JSON.parse(content.slice(start, i + 1));
        const keys = scopes.at(-1);
        if (keys?.has(key)) {throw new Error('Duplicate JSON object keys are unsupported.');}
        keys?.add(key);
      }
    }
  }
}

/**
 * Projection of CLI 1.0.105 UsageGetMetricsResult, not a ledger or stdout result.
 * The native accumulator's overlap/completeness semantics are not established.
 */
export function parseCliUsage(content: string): CliUsageSnapshot {
  const snapshot = emptyCliUsage();
  try {
    if (Buffer.byteLength(content, 'utf8') > MAX_CLI_USAGE_BYTES) {throw new Error('Metrics file exceeds 2 MiB.');}
    const raw: unknown = JSON.parse(content);
    rejectDuplicateKeys(content);
    boundDocument(raw);
    const r = object(raw);
    if (Object.hasOwn(r, 'version') || Object.hasOwn(r, 'schemaVersion')) {
      throw new Error('Versioned metrics envelopes are unsupported.');
    }
    if (typeof r.sessionStartTime !== 'string' || r.sessionStartTime.length > 64
      || !/^\d{4}-\d\d-\d\dT/.test(r.sessionStartTime) || !Number.isFinite(Date.parse(r.sessionStartTime))) {
      throw new Error('Missing or invalid sessionStartTime.');
    }
    // Validate the required producer shape without retaining code-change paths.
    const changes = object(r.codeChanges);
    if (!Array.isArray(changes.filesModified) || changes.filesModified.length > 1000
      || !changes.filesModified.every(v => typeof v === 'string' && v.length <= 4096)) {
      throw new Error('Invalid codeChanges shape.');
    }
    for (const key of ['filesModifiedCount', 'linesAdded', 'linesRemoved']) {quantity(changes[key], true);}
    quantity(r.lastCallInputTokens, true);
    quantity(r.lastCallOutputTokens, true);
    const metrics = object(r.modelMetrics);
    const keys = Object.keys(metrics);
    if (keys.length > MAX_CLI_USAGE_MODELS) {throw new Error('Metrics exceed 128 model entries.');}
    const models = keys.map(model => {
      if (!model.trim() || model.length > 128 || /[\u0000-\u001f\u007f]/.test(model)) {
        throw new Error('Invalid model identifier.');
      }
      const m = object(metrics[model]);
      const requests = object(m.requests);
      const usage = object(m.usage);
      return {
        model, requests: quantity(requests.count, true), premiumRequests: quantity(requests.cost),
        inputTokens: quantity(usage.inputTokens, true), outputTokens: quantity(usage.outputTokens, true),
        cacheReadTokens: quantity(usage.cacheReadTokens, true), cacheWriteTokens: quantity(usage.cacheWriteTokens, true),
        reasoningTokens: optionalQuantity(usage, 'reasoningTokens', true),
        nanoAiu: optionalQuantity(m, 'totalNanoAiu'),
      };
    });
    return {
      ...snapshot, state: 'ready',
      report: {
        sessionStartTime: r.sessionStartTime,
        userRequests: quantity(r.totalUserRequests, true),
        premiumRequests: quantity(r.totalPremiumRequestCost),
        apiDurationMs: quantity(r.totalApiDurationMs),
        nanoAiu: optionalQuantity(r, 'totalNanoAiu'), modelCount: models.length,
        models: models.slice(0, MAX_CLI_USAGE_ROWS),
      },
    };
  } catch (error) {
    return { ...snapshot, state: 'error', diagnostic: `Cannot import CLI usage: ${error instanceof SyntaxError ? 'Invalid JSON document.' : String(error)}` };
  }
}

interface Identity { dev: number; ino: number; birthtimeMs: number }
interface Selection { root: string; rootIdentity: Identity; file: string; identity: Identity }

function identity(stat: fs.Stats): Identity {
  return { dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs };
}

function sameIdentity(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;
}

function selectedFile(root: string, file: string): string {
  const absoluteRoot = path.resolve(root);
  const absoluteFile = path.resolve(file);
  const relative = path.relative(absoluteRoot, absoluteFile);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)
    || relative.includes(':') || path.extname(absoluteFile).toLowerCase() !== '.json') {
    throw new Error('Select one JSON file inside the selected workspace.');
  }
  // Reject symlink/junction components, including a linked workspace root.
  let current = path.parse(absoluteFile).root;
  for (const part of absoluteFile.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) {throw new Error('Linked paths are not supported. Copy a sanitized export into the workspace.');}
  }
  if (fs.realpathSync(absoluteRoot) !== absoluteRoot || fs.realpathSync(absoluteFile) !== absoluteFile) {
    throw new Error('Path identity changed; select the canonical workspace file again.');
  }
  return absoluteFile;
}

/** In-memory consent only. One selection replaces the prior report; refresh never accumulates. */
export class CliUsageImport {
  private selection: Selection | undefined;
  snapshot = emptyCliUsage();

  clear(): CliUsageSnapshot {
    this.selection = undefined;
    return this.snapshot = emptyCliUsage();
  }

  select(root: string, file: string): CliUsageSnapshot {
    this.clear();
    try {
      const selected = selectedFile(root, file);
      const stat = fs.lstatSync(selected);
      if (!stat.isFile() || stat.nlink !== 1) {throw new Error('Select a regular, non-hardlinked JSON file.');}
      this.selection = { root: path.resolve(root), rootIdentity: identity(fs.statSync(root)), file: selected, identity: identity(stat) };
      return this.refresh(root);
    } catch (error) {
      return this.fail(error);
    }
  }

  refresh(root: string | undefined): CliUsageSnapshot {
    const selection = this.selection;
    if (!selection || !root || path.resolve(root) !== selection.root) {return this.clear();}
    let fd: number | undefined;
    try {
      selectedFile(root, selection.file);
      if (!sameIdentity(identity(fs.statSync(root)), selection.rootIdentity)) {
        throw new Error('Workspace identity changed; select the file again.');
      }
      fd = fs.openSync(selection.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || !sameIdentity(identity(before), selection.identity)) {
        throw new Error('Selected file identity changed; select it again to consent.');
      }
      if (before.size > MAX_CLI_USAGE_BYTES) {throw new Error('Metrics file exceeds 2 MiB.');}
      const buffer = Buffer.alloc(before.size + 1);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const after = fs.fstatSync(fd);
      const live = fs.lstatSync(selection.file);
      selectedFile(root, selection.file);
      if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs
        || before.ctimeMs !== after.ctimeMs || live.size !== after.size || live.mtimeMs !== after.mtimeMs
        || after.nlink !== 1 || live.nlink !== 1 || !live.isFile()
        || !sameIdentity(identity(live), selection.identity)
        || !sameIdentity(identity(fs.statSync(root)), selection.rootIdentity)) {
        throw new Error('Metrics changed while reading; retry manually.');
      }
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
      return this.snapshot = { ...parseCliUsage(content), sourcePath: selection.file, canRefresh: true };
    } catch (error) {
      return this.fail(error, selection.file);
    } finally {
      if (fd !== undefined) {fs.closeSync(fd);}
    }
  }

  private fail(error: unknown, sourcePath: string | null = null): CliUsageSnapshot {
    this.selection = undefined;
    return this.snapshot = {
      ...emptyCliUsage(), state: 'error', sourcePath,
      diagnostic: `Cannot read CLI usage: ${String(error)} Select the file again to retry.`,
    };
  }
}
