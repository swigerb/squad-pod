import * as fs from 'node:fs';
import * as path from 'node:path';

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
    if (!path.isAbsolute(selectedRoot)) throw new Error('Provide an explicit absolute project path.');
    this.selectedRoot = selectedRoot;
    this.root = fs.realpathSync(selectedRoot);
    this.rootIdentity = fs.statSync(this.root, { bigint: true });
    if (!this.rootIdentity.isDirectory()) throw new Error('Project path must be a directory.');
  }

  /** Resolve only within the still-identical root, refusing internal links/junctions. */
  resolve(relative: string): string {
    if (fs.realpathSync(this.selectedRoot) !== this.root
      || !sameFile(this.rootIdentity, fs.statSync(this.root, { bigint: true }))) {
      throw new Error('Selected project root changed.');
    }
    const target = path.resolve(this.root, relative);
    const parts = path.relative(this.root, target).split(path.sep);
    if (parts.includes('..') || path.isAbsolute(path.relative(this.root, target))) {
      throw new Error('Project path escapes selected root.');
    }
    let current = this.root;
    for (const part of parts) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Project symlinks/junctions are not observed.');
    }
    if (fs.realpathSync(target) !== target) throw new Error('Project source changed or escaped selected root.');
    return target;
  }

  /**
   * Read bounded strict UTF-8; missing returns null, unsafe/changed sources throw.
   * Raw-content consumers can preserve the BOM; other consumers keep decoder defaults.
   */
  read(relative: string, limit: number, options: { preserveBOM?: boolean } = {}): string | null {
    let fd: number | undefined;
    try {
      const target = this.resolve(relative);
      const before = fs.lstatSync(target, { bigint: true });
      if (!before.isFile() || before.size > BigInt(limit)) throw new Error(`Source is not a regular file within ${limit} bytes.`);
      fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const opened = fs.fstatSync(fd, { bigint: true });
      if (!sameFile(before, opened) || !opened.isFile() || opened.size > BigInt(limit)) {
        throw new Error('Source changed while opening.');
      }
      const buffer = Buffer.alloc(limit + 1);
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const after = fs.fstatSync(fd, { bigint: true });
      if (size > limit || opened.size !== BigInt(size) || after.size !== opened.size
        || opened.mtimeNs !== after.mtimeNs || opened.ctimeNs !== after.ctimeNs
        || this.resolve(relative) !== target
        || !sameFile(fs.lstatSync(target, { bigint: true }), opened)) {
        throw new Error('Source changed while reading; retry on next poll.');
      }
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: options.preserveBOM }).decode(buffer.subarray(0, size));
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
