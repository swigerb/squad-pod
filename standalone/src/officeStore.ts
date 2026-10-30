import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { LayoutData } from '../../src/types.js';
import { isValidLayout } from '../../src/layoutValidation.js';
import { parseLayoutJson } from '../../src/layoutPersistence.js';
import { ProjectFiles } from './projectFiles.js';
import { validPreferences, type OfficePreferences } from './officePreferences.js';
export type { OfficePreferences } from './officePreferences.js';

export const MAX_OFFICE_BYTES = 2 * 1024 * 1024;
const MAX_PREFERENCES_BYTES = 128 * 1024;
const DIRECTORY = '.squad-pod';
const LAYOUT = path.join(DIRECTORY, 'layout.json');
const PREFERENCES = path.join(DIRECTORY, 'office-preferences.json');

export interface OfficeSnapshot<T> {
  value: T | null;
  revision: string | null;
}

export type OfficeSave<T> = OfficeSnapshot<T> & { saved: boolean };

/** Throws unless the originating connection still has office control authority.
 * The transport must bind this to the specific connection and credential generation,
 * not just to the server's current opt-in flag or terminal authorization.
 */
export type AssertOfficeAuthority = () => void;

function revision(content: string | null): string | null {
  return content === null ? null : createHash('sha256').update(content).digest('hex');
}

function sameIdentity(before: fs.BigIntStats, after: fs.BigIntStats): boolean {
  // Windows can return dev=0 from lstat until a handle has been opened.
  return before.ino === after.ino && (before.dev === after.dev
    || (process.platform === 'win32' && (before.dev === 0n || after.dev === 0n)));
}

/** Fixed selected-project targets only; never accepts a browser-supplied path.
 * Synchronous commit sections serialize local viewers, while exclusive lock files
 * also serialize cooperating processes (including native layout writers).
 */
export class OfficeStore {
  readonly root: string;
  private readonly files: ProjectFiles;
  private readonly identity: fs.BigIntStats;

  constructor(project: string) {
    this.files = new ProjectFiles(project);
    this.root = this.files.root;
    this.identity = fs.lstatSync(this.root, { bigint: true });
  }

  readLayout(): OfficeSnapshot<LayoutData> {
    const raw = this.read(LAYOUT, MAX_OFFICE_BYTES);
    return this.layoutSnapshot(raw);
  }

  readPreferences(): OfficeSnapshot<OfficePreferences> {
    return this.preferencesSnapshot(this.read(PREFERENCES, MAX_PREFERENCES_BYTES));
  }

  saveLayout(
    input: unknown, expectedRevision: unknown, assertAuthority: AssertOfficeAuthority,
  ): OfficeSave<LayoutData> {
    assertAuthority();
    const content = this.serialize(input, MAX_OFFICE_BYTES);
    const candidate: unknown = JSON.parse(content);
    if (!isValidLayout(candidate)) throw new Error('Invalid layout; saved office was not changed.');
    return this.commit(LAYOUT, content, expectedRevision, MAX_OFFICE_BYTES, assertAuthority,
      raw => this.layoutSnapshot(raw));
  }

  savePreferences(
    input: unknown, expectedRevision: unknown, agentIds: ReadonlySet<string>,
    assertAuthority: AssertOfficeAuthority,
  ): OfficeSave<OfficePreferences> {
    assertAuthority();
    const content = this.serialize(input, MAX_PREFERENCES_BYTES);
    const candidate: unknown = JSON.parse(content);
    if (!validPreferences(candidate)) throw new Error('Invalid or unsupported office preferences.');
    const retained = this.readPreferences().value?.agents ?? {};
    if (Object.entries(candidate.agents).some(([id, meta]) => !agentIds.has(id)
      && (!Object.hasOwn(retained, id) || retained[id].palette !== meta.palette || retained[id].seatId !== meta.seatId))) {
      throw new Error('Office preferences contain an unknown selected-project agent.');
    }
    return this.commit(PREFERENCES, content, expectedRevision, MAX_PREFERENCES_BYTES, assertAuthority,
      raw => this.preferencesSnapshot(raw));
  }

  private serialize(input: unknown, limit: number): string {
    const content = JSON.stringify(input, null, 2);
    if (typeof content !== 'string' || Buffer.byteLength(content) > limit) {
      throw new Error(`Office data exceeds ${limit} bytes or is not JSON.`);
    }
    return content;
  }

  private layoutSnapshot(raw: string | null): OfficeSnapshot<LayoutData> {
    const value = raw === null ? null : parseLayoutJson(raw);
    if (raw !== null && value === null) throw new Error('Saved layout is malformed; recover it before saving.');
    return { value, revision: revision(raw) };
  }

  private preferencesSnapshot(raw: string | null): OfficeSnapshot<OfficePreferences> {
    if (raw === null) return { value: null, revision: null };
    const value: unknown = JSON.parse(raw);
    if (!validPreferences(value)) throw new Error('Saved office preferences are malformed; recover them before saving.');
    return { value, revision: revision(raw) };
  }

  private assertRoot(): void {
    const current = fs.lstatSync(this.root, { bigint: true });
    if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(this.identity, current)
      || fs.realpathSync(this.root) !== this.root) throw new Error('Selected project identity changed.');
  }

  private read(relative: string, limit: number): string | null {
    this.assertRoot();
    return this.files.read(relative, limit);
  }

  private ensureDirectory(relative: string): string {
    this.assertRoot();
    const parent = path.dirname(relative);
    const parentPath = parent === '.' ? this.root : this.files.resolve(parent);
    const target = path.join(parentPath, path.basename(relative));
    try { fs.mkdirSync(target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const resolved = this.files.resolve(relative);
    if (!fs.lstatSync(resolved).isDirectory()) throw new Error('Office storage is not a directory.');
    return resolved;
  }

  private commit<T>(
    relative: string, content: string, expectedRevision: unknown, limit: number,
    assertAuthority: AssertOfficeAuthority, snapshot: (raw: string | null) => OfficeSnapshot<T>,
  ): OfficeSave<T> {
    if (expectedRevision !== null && (typeof expectedRevision !== 'string'
      || !/^[a-f0-9]{64}$/.test(expectedRevision))) throw new Error('Invalid office revision.');
    assertAuthority();
    const directory = this.ensureDirectory(DIRECTORY);
    const directoryIdentity = fs.lstatSync(directory, { bigint: true });
    const assertDirectory = () => {
      this.assertRoot();
      const current = this.files.resolve(DIRECTORY);
      if (current !== directory || !sameIdentity(directoryIdentity, fs.lstatSync(current, { bigint: true }))) {
        throw new Error('Office storage identity changed.');
      }
    };
    const target = path.join(this.root, relative);
    const lockPath = `${target}.lock`;
    const lock = fs.openSync(lockPath, 'wx', 0o600);
    const temporary = `${target}.${randomUUID()}.tmp`;
    let staged = false;
    try {
      const previous = this.read(relative, limit);
      const current = snapshot(previous);
      if (current.revision !== expectedRevision) return { ...current, saved: false };
      assertDirectory();
      const fd = fs.openSync(temporary, 'wx', 0o600);
      staged = true;
      try {
        fs.writeFileSync(fd, content, 'utf8');
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      assertAuthority();
      assertDirectory();
      const beforeCommit = this.read(relative, limit);
      if (beforeCommit !== previous) return { ...snapshot(beforeCommit), saved: false };
      // Retain the exact previous bytes, including unknown metadata, for recovery.
      if (previous !== null) {
        const recovery = this.ensureDirectory(path.join(DIRECTORY, 'recovery'));
        const backup = path.join(recovery, `${randomUUID()}.json`);
        fs.writeFileSync(backup, previous, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      }
      assertAuthority();
      assertDirectory();
      const finalRevision = this.read(relative, limit);
      if (finalRevision !== previous) return { ...snapshot(finalRevision), saved: false };
      fs.renameSync(temporary, target);
      staged = false;
      const written = this.read(relative, limit);
      if (written !== content) throw new Error('Office changed after commit; reload before retrying. Draft must be retained.');
      return { ...snapshot(written), saved: true };
    } finally {
      fs.closeSync(lock);
      // Do not follow a replaced parent directory even during cleanup.
      try { assertDirectory(); }
      catch {
        throw new Error('Office storage identity changed; lock and staged bytes were retained in the original directory for manual recovery.');
      }
      if (staged) fs.unlinkSync(temporary);
      fs.unlinkSync(lockPath);
    }
  }
}
