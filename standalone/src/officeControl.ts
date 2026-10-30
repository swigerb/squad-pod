import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { OutboundMessage, WebviewMessage } from '../../src/types.js';
import { parseTeamRoster } from '../../src/teamParser.js';
import { isObserverLayout } from './events.js';
import { OfficeStore, type AssertOfficeAuthority } from './officeStore.js';
import { ProjectFiles } from './projectFiles.js';
import { defaultPreferences, validPreferenceMutation } from './officePreferences.js';

export type OfficeMutation = Extract<WebviewMessage, {
  type: 'saveLayout' | 'saveAgentSeats' | 'setSoundEnabled' | 'setDebugEnabled' | 'setShowAreas'
}>;
export interface ControlRequest {
  version: 1;
  kind: 'control';
  requestId: number;
  expectedRevision: string | null;
  message: OfficeMutation;
}
export const MAX_CONTROL_FRAME = 2 * 1024 * 1024 + 8192;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).length === names.length && names.every(key => Object.hasOwn(v, key));
export const validRevision = (v: unknown): v is string | null => v === null || typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

/** Network mutations are deliberately narrower than the native WebviewMessage union. */
export function decodeControl(value: unknown): ControlRequest {
  if (!record(value) || !keys(value, ['version', 'kind', 'requestId', 'expectedRevision', 'message'])
    || value.version !== 1 || value.kind !== 'control' || !Number.isSafeInteger(value.requestId)
    || typeof value.requestId !== 'number' || value.requestId < 1 || !validRevision(value.expectedRevision)
    || !record(value.message)) throw new Error('Invalid control frame.');
  const m = value.message;
  if (m.type === 'saveLayout') {
    if (!keys(m, ['type', 'layout', 'expectedRevision', 'workspaceRoot'])
      || !validRevision(m.expectedRevision) || m.expectedRevision !== value.expectedRevision
      || typeof m.workspaceRoot !== 'string' || m.workspaceRoot.length > 8192
      || !isObserverLayout(m.layout)) throw new Error('Invalid layout mutation.');
  } else if (!validPreferenceMutation(m)) throw new Error('Invalid or unsupported office mutation.');
  return value as unknown as ControlRequest;
}

export function createOfficeControl(project: string) {
  const store = new OfficeStore(project);
  const files = new ProjectFiles(project);
  const projectIdentity = createHash('sha256').update(store.root).digest('hex');
  function preferences() { return store.readPreferences(); }
  function mutate(request: ControlRequest, assertAuthority: AssertOfficeAuthority): OutboundMessage[] {
    const message = request.message;
    if (message.type === 'saveLayout') {
      if (message.workspaceRoot !== store.root) throw new Error('Selected project identity does not match.');
      const saved = store.saveLayout(message.layout, request.expectedRevision, assertAuthority);
      if (!saved.saved) {
        return [
          ...(saved.value ? [{ type: 'layoutLoaded' as const, layout: saved.value, revision: saved.revision, workspaceRoot: store.root }] : []),
          { type: 'layoutError', error: 'Save conflict: the saved office changed. Your draft was kept; resolve or export both versions before retrying.' },
        ];
      }
      return [{ type: 'layoutSaved', layout: saved.value!, revision: saved.revision }];
    }
    const current = preferences();
    let squad = '.squad';
    try { files.resolve(squad); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') squad = '.ai-team';
      else throw error;
    }
    const roster = files.read(path.join(squad, 'team.md'), 256 * 1024);
    const ids = new Set(parseTeamRoster(roster ?? '').map(agent => agent.slug));
    const next = structuredClone(current.value ?? defaultPreferences());
    if (message.type === 'saveAgentSeats') {
      if (Object.keys(message.seats).some(id => !ids.has(id))) throw new Error('Seat change contains an unknown selected-project agent.');
      for (const [id, meta] of Object.entries(next.agents)) {
        if (ids.has(id) && meta.seatId !== undefined) delete next.agents[id].seatId;
      }
      for (const [id, seatId] of Object.entries(message.seats)) {
        Object.defineProperty(next.agents, id, {
          value: { ...next.agents[id], seatId }, enumerable: true, configurable: true, writable: true,
        });
      }
    } else {
      const key = message.type === 'setSoundEnabled' ? 'soundEnabled'
        : message.type === 'setDebugEnabled' ? 'debugEnabled' : 'showAreas';
      next.settings[key] = message.enabled;
    }
    const saved = store.savePreferences(next, request.expectedRevision, ids, assertAuthority);
    const result = saved.value ?? defaultPreferences();
    return [
      { type: 'settingsLoaded', ...result.settings },
      ...(!saved.saved ? [{ type: 'layoutError' as const, error: 'Preferences conflict: another viewer or external edit changed settings/seats. Your requested change was not saved; reload and deliberately retry.' }] : []),
    ];
  }
  return { store, projectIdentity, preferences, mutate };
}
export type OfficeControl = ReturnType<typeof createOfficeControl>;
