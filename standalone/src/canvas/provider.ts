import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type * as SDK from '@github/copilot-sdk/extension';
import { startCanvasOfficeHost, type CanvasOfficeHost, type CanvasOfficeHostOptions } from './officeHost.js';
import { memberDetails, officeState } from './readActions.js';

type Sdk = Pick<typeof SDK, 'createCanvas' | 'joinSession' | 'CanvasError'>;
type Context = SDK.CanvasContext;
type Identity = ReturnType<typeof directoryIdentity>;
type Entry = { ready?: Promise<CanvasOfficeHost>; generation: number; pending: boolean; root?: Identity; host?: CanvasOfficeHost };
const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const empty = { type: 'object', properties: {}, additionalProperties: false };

// Promoted from the C01 proof: explicit local identity, never cwd/workspacePath fallback.
function directoryIdentity(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)
    || !isAbsolute(value) || /^[\\/]{2}|^\\|^\/(?:mnt\/[a-z](?:\/|$)|wsl(?:\/|$))/i.test(value)
    || (process.platform === 'win32' && (!/^[A-Za-z]:[\\/]/.test(value) || value.slice(2).includes(':')))) throw new Error();
  const path = realpathSync.native(value);
  if (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(path)) throw new Error();
  const stat = statSync(path, { bigint: true });
  if (!stat.isDirectory()) throw new Error();
  return { path, key: process.platform === 'win32' ? path.toLowerCase() : path, dev: stat.dev, ino: stat.ino };
}
const same = (a: Identity, b: Identity) => a.key === b.key && a.dev === b.dev && a.ino === b.ino;

/** Join only the host-owned session; own and dispose offices, never the session itself. */
export async function startOfficeExtension(sdk: Sdk, paths: Omit<CanvasOfficeHostOptions, 'projectRoot'>,
  lifecycle: Pick<NodeJS.Process, 'once' | 'removeListener'> = process) {
  let session: SDK.JoinedSession | undefined;
  let boundSessionId: string | undefined;
  let providerId: string | undefined;
  let disposed = false;
  let cleanupFailed = false;
  let inFlight = 0;
  let disposal: Promise<void> | undefined;
  let unsubscribe: (() => void) | undefined;
  const entries = new Map<string, Entry>();
  function fail(code: string): never { throw new sdk.CanvasError(code, 'Squad Pod Canvas authority or resource unavailable'); }
  function revoke() {
    const owned = [...entries.values()];
    entries.clear();
    for (const entry of owned) entry.host?.clearActivity?.();
    for (const entry of owned) void closeEntry(entry).catch(() => { cleanupFailed = true; });
  }
  function validate(ctx: Context) {
    if (disposed || cleanupFailed || !session) fail('canvas_unavailable');
    if (session.sessionId !== boundSessionId) { revoke(); fail('canvas_session_mismatch'); }
    if (!ctx || typeof ctx !== 'object') fail('canvas_context_invalid');
    if (ctx.sessionId !== session.sessionId) fail('canvas_session_mismatch');
    if (ctx.canvasId !== 'squad-pod' || typeof ctx.instanceId !== 'string' || !id.test(ctx.instanceId)
      || typeof ctx.extensionId !== 'string' || !ctx.extensionId || ctx.extensionId.length > 256) fail('canvas_context_invalid');
    if (providerId && providerId !== ctx.extensionId) fail('canvas_provider_mismatch');
    return entries.get(ctx.instanceId);
  }
  function active(ctx: Context, entry: Entry, generation = entry.generation) {
    validate(ctx);
    if (entries.get(ctx.instanceId) !== entry || entry.generation !== generation) fail('canvas_closed');
    try {
      if (entry.root && !same(entry.root, directoryIdentity(entry.root.path))) fail('canvas_root_changed');
    } catch { fail('canvas_root_changed'); }
  }
  async function authority(ctx: Context): Promise<Identity> {
    const metadata = session?.rpc?.metadata;
    if (typeof metadata?.snapshot !== 'function') fail('canvas_metadata_missing');
    if (inFlight >= 4) fail('canvas_metadata_limit');
    inFlight++;
    // Timeouts retain their slot until actual settlement; late RPCs cannot authorize.
    const request = Promise.resolve().then(() => metadata.snapshot()).then(
      value => ({ value }), () => ({ error: 'canvas_metadata_rejected' }),
    ).finally(() => { inFlight--; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([request, new Promise<{ error: string }>(resolve => {
        timer = setTimeout(() => resolve({ error: 'canvas_metadata_deadline' }), 1000);
      })]);
      if ('error' in result) fail(result.error);
      const value = result.value;
      if (!object(value) || value.sessionId !== ctx.sessionId || value.sessionId !== session?.sessionId) fail('canvas_metadata_mismatch');
      try {
        const root = directoryIdentity(value.workingDirectory);
        if (object(ctx.input) && Object.hasOwn(ctx.input, 'projectRoot')
          && !same(root, directoryIdentity(ctx.input.projectRoot))) fail('canvas_root_mismatch');
        return root;
      } catch (error) {
        if (error instanceof sdk.CanvasError) throw error;
        return fail('canvas_root_unavailable');
      }
    } finally { clearTimeout(timer); }
  }
  const release = async (host: CanvasOfficeHost) => {
    try { await host.dispose(); } catch { cleanupFailed = true; fail('canvas_disposal_failed'); }
  };
  const closeEntry = async (entry: Entry) => {
    if (entry.host) return release(entry.host);
    let host: CanvasOfficeHost | undefined;
    try { host = await entry.ready; } catch { return; }
    if (host) await release(host);
  };
  async function close(ctx: Context) {
    const entry = validate(ctx);
    entries.delete(ctx.instanceId);
    entry?.host?.clearActivity?.();
    if (entry) {
      try { await closeEntry(entry); } catch { fail('canvas_disposal_failed'); }
    }
  }
  const canvas = sdk.createCanvas({
    id: 'squad-pod', displayName: 'Squad Pod',
    description: 'Read-only office for the exact joined session project.',
    inputSchema: { ...empty, properties: { projectRoot: { type: 'string', minLength: 1, maxLength: 4096 } } },
    async open(ctx) {
      let entry = validate(ctx);
      if (ctx.input !== undefined && (!object(ctx.input) || Object.keys(ctx.input).some(key => key !== 'projectRoot'))) fail('canvas_input_invalid');
      if (!entry) {
        if (entries.size >= 4) fail('canvas_instance_limit');
        providerId ??= ctx.extensionId;
        entry = { generation: 0, pending: false };
        entries.set(ctx.instanceId, entry);
      }
      const generation = ++entry.generation;
      entry.pending = true;
      entry.host?.clearActivity?.();
      try {
        const root = await authority(ctx);
        active(ctx, entry, generation);
        if (entry.root && !same(root, entry.root)) fail('canvas_root_changed');
        entry.root = root;
        if (!entry.ready) {
          const owned = entry;
          // Startup belongs to the instance; only the latest open owns authority.
          entry.ready = Promise.resolve().then(async () => {
            active(ctx, owned);
            const host = await startCanvasOfficeHost({ ...paths, projectRoot: root.path, sessionId: session!.sessionId });
            try { active(ctx, owned); } catch (error) { await release(host); throw error; }
            owned.host = host;
            return host;
          });
        }
        const host = await entry.ready;
        active(ctx, entry, generation);
        entry.pending = false;
        return { title: 'Squad Pod', url: host.url };
      } catch (error) {
        if (entries.get(ctx.instanceId) === entry && entry.generation === generation) {
          entries.delete(ctx.instanceId);
          try { await closeEntry(entry); } catch { fail('canvas_disposal_failed'); }
        } else active(ctx, entry, generation);
        if (error instanceof sdk.CanvasError) throw error;
        return fail('canvas_open_failed');
      }
    },
    onClose: close,
    actions: ['get_office_state', 'get_member_details'].map(name => ({
      name, description: name === 'get_office_state' ? 'Bounded office members, layout, source status and requests-observed readiness.'
        : 'Exact-member charter summary, expertise and declared model provenance.',
      inputSchema: name === 'get_office_state' ? empty : { ...empty,
        properties: { slug: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' } }, required: ['slug'] },
      async handler(ctx) {
        const entry = validate(ctx);
        if (!entry?.host || !entry.root || entry.pending) fail('canvas_instance_unavailable');
        const { host, root, generation } = entry;
        const input = ctx.input === undefined ? {} : ctx.input;
        if (ctx.actionName !== name || !object(input) || (name === 'get_office_state'
          ? Object.keys(input).length !== 0 : Object.keys(input).length !== 1 || typeof input.slug !== 'string'
            || !/^[A-Za-z0-9_-]{1,128}$/.test(input.slug))) fail('canvas_input_invalid');
        try {
          active(ctx, entry, generation);
          const messages = await host.snapshot();
          active(ctx, entry, generation);
          if (entry.pending) fail('canvas_instance_unavailable');
          return name === 'get_office_state' ? officeState(messages, host.readiness?.())
            : memberDetails(root.path, input.slug as string, messages);
        } catch (error) {
          if (error instanceof sdk.CanvasError) throw error;
          return fail('canvas_action_unavailable');
        }
      },
    })),
  });
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    disposed = true;
    const owned = [...entries.values()];
    entries.clear();
    for (const entry of owned) entry.host?.clearActivity?.();
    const subscription = unsubscribe;
    unsubscribe = undefined;
    for (const signal of ['disconnect', 'SIGTERM', 'SIGINT']) lifecycle.removeListener(signal, stop);
    return disposal = Promise.resolve().then(async () => {
      let failed = false;
      try { subscription?.(); } catch { failed = true; }
      const results = await Promise.allSettled(owned.map(closeEntry));
      if (failed || results.some(result => result.status === 'rejected')) fail('canvas_disposal_failed');
    });
  }
  function stop() { void dispose().catch(() => { process.exitCode = 1; }); }
  try {
    session = await sdk.joinSession({ canvases: [canvas] });
    if (!session || typeof session.sessionId !== 'string' || !id.test(session.sessionId)) fail('canvas_binding_invalid');
    boundSessionId = session.sessionId;
    const joined = session;
    unsubscribe = joined.on(event => {
      if (disposed) return;
      if (session !== joined || joined.sessionId !== boundSessionId
        || event.type === 'session.context_changed' || (event.type === 'session.shutdown' && !event.agentId)) {
        revoke();
        if (event.type === 'session.shutdown' && !event.agentId) stop();
        return;
      }
      for (const entry of entries.values()) if (!entry.pending) entry.host?.acceptActivity?.(event);
    });
    if (typeof unsubscribe !== 'function') fail('canvas_binding_invalid');
    if (disposed) { unsubscribe(); fail('canvas_binding_invalid'); }
    for (const signal of ['disconnect', 'SIGTERM', 'SIGINT']) lifecycle.once(signal, stop);
    return { canvas, dispose };
  } catch {
    await dispose();
    return fail('canvas_binding_invalid');
  }
}
