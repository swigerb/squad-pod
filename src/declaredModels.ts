import * as path from 'path';
import { ProjectFiles, projectFileDiagnostic } from './projectFiles.js';
import { selectTeamSourceDirectory } from './teamSource.js';

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

function modelDirectory(files: ProjectFiles): { directory: '.squad' | '.ai-team'; fingerprint: string } {
  const directory = selectTeamSourceDirectory(files);
  const preferred = files.inspect('.squad');
  const selected = directory === '.squad' ? preferred : files.inspect(directory);
  if ((directory === '.ai-team' && preferred.status !== 'missing')
    || selected.status === 'unreadable'
    || (selected.status === 'present' && selected.kind !== 'directory')) {
    throw new Error('Selected model directory changed or is unavailable.');
  }
  return { directory, fingerprint: `${preferred.fingerprint}||${selected.fingerprint}` };
}

function readJsonConfig(files: ProjectFiles, relative: string, agentName: string, sourcePath: string): ModelConfigSource {
  const result = (state: ModelReadState, diagnostic: string): ModelConfigSource =>
    ({ sourcePath, state, diagnostic, values: [] });
  const before = files.inspect(relative);
  if (before.status !== 'present') {
    return result(before.status, before.status === 'missing' ? 'No JSON configuration file.' : before.reason);
  }
  if (before.kind !== 'file' || before.size > BigInt(MAX_MODEL_CONFIG_BYTES)) {
    return result('unreadable', 'Configuration is not a regular file within the 64 KiB read limit.');
  }
  try {
    const content = files.read(relative, MAX_MODEL_CONFIG_BYTES);
    if (content === null || files.inspect(relative).fingerprint !== before.fingerprint) {
      return result('ambiguous', 'Configuration changed while reading; reopen to retry.');
    }
    return parseModelConfig(content, agentName, sourcePath);
  } catch (error) {
    const diagnostic = projectFileDiagnostic(error);
    if (files.inspect(relative).fingerprint !== before.fingerprint || /changed/i.test(diagnostic)) {
      return result('ambiguous', diagnostic);
    }
    return result((error as NodeJS.ErrnoException | null)?.code === 'ERR_ENCODING_INVALID_ENCODED_DATA'
      ? 'malformed' : 'unreadable', diagnostic);
  }
}

function inspectExecutable(files: ProjectFiles, relative: string, sourcePath: string): ModelConfigSource {
  const inspected = files.inspect(relative);
  let state: ModelReadState;
  let diagnostic: string;
  if (inspected.status !== 'present') {
    state = inspected.status;
    diagnostic = inspected.status === 'missing' ? 'No executable/legacy configuration at this path.' : inspected.reason;
  } else if (inspected.kind !== 'file') {
    state = 'unreadable';
    diagnostic = 'Executable/legacy configuration is not a regular file.';
  } else {
    state = 'unsupported';
    diagnostic = 'Executable/legacy configuration is present; not imported, executed or resolved.';
  }
  if (files.inspect(relative).fingerprint !== inspected.fingerprint) {
    state = 'ambiguous';
    diagnostic = 'Executable/legacy configuration changed while inspecting; reopen to retry.';
  }
  return { sourcePath, state, diagnostic, values: [] };
}

/**
 * Observe declarations in an explicitly host-selected project, without granting
 * root/session authority. Shared guards enforce bounded strict UTF-8 JSON reads;
 * executable sources receive metadata inspection only, never content reads.
 */
export function readModelConfig(workspaceRoot: string, agentName: string): ModelConfigSource[] {
  let directory: '.squad' | '.ai-team' = '.squad';
  // Invalid relative input is a label only, never authority relative to cwd.
  const sourcePath = (relative: string): string => path.isAbsolute(workspaceRoot)
    ? path.join(workspaceRoot, relative) : relative.split(path.sep).join('/');
  const paths = (): string[] => [
    path.join(directory, 'config.json'), 'squad.config.ts', path.join(directory, 'squad.config.ts'),
  ];
  let files: ProjectFiles;
  let before: ReturnType<typeof modelDirectory>;
  try {
    files = new ProjectFiles(workspaceRoot);
    before = modelDirectory(files);
    directory = before.directory;
  } catch (error) {
    return paths().map(relative => ({ sourcePath: sourcePath(relative), state: 'unreadable',
      diagnostic: projectFileDiagnostic(error), values: [] }));
  }
  const relativePaths = paths();
  const sources = [
    readJsonConfig(files, relativePaths[0], agentName, sourcePath(relativePaths[0])),
    ...relativePaths.slice(1).map(relative => inspectExecutable(files, relative, sourcePath(relative))),
  ];
  try {
    const after = modelDirectory(files);
    if (before.directory === after.directory && before.fingerprint === after.fingerprint) {
      return sources;
    }
  } catch (error) {
    return sources.map(source => ({ ...source, state: 'ambiguous',
      diagnostic: `Selected model source changed or became unavailable; reopen to retry. ${projectFileDiagnostic(error)}`, values: [] }));
  }
  return sources.map(source => ({ ...source, state: 'ambiguous',
    diagnostic: 'Selected model source changed while observing declarations; reopen to retry.', values: [] }));
}
