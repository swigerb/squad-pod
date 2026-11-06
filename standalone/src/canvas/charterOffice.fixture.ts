import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JoinedSession } from '@github/copilot-sdk/extension';
import type { OutboundMessage } from '../../../src/types.js';
import { createHostCapabilities } from './hostCapabilities.js';

/**
 * Test-only (never bundled): one read-only Project A office with a valid Amber A
 * charter and a declared-but-absent Cedar A charter, served through the real
 * instance-owned host capability handler and the transport's JSON reply shape.
 */
export async function createCharterOffice(base: string) {
  const repo = join(base, `.canvas-charter-${randomUUID()}`);
  const root = join(repo, 'project-a');
  await mkdir(join(root, '.squad', 'agents', 'amber-a'), { recursive: true });
  execFileSync('git', ['init', '--quiet', repo], { windowsHide: true });
  await writeFile(join(root, '.squad', 'team.md'), '# Team\n## Members\n| Name | Role | Charter | Status |\n|---|---|---|---|\n'
    + '| Amber A | Dev | .squad/agents/amber-a/charter.md | Active |\n'
    + '| Cedar A | Dev | .squad/agents/cedar-a/charter.md | Active |\n');
  await writeFile(join(root, '.squad', 'agents', 'amber-a', 'charter.md'), '# Amber A\nValid charter.');
  const agents = ['amber-a', 'cedar-a'].map((id, paletteIndex) => ({ id, name: id === 'amber-a' ? 'Amber A' : 'Cedar A',
    role: 'Dev', status: 'idle' as const, paletteIndex, seatId: null, currentTask: null }));
  const state = { opens: [] as Array<{ instanceId: string; path: string }>, lists: 0, snapshots: 0, metrics: 0,
    openBehavior: 'open' as 'open' | 'reject' | 'hang', disposed: false,
    onList: undefined as undefined | (() => Promise<void>),
    onOpen: undefined as undefined | (() => Promise<void>),
    onMetrics: undefined as undefined | (() => Promise<void>) };
  const schema = { type: 'object', properties: { scope: { enum: ['workspace', 'repo'] }, path: { type: 'string' } }, required: ['scope'] };
  const session: JoinedSession = { sessionId: 'joined', on: () => () => {}, rpc: { canvas: {
    list: async () => {
      state.lists++;
      await state.onList?.();
      return { canvases: [{ canvasId: 'editor', extensionId: 'builtin', inputSchema: schema }] };
    },
    open: async params => {
      state.opens.push({ instanceId: params.instanceId, path: params.input.path });
      await state.onOpen?.();
      if (state.openBehavior === 'reject') throw new Error('SECRET C:\\private host diagnostic');
      if (state.openBehavior === 'hang') return new Promise(() => {});
      return { canvasId: params.canvasId, instanceId: params.instanceId, extensionId: params.extensionId };
    },
  }, usage: { getMetrics: async () => {
    state.metrics++;
    await state.onMetrics?.();
    return { totalUserRequests: 3 };
  } } } };
  const handle = createHostCapabilities(session, root, 'project-a', () => {
    if (state.disposed) throw new Error('disposed');
    return 0;
  }, async (): Promise<OutboundMessage[]> => { state.snapshots++; return [{ type: 'existingAgents', agents }]; });
  /** Mirrors transport.ts: disposed instances get 403, otherwise the handler result as 200 JSON. */
  async function request(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
    if (state.disposed) return new Response('FORBIDDEN', { status: 403 });
    const result = await handle(JSON.parse(String(init?.body)), false);
    if (state.disposed) return new Response('FORBIDDEN', { status: 403 });
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  return { handle, request, state, agents, root, cleanup: () => rm(repo, { recursive: true, force: true }) };
}
