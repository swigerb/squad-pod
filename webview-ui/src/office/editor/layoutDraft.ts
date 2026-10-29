import { isValidLayout, layoutContent } from '../../../../src/layoutValidation.js';
import type { OfficeLayout } from '../types.js';

export interface LayoutSnapshot {
  id: number;
  source: 'external' | 'import' | 'recovery';
  layout: OfficeLayout;
  workspaceRoot?: string;
}

export interface LayoutRecovery {
  version: 1;
  baseline: OfficeLayout | null;
  draft: OfficeLayout | null;
  revision: string | null;
  pending: LayoutSnapshot[];
  retained: LayoutSnapshot[];
  nextId: number;
  workspaceRoot: string | null;
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const sameLayout = (a: unknown, b: unknown): boolean => layoutContent(a) === layoutContent(b);

function validOffice(value: unknown): value is OfficeLayout {
  return isValidLayout(value) && Array.isArray(value.furniture);
}

/** Owns full immutable snapshots, not just dirty flags or ignored source IDs. */
export class LayoutDraft {
  state: LayoutRecovery = {
    version: 1, baseline: null, draft: null, revision: null, pending: [], retained: [], nextId: 1, workspaceRoot: null,
  };
  error: string | null = null;
  watcherError: string | null = null;
  saving = false;
  workspaceMismatch = false;
  invalidRecovery = false;
  private externalVersion = 0;
  private savingVersion = 0;

  constructor(public readonly recoveryInput?: unknown) {
    const recovery = recoveryInput;
    if (recovery === undefined || recovery === null) return;
    const r = recovery as Partial<LayoutRecovery>;
    if (r.version !== 1 || !validOffice(r.baseline) || !validOffice(r.draft)
      || !(r.revision === null || typeof r.revision === 'string')
      || !(r.workspaceRoot === null || typeof r.workspaceRoot === 'string')
      || typeof r.nextId !== 'number' || !Number.isSafeInteger(r.nextId) || r.nextId < 1
      || !Array.isArray(r.pending) || !Array.isArray(r.retained)
      || ![...r.pending, ...r.retained].every((s) => s && Number.isSafeInteger(s.id)
        && s.id > 0 && s.id < r.nextId!
        && ['external', 'import', 'recovery'].includes(s.source) && validOffice(s.layout)
        && (s.workspaceRoot === undefined || typeof s.workspaceRoot === 'string'))
      || new Set([...r.pending, ...r.retained].map((s) => s.id)).size !== r.pending.length + r.retained.length) {
      this.error = 'Layout recovery state is malformed. It was not applied or replaced. Export the recovery state before continuing.';
      this.invalidRecovery = true;
      return;
    }
    this.state = copy(r as LayoutRecovery);
  }

  get dirty(): boolean {
    return this.state.baseline !== null && !sameLayout(this.state.draft, this.state.baseline);
  }

  capture(layout: OfficeLayout): void {
    if (this.state.draft) this.state.draft = copy(layout);
  }

  receive(layout: unknown, source: 'external' | 'import', revision: string | null, workspaceRoot?: string): boolean {
    if (this.invalidRecovery) return false;
    if (!validOffice(layout) || !['external', 'import'].includes(source)
      || !(revision === null || typeof revision === 'string')) {
      this.error = 'Incoming layout is malformed; the local draft and pending snapshots were kept.';
      return false;
    }
    if (workspaceRoot) {
      this.workspaceMismatch = this.state.workspaceRoot !== null && this.state.workspaceRoot !== workspaceRoot;
      if (!this.state.workspaceRoot) this.state.workspaceRoot = workspaceRoot;
    }
    if (this.workspaceMismatch) {
      this.error = 'Workspace changed. Both workspaces are kept separate: export recovery copies and return to the original workspace before saving.';
      this.state.pending.push({ id: this.state.nextId++, source, layout: copy(layout), workspaceRoot });
      return false;
    }
    if (source === 'external') {
      this.watcherError = null;
      if (revision !== this.state.revision || !sameLayout(layout, this.state.baseline)) this.externalVersion++;
      this.state.revision = revision;
    }
    if (!this.state.draft) {
      this.state.baseline = copy(layout);
      this.state.draft = copy(layout);
      return true;
    }
    if (sameLayout(layout, this.state.draft)) {
      if (source === 'external') this.state.baseline = copy(layout);
      return false;
    }
    // A replay of the saved baseline is not an edit, even while the draft is dirty.
    if (source === 'external' && sameLayout(layout, this.state.baseline)) return false;
    if (this.dirty || this.state.pending.length || this.saving) {
      if (!this.state.pending.some((s) => s.source === source && sameLayout(s.layout, layout))) {
        if (!this.state.retained.some((s) => sameLayout(s.layout, this.state.draft))) {
          this.state.retained.push({ id: this.state.nextId++, source: 'recovery', layout: copy(this.state.draft) });
        }
        this.state.pending.push({ id: this.state.nextId++, source, layout: copy(layout) });
      }
      if (source === 'external') this.state.baseline = copy(layout);
      return false;
    }
    if (source === 'external') this.state.baseline = copy(layout);
    this.state.draft = copy(layout);
    return true;
  }

  resolve(id: number, choice: 'local' | 'incoming'): boolean {
    const snapshot = this.state.pending.find((s) => s.id === id);
    if (!snapshot || !this.state.draft) return false;
    if (choice === 'incoming') {
      this.state.retained.push({ id: this.state.nextId++, source: 'recovery', layout: copy(this.state.draft) });
      this.state.draft = copy(snapshot.layout);
    } else {
      this.state.retained.push(copy(snapshot));
    }
    // Disk's latest revision is independent of which queued snapshot is selected.
    // Keep an older selection dirty so it still requires an explicit save.
    this.state.pending = this.state.pending.filter((s) => s.id !== id);
    return choice === 'incoming';
  }

  beginSave(): void {
    this.saving = true;
    this.savingVersion = this.externalVersion;
  }

  acknowledge(layout: OfficeLayout, revision: string | null): void {
    if (!validOffice(layout) || !(revision === null || typeof revision === 'string')) {
      this.error = 'Malformed save acknowledgement; the draft and recovery copies were kept.';
      this.saving = false;
      return;
    }
    // A later external snapshot can arrive before an earlier save acknowledgement.
    // Never rewind its baseline/revision, even if the user already resolved it.
    if (this.externalVersion === this.savingVersion
      || (sameLayout(layout, this.state.baseline) && revision === this.state.revision)) {
      this.state.baseline = copy(layout);
      this.state.revision = revision;
    }
    this.saving = false;
    this.error = null;
    this.watcherError = null;
  }
}
