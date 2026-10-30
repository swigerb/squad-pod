import { describe, expect, it } from 'vitest';
import { resolveFileAgentId, slugify } from './agentIdentity.js';

const roster = new Map([
  ['homer-simpson', { id: 'homer-simpson', name: 'Homer Simpson' }],
  ['homer-rabbit', { id: 'homer-rabbit', name: 'Homer Rabbit' }],
  ['lisa', { id: 'lisa', name: 'Lisa Simpson' }],
]);

describe('shared file-only agent aliases', () => {
  it.each([
    ['homer-simpson', 'homer-simpson'],
    ['Homer Simpson', 'homer-simpson'],
    ['Lisa Simpson', 'lisa'],
    ['Lisa', 'lisa'],
    ['homer-simpson-review', 'homer-simpson'],
    ['Homer', null],
    ['unknown', null],
    ['', null],
  ])('resolves %j without ambiguous first-name matches', (raw, expected) => {
    expect(resolveFileAgentId(raw, roster)).toBe(expected);
  });

  it('retains native normalization and longest suffix-prefix preference', () => {
    expect(slugify('  Lisa Simpson! ')).toBe('lisa-simpson');
    const overlapping = new Map([...roster, ['homer', { id: 'homer', name: 'Other Member' }]]);
    expect(resolveFileAgentId('homer-simpson-review', overlapping)).toBe('homer-simpson');
  });
});
