/// <reference types="vitest/globals" />
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseAllMembers, parseProjectContext, parseTeamName, parseTeamRoster, readTeamFile, readTeamRoster } from './teamParser.js';
import { readDeclaredRoster } from './declaredRoster.js';
import { ProjectFiles } from './projectFiles.js';
import { MAX_TEAM_SOURCE_BYTES, readTeamSource } from './teamSource.js';

const FULL_TEAM_MD = `# Squad Team

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Homer Simpson | 🏗️ Lead | \`.squad/agents/homer-simpson/charter.md\` | ✅ Active |
| Marge Simpson | 🎨 Designer | \`.squad/agents/marge-simpson/charter.md\` | ✅ Active |
| Bart Simpson | 🧪 Tester | \`.squad/agents/bart-simpson/charter.md\` | ✅ Active |
| Lisa Simpson | 💻 Core Dev | \`.squad/agents/lisa-simpson/charter.md\` | ✅ Active |
| Maggie Simpson | 📦 Packager | \`.squad/agents/maggie-simpson/charter.md\` | ✅ Active |

## Notes

Some extra section.
`;

describe('parseTeamRoster', () => {
  it('parses a valid 5-member table', () => {
    const members = parseTeamRoster(FULL_TEAM_MD);
    expect(members).toHaveLength(5);
    expect(members[0]).toEqual({
      name: 'Homer Simpson',
      slug: 'homer-simpson',
      role: '🏗️ Lead',
      status: '✅ Active',
      charterPath: '.squad/agents/homer-simpson/charter.md',
    });
    expect(members[4].name).toBe('Maggie Simpson');
  });

  it('derives slug from charter path', () => {
    const members = parseTeamRoster(FULL_TEAM_MD);
    expect(members[0].slug).toBe('homer-simpson');
    expect(members[3].slug).toBe('lisa-simpson');
  });

  it('falls back to name-based slug when charter column is missing', () => {
    const md = `## Members

| Name | Role | Status |
|------|------|--------|
| Homer Simpson | Lead | ✅ Active |
`;
    const members = parseTeamRoster(md);
    expect(members).toHaveLength(1);
    expect(members[0].slug).toBe('homer-simpson');
  });

  it('filters hidden agents: Scribe (role contains "scribe")', () => {
    const md = `## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Homer Simpson | Lead | \`.squad/agents/homer-simpson/charter.md\` | ✅ Active |
| Ned Flanders | 📋 Scribe | \`.squad/agents/ned-flanders/charter.md\` | 📋 Silent |
`;
    const members = parseTeamRoster(md);
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe('Homer Simpson');
  });

  it('filters hidden agents: Ralph (name=ralph AND role contains "monitor")', () => {
    const md = `## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Homer Simpson | Lead | \`.squad/agents/homer-simpson/charter.md\` | ✅ Active |
| Ralph | 🔄 Monitor | \`.squad/agents/ralph/charter.md\` | 🔄 Monitor |
`;
    const members = parseTeamRoster(md);
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe('Homer Simpson');
  });

  it('returns empty array for empty file', () => {
    expect(parseTeamRoster('')).toEqual([]);
  });

  it('returns empty array when no ## Members section exists', () => {
    const md = `# Team Info

## Overview

Some overview text.

## Policies

Follow them.
`;
    expect(parseTeamRoster(md)).toEqual([]);
  });

  it('handles malformed table with extra whitespace', () => {
    const md = `## Members

|  Name  |  Role  |  Charter  |  Status  |
|--------|--------|-----------|----------|
|  Homer Simpson  |  Lead  |  \`.squad/agents/homer-simpson/charter.md\`  |  ✅ Active  |
`;
    const members = parseTeamRoster(md);
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe('Homer Simpson');
    expect(members[0].slug).toBe('homer-simpson');
  });
});

describe('readTeamRoster', () => {
  let root: string;
  const write = (content: string | Buffer, directory = '.squad') => {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, 'team.md'), content);
  };
  beforeEach(() => { root = fs.mkdtempSync(path.resolve('.team-parser-fixture-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('returns empty array for nonexistent path', () => {
    const result = readTeamRoster('/definitely/does/not/exist');
    expect(result).toEqual([]);
  });

  it('preserves raw content, metadata, exact IDs and hidden rules through both readers', () => {
    const content = '# Synthetic team\r\n\r\n## Project Context\r\nSynthetic context.\r\n\r\n'
      + FULL_TEAM_MD.slice(FULL_TEAM_MD.indexOf('## Members'))
        .replace('homer-simpson', 'Mixed_Name-2')
        .replace('## Notes', '| Scribe | Scribe | .squad/agents/scribe/charter.md | Silent |\n'
          + '| Ralph | Monitor | .squad/agents/ralph/charter.md | Active |\n\n## Notes');
    write(content);
    const raw = readTeamFile(root);
    expect(raw).toBe(content);
    expect(parseTeamName(raw!)).toBe('Synthetic team');
    expect(parseProjectContext(raw!)).toBe('Synthetic context.');
    expect(readTeamRoster(root)).toEqual(parseTeamRoster(content));
    expect(readTeamRoster(root).map(m => m.slug)).toEqual([
      'Mixed_Name-2', 'marge-simpson', 'bart-simpson', 'lisa-simpson', 'maggie-simpson',
    ]);
    expect(readDeclaredRoster({ files: new ProjectFiles(root) })).toMatchObject({
      status: 'available', byteLength: Buffer.byteLength(content),
      members: readTeamRoster(root), allMembers: parseAllMembers(content),
    });
    write('\uFEFF' + content);
    expect(readTeamFile(root)).toBe('\uFEFF' + content);
    expect(readTeamSource(new ProjectFiles(root)).byteLength).toBe(Buffer.byteLength('\uFEFF' + content));
  });

  it('uses only absent-directory fallback, preserving empty and non-roster raw files', () => {
    write(FULL_TEAM_MD, '.ai-team');
    expect(readTeamRoster(root)).toHaveLength(5);
    fs.mkdirSync(path.join(root, '.squad'));
    expect(readTeamFile(root)).toBeNull();
    expect(readTeamRoster(root)).toEqual([]);
    for (const content of ['', '# Name only\n\nIntro\n\n## Notes\n']) {
      write(content);
      expect(readTeamFile(root)).toBe(content);
      expect(readTeamRoster(root)).toEqual([]);
      expect(readTeamSource(new ProjectFiles(root))).toMatchObject({ status: 'available', content });
      expect(readDeclaredRoster({ files: new ProjectFiles(root) }).status).toBe('invalid');
    }
  });

  it('rejects invalid UTF-8, oversize and non-file sources rather than returning a partial roster', () => {
    const exact = FULL_TEAM_MD + ' '.repeat(MAX_TEAM_SOURCE_BYTES - Buffer.byteLength(FULL_TEAM_MD));
    write(exact);
    expect(readTeamFile(root)).toBe(exact);
    expect(readTeamRoster(root)).toHaveLength(5);
    for (const content of [exact + ' ', Buffer.from([0xff])]) {
      write(content);
      expect(readTeamFile(root)).toBeNull();
      expect(readTeamRoster(root)).toEqual([]);
      expect(readTeamSource(new ProjectFiles(root))).toMatchObject({ status: 'unreadable', byteLength: 0 });
    }
    fs.unlinkSync(path.join(root, '.squad', 'team.md'));
    fs.mkdirSync(path.join(root, '.squad', 'team.md'));
    expect(readTeamFile(root)).toBeNull();
  });

  it('fails closed for relative selection and linked or invalid preferred directories', () => {
    expect(readTeamFile('.')).toBeNull();
    expect(readTeamRoster('.')).toEqual([]);
    write(FULL_TEAM_MD, '.ai-team');
    const preferred = path.join(root, '.squad');
    fs.symlinkSync(path.join(root, '.ai-team'), preferred, 'junction');
    expect(readTeamFile(root)).toBeNull();
    expect(readTeamRoster(root)).toEqual([]);
    fs.unlinkSync(preferred);
    fs.writeFileSync(preferred, 'not a directory');
    expect(readTeamFile(root)).toBeNull();
    expect(readTeamRoster(root)).toEqual([]);
  });
});
