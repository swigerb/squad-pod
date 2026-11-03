import * as path from 'node:path';
import { ProjectFiles, projectFileDiagnostic, type ProjectFileInspection } from './projectFiles.js';
import { SQUAD_DIR_NAMES } from './squadPaths.js';

/** Fixed team.md byte limit; oversize input is rejected, never truncated. */
export const MAX_TEAM_SOURCE_BYTES = 256 * 1024;

/** Source availability is independent of whether the content contains a roster. */
export type TeamSource = {
  directory: typeof SQUAD_DIR_NAMES[number];
  byteLength: number;
} & (
  | { status: 'available'; content: string }
  | { status: 'missing' | 'unreadable'; reason: string }
);

/**
 * Select the guarded roster directory using metadata only, without reading team.md.
 * Only an absent .squad permits legacy fallback; invalid or unsafe paths throw.
 * Selection alone does not establish that the roster content is available.
 */
export function selectTeamSourceDirectory(files: ProjectFiles): TeamSource['directory'] {
  const probe = inspectTeamSource(files, true);
  if (probe.source?.status === 'unreadable') { throw new Error(probe.source.reason); }
  return probe.directory;
}

interface TeamSourceProbe {
  directory: TeamSource['directory'];
  fingerprint: string;
  source?: TeamSource;
  retry: boolean;
}

function inspectTeamSource(files: ProjectFiles, directoryOnly = false): TeamSourceProbe {
  let directory: TeamSource['directory'] = SQUAD_DIR_NAMES[0];
  const fingerprints: string[] = [];
  let retry = false;
  const inspect = (relative: string): ProjectFileInspection => {
    const result = files.inspect(relative);
    fingerprints.push(result.fingerprint);
    if (result.status !== 'present') { retry ||= result.retry; }
    return result;
  };
  const unavailable = (status: 'missing' | 'unreadable', reason: string): TeamSourceProbe => ({
    directory, fingerprint: fingerprints.join('||'), retry,
    source: { status, directory, byteLength: 0,
      reason: status === 'missing' ? 'No selected-project team.md found.' : reason },
  });
  let dir = inspect(directory);
  if (dir.status === 'missing') {
    directory = SQUAD_DIR_NAMES[1];
    dir = inspect(directory);
  }
  if (dir.status !== 'present') { return unavailable(dir.status, dir.reason); }
  if (dir.kind !== 'directory') { return unavailable('unreadable', 'Selected roster path is not a directory.'); }
  if (directoryOnly) { return { directory, fingerprint: fingerprints.join('||'), retry }; }
  const file = inspect(path.join(directory, 'team.md'));
  if (file.status !== 'present') { return unavailable(file.status, file.reason); }
  if (file.kind !== 'file' || file.size > BigInt(MAX_TEAM_SOURCE_BYTES)) {
    return unavailable('unreadable', `Source is not a regular file within ${MAX_TEAM_SOURCE_BYTES} bytes.`);
  }
  return { directory, fingerprint: fingerprints.join('||'), retry };
}

function readProbedTeamSource(files: ProjectFiles, probe: TeamSourceProbe): { source: TeamSource; retry: boolean } {
  const { directory } = probe;
  if (probe.source) { return { source: probe.source, retry: probe.retry }; }
  const unavailable = (reason: string): TeamSource =>
    ({ status: 'unreadable', directory, byteLength: 0, reason });
  try {
    const content = files.read(path.join(directory, 'team.md'), MAX_TEAM_SOURCE_BYTES, { preserveBOM: true });
    const after = inspectTeamSource(files);
    if (content === null || probe.fingerprint !== after.fingerprint || after.source) {
      return { source: unavailable('Selected roster source changed while reading; retry on next poll.'), retry: true };
    }
    return { source: { status: 'available', directory, byteLength: Buffer.byteLength(content), content }, retry: false };
  } catch (error) {
    return { source: unavailable(projectFileDiagnostic(error)),
      // Only a stable, strictly decoded content refusal can be cached after a read.
      retry: (error as NodeJS.ErrnoException | null)?.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA'
        || inspectTeamSource(files).fingerprint !== probe.fingerprint };
  }
}

/**
 * Read only the host-selected project's fixed team.md through ProjectFiles.
 * Only an absent .squad directory permits .ai-team fallback. Invalid directories,
 * internal links, changed identities, non-files, invalid UTF-8 and >256-KiB files
 * fail closed. No discovery, runtime membership or root/session authority is granted.
 */
export function readTeamSource(files: ProjectFiles): TeamSource {
  return readProbedTeamSource(files, inspectTeamSource(files)).source;
}

/**
 * Per-watcher, in-memory guarded source state. The authorized root identity is
 * retained for its lifetime; unchanged metadata reuses only this project's last
 * bounded validation. Refusals participate in invalidation, not just file stamps.
 */
export class TeamSourceState {
  private files: ProjectFiles | undefined;
  private previous: { fingerprint: string; source: TeamSource; retry: boolean } | undefined;
  private readonly selectedRoot: string;

  constructor(project: string | ProjectFiles) {
    this.selectedRoot = typeof project === 'string' ? project : project.root;
    this.files = typeof project === 'string' ? undefined : project;
  }

  scan(): { source: TeamSource; changed: boolean } {
    let next: NonNullable<TeamSourceState['previous']>;
    try {
      this.files ??= new ProjectFiles(this.selectedRoot);
      const probe = inspectTeamSource(this.files);
      if (this.previous && !this.previous.retry && this.previous.fingerprint === probe.fingerprint && !probe.retry) {
        return { source: this.previous.source, changed: false };
      }
      next = { fingerprint: probe.fingerprint, ...readProbedTeamSource(this.files, probe) };
    } catch (error) {
      next = { fingerprint: 'project-unavailable', retry: true,
        source: { status: 'unreadable', directory: SQUAD_DIR_NAMES[0], byteLength: 0,
          reason: projectFileDiagnostic(error) } };
    }
    const prior = this.previous;
    const changed = !prior || prior.fingerprint !== next.fingerprint
      || prior.source.status !== next.source.status
      || (prior.source.status !== 'available' && next.source.status !== 'available'
        && prior.source.reason !== next.source.reason);
    this.previous = next;
    return { source: next.source, changed };
  }
}
