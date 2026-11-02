import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the staged module without resolving or installing the host-injected SDK.
const modulePath = '../spikes/canvas-173/com.github.copilot/extensions/canvas-173/probe.mjs';
const { createProbe, sanitizeEvent } = await import(modulePath);
class ProbeError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const active: Array<ReturnType<typeof createProbe>> = [];
const fixtureRoot = mkdtempSync(fileURLToPath(new URL('../.canvas173-fixture-', import.meta.url)));
const selectedRoot = join(fixtureRoot, 'selected');
const otherRoot = join(fixtureRoot, 'other');
mkdirSync(selectedRoot);
mkdirSync(otherRoot);
mkdirSync(join(selectedRoot, 'child'));
const sessionId = 'synthetic-session';
const ctx = (instanceId = 'synthetic-panel') => ({
  sessionId, extensionId: 'project:canvas-173', canvasId: 'squad-pod-canvas-173',
  instanceId, input: {}, actionName: 'snapshot',
  session: { workingDirectory: selectedRoot },
});
const openCtx = (instanceId = 'synthetic-panel') => ({
  ...ctx(instanceId), input: { syntheticProjectRoot: selectedRoot },
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
afterAll(() => { rmSync(fixtureRoot, { recursive: true, force: true }); });

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
    expect(probe.canvas.inputSchema.required).toEqual(['syntheticProjectRoot']);
  });

  it('authenticates per-instance loopback with strict Host, Origin, methods and target; preserves security headers', async () => {
    const { probe } = fixture();
    const { url } = await probe.canvas.open(openCtx());
    const valid = await get(url);
    expect(valid.status).toBe(200);
    expect(valid.body).toContain('synthetic read-only UI');
    expect(valid.body).not.toContain(sessionId);
    expect(valid.body).not.toContain('Native framing is deliberately blocked');
    expect(valid.body).toContain('Security headers remain unchanged');
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
    await expect(probe.canvas.open({ ...openCtx(), sessionId: 'other-session' })).rejects.toMatchObject({ code: 'probe_session_mismatch' });
    await probe.canvas.open(openCtx());
    expect(() => action({ ...ctx(), sessionId: 'other-session' })).toThrow('Exact joined session');
    await expect(probe.canvas.onClose({ ...ctx(), sessionId: 'other-session' })).rejects.toThrow('Exact joined session');
    expect(() => action({ ...ctx(), extensionId: 'other-provider' })).toThrow('another provider');
    await expect(probe.canvas.open({ ...openCtx('other-panel'), extensionId: 'other-provider' })).rejects.toThrow('another provider');
    for (const input of [null, [], 'prompt', { extra: 'secret' }]) {
      await expect(probe.canvas.open({ ...openCtx(), input })).rejects.toThrow('explicit syntheticProjectRoot');
      expect(() => action({ ...ctx(), input })).toThrow('empty object');
    }
    expect(() => action({ ...ctx(), actionName: 'write' })).toThrow('Unknown action');
    await expect(probe.canvas.open(openCtx('../bad'))).rejects.toThrow('Invalid canvas context');
    const snapshot = action(ctx());
    expect(snapshot.exactJoinedSession).toBe(true);
    expect(snapshot.selectedProjectRoot).toEqual({ status: 'matched', scope: 'explicit-synthetic-root-equality-only' });
    expect(snapshot.activeWorkingDirectoryAvailable).toBe(true);
    expect(snapshot.model).toEqual({ status: 'unavailable' });
    expect(snapshot.contextUsage).toEqual({ status: 'unavailable' });
    expect(snapshot.runtime).toEqual({
      scope: 'extension-process',
      node: { status: 'available', value: process.version },
      platform: { status: 'available', value: process.platform },
      arch: { status: 'available', value: process.arch },
      sdkVersion: { status: 'unavailable' }, appVersion: { status: 'unavailable' },
    });
    expect(snapshot.listener).toMatchObject({ scope: 'this-instance', transport: 'ipv4-loopback' });
    expect(Number.isInteger(snapshot.listener.port)).toBe(true);
    expect(snapshot.listener.port).toBeGreaterThan(0);
    expect(snapshot.listener.port).toBeLessThanOrEqual(65535);
    expect(JSON.stringify(snapshot)).not.toContain('http://');
    expect(JSON.stringify(snapshot)).not.toContain(selectedRoot);
    expect(JSON.stringify(snapshot)).not.toContain(sessionId);
    expect(JSON.stringify(snapshot)).not.toContain('synthetic-artifact');
  });

  it('bounds and sanitizes event envelopes without raw producer data or opaque agent IDs', async () => {
    const f = fixture();
    await f.probe.canvas.open(openCtx());
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
    const [a, b] = await Promise.all([f.probe.canvas.open(openCtx()), f.probe.canvas.open(openCtx())]);
    expect(a.url).toBe(b.url);
    expect(f.subscriptions()).toBe(1);
    f.emit({ type: 'session.idle' });
    const second = await f.probe.canvas.open(openCtx('second'));
    expect(second.url).not.toBe(a.url);
    expect(f.probe.canvas.actions[0].handler(ctx()).listener.port).toBe(Number(new URL(a.url).port));
    expect(f.probe.canvas.actions[0].handler(ctx('second')).listener.port).toBe(Number(new URL(second.url).port));
    expect((await get(new URL(new URL(a.url).pathname, second.url).href)).status).toBe(403);
    expect(f.probe.canvas.actions[0].handler(ctx('second')).events).toEqual([]);
    await f.probe.canvas.open(openCtx('third'));
    await f.probe.canvas.open(openCtx('fourth'));
    await expect(f.probe.canvas.open(openCtx('fifth'))).rejects.toThrow('At most four');
    await f.probe.canvas.onClose(ctx());
    await f.probe.canvas.onClose(ctx());
    await expect(get(a.url)).rejects.toThrow();
    expect((await get(second.url)).status).toBe(200);
    const reopened = await f.probe.canvas.open(openCtx());
    expect(reopened.url).not.toBe(a.url);
    expect(f.probe.canvas.actions[0].handler(ctx()).events).toEqual([]);
    await f.probe.dispose();
    await f.probe.dispose();
    expect(f.subscriptions()).toBe(0);
    await expect(get(reopened.url)).rejects.toThrow();
    await expect(get(second.url)).rejects.toThrow();
    await expect(f.probe.canvas.open(openCtx())).rejects.toThrow('Provider is closed');
  });

  it('rejects callbacks before binding and refuses session replacement in the same provider', async () => {
    const probe = createProbe((options: unknown) => options, ProbeError);
    active.push(probe);
    await expect(probe.canvas.open(openCtx())).rejects.toThrow('not ready');
    const f = fixture();
    expect(() => f.probe.bind({ sessionId: 'replacement', on: () => () => {} })).toThrow('single valid joined session');
  });

  it('unsubscribes on last close and starts a fresh bounded observation window on reopen', async () => {
    const f = fixture();
    await f.probe.canvas.open(openCtx());
    f.emit({ type: 'session.idle' });
    await f.probe.canvas.onClose(ctx());
    expect(f.subscriptions()).toBe(0);
    f.emit({ type: 'session.idle' });
    await f.probe.canvas.open(openCtx());
    expect(f.subscriptions()).toBe(1);
    expect(f.probe.canvas.actions[0].handler(ctx()).events).toEqual([]);
  });

  it('cleans up an open racing with close or provider disposal', async () => {
    for (const dispose of [false, true]) {
      const { probe } = fixture();
      const opening = probe.canvas.open(openCtx());
      expect(() => probe.canvas.actions[0].handler(ctx())).toThrow('Instance is not ready');
      const rejected = expect(opening).rejects.toMatchObject({ code: 'probe_closed' });
      await (dispose ? probe.dispose() : probe.canvas.onClose(ctx()));
      await rejected;
    }
  });

  it('reports an explicit subscription error and allows safe disposal after startup failure', async () => {
    const probe = createProbe((options: unknown) => options, ProbeError);
    active.push(probe);
    probe.bind({ sessionId, on() { throw new Error('private upstream text'); } });
    await expect(probe.canvas.open(openCtx())).rejects.toMatchObject({
      code: 'probe_subscription_failed', message: 'Session event subscription failed',
    });
    await probe.dispose();
  });

  it('rejects missing, nonlocal, malformed, missing-on-disk and descendant roots before any listener or subscription', async () => {
    const f = fixture();
    for (const input of [undefined, {}, null, [], { syntheticProjectRoot: selectedRoot, extra: true }]) {
      await expect(f.probe.canvas.open({ ...openCtx(), input })).rejects.toMatchObject({ code: 'probe_input_invalid' });
    }
    const file = join(fixtureRoot, 'not-directory');
    writeFileSync(file, 'synthetic-only');
    for (const root of [null, 1, '', '.', 'relative', 'C:relative', '\\\\server\\share', '\\\\?\\C:\\device', 'file:///root', `${selectedRoot}\0`, join(fixtureRoot, 'missing'), file]) {
      await expect(f.probe.canvas.open({ ...openCtx(), input: { syntheticProjectRoot: root } })).rejects.toMatchObject({ code: 'probe_root_unavailable' });
    }
    for (const session of [undefined, {}, { workingDirectory: null }, { workingDirectory: '.' }]) {
      await expect(f.probe.canvas.open({ ...openCtx(), session })).rejects.toMatchObject({ code: 'probe_root_unavailable' });
    }
    for (const workingDirectory of [otherRoot, join(selectedRoot, 'child')]) {
      await expect(f.probe.canvas.open({ ...openCtx(), session: { workingDirectory } })).rejects.toMatchObject({ code: 'probe_root_mismatch' });
    }
    expect(f.subscriptions()).toBe(0);
    expect(() => f.probe.canvas.actions[0].handler(ctx())).toThrow('Open the instance first');
  });

  it('accepts canonical aliases but rejects stale host context and root replacement until owned close', async () => {
    const f = fixture();
    const alias = join(fixtureRoot, 'alias');
    symlinkSync(selectedRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliasCtx = { ...openCtx(), input: { syntheticProjectRoot: alias } };
    const opened = await f.probe.canvas.open(aliasCtx);
    expect((await f.probe.canvas.open({ ...openCtx(), input: { syntheticProjectRoot: `${selectedRoot}${sep}.` } })).url).toBe(opened.url);
    const action = f.probe.canvas.actions[0].handler;
    expect(action({ ...ctx(), session: { workingDirectory: alias } }).selectedProjectRoot.status).toBe('matched');
    if (process.platform === 'win32') {
      expect(action({ ...ctx(), session: { workingDirectory: selectedRoot.toUpperCase() } }).exactJoinedSession).toBe(true);
    }
    expect(() => action({ ...ctx(), session: undefined })).toThrow('active session context');
    expect(() => action({ ...ctx(), session: { workingDirectory: otherRoot } })).toThrow('Exact active directory');
    expect(() => action({ ...ctx(), session: { workingDirectory: join(selectedRoot, 'child') } })).toThrow('Exact active directory');
    const replacement = { ...openCtx(), input: { syntheticProjectRoot: otherRoot }, session: { workingDirectory: otherRoot } };
    await expect(f.probe.canvas.open(replacement)).rejects.toMatchObject({ code: 'probe_root_mismatch' });
    unlinkSync(alias);
    symlinkSync(otherRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => action({ ...ctx(), session: { workingDirectory: otherRoot } })).toThrow('root binding has changed');
    await expect(f.probe.canvas.onClose({ ...ctx(), extensionId: 'hijack', session: undefined })).rejects.toThrow('another provider');
    await expect(f.probe.canvas.onClose({ ...ctx(), canvasId: 'hijack', session: undefined })).rejects.toThrow('Invalid canvas');
    await f.probe.canvas.onClose({ ...ctx(), session: undefined });
    await expect(get(opened.url)).rejects.toThrow();
    await expect(f.probe.canvas.open({ ...replacement, extensionId: 'hijack' })).rejects.toThrow('another provider');
    const reopened = await f.probe.canvas.open(replacement);
    expect(reopened.url).not.toBe(opened.url);
    expect(action({ ...ctx(), session: { workingDirectory: otherRoot } }).selectedProjectRoot.status).toBe('matched');
    expect(() => action(ctx())).toThrow('Exact active directory');
    unlinkSync(alias);
  });

  it('detects replacement at the same canonical path and closes safely after directory disappearance', async () => {
    const f = fixture();
    const root = join(fixtureRoot, 'replaceable');
    const moved = join(fixtureRoot, 'displaced');
    mkdirSync(root);
    const context = { ...openCtx(), input: { syntheticProjectRoot: root }, session: { workingDirectory: root } };
    const { url } = await f.probe.canvas.open(context);
    renameSync(root, moved);
    mkdirSync(root);
    expect(() => f.probe.canvas.actions[0].handler({ ...context, input: {} })).toThrow('root binding has changed');
    rmSync(root, { recursive: true });
    expect(() => f.probe.canvas.actions[0].handler({ ...context, input: {} })).toThrow('active session context');
    await f.probe.canvas.onClose(context);
    await expect(get(url)).rejects.toThrow();
    expect(f.subscriptions()).toBe(0);
  });
});
