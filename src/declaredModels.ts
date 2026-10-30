import * as fs from 'fs';
import * as path from 'path';
import { resolveSquadDir } from './squadPaths.js';

export const MAX_MODEL_CONFIG_BYTES = 64 * 1024;
export type ModelReadState = 'ready' | 'missing' | 'malformed' | 'unreadable' | 'ambiguous' | 'unsupported';
export interface DeclaredModelValue {
  key: string;
  value: string;
}
export interface ModelConfigSource {
  sourcePath: string;
  state: ModelReadState;
  diagnostic: string;
  values: DeclaredModelValue[];
}

export function parseCharterModel(content: string, sourcePath: string): ModelConfigSource {
  const result = (state: ModelReadState, diagnostic: string, values: DeclaredModelValue[] = []): ModelConfigSource =>
    ({ sourcePath, state, diagnostic, values });
  if (Buffer.byteLength(content, 'utf8') > MAX_MODEL_CONFIG_BYTES) {
    return result('unreadable', 'Charter exceeds the 64 KiB read limit.');
  }
  let fence: string | undefined;
  const lines = content.split(/\r?\n/).filter(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) {fence = marker;}
      else if (marker[0] === fence[0] && marker.length >= fence.length) {fence = undefined;}
      return false;
    }
    return !fence;
  });
  const sections = lines.flatMap((line, index) => /^##\s+Model\s*$/i.test(line) ? [index] : []);
  if (!sections.length) {return result('missing', 'No declared ## Model section.');}
  if (sections.length > 1) {return result('ambiguous', 'Multiple Model sections; declarations withheld.');}
  const section = lines.slice(sections[0] + 1);
  const end = section.findIndex(line => /^#{1,2}\s/.test(line));
  const fields = (end < 0 ? section : section.slice(0, end)).flatMap(line => {
    const field = /^\s*(?:[-*]\s+)?\*\*(Preferred|Rationale|Fallback):\*\*\s*(.*)$/i.exec(line);
    return field ? [{ key: field[1][0].toUpperCase() + field[1].slice(1).toLowerCase(), value: field[2].trim() }] : [];
  });
  if (new Set(fields.map(field => field.key)).size !== fields.length) {
    return result('ambiguous', 'Repeated Model fields; declarations withheld.');
  }
  if (fields.some(field => !field.value || field.value.length > 4096 || /[\u0000-\u001f\u007f]/.test(field.value))) {
    return result('malformed', 'Model fields must be non-empty text of at most 4,096 characters.');
  }
  const missing = ['Preferred', 'Rationale', 'Fallback'].filter(key => !fields.some(field => field.key === key));
  return result('ready', missing.length ? `Not declared: ${missing.join(', ')}.` : 'Declared charter fields only.', fields);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function model(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(value);
}

// JSON.parse accepts duplicate keys; do not silently select the last declaration.
function duplicateKeys(content: string): boolean {
  const stack: Array<Set<string> | null> = [];
  const tokens = content.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]]/g);
  for (const token of tokens) {
    const text = token[0];
    if (text === '{') {stack.push(new Set());}
    else if (text === '[') {stack.push(null);}
    else if (text === '}' || text === ']') {stack.pop();}
    else if (content.slice(token.index + text.length).trimStart().startsWith(':')) {
      const key: string = JSON.parse(text);
      const keys = stack.at(-1);
      if (keys?.has(key)) {return true;}
      keys?.add(key);
    }
  }
  return false;
}

/** Report only exact agent-name keys, never resolve precedence or a runtime model. */
export function parseModelConfig(content: string, agentName: string, sourcePath: string): ModelConfigSource {
  const result = (state: ModelReadState, diagnostic: string, values: DeclaredModelValue[] = []): ModelConfigSource =>
    ({ sourcePath, state, diagnostic, values });
  if (Buffer.byteLength(content, 'utf8') > MAX_MODEL_CONFIG_BYTES) {
    return result('unreadable', 'Configuration exceeds the 64 KiB read limit.');
  }
  let config: unknown;
  try {config = JSON.parse(content);}
  catch {return result('malformed', 'Configuration is not valid JSON.');}
  if (!object(config)) {return result('malformed', 'Configuration must be a JSON object.');}
  if (duplicateKeys(content)) {return result('ambiguous', 'Duplicate JSON keys; declared preferences withheld.');}
  const values: DeclaredModelValue[] = [];
  if (Object.hasOwn(config, 'defaultModel')) {
    if (!model(config.defaultModel)) {return result('malformed', 'defaultModel must be a non-empty model string (at most 256 characters).');}
    values.push({ key: 'defaultModel', value: config.defaultModel });
  }
  if (Object.hasOwn(config, 'agentModelOverrides')) {
    if (!object(config.agentModelOverrides) || Object.values(config.agentModelOverrides).some(value => !model(value))) {
      return result('malformed', 'agentModelOverrides must be an object of non-empty model strings (at most 256 characters).');
    }
    if (Object.hasOwn(config.agentModelOverrides, agentName)) {
      const value = config.agentModelOverrides[agentName];
      if (model(value)) {values.push({ key: `agentModelOverrides[${JSON.stringify(agentName)}]`, value });}
    }
  }
  return result('ready', values.length ? 'Declared preferences only; runtime selection is not known.' : 'No supported preferences declared for this exact agent name.', values);
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function guardedPath(root: string, squadDir: string): string {
  const candidate = path.join(root, path.basename(squadDir), 'config.json');
  for (const entry of [path.dirname(candidate), candidate]) {
    if (fs.lstatSync(entry).isSymbolicLink() || fs.realpathSync(entry) !== entry) {
      throw new Error('Configuration symlinks/junctions are not observed.');
    }
  }
  return candidate;
}

function sameFile(before: fs.BigIntStats, after: fs.BigIntStats): boolean {
  // Windows lstat can report dev=0 before the file has been opened.
  return before.ino === after.ino && (before.dev === after.dev || (process.platform === 'win32' && before.dev === 0n));
}

/** Bounded local read; legacy executable sources are inspected for presence only. */
export function readModelConfig(workspaceRoot: string, agentName: string): ModelConfigSource[] {
  const squadDir = resolveSquadDir(workspaceRoot);
  const sourcePath = path.join(squadDir, 'config.json');
  const sources: ModelConfigSource[] = [];
  let fd: number | undefined;
  let reading = false;
  try {
    const root = fs.realpathSync(workspaceRoot);
    const realFile = guardedPath(root, squadDir);
    const before = fs.lstatSync(realFile, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_MODEL_CONFIG_BYTES)) {throw new Error('Configuration is not a regular file within the 64 KiB read limit.');}
    fd = fs.openSync(realFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    reading = true;
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!sameFile(before, stat) || !stat.isFile() || stat.size > BigInt(MAX_MODEL_CONFIG_BYTES)) {
      throw new Error('Configuration changed while opening; reopen to retry.');
    }
    const buffer = Buffer.alloc(Number(stat.size) + 1);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const after = fs.fstatSync(fd, { bigint: true });
    if (fs.realpathSync(workspaceRoot) !== root || guardedPath(root, squadDir) !== realFile
      || !sameFile(fs.lstatSync(realFile, { bigint: true }), stat)
      || BigInt(bytes) !== stat.size || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) {
      sources.push({ sourcePath, state: 'ambiguous', diagnostic: 'Configuration changed while reading; reopen to retry.', values: [] });
    } else {
      let content: string;
      try {content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));}
      catch {return [{ sourcePath, state: 'malformed', diagnostic: 'Configuration is not valid UTF-8.', values: [] }, ...legacySources(workspaceRoot, squadDir)];}
      sources.push(parseModelConfig(content, agentName, sourcePath));
    }
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    sources.push({ sourcePath, state: reading ? 'ambiguous' : missing ? 'missing' : 'unreadable',
      diagnostic: reading ? `Configuration changed or became unreadable; reopen to retry: ${String(error)}`
        : missing ? 'No JSON configuration file.' : `Cannot read configuration: ${String(error)}`, values: [] });
  } finally {
    if (fd !== undefined) {fs.closeSync(fd);}
  }
  return [...sources, ...legacySources(workspaceRoot, squadDir)];
}

function legacySources(workspaceRoot: string, squadDir: string): ModelConfigSource[] {
  return [path.join(workspaceRoot, 'squad.config.ts'), path.join(squadDir, 'squad.config.ts')].map(sourcePath => {
    try {
      if (path.dirname(sourcePath) === squadDir && !inside(fs.realpathSync(workspaceRoot), fs.realpathSync(squadDir))) {
        throw new Error('Legacy configuration path escapes the selected workspace.');
      }
      fs.lstatSync(sourcePath);
      return { sourcePath, state: 'unsupported', diagnostic: 'Executable/legacy configuration is present; not imported, executed or resolved.', values: [] };
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      return { sourcePath, state: missing ? 'missing' : 'unreadable',
        diagnostic: missing ? 'No executable/legacy configuration at this path.' : `Cannot inspect legacy configuration: ${String(error)}`, values: [] };
    }
  });
}
