import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncBuiltinESMExports } from 'module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_MODEL_CONFIG_BYTES, parseModelConfig, readModelConfig } from './declaredModels.js';

const sourcePath = '.squad/config.json';
const parse = (content: string, name = 'Ada') => parseModelConfig(content, name, sourcePath);
const roots: string[] = [];
function fixture(config?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-models-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.squad'));
  if (config !== undefined) {fs.writeFileSync(path.join(root, '.squad', 'config.json'), config);}
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) {fs.rmSync(root, { recursive: true, force: true });}
});

describe('declared JSON model metadata', () => {
  it('keeps auto, conflicting preferences and exact key provenance separate without resolution', () => {
    expect(parse('{"defaultModel":"auto","agentModelOverrides":{"Ada":"explicit-model","ada":"other-model"}}')).toEqual({
      sourcePath, state: 'ready', diagnostic: expect.stringContaining('runtime selection is not known'),
      values: [{ key: 'defaultModel', value: 'auto' }, { key: 'agentModelOverrides["Ada"]', value: 'explicit-model' }],
    });
    expect(parse('{"agentModelOverrides":{"ada":"other-model","Ada Lovelace":"another-model"}}').values).toEqual([]);
    expect(parse('{"agentModelOverrides":{"__proto__":"auto"}}', '__proto__').values)
      .toEqual([{ key: 'agentModelOverrides["__proto__"]', value: 'auto' }]);
  });

  it.each(['{', '[]', 'null', '{"defaultModel":null}', '{"defaultModel":""}',
    '{"agentModelOverrides":[]}', '{"agentModelOverrides":{"Other":false}}'])('reports malformed input: %s', content => {
    expect(parse(content)).toMatchObject({ state: 'malformed', values: [] });
  });

  it('reports duplicate escaped and nested keys as ambiguous, not last-key-wins', () => {
    for (const content of ['{"defaultModel":"a","defaultModel":"b"}',
      '{"defaultModel":"a","default\\u004dodel":"b"}',
      '{"agentModelOverrides":{"Ada":"a","Ada":"b"}}']) {
      expect(parse(content)).toMatchObject({ state: 'ambiguous', values: [] });
    }
    expect(parse('{"description":"{\\"a\\":1}","defaultModel":"auto"}').state).toBe('ready');
    expect(parse('{"a":{"key":1},"b":{"key":2}}').state).toBe('ready');
  });

  it('bounds JSON bytes and model values', () => {
    expect(parse(' '.repeat(MAX_MODEL_CONFIG_BYTES + 1)).state).toBe('unreadable');
    expect(parse(JSON.stringify({ defaultModel: 'm'.repeat(257) })).state).toBe('malformed');
    expect(parse(JSON.stringify({ defaultModel: 'a\nb' })).state).toBe('malformed');
    expect(parse('{"defaultModel":"auto"}'.padEnd(MAX_MODEL_CONFIG_BYTES, ' ')).state).toBe('ready');
  });

  it('refreshes each read and distinguishes missing, malformed, oversized and invalid encoding', () => {
    const root = fixture();
    const file = path.join(root, '.squad', 'config.json');
    expect(readModelConfig(root, 'Ada')[0].state).toBe('missing');
    fs.writeFileSync(file, '{"defaultModel":"first"}');
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({ state: 'ready', values: [{ key: 'defaultModel', value: 'first' }] });
    fs.writeFileSync(file, '{');
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({ state: 'malformed', values: [] });
    fs.writeFileSync(file, Buffer.from([0xff]));
    expect(readModelConfig(root, 'Ada')[0].state).toBe('malformed');
    fs.truncateSync(file, MAX_MODEL_CONFIG_BYTES + 1);
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({ state: 'unreadable', values: [] });
    fs.unlinkSync(file);
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({ state: 'missing', values: [] });
  });

  it('does not execute legacy configuration or conflate its presence with JSON absence', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'squad.config.ts'), 'throw new Error("NEVER EXECUTE");');
    expect(readModelConfig(root, 'Ada')).toEqual([
      expect.objectContaining({ state: 'missing', sourcePath: path.join(root, '.squad', 'config.json') }),
      expect.objectContaining({ state: 'unsupported', sourcePath: path.join(root, 'squad.config.ts'), values: [] }),
      expect.objectContaining({ state: 'missing', sourcePath: path.join(root, '.squad', 'squad.config.ts') }),
    ]);
  });

  it('rejects Squad directory junctions escaping the selected workspace', () => {
    const root = fixture();
    const outside = fixture('{"defaultModel":"outside"}');
    fs.rmdirSync(path.join(root, '.squad'));
    fs.symlinkSync(path.join(outside, '.squad'), path.join(root, '.squad'), 'junction');
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({ state: 'unreadable', values: [] });
  });

  it('reports permission failures without retaining values', () => {
    const root = fixture('{}');
    vi.spyOn(fs, 'openSync').mockImplementation(() => {throw Object.assign(new Error('denied'), { code: 'EACCES' });});
    syncBuiltinESMExports();
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({ state: 'unreadable', diagnostic: expect.stringContaining('denied'), values: [] });
  });

  it('withholds changing reads and never reads oversized files', () => {
    const root = fixture('{"defaultModel":"auto"}');
    const file = path.join(root, '.squad', 'config.json');
    const originalRead = fs.readSync;
    const read = vi.spyOn(fs, 'readSync').mockImplementationOnce((fd, buffer, offset, length, position) => {
      const bytes = originalRead(fd, buffer, offset, length, position);
      fs.appendFileSync(file, ' ');
      return bytes;
    });
    syncBuiltinESMExports();
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({ state: 'ambiguous', values: [] });
    read.mockClear();
    fs.truncateSync(file, MAX_MODEL_CONFIG_BYTES + 1);
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({ state: 'unreadable', values: [] });
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['directory', 'file'])('withholds a %s substituted between resolution and open', target => {
    const root = fixture('{"defaultModel":"inside"}');
    const outside = fixture('{"defaultModel":"outside"}');
    const originalOpen = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementationOnce((file, flags, mode) => {
      if (target === 'directory') {
        fs.renameSync(path.join(root, '.squad'), path.join(root, 'original-squad'));
        fs.symlinkSync(path.join(outside, '.squad'), path.join(root, '.squad'), 'junction');
      } else {
        fs.renameSync(path.join(root, '.squad', 'config.json'), path.join(root, '.squad', 'original.json'));
        fs.copyFileSync(path.join(outside, '.squad', 'config.json'), path.join(root, '.squad', 'config.json'));
      }
      return originalOpen(file, flags, mode);
    });
    syncBuiltinESMExports();
    const result = readModelConfig(root, 'Ada')[0];
    expect(result.state).not.toBe('ready');
    expect(result.values).toEqual([]);
  });

  it.each(['directory', 'file'])('rechecks the selected %s identity after reading', target => {
    const root = fixture('{"defaultModel":"inside"}');
    const replacement = fixture('{"defaultModel":"replacement"}');
    const originalRead = fs.readSync;
    vi.spyOn(fs, 'readSync').mockImplementationOnce((fd, buffer, offset, length, position) => {
      const bytes = originalRead(fd, buffer, offset, length, position);
      if (target === 'directory') {
        fs.renameSync(path.join(root, '.squad'), path.join(root, 'original-squad'));
        fs.symlinkSync(path.join(replacement, '.squad'), path.join(root, '.squad'), 'junction');
      } else {
        fs.renameSync(path.join(root, '.squad', 'config.json'), path.join(root, '.squad', 'original.json'));
        fs.copyFileSync(path.join(replacement, '.squad', 'config.json'), path.join(root, '.squad', 'config.json'));
      }
      return bytes;
    });
    syncBuiltinESMExports();
    const result = readModelConfig(root, 'Ada')[0];
    expect(result.state).not.toBe('ready');
    expect(result.values).toEqual([]);
  });
});
