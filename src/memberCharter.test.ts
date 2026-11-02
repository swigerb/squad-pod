import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readMemberCharter, type MemberCharterContext } from './memberCharter.js';
import { ProjectFiles } from './projectFiles.js';
import { parseTeamRoster } from './teamParser.js';

describe('host-authorized exact-member charter service', () => {
  let root: string;
  let members: Set<string>;
  let context: MemberCharterContext;
  const source = '# Ada\r\n\r\nBuilds tools. Reviews tools.\r\n\r\n## Identity\r\n'
    + '- **Expertise:** TypeScript\r\n\r\n## What I Own\r\n- Services\r\n\r\n'
    + '## Boundaries\r\n- No sessions\r\n\r\n## Model\r\n- **Preferred:** declared-only\r\n';
  const write = (id = 'ada', content: string | Buffer = source, directory = '.squad') => {
    const target = path.join(root, directory, 'agents', id, 'charter.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.resolve('.member-charter-fixture-'));
    members = new Set(['ada']);
    context = { workspaceRoot: root, isCurrentMember: id => members.has(id) };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('preserves raw content and every rich field without interpreting declared models', () => {
    write();
    expect(readMemberCharter(context, 'ada')).toEqual({
      charterStatus: 'available', charterContent: source,
      charterSummary: 'Builds tools. Reviews tools.', expertise: 'TypeScript',
      responsibilities: '- Services', boundaries: '- No sessions',
    });
  });

  it('checks live exact membership on each request without reading unknown or removed files', () => {
    write();
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    expect(readMemberCharter(context, 'ada').charterStatus).toBe('available');
    members.delete('ada');
    read.mockClear();
    for (const id of ['ada', 'Ada', 'ADA', 'ada-task', 'unknown']) {
      expect(readMemberCharter(context, id)).toMatchObject({
        charterStatus: 'unavailable', charterContent: null, expertise: null,
      });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('rechecks membership immediately before the guarded read', () => {
    write();
    let checks = 0;
    context.isCurrentMember = () => ++checks === 1;
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    expect(readMemberCharter(context, 'ada').charterStatus).toBe('unavailable');
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['Mixed_Name-2', '_helper', '..agent', 'Équipe Agent'])('preserves the parsed legitimate ID %s', id => {
    const [member] = parseTeamRoster(`## Members\n| Name | Role | Charter |\n| --- | --- | --- |\n`
      + `| Ada | Developer | .squad/agents/${id}/charter.md |`);
    members = new Set([member.slug]);
    write(id);
    expect(readMemberCharter(context, id).charterContent).toBe(source);
  });

  it.each(['', '.', '..', '../ada', 'x\\ada', 'C:ada', 'ada\0'])('refuses path syntax even if supplied as membership: %j', id => {
    members.add(id);
    const read = vi.spyOn(ProjectFiles.prototype, 'read');
    expect(readMemberCharter(context, id).charterStatus).toBe('unavailable');
    expect(read).not.toHaveBeenCalled();
  });

  it('uses legacy state only when the preferred directory is absent', () => {
    write('ada', source, '.ai-team');
    expect(readMemberCharter(context, 'ada').charterContent).toBe(source);
    fs.mkdirSync(path.join(root, '.squad'));
    expect(readMemberCharter(context, 'ada').charterStatus).toBe('missing');
    write('ada', '# Preferred\n\nPreferred content.');
    expect(readMemberCharter(context, 'ada').charterSummary).toBe('Preferred content.');
  });

  it('distinguishes missing, empty and unstructured readable input', () => {
    expect(readMemberCharter(context, 'ada').charterStatus).toBe('missing');
    for (const content of ['', 'not a markdown charter']) {
      write('ada', content);
      expect(readMemberCharter(context, 'ada')).toEqual({
        charterStatus: 'available', charterContent: content, charterSummary: null,
        expertise: null, responsibilities: null, boundaries: null,
      });
    }
  });

  it.each([Buffer.from([0xff]), Buffer.alloc(65537, 'x')])('withholds invalid UTF-8 or oversized input', content => {
    write('ada', content);
    expect(readMemberCharter(context, 'ada')).toEqual({
      charterStatus: 'unreadable', charterContent: null, charterSummary: null,
      expertise: null, responsibilities: null, boundaries: null,
    });
  });

  it('accepts the exact byte bound and refuses an internal directory junction', () => {
    const target = write('ada', 'x'.repeat(65536));
    expect(readMemberCharter(context, 'ada').charterContent).toHaveLength(65536);
    const directory = path.dirname(target);
    fs.renameSync(directory, path.join(root, 'original-agent'));
    fs.symlinkSync(path.join(root, 'original-agent'), directory, 'junction');
    expect(readMemberCharter(context, 'ada').charterStatus).toBe('unreadable');
  });
});
