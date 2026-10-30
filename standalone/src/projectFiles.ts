import * as fs from 'node:fs';
import * as path from 'node:path';

/** Project reads never follow internal symlinks/junctions or enumerate outside this root. */
export class ProjectFiles {
  readonly root: string;
  constructor(root: string) {
    if (!path.isAbsolute(root)) throw new Error('Provide an explicit absolute project path.');
    this.root = fs.realpathSync(root);
    if (!fs.statSync(this.root).isDirectory()) throw new Error('Project path must be a directory.');
  }

  resolve(relative: string): string {
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

  read(relative: string, limit: number): string | null {
    let fd: number | undefined;
    try {
      const target = this.resolve(relative);
      const before = fs.lstatSync(target, { bigint: true });
      if (!before.isFile() || before.size > BigInt(limit)) throw new Error(`Source is not a regular file within ${limit} bytes.`);
      fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const opened = fs.fstatSync(fd, { bigint: true });
      // Windows lstat's fast path can report dev=0 until a handle has been opened.
      const differentDevice = opened.dev !== before.dev && !(process.platform === 'win32' && before.dev === 0n);
      if (differentDevice || opened.ino !== before.ino || !opened.isFile()) {
        throw new Error('Source changed while opening.');
      }
      const buffer = Buffer.alloc(limit + 1);
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const after = fs.fstatSync(fd, { bigint: true });
      if (size > limit || after.size !== BigInt(size) || opened.mtimeNs !== after.mtimeNs
        || this.resolve(relative) !== target) throw new Error('Source changed while reading; retry on next poll.');
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

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
