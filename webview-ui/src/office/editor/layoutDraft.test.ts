import { describe, expect, it } from 'vitest';
import { LayoutDraft } from './layoutDraft.js';
import type { OfficeLayout } from '../types.js';

const original: OfficeLayout = {
  version: 2, cols: 20, rows: 15, tiles: Array(300).fill(1),
  furniture: [{ uid: 'original', type: 'legacy-desk', col: 3, row: 4, rotation: 90,
    assetFootprint: { width: 3, height: 2 }, assetRole: 'desk' }],
  tileColors: { '0,0': { h: 210, s: 25, b: -5, c: 10 } },
};
const draft = { ...original, cols: 21, tiles: Array(315).fill(2) };
const external = { ...original, furniture: [
  ...original.furniture, { uid: 'remote', type: 'unavailable-id', col: 10, row: 8, rotation: 0 },
] };
const another = { ...original, rows: 16, tiles: Array(320).fill(3) };
function start() {
  const protection = new LayoutDraft();
  protection.receive(original, 'external', 'revision-0', 'workspace-A');
  return protection;
}

describe('content-based layout conflict snapshots', () => {
  it('applies clean snapshots without mutating originals or depending on object key order', () => {
    const protection = start();
    expect(protection.receive(external, 'external', 'revision-1')).toBe(true);
    expect(protection.state.draft).toEqual(external);
    expect(protection.state.baseline).toEqual(external);
    expect(protection.state.draft).not.toBe(external);
    protection.capture({ ...external, tiles: [...external.tiles], cols: external.cols });
    expect(protection.dirty).toBe(false);
    expect(protection.state.pending).toEqual([]);
  });

  it.each(['local', 'incoming'] as const)('retains exact local and external contents before and after choosing %s', (choice) => {
    const protection = start();
    protection.capture(draft);
    const applied = protection.receive(external, 'external', 'revision-1');
    expect(protection.state.draft).toEqual(draft);
    expect(protection.state.pending[0].layout).toEqual(external);
    expect(applied).toBe(false);
    const id = protection.state.pending[0].id;
    protection.resolve(id, choice);
    expect(protection.state.draft).toEqual(choice === 'local' ? draft : external);
    expect(protection.state.retained.map((s) => s.layout)).toContainEqual(draft);
    if (choice === 'local') expect(protection.state.retained.map((s) => s.layout)).toContainEqual(external);
    expect(protection.state.pending).toEqual([]);
    expect(protection.dirty).toBe(choice === 'local');
    const replay = protection.receive(external, 'external', 'revision-1');
    expect(replay).toBe(false);
    expect(protection.state.pending).toEqual([]);
  });

  it('does not suppress later distinct snapshots from a resolved source, even if an old version returns', () => {
    const protection = start();
    protection.capture(draft);
    protection.receive(external, 'external', 'revision-1');
    protection.resolve(protection.state.pending[0].id, 'local');
    protection.receive(another, 'external', 'revision-2');
    expect(protection.state.pending.map((s) => s.layout)).toEqual([another]);
    protection.resolve(protection.state.pending[0].id, 'local');
    protection.receive(external, 'external', 'revision-3');
    expect(protection.state.pending.map((s) => s.layout)).toEqual([external]);
    expect(protection.state.draft).toEqual(draft);
  });

  it('queues multiple sources, deduplicates only pending content, and keeps an older chosen snapshot dirty', () => {
    const protection = start();
    protection.capture(draft);
    protection.receive(external, 'external', 'revision-1');
    protection.receive(another, 'import', null);
    protection.receive(another, 'import', null);
    protection.receive(another, 'external', 'revision-2');
    expect(protection.state.pending.map((s) => s.layout)).toEqual([external, another, another]);
    protection.resolve(protection.state.pending[0].id, 'incoming');
    expect(protection.state.draft).toEqual(external);
    expect(protection.dirty).toBe(true);
    expect(protection.state.pending.map((s) => s.layout)).toEqual([another, another]);
    expect(protection.state.revision).toBe('revision-2');
  });

  it('stages clean imports as unsaved content, with disk baseline unchanged until acknowledgement', () => {
    const protection = start();
    expect(protection.receive(external, 'import', null)).toBe(true);
    expect(protection.state.draft).toEqual(external);
    expect(protection.state.baseline).toEqual(original);
    expect(protection.state.revision).toBe('revision-0');
    expect(protection.dirty).toBe(true);
    protection.beginSave();
    expect(protection.dirty).toBe(true);
    protection.capture(another);
    protection.acknowledge(external, 'saved-revision');
    expect(protection.state.draft).toEqual(another);
    expect(protection.state.baseline).toEqual(external);
    expect(protection.dirty).toBe(true);
    protection.capture(external);
    expect(protection.dirty).toBe(false);
  });

  it('restores full drafts, queued snapshots and retained copies after JSON recovery and startup replay', () => {
    const protection = start();
    protection.capture(draft);
    protection.receive(external, 'external', 'revision-1');
    protection.receive(another, 'import', null);
    const restored = new LayoutDraft(JSON.parse(JSON.stringify(protection.state)));
    restored.receive(external, 'external', 'revision-1', 'workspace-A');
    expect(restored.state).toEqual(protection.state);
    expect(restored.state.draft).toEqual(draft);
    expect(restored.state.pending.map((s) => s.layout)).toEqual([external, another]);
    restored.resolve(restored.state.pending[0].id, 'incoming');
    const again = new LayoutDraft(JSON.parse(JSON.stringify(restored.state)));
    expect(again.state.draft).toEqual(external);
    expect(again.state.retained.map((s) => s.layout)).toContainEqual(draft);
  });

  it('isolates malformed incoming input without changing any saved, draft, pending or revision content', () => {
    const protection = start();
    protection.capture(draft);
    protection.receive(external, 'external', 'revision-1');
    const before = JSON.parse(JSON.stringify(protection.state));
    const circular = { ...original, extra: {} };
    circular.extra = circular;
    for (const bad of [null, {}, circular, { ...original, tiles: [] }, { ...original, tileColors: { bad: null } }]) {
      expect(protection.receive(bad, 'external', 'bad-revision')).toBe(false);
      expect(protection.state).toEqual(before);
      expect(protection.error).toContain('malformed');
    }
  });

  it('does not rewind a newer external baseline on a late save acknowledgement', () => {
    const protection = start();
    protection.capture(draft);
    protection.beginSave();
    protection.receive(external, 'external', 'newer-revision');
    protection.resolve(protection.state.pending[0].id, 'local');
    protection.acknowledge(draft, 'older-save-revision');
    expect(protection.state.baseline).toEqual(external);
    expect(protection.state.revision).toBe('newer-revision');
    expect(protection.state.draft).toEqual(draft);
    expect(protection.state.retained.map((s) => s.layout)).toContainEqual(external);
    expect(protection.dirty).toBe(true);
    protection.beginSave();
    protection.acknowledge(draft, 'final-revision');
    expect(protection.state.baseline).toEqual(draft);
    expect(protection.dirty).toBe(false);
  });

  it('keeps workspace drafts isolated and blocks invalid recovery state instead of applying it', () => {
    const protection = start();
    protection.capture(draft);
    protection.receive(external, 'external', 'other-root-revision', 'workspace-B');
    expect(protection.state.draft).toEqual(draft);
    expect(protection.state.baseline).toEqual(original);
    expect(protection.state.revision).toBe('revision-0');
    expect(protection.workspaceMismatch).toBe(true);
    expect(protection.state.pending[0].layout).toEqual(external);
    const invalid = new LayoutDraft({ ...protection.state, draft: { tiles: [] } });
    expect(invalid.invalidRecovery).toBe(true);
    expect(invalid.receive(original, 'external', 'r')).toBe(false);
    expect(invalid.state.draft).toBeNull();
  });
});
