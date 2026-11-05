import * as path from 'node:path';
import { LAYOUT_FILE_DIR, LAYOUT_FILE_NAME } from './constants.js';
import { parseLayoutJson } from './layoutValidation.js';
import { ProjectFiles, projectFileDiagnostic } from './projectFiles.js';
import type { LayoutData } from './types.js';

/** Allows a full 256×256 grid plus colors/metadata; larger sources fail closed. */
export const MAX_LAYOUT_SOURCE_BYTES = 8 * 1024 * 1024;
const relative = path.join(LAYOUT_FILE_DIR, LAYOUT_FILE_NAME);
class SnapshotInspectionError extends Error {}

/** Only confirmed absence has a null revision; refusal never supplies a revision. */
export type LayoutSnapshot =
  | { status: 'valid'; layout: LayoutData; revision: string }
  | { status: 'missing'; revision: null }
  | { status: 'malformed'; revision: string; diagnostic: string }
  | { status: 'unreadable'; diagnostic: string };

function inspectSource(files: ProjectFiles): { status: 'present' | 'missing'; fingerprint: string } {
  const directory = files.inspect(LAYOUT_FILE_DIR);
  if (directory.status === 'unreadable') {throw new SnapshotInspectionError(directory.reason);}
  if (directory.status === 'present' && directory.kind !== 'directory') {
    throw new SnapshotInspectionError('Saved layout directory is not a directory.');
  }
  const file = files.inspect(relative);
  if (file.status === 'unreadable') {throw new SnapshotInspectionError(file.reason);}
  return { status: file.status, fingerprint: `${directory.fingerprint}||${file.fingerprint}` };
}

/**
 * Read only the fixed layout of an explicitly host-authorized ProjectFiles root.
 * Strict UTF-8, bounded reads and before/after identity checks refuse unsafe paths
 * and races, including disappearance of a previously present file/root.
 * Parsing migrates in memory only; raw revisions retain BOM/formatting/metadata.
 */
export function readLayoutSnapshot(files: ProjectFiles): LayoutSnapshot {
  try {
    const before = inspectSource(files);
    const revision = files.read(relative, MAX_LAYOUT_SOURCE_BYTES, { preserveBOM: true });
    const after = inspectSource(files);
    // A transient root ENOENT can yield null even with identical present inspections.
    if (after.status !== before.status || after.fingerprint !== before.fingerprint
      || (revision === null && (before.status !== 'missing' || after.status !== 'missing'))) {
      return { status: 'unreadable', diagnostic: 'Saved layout source changed while reading.' };
    }
    if (revision === null) {return { status: 'missing', revision: null };}
    const layout = parseLayoutJson(revision);
    return layout ? { status: 'valid', layout, revision }
      : { status: 'malformed', revision,
        diagnostic: 'Saved layout is malformed. The file was not overwritten; recover it before saving.' };
  } catch (error) {
    // Inspection reasons are already privacy-safe; native errors are never echoed.
    return { status: 'unreadable', diagnostic: error instanceof SnapshotInspectionError
      ? error.message : projectFileDiagnostic(error) };
  }
}
