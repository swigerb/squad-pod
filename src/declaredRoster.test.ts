import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_DECLARED_ROSTER_BYTES, readDeclaredRoster } from './declaredRoster.js';
import { ProjectFiles } from './projectFiles.js';

const roots: string[] = [];
const roster = (id: string) => '## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n'
  + `| Ada | Developer | \`.squad/agents/${id}/charter.md\` | Ready |\n`
  + '| Scribe | Scribe | .squad/agents/scribe/charter.md | Silent |\n';
function fixture() {
  const root = fs.mkdtempSync(path.resolve('.declared-roster-fixture-'));
  roots.push(root);
  return { root, files: new ProjectFiles(root) };
}
function write(root: string, content: string | Buffer, directory = '.squad') {
  fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(path.join(root, directory, 'team.md'), content);
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {fs.rmSync(root, { recursive: true, force: true });}
});

describe('guarded declared selected-project roster', () => {
  it('keeps independent contexts, exact parser IDs, metadata and filtering', () => {
    const first = fixture();
    const second = fixture();
    write(first.root, roster('Mixed_Name-2'));
    write(second.root, roster('Équipe Agent'), '.ai-team');
    const enumerate = vi.spyOn(ProjectFiles.prototype, 'entries');
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    const result = readDeclaredRoster(first);
    expect(result).toMatchObject({
      status: 'available', directory: '.squad',
      members: [{
        slug: 'Mixed_Name-2', name: 'Ada', role: 'Developer', status: 'Ready',
        charterPath: '.squad/agents/Mixed_Name-2/charter.md',
      }],
      allMembers: [expect.objectContaining({ slug: 'Mixed_Name-2' }), expect.objectContaining({ slug: 'scribe' })],
    });
    expect(readDeclaredRoster(second)).toMatchObject({
      status: 'available', directory: '.ai-team', members: [expect.objectContaining({ slug: 'Équipe Agent' })],
    });
    expect(result.byteLength).toBe(Buffer.byteLength(roster('Mixed_Name-2')));
    expect(enumerate).not.toHaveBeenCalled();
    expect(read.mock.calls.map(([relative, limit]) => [relative, limit])).toEqual([
      [path.join('.squad', 'team.md'), MAX_DECLARED_ROSTER_BYTES],
      [path.join('.ai-team', 'team.md'), MAX_DECLARED_ROSTER_BYTES],
    ]);
  });

  it('re-reads membership without snapshots or inferred task/activity members', () => {
    const context = fixture();
    write(context.root, roster('ada'));
    expect(readDeclaredRoster(context).members.map(m => m.slug)).toEqual(['ada']);
    fs.mkdirSync(path.join(context.root, '.squad', 'sessions'));
    fs.writeFileSync(path.join(context.root, '.squad', 'sessions', 'task.json'), '{"agent":"not-declared"}');
    write(context.root, roster('replacement'));
    expect(readDeclaredRoster(context).members.map(m => m.slug)).toEqual(['replacement']);
  });

  it('prefers .squad and never bypasses its missing or malformed team file', () => {
    const context = fixture();
    write(context.root, roster('legacy'), '.ai-team');
    expect(readDeclaredRoster(context).directory).toBe('.ai-team');
    fs.mkdirSync(path.join(context.root, '.squad'));
    expect(readDeclaredRoster(context)).toMatchObject({ status: 'missing', directory: '.squad', members: [] });
    write(context.root, 'not a roster');
    expect(readDeclaredRoster(context)).toMatchObject({ status: 'invalid', directory: '.squad', allMembers: [] });
    write(context.root, roster('preferred'));
    expect(readDeclaredRoster(context).members.map(m => m.slug)).toEqual(['preferred']);
  });

  it('fails closed for an invalid preferred directory and changed selected-root identity', () => {
    const context = fixture();
    write(context.root, roster('legacy'), '.ai-team');
    fs.symlinkSync(path.join(context.root, '.ai-team'), path.join(context.root, '.squad'), 'junction');
    expect(readDeclaredRoster(context)).toMatchObject({ status: 'unreadable', directory: '.squad', members: [] });
    fs.unlinkSync(path.join(context.root, '.squad'));
    fs.writeFileSync(path.join(context.root, '.squad'), 'not a directory');
    expect(readDeclaredRoster(context)).toMatchObject({ status: 'unreadable', directory: '.squad', members: [] });
    const selected = path.join(context.root, 'selected');
    fs.mkdirSync(selected);
    const files = new ProjectFiles(selected);
    fs.renameSync(selected, path.join(context.root, 'original'));
    fs.mkdirSync(selected);
    write(selected, roster('impostor'));
    expect(readDeclaredRoster({ files })).toMatchObject({ status: 'unreadable', members: [] });
  });

  it('reports absent, empty, non-table, invalid UTF-8 and oversized input without truncation', () => {
    const context = fixture();
    expect(readDeclaredRoster(context)).toMatchObject({ status: 'missing', members: [] });
    for (const content of ['', '## Members\nNo table']) {
      write(context.root, content);
      expect(readDeclaredRoster(context)).toMatchObject({ status: 'invalid', members: [] });
    }
    write(context.root, Buffer.from([0xff]));
    expect(readDeclaredRoster(context)).toMatchObject({ status: 'unreadable', members: [] });
    const exact = roster('ada').padEnd(MAX_DECLARED_ROSTER_BYTES, ' ');
    write(context.root, exact);
    expect(readDeclaredRoster(context)).toMatchObject({ status: 'available', byteLength: MAX_DECLARED_ROSTER_BYTES });
    write(context.root, exact + ' ');
    expect(readDeclaredRoster(context)).toMatchObject({ status: 'unreadable', members: [] });
  });
});
