import * as fs from 'node:fs';
import * as path from 'node:path';

/** Metadata observation never establishes content availability. */
export type ProjectFileInspection = { fingerprint: string } & (
  | { status: 'present'; kind: 'directory' | 'file' | 'other'; size: bigint }
  | { status: 'missing' | 'unreadable'; reason: string; retry: boolean }
);

class ProjectFileError extends Error {}

/** Do not disclose native error messages, paths, or source contents to consumers. */
export function projectFileDiagnostic(error: unknown): string {
  if (error instanceof ProjectFileError) { return error.message; }
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ERR_ENCODING_INVALID_ENCODED_DATA') { return 'Source is not valid UTF-8.'; }
  return typeof code === 'string' && /^E[A-Z0-9_]{1,63}$/.test(code)
    ? `Filesystem inspection/read failed (${code}).` : 'Unexpected filesystem inspection/read failure.';
}

/**
 * Read-only filesystem boundary for an explicit, host-authorized local project.
 * Canonicalizing a path does not establish host/session authority.
 */
export class ProjectFiles {
  readonly root: string;
  private readonly rootIdentity: fs.BigIntStats;
  private readonly selectedRoot: string;

  /** Capture the selected root; callers must validate authority before construction. */
  constructor(selectedRoot: string) {
    if (!path.isAbsolute(selectedRoot)) throw new ProjectFileError('Provide an explicit absolute project path.');
    this.selectedRoot = selectedRoot;
    this.root = fs.realpathSync(selectedRoot);
    this.rootIdentity = fs.statSync(this.root, { bigint: true });
    if (!this.rootIdentity.isDirectory()) throw new ProjectFileError('Project path must be a directory.');
  }

  /**
   * Inspect without following internal links, retaining identities even on refusal.
   * Fingerprints include root identity and each traversed component's identity,
   * type, size and timestamps. Native failures are retried, never cached as success.
   */
  inspect(relative: string): ProjectFileInspection {
    const stamps: string[] = [];
    let rootValidated = false;
    try {
      const root = fs.statSync(this.root, { bigint: true });
      stamps.push(`${root.dev}:${root.ino}:${root.mode}`);
      if (fs.realpathSync(this.selectedRoot) !== this.root || !sameFile(this.rootIdentity, root)) {
        throw new ProjectFileError('Selected project root changed.');
      }
      rootValidated = true;
      const target = path.resolve(this.root, relative);
      const rel = path.relative(this.root, target);
      if (rel.split(path.sep).includes('..') || path.isAbsolute(rel)) {
        throw new ProjectFileError('Project path escapes selected root.');
      }
      let current = this.root;
      let stat = root;
      for (const part of rel.split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        stat = fs.lstatSync(current, { bigint: true });
        if (process.platform === 'win32' && stat.isFile()) {
          // A first open finalizes Windows creation-time metadata. Fingerprint
          // the handle's current ctime rather than the pre-open fast-path value.
          const fd = fs.openSync(current, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
          try {
            const opened = fs.fstatSync(fd, { bigint: true });
            if (!sameFile(stat, opened) || !opened.isFile()
              || stat.size !== opened.size || stat.mtimeNs !== opened.mtimeNs) {
              throw new ProjectFileError('Source changed while inspecting.');
            }
            stat = opened;
          } finally { fs.closeSync(fd); }
        }
        stamps.push(`${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`);
        if (stat.isSymbolicLink()) { throw new ProjectFileError('Project symlinks/junctions are not observed.'); }
      }
      if (this.resolve(relative) !== target) { throw new ProjectFileError('Project source changed.'); }
      return { status: 'present', fingerprint: stamps.join('|'), size: stat.size,
        kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other' };
    } catch (error) {
      const missing = rootValidated && (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
      const reason = missing ? 'Source is missing.' : projectFileDiagnostic(error);
      return { status: missing ? 'missing' : 'unreadable', reason,
        fingerprint: `${stamps.join('|')}|${missing ? 'missing' : reason}`,
        retry: !missing && !(error instanceof ProjectFileError) };
    }
  }

  /** Resolve only within the still-identical root, refusing internal links/junctions. */
  resolve(relative: string): string {
    if (fs.realpathSync(this.selectedRoot) !== this.root
      || !sameFile(this.rootIdentity, fs.statSync(this.root, { bigint: true }))) {
      throw new ProjectFileError('Selected project root changed.');
    }
    const target = path.resolve(this.root, relative);
    const parts = path.relative(this.root, target).split(path.sep);
    if (parts.includes('..') || path.isAbsolute(path.relative(this.root, target))) {
      throw new ProjectFileError('Project path escapes selected root.');
    }
    let current = this.root;
    for (const part of parts) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new ProjectFileError('Project symlinks/junctions are not observed.');
    }
    if (fs.realpathSync(target) !== target) throw new ProjectFileError('Project source changed or escaped selected root.');
    return target;
  }

  /**
   * Read bounded strict UTF-8; missing returns null, unsafe/changed sources throw.
   * Raw-content consumers can preserve the BOM; other consumers keep decoder defaults.
   */
  read(relative: string, limit: number, options: { preserveBOM?: boolean } = {}): string | null {
    const buffer = this.readBytes(relative, limit, false);
    return buffer === null ? null
      : new TextDecoder('utf-8', { fatal: true, ignoreBOM: options.preserveBOM }).decode(buffer);
  }

  /**
   * Revalidate current read access through the same bounded object guards as read().
   * Attempt a one-byte read even at EOF; missing returns false, refusals throw.
   * This establishes readability, not content equality or UTF-8 validity.
   */
  probe(relative: string, limit: number): boolean {
    return this.readBytes(relative, limit, true) !== null;
  }

  private readBytes(relative: string, limit: number, probe: boolean): Buffer | null {
    let fd: number | undefined;
    try {
      const target = this.resolve(relative);
      const before = fs.lstatSync(target, { bigint: true });
      if (!before.isFile() || before.size > BigInt(limit)) throw new ProjectFileError(`Source is not a regular file within ${limit} bytes.`);
      fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const opened = fs.fstatSync(fd, { bigint: true });
      if (!sameFile(before, opened) || !opened.isFile() || opened.size > BigInt(limit)) {
        throw new ProjectFileError('Source changed while opening.');
      }
      const buffer = Buffer.alloc(probe ? 1 : limit + 1);
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const after = fs.fstatSync(fd, { bigint: true });
      const expected = probe && opened.size > 0n ? 1n : opened.size;
      if (size > limit || expected !== BigInt(size) || after.size !== opened.size
        || opened.mtimeNs !== after.mtimeNs || opened.ctimeNs !== after.ctimeNs
        || this.resolve(relative) !== target
        || !sameFile(fs.lstatSync(target, { bigint: true }), opened)) {
        throw new ProjectFileError('Source changed while reading; retry on next poll.');
      }
      return buffer.subarray(0, size);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  /** Enumerate at most 256 entries under a guarded project directory. */
  entries(relative: string): string[] {
    try {
      const dir = fs.opendirSync(this.resolve(relative));
      const names: string[] = [];
      let entries = 0;
      try {
        let entry: fs.Dirent | null;
        while ((entry = dir.readSync())) {
          if (++entries > 256) throw new Error('Activity directory exceeds 256 entries; observation paused for this source.');
          if (entry.isFile()) names.push(entry.name);
        }
      } finally { dir.closeSync(); }
      return names.sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}

function sameFile(before: fs.BigIntStats, after: fs.BigIntStats): boolean {
  // Keep path stats first: Windows lstat's fast path can report dev=0.
  return before.ino === after.ino
    && (before.dev === after.dev || (process.platform === 'win32' && before.dev === 0n));
}
