import * as fs from 'node:fs';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_MODEL_CONFIG_BYTES, parseCharterModel, parseModelConfig, readModelConfig } from './declaredModels.js';
import { ProjectFiles } from './projectFiles.js';

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }));

const sourcePath = '.squad/config.json';
const parse = (content: string, name = 'Ada') => parseModelConfig(content, name, sourcePath);
const roots: string[] = [];
function fixture(config?: string): string {
  const root = fs.mkdtempSync(path.resolve('.declared-models-fixture-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.squad'));
  if (config !== undefined) {fs.writeFileSync(path.join(root, '.squad', 'config.json'), config);}
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {fs.rmSync(root, { recursive: true, force: true });}
});

describe('declared JSON model metadata', () => {
  it('extracts only declared charter Model fields, not other sections or fenced examples', () => {
    expect(parseCharterModel('# TestBot\n\n## Model\n- **Preferred:** auto\n- **Rationale:** Task dependent\n- **Fallback:** Declared chain\n## Work\n- **Preferred:** wrong', 'charter.md'))
      .toMatchObject({ state: 'ready', values: [
        { key: 'Preferred', value: 'auto' }, { key: 'Rationale', value: 'Task dependent' }, { key: 'Fallback', value: 'Declared chain' },
      ] });
    expect(parseCharterModel('```\n## Model\n- **Preferred:** fake\n```', 'charter.md').state).toBe('missing');
    expect(parseCharterModel('## Model\n## Model', 'charter.md').state).toBe('ambiguous');
    expect(parseCharterModel('## Model\n**Preferred:** one\n**Preferred:** two', 'charter.md').state).toBe('ambiguous');
    expect(parseCharterModel('## Model\n**Preferred:** ', 'charter.md').state).toBe('malformed');
    expect(parseCharterModel('## Model\n**Preferred:** explicit-model', 'charter.md'))
      .toMatchObject({ state: 'ready', diagnostic: 'Not declared: Rationale, Fallback.', values: [{ key: 'Preferred', value: 'explicit-model' }] });
  });

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
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({ state: 'unreadable', diagnostic: expect.stringContaining('EACCES'), values: [] });
    expect(JSON.stringify(readModelConfig(root, 'Ada'))).not.toContain('denied');
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
    const result = readModelConfig(root, 'Ada')[0];
    expect(result.state).not.toBe('ready');
    expect(result.values).toEqual([]);
  });

  it('uses guarded preferred and genuinely absent-preferred legacy sources without resolving conflicts', () => {
    const root = fixture('{"defaultModel":"auto","agentModelOverrides":{"Ada":"exact","ada":"wrong"}}');
    fs.mkdirSync(path.join(root, '.ai-team'));
    fs.writeFileSync(path.join(root, '.ai-team', 'config.json'), '{"defaultModel":"legacy"}');
    expect(readModelConfig(root, 'Ada')[0].values).toEqual([
      { key: 'defaultModel', value: 'auto' }, { key: 'agentModelOverrides["Ada"]', value: 'exact' },
    ]);
    fs.renameSync(path.join(root, '.squad'), path.join(root, 'original-squad'));
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({
      sourcePath: path.join(root, '.ai-team', 'config.json'), state: 'ready',
      values: [{ key: 'defaultModel', value: 'legacy' }],
    });
  });

  it.each(['file', 'linked', 'inaccessible'])('never falls back from an invalid %s preferred source', kind => {
    const root = fixture();
    fs.renameSync(path.join(root, '.squad'), path.join(root, '.ai-team'));
    fs.writeFileSync(path.join(root, '.ai-team', 'config.json'), '{"defaultModel":"legacy-secret"}');
    if (kind === 'file') {fs.writeFileSync(path.join(root, '.squad'), 'not a directory');}
    else if (kind === 'linked') {
      fs.symlinkSync(path.join(root, '.ai-team'), path.join(root, '.squad'), 'junction');
    } else {
      const inspect = ProjectFiles.prototype.inspect;
      vi.spyOn(ProjectFiles.prototype, 'inspect').mockImplementation(function (relative) {
        return relative === '.squad'
          ? { status: 'unreadable', fingerprint: 'refused', reason: 'Refused.', retry: true }
          : inspect.call(this, relative);
      });
    }
    const sources = readModelConfig(root, 'Ada');
    expect(sources[0]).toMatchObject({
      sourcePath: path.join(root, '.squad', 'config.json'), state: 'unreadable', values: [],
    });
    expect(JSON.stringify(sources)).not.toContain('legacy-secret');
  });

  it.each(['preferred-appears', 'directory-replaced', 'root-replaced'])('withholds declarations when %s during reading', change => {
    const container = fixture();
    const root = path.join(container, 'selected');
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(root, '.ai-team'));
    fs.writeFileSync(path.join(root, '.ai-team', 'config.json'), '{"defaultModel":"legacy"}');
    const read = ProjectFiles.prototype.read;
    vi.spyOn(ProjectFiles.prototype, 'read').mockImplementationOnce(function (...args) {
      const content = read.call(this, ...args);
      if (change === 'preferred-appears') {fs.mkdirSync(path.join(root, '.squad'));}
      else if (change === 'directory-replaced') {
        fs.renameSync(path.join(root, '.ai-team'), path.join(root, 'original-team'));
        fs.mkdirSync(path.join(root, '.ai-team'));
        fs.renameSync(path.join(root, 'original-team', 'config.json'), path.join(root, '.ai-team', 'config.json'));
      } else {
        fs.renameSync(root, path.join(container, 'original-root'));
        fs.mkdirSync(root);
        fs.mkdirSync(path.join(root, '.ai-team'));
        fs.writeFileSync(path.join(root, '.ai-team', 'config.json'), '{"defaultModel":"replacement"}');
      }
      return content;
    });
    const sources = readModelConfig(root, 'Ada');
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: 'ambiguous', values: [] }),
    ]));
    expect(sources.every(source => source.values.length === 0)).toBe(true);
  });

  it('does not turn a disappeared observed file into ordinary absence', () => {
    const root = fixture('{}');
    vi.spyOn(ProjectFiles.prototype, 'read').mockImplementationOnce(() => {
      fs.unlinkSync(path.join(root, '.squad', 'config.json'));
      return null;
    });
    expect(readModelConfig(root, 'Ada')[0]).toMatchObject({ state: 'ambiguous', values: [] });
  });

  it.each(['relative', 'missing', 'file'])('returns sanitized explicit refusals for a %s selected root', kind => {
    const root = fixture();
    const selected = kind === 'relative' ? '.' : path.join(root, kind);
    if (kind === 'file') {fs.writeFileSync(selected, 'not a directory');}
    const sources = readModelConfig(selected, 'Ada');
    expect(sources).toHaveLength(3);
    expect(sources.every(source => source.state === 'unreadable' && source.values.length === 0)).toBe(true);
    expect(sources.map(source => source.sourcePath)).toEqual(kind === 'relative'
      ? ['.squad/config.json', 'squad.config.ts', '.squad/squad.config.ts']
      : [path.join(selected, '.squad', 'config.json'), path.join(selected, 'squad.config.ts'),
        path.join(selected, '.squad', 'squad.config.ts')]);
    if (kind !== 'relative') {
      expect(sources.every(source => !source.diagnostic.includes(selected))).toBe(true);
    }
  });

  it('inspects executable sources for presence only, never reading their contents', () => {
    const root = fixture('{}');
    for (const relative of ['squad.config.ts', path.join('.squad', 'squad.config.ts')]) {
      fs.writeFileSync(path.join(root, relative), 'throw new Error("NEVER EXECUTE OR READ");');
    }
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    const bytes = vi.spyOn(fs, 'readSync');
    expect(readModelConfig(root, 'Ada').map(source => source.state)).toEqual(['ready', 'unsupported', 'unsupported']);
    expect(read.mock.calls.map(call => call[0])).toEqual([path.join('.squad', 'config.json')]);
    expect(bytes).toHaveBeenCalledTimes(1);
  });

  it('rechecks directory authority after executable metadata inspection too', () => {
    const root = fixture('{}');
    fs.renameSync(path.join(root, '.squad'), path.join(root, '.ai-team'));
    fs.writeFileSync(path.join(root, 'squad.config.ts'), 'never read');
    const inspect = ProjectFiles.prototype.inspect;
    let changed = false;
    vi.spyOn(ProjectFiles.prototype, 'inspect').mockImplementation(function (relative) {
      const observed = inspect.call(this, relative);
      if (relative === 'squad.config.ts' && !changed) {
        changed = true;
        fs.mkdirSync(path.join(root, '.squad'));
      }
      return observed;
    });
    expect(readModelConfig(root, 'Ada')).toEqual([
      expect.objectContaining({ state: 'ambiguous', values: [] }),
      expect.objectContaining({ state: 'ambiguous', values: [] }),
      expect.objectContaining({ state: 'ambiguous', values: [] }),
    ]);
  });

  it('sanitizes actual read refusals while preserving independent executable presence', () => {
    const root = fixture('{"defaultModel":"withheld"}');
    fs.writeFileSync(path.join(root, 'squad.config.ts'), 'never read');
    vi.spyOn(fs, 'readSync').mockImplementation(() => {
      throw Object.assign(new Error('private source contents and native path'), { code: 'EACCES' });
    });
    const sources = readModelConfig(root, 'Ada');
    expect(sources[0]).toMatchObject({
      state: 'unreadable', diagnostic: 'Filesystem inspection/read failed (EACCES).', values: [],
    });
    expect(sources[1]).toMatchObject({ state: 'unsupported', values: [] });
    expect(JSON.stringify(sources)).not.toContain('private source contents');
  });

  it('refuses linked executable sources without content reads', () => {
    const root = fixture('{}');
    fs.writeFileSync(path.join(root, 'squad.config.ts'), 'never read');
    fs.writeFileSync(path.join(root, '.squad', 'squad.config.ts'), 'never read');
    const lstat = fs.lstatSync;
    vi.spyOn(fs, 'lstatSync').mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
      const stat = lstat(...args);
      return String(args[0]).endsWith('squad.config.ts') ? Object.assign(stat, { isSymbolicLink: () => true }) : stat;
    });
    const bytes = vi.spyOn(fs, 'readSync');
    expect(readModelConfig(root, 'Ada').map(source => source.state)).toEqual(['ready', 'unreadable', 'unreadable']);
    expect(bytes).toHaveBeenCalledTimes(1);
  });

  it('refuses file links and executable directories rather than reporting supported presence', () => {
    const root = fixture('{}');
    const lstat = fs.lstatSync;
    vi.spyOn(fs, 'lstatSync').mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
      const stat = lstat(...args);
      return String(args[0]).endsWith('config.json') ? Object.assign(stat, { isSymbolicLink: () => true }) : stat;
    });
    fs.mkdirSync(path.join(root, 'squad.config.ts'));
    const sources = readModelConfig(root, 'Ada');
    expect(sources[0]).toMatchObject({ state: 'unreadable', values: [] });
    expect(sources[1]).toMatchObject({ state: 'unreadable', values: [] });
  });
});
