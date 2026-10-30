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

/** Bounded local read; legacy executable sources are inspected for presence only. */
export function readModelConfig(workspaceRoot: string, agentName: string): ModelConfigSource[] {
  const squadDir = resolveSquadDir(workspaceRoot);
  const sourcePath = path.join(squadDir, 'config.json');
  const sources: ModelConfigSource[] = [];
  let fd: number | undefined;
  try {
    const root = fs.realpathSync(workspaceRoot);
    const realSquad = fs.realpathSync(squadDir);
    if (!inside(root, realSquad)) {throw new Error('Squad directory escapes the selected workspace.');}
    const realFile = fs.realpathSync(sourcePath);
    if (!inside(realSquad, realFile)) {throw new Error('Configuration escapes the selected Squad directory.');}
    if (!fs.statSync(realFile).isFile()) {throw new Error('Configuration is not a regular file.');}
    fd = fs.openSync(realFile, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_MODEL_CONFIG_BYTES) {throw new Error('Configuration is not a regular file within the 64 KiB read limit.');}
    const buffer = Buffer.alloc(stat.size + 1);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const after = fs.fstatSync(fd);
    if (bytes !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      sources.push({ sourcePath, state: 'ambiguous', diagnostic: 'Configuration changed while reading; reopen to retry.', values: [] });
    } else {
      let content: string;
      try {content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));}
      catch {return [{ sourcePath, state: 'malformed', diagnostic: 'Configuration is not valid UTF-8.', values: [] }, ...legacySources(workspaceRoot, squadDir)];}
      sources.push(parseModelConfig(content, agentName, sourcePath));
    }
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    sources.push({ sourcePath, state: missing ? 'missing' : 'unreadable',
      diagnostic: missing ? 'No JSON configuration file.' : `Cannot read configuration: ${String(error)}`, values: [] });
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
