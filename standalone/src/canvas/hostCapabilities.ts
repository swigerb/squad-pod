import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import type { JoinedSession } from '@github/copilot-sdk/extension';
import { ProjectFiles } from '../../../src/projectFiles.js';
import { readTeamSource, selectTeamSourceDirectory } from '../../../src/teamSource.js';
import { parseTeamRoster } from '../../../src/teamParser.js';
import { readMemberCharter } from '../../../src/memberCharter.js';
import { isObserverLayout } from '../events.js';
import type { OutboundMessage } from '../../../src/types.js';
import { CANVAS_CHARTER_UNAVAILABLE, type CanvasHostResult, type CanvasUsageQuantity } from '../../../src/core/canvasHost.js';

export type CanvasHostHandler = ((input: unknown, editing: boolean) => Promise<CanvasHostResult>) & {
  available?: () => { charter: boolean; usage: boolean; export: boolean };
};
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const MAX_BYTES = 2 * 1024 * 1024;
const HOST_RPC_TIMEOUT_MS = 1000;
const reason = 'Host capability unavailable or rejected. Outcome unconfirmed; no automatic retry.';
/** A member file/declaration refusal confirmed locally; no host call is pending or made for it. */
class LocalRefusal extends Error {
  readonly generation: number;
  constructor(generation: number) { super(); this.generation = generation; }
}

/** Never accept a session ID, root, canvas ID or export destination from the browser. */
export function createHostCapabilities(session: JoinedSession, root: string, instanceId: string,
  assertActive: () => number, snapshot: () => Promise<OutboundMessage[]>): CanvasHostHandler {
  const files = new ProjectFiles(root);
  const failed = new Set<string>();
  const available = () => ({
    charter: !failed.has('charter') && typeof session.rpc?.canvas?.open === 'function'
      && typeof session.rpc?.canvas?.list === 'function',
    usage: !failed.has('usage') && typeof session.rpc?.usage?.getMetrics === 'function',
    export: !failed.has('export') && typeof session.rpc?.workspaces?.createFile === 'function',
  });
  let busy = false;
  const current = (generation: number) => { try { return assertActive() === generation; } catch { return false; } };
  const handle: CanvasHostHandler = async (input, editing) => {
    let operation = '';
    let invoked = false;
    try {
      const generation = assertActive();
      const check = () => { if (assertActive() !== generation) throw new Error(); };
      async function invoke<T>(call: () => Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        invoked = true;
        try {
          // A timeout retires this operation, not the SDK request or its side effects.
          return await Promise.race([
            Promise.resolve().then(() => { check(); return call(); }),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error()), HOST_RPC_TIMEOUT_MS);
            }),
          ]);
        } finally { clearTimeout(timer); }
      }
      if (!object(input) || typeof input.operation !== 'string') throw new Error();
      operation = input.operation;
      const field = operation === 'charter' ? 'slug' : operation === 'export' ? 'content' : operation === 'import' ? 'path' : null;
      if (!['capabilities', 'usage', 'charter', 'export', 'import'].includes(operation)
        || Object.keys(input).length !== (field ? 2 : 1) || (field && typeof input[field] !== 'string')
        || failed.has(operation) || busy) throw new Error();
      if (operation === 'capabilities') return { ok: true, capabilities: available() };
      if ((operation === 'import' || operation === 'export') && !editing) throw new Error();
      busy = true;
      try {
        if (operation === 'charter') {
          if (!available().charter || typeof input.slug !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.slug)) throw new Error();
          const slug = input.slug;
          const messages = await invoke(snapshot);
          check();
          const roster = messages.find(message => message.type === 'existingAgents')?.agents ?? [];
          // Validate this member locally before any Editor RPC, so its file cannot poison other members.
          const charter = readMemberCharter({ workspaceRoot: root, isCurrentMember: id => roster.some(m => m.id === id) }, slug);
          if (charter.charterStatus !== 'available') throw new LocalRefusal(generation);
          const path = join(selectTeamSourceDirectory(files), 'agents', slug, 'charter.md');
          const declaredHere = () => {
            const source = readTeamSource(files);
            if (source.status !== 'available') return false;
            const declared = parseTeamRoster(source.content).filter(member => member.slug === slug);
            return declared.length === 1 && declared[0].charterPath.replace(/\\/g, '/') === path.split(sep).join('/');
          };
          if (!declaredHere()) throw new LocalRefusal(generation);
          check();
          const catalog = await invoke(() => session.rpc!.canvas!.list!());
          if (!object(catalog) || !Array.isArray(catalog.canvases)) throw new Error();
          const editors = catalog.canvases.filter(c => object(c) && c.canvasId === 'editor');
          if (editors.length !== 1) throw new Error();
          const editor: unknown = editors[0];
          if (!object(editor) || typeof editor.extensionId !== 'string' || !object(editor.inputSchema)) throw new Error();
          const editorProvider = editor.extensionId;
          const schema = editor.inputSchema;
          if (!object(schema.properties) || !object(schema.properties.scope) || !object(schema.properties.path)
            || schema.properties.path.type !== 'string' || !Array.isArray(schema.properties.scope.enum)
            || !schema.properties.scope.enum.includes('repo') || !Array.isArray(schema.required)
            || schema.required.some(key => key !== 'scope' && key !== 'path')) throw new Error();
          // Editor repo scope is not cwd scope: translate from Git's actual worktree root.
          const git = await promisify(execFile)('git', ['-C', root, 'rev-parse', '--show-toplevel'],
            { timeout: 1000, maxBuffer: 8192, windowsHide: true });
          const repo = realpathSync(git.stdout.trim());
          const prefix = relative(repo, files.root);
          if (isAbsolute(prefix) || prefix.split(sep).includes('..')) throw new Error();
          const target = files.resolve(path);
          const repoPath = relative(repo, target).split(sep).join('/');
          check();
          // Authoritative recheck at the open boundary: a declaration or file that changed during discovery fails closed.
          if (!declaredHere() || readMemberCharter({ workspaceRoot: root, isCurrentMember: id => roster.some(m => m.id === id) }, slug)
            .charterStatus !== 'available') throw new Error();
          const targetInstance = `squad-charter-${instanceId}-${slug}`;
          const opened = await invoke(() => session.rpc!.canvas!.open({ extensionId: editorProvider, canvasId: 'editor',
            instanceId: targetInstance,
            input: { scope: 'repo', path: repoPath } }));
          check();
          if (!object(opened) || opened.canvasId !== 'editor' || opened.extensionId !== editorProvider
            || opened.instanceId !== targetInstance) throw new Error();
          return { ok: true };
        }
        if (operation === 'usage') {
          if (!available().usage) throw new Error();
          const metrics = await invoke(() => session.rpc!.usage!.getMetrics());
          check();
          if (!object(metrics)) throw new Error();
          const quantities: CanvasUsageQuantity[] = [];
          for (const [key, label, unit] of [
            ['totalUserRequests', 'User-initiated API requests', 'requests'],
            ['totalPremiumRequestCost', 'Premium-request cost (multiplier applied)', 'premium requests'],
            ['totalApiDurationMs', 'API time', 'ms'],
            ['totalNanoAiu', 'AI usage', 'nano-AI units'],
          ]) {
            const value = metrics[key];
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) quantities.push({ label, value, unit });
          }
          return { ok: true, quantities };
        }
        if (operation === 'export') {
          if (!available().export || typeof input.content !== 'string' || Buffer.byteLength(input.content) > MAX_BYTES
            || !isObserverLayout(JSON.parse(input.content))) throw new Error();
          const path = `squad-pod-layout-${randomUUID()}.json`;
          check();
          const content = input.content;
          await invoke(() => session.rpc!.workspaces!.createFile({ path, content }));
          check();
          return { ok: true, path };
        }
        if (typeof input.path !== 'string' || input.path.length > 4096 || !input.path.endsWith('.json') || /[\\:\x00-\x1f\x7f]/.test(input.path)
          || isAbsolute(input.path) || input.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error();
        const content = files.read(input.path, MAX_BYTES);
        if (content === null) throw new Error();
        const layout: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
        if (!isObserverLayout(layout)) throw new Error();
        check();
        return { ok: true, layout };
      } finally { busy = false; }
    } catch (error) {
      // Only a typed local refusal, raised before any Editor RPC, keeps the capability usable.
      if (error instanceof LocalRefusal && current(error.generation)) return { ok: false, reason: CANVAS_CHARTER_UNAVAILABLE, failure: 'request' };
      // Host rejections are terminal for this instance's host path, never leaked SDK diagnostics.
      if (invoked) failed.add(operation);
      return { ok: false, reason };
    }
  };
  handle.available = available;
  return handle;
}
