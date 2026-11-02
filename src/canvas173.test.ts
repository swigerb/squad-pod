import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';

// Exercise the staged module without resolving or installing the host-injected SDK.
const modulePath = '../spikes/canvas-173/com.github.copilot/extensions/canvas-173/probe.mjs';
const { createProbe, sanitizeEvent } = await import(modulePath);
class ProbeError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const active: Array<ReturnType<typeof createProbe>> = [];
const sessionId = 'synthetic-session';
const ctx = (instanceId = 'synthetic-panel') => ({
  sessionId, extensionId: 'project:canvas-173', canvasId: 'squad-pod-canvas-173',
  instanceId, input: {}, actionName: 'snapshot',
});
function fixture() {
  let handler: ((event: unknown) => void) | undefined;
  let subscriptions = 0;
  const probe = createProbe((options: unknown) => options, ProbeError);
  active.push(probe);
  probe.bind({
    sessionId, workspacePath: 'synthetic-artifact-workspace-not-project',
    on(callback: (event: unknown) => void) {
      handler = callback; subscriptions++;
      return () => { handler = undefined; subscriptions--; };
    },
  });
  return { probe, emit: (event: unknown) => handler?.(event), subscriptions: () => subscriptions };
}
function get(url: string, options: { method?: string; headers?: Record<string, string>; path?: string } = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request(url, options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
afterEach(async () => { await Promise.all(active.splice(0).map((probe) => probe.dispose())); });

describe('staged Canvas 173 probe (synthetic SDK boundary)', () => {
  it('uses the bare host SDK import with exactly one read-only action and no dependency manifest', () => {
    const entry = readFileSync(new URL('../spikes/canvas-173/com.github.copilot/extensions/canvas-173/extension.mjs', import.meta.url), 'utf8');
    expect(entry).toContain('from "@github/copilot-sdk/extension"');
    expect(entry).toContain('joinSession({ canvases: [probe.canvas] })');
    expect(existsSync(new URL('../spikes/canvas-173/com.github.copilot/extensions/canvas-173/package.json', import.meta.url))).toBe(false);
    const manifest = JSON.parse(readFileSync(new URL('../spikes/canvas-173/plugin.json', import.meta.url), 'utf8'));
    expect(manifest.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    expect(manifest.name).toBe('squad-pod-canvas-173');
    const { probe } = fixture();
    expect(probe.canvas.actions.map((action: { name: string }) => action.name)).toEqual(['snapshot']);
    expect(probe.canvas.inputSchema.additionalProperties).toBe(false);
  });

  it('authenticates per-instance loopback with strict Host, Origin, methods and target; fails closed on framing', async () => {
    const { probe } = fixture();
    const { url } = await probe.canvas.open(ctx());
    const valid = await get(url);
    expect(valid.status).toBe(200);
    expect(valid.body).toContain('synthetic read-only UI');
    expect(valid.body).not.toContain(sessionId);
    expect(valid.headers['content-security-policy']).toBe("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    expect(valid.headers['x-frame-options']).toBe('DENY');
    expect(valid.headers['cache-control']).toBe('no-store');
    expect(valid.headers['referrer-policy']).toBe('no-referrer');
    expect(valid.headers['access-control-allow-origin']).toBeUndefined();
    expect((await get(new URL('/', url).href)).status).toBe(403);
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
      expect((await get(url, { method })).status).toBe(405);
    }
    for (const headers of [{ Host: 'evil.invalid' }, { Origin: 'https://evil.invalid' }, { Origin: 'null' }]) {
      expect((await get(url, { headers })).status).toBe(403);
    }
    expect((await get(url, { headers: { Origin: new URL(url).origin } })).status).toBe(200);
    expect((await get(`${url}?extra=1`)).status).toBe(403);
    expect((await get(`${url}state`)).status).toBe(403);
    expect((await get(url, { path: url })).status).toBe(403);
    expect((await get(new URL('/wrong/', url).href)).status).toBe(403);
  });

  it('rejects session/provider mismatch, missing instances, invalid context and unknown input/action', async () => {
    const { probe } = fixture();
    const action = probe.canvas.actions[0].handler;
    expect(() => action(ctx())).toThrow('Open the instance first');
    await expect(probe.canvas.open({ ...ctx(), sessionId: 'other-session' })).rejects.toMatchObject({ code: 'probe_session_mismatch' });
    await probe.canvas.open(ctx());
    expect(() => action({ ...ctx(), sessionId: 'other-session' })).toThrow('Exact joined session');
    await expect(probe.canvas.onClose({ ...ctx(), sessionId: 'other-session' })).rejects.toThrow('Exact joined session');
    expect(() => action({ ...ctx(), extensionId: 'other-provider' })).toThrow('another provider');
    for (const input of [null, [], 'prompt', { extra: 'secret' }]) {
      await expect(probe.canvas.open({ ...ctx(), input })).rejects.toThrow('empty object');
      expect(() => action({ ...ctx(), input })).toThrow('empty object');
    }
    expect(() => action({ ...ctx(), actionName: 'write' })).toThrow('Unknown action');
    await expect(probe.canvas.open(ctx('../bad'))).rejects.toThrow('Invalid canvas context');
    const snapshot = action({ ...ctx(), session: { workingDirectory: 'synthetic-project' } });
    expect(snapshot.joinedSessionId).toBe(sessionId);
    expect(snapshot.selectedProjectRoot.status).toBe('unavailable');
    expect(snapshot.activeWorkingDirectoryAvailable).toBe(true);
    expect(snapshot.model).toEqual({ status: 'unavailable' });
    expect(snapshot.contextUsage).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(snapshot)).not.toContain('synthetic-project');
    expect(JSON.stringify(snapshot)).not.toContain('synthetic-artifact');
  });

  it('bounds and sanitizes event envelopes without raw producer data or opaque agent IDs', async () => {
    const f = fixture();
    await f.probe.canvas.open(ctx());
    const event = {
      type: 'session.idle', timestamp: '2026-11-02T16:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000001', parentId: '00000000-0000-4000-8000-000000000002',
      agentId: 'private-agent', data: { prompt: '<secret>', cwd: 'private-root', model: 'private-model' },
    };
    f.emit(event); f.emit(event);
    const action = f.probe.canvas.actions[0].handler;
    expect(action(ctx()).events).toEqual([{
      type: 'session.idle', timestamp: event.timestamp, eventId: event.id, parentEventId: event.parentId,
    }]);
    expect(sanitizeEvent({ ...event, timestamp: '2026-02-31T16:00:00Z', id: '<secret>', parentId: 'opaque' })).toEqual({ type: 'session.idle' });
    expect(sanitizeEvent({ ...event, type: 'user.message' })).toBeUndefined();
    expect(sanitizeEvent({ ...event, type: '<arbitrary>' })).toBeUndefined();
    expect(sanitizeEvent({ type: 'session.start', get data() { throw new Error('must not inspect data'); } })).toEqual({ type: 'session.start' });
    for (let i = 0; i < 80; i++) {
      f.emit({ type: 'assistant.turn_start' });
    }
    expect(action(ctx()).events).toHaveLength(32);
    const snapshot = action(ctx());
    snapshot.events.length = 0;
    expect(action(ctx()).events).toHaveLength(32);
  });

  it('opens idempotently, isolates instances, caps servers and closes/reopens with fresh capability', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.probe.canvas.open(ctx()), f.probe.canvas.open(ctx())]);
    expect(a.url).toBe(b.url);
    expect(f.subscriptions()).toBe(1);
    f.emit({ type: 'session.idle' });
    const second = await f.probe.canvas.open(ctx('second'));
    expect(second.url).not.toBe(a.url);
    expect((await get(new URL(new URL(a.url).pathname, second.url).href)).status).toBe(403);
    expect(f.probe.canvas.actions[0].handler(ctx('second')).events).toEqual([]);
    await f.probe.canvas.open(ctx('third'));
    await f.probe.canvas.open(ctx('fourth'));
    await expect(f.probe.canvas.open(ctx('fifth'))).rejects.toThrow('At most four');
    await f.probe.canvas.onClose(ctx());
    await f.probe.canvas.onClose(ctx());
    await expect(get(a.url)).rejects.toThrow();
    expect((await get(second.url)).status).toBe(200);
    const reopened = await f.probe.canvas.open(ctx());
    expect(reopened.url).not.toBe(a.url);
    expect(f.probe.canvas.actions[0].handler(ctx()).events).toEqual([]);
    await f.probe.dispose();
    await f.probe.dispose();
    expect(f.subscriptions()).toBe(0);
    await expect(get(reopened.url)).rejects.toThrow();
    await expect(get(second.url)).rejects.toThrow();
    await expect(f.probe.canvas.open(ctx())).rejects.toThrow('Provider is closed');
  });

  it('rejects callbacks before binding and refuses session replacement in the same provider', async () => {
    const probe = createProbe((options: unknown) => options, ProbeError);
    active.push(probe);
    await expect(probe.canvas.open(ctx())).rejects.toThrow('not ready');
    const f = fixture();
    expect(() => f.probe.bind({ sessionId: 'replacement', on: () => () => {} })).toThrow('single valid joined session');
  });

  it('unsubscribes on last close and starts a fresh bounded observation window on reopen', async () => {
    const f = fixture();
    await f.probe.canvas.open(ctx());
    f.emit({ type: 'session.idle' });
    await f.probe.canvas.onClose(ctx());
    expect(f.subscriptions()).toBe(0);
    f.emit({ type: 'session.idle' });
    await f.probe.canvas.open(ctx());
    expect(f.subscriptions()).toBe(1);
    expect(f.probe.canvas.actions[0].handler(ctx()).events).toEqual([]);
  });

  it('cleans up an open racing with close or provider disposal', async () => {
    for (const dispose of [false, true]) {
      const { probe } = fixture();
      const opening = probe.canvas.open(ctx());
      const rejected = expect(opening).rejects.toMatchObject({ code: 'probe_closed' });
      await (dispose ? probe.dispose() : probe.canvas.onClose(ctx()));
      await rejected;
    }
  });

  it('reports an explicit subscription error and allows safe disposal after startup failure', async () => {
    const probe = createProbe((options: unknown) => options, ProbeError);
    active.push(probe);
    probe.bind({ sessionId, on() { throw new Error('private upstream text'); } });
    await expect(probe.canvas.open(ctx())).rejects.toMatchObject({
      code: 'probe_subscription_failed', message: 'Session event subscription failed',
    });
    await probe.dispose();
  });
});
