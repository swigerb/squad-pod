import fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CopilotSessionRef {
  id: string;
  dir: string;
  mtimeMs: number;
}

export function isSessionUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/** Exact host-generated IDs bypass newest-session limits, not path or symlink checks. */
export function findCopilotSession(copilotHome: string, id: string): CopilotSessionRef | undefined {
  if (!isSessionUuid(id)) { throw new Error('Invalid generated Copilot session UUID.'); }
  const root = path.join(copilotHome, 'session-state');
  try {
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) { throw new Error('Unsupported Copilot session root.'); }
    const dir = path.join(root, id);
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || path.dirname(fs.realpathSync.native(dir)) !== fs.realpathSync.native(root)) {
      throw new Error('Unsupported exact Copilot session directory.');
    }
    return { id, dir, mtimeMs: stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; }
    throw error;
  }
}

export function resolveCopilotHome(env = process.env, homedir = os.homedir()): string {
  const override = env.COPILOT_HOME;
  return override?.trim() && path.isAbsolute(override) ? override : path.join(homedir, '.copilot');
}

export function listCopilotSessions(
  copilotHome: string,
  options?: { limit?: number },
): CopilotSessionRef[] {
  const limit = options?.limit ?? 500;
  if (!Number.isFinite(limit) || limit <= 0) { return []; }
  const sessions: CopilotSessionRef[] = [];
  let directory: fs.Dir | undefined;
  try {
    const sessionRoot = path.join(copilotHome, 'session-state');
    if (fs.lstatSync(sessionRoot).isSymbolicLink()) { return []; }
    const root = fs.realpathSync.native(sessionRoot);
    directory = fs.opendirSync(root);
    for (let examined = 0; examined < 500; examined++) {
      const entry = directory.readSync();
      if (!entry) { break; }
      // Session aliases are unnecessary here; skipping all links also prevents root escapes.
      if (!entry.isDirectory() || entry.isSymbolicLink()) { continue; }
      try {
        const dir = path.join(root, entry.name);
        const real = fs.realpathSync.native(dir);
        const relative = path.relative(root, real);
        if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) { continue; }
        sessions.push({ id: entry.name, dir, mtimeMs: fs.statSync(dir).mtimeMs });
      } catch {
        // Sessions may disappear while the CLI is cleaning up.
      }
    }
  } catch {
    return [];
  } finally {
    try { directory?.closeSync(); } catch { /* Read-only, best-effort metadata discovery. */ }
  }
  return sessions.sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id))
    .slice(0, Math.min(500, Math.floor(limit)));
}

function cwdScalar(value: string): string | null {
  const text = value.trim();
  if (text.startsWith("'")) {
    const match = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(text);
    return match ? match[1].replace(/''/g, "'") : null;
  }
  if (text.startsWith('"')) {
    const match = /^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/.exec(text);
    if (!match) { return null; }
    const escapes: Record<string, string> = {
      '0': '\0', a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v',
      f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\',
      N: '\u0085', _: '\u00a0', L: '\u2028', P: '\u2029',
    };
    try {
      return match[1].slice(1, -1).replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g,
        (_match: string, escape: string) => {
          if (/^[xuU]/.test(escape) && escape.length > 1) {
            return String.fromCodePoint(parseInt(escape.slice(1), 16));
          }
          if (!(escape in escapes)) { throw new Error('Unsupported scalar escape'); }
          return escapes[escape];
        });
    } catch { return null; }
  }
  if (!text || /^[|>{[\]&*!#]/.test(text)) { return null; }
  return text.replace(/\s+#.*$/, '').trim() || null;
}

export function readSessionCwd(sessionDir: string): string | null {
  let fd: number | undefined;
  try {
    const file = path.join(sessionDir, 'workspace.yaml');
    const metadata = fs.lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8192) { return null; }
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 8192) { return null; }
    const buffer = Buffer.alloc(8192);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const matches = [...buffer.toString('utf8', 0, bytes).replace(/^\uFEFF/, '').matchAll(/^cwd:[ \t]*(.*)\r?$/gm)];
    if (matches.length !== 1) { return null; }
    const cwd = cwdScalar(matches[0][1]);
    return cwd && path.isAbsolute(cwd) && !/[\u0000-\u001f\u007f]/.test(cwd) ? cwd : null;
  } catch {
    return null;
  } finally {
    try { if (fd !== undefined) { fs.closeSync(fd); } } catch { /* Best-effort close after a read failure. */ }
  }
}
