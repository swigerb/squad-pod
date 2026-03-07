/// <reference types="vitest/globals" />
import { parseTeamRoster, readTeamRoster } from './teamParser.js';

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
  it('returns empty array for nonexistent path', () => {
    const result = readTeamRoster('/definitely/does/not/exist');
    expect(result).toEqual([]);
  });
});
