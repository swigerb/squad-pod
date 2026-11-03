import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { request } from 'node:http';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  const callbacks: Array<(event: unknown) => void> = [];
  let subscriptions = 0;
  const unsubscribed: Array<(event: unknown) => void> = [];
  const probe = createProbe((options: unknown) => options, ProbeError);
  active.push(probe);
  probe.bind({
    sessionId, workspacePath: 'synthetic-artifact-workspace-not-project',
    on(callback: (event: unknown) => void) {
      handler = callback; callbacks.push(callback); subscriptions++;
      return () => {
        unsubscribed.push(callback);
        if (handler === callback) handler = undefined;
        subscriptions--;
      };
    },
  });
  return { probe, callbacks, unsubscribed, emit: (event: unknown) => handler?.(event), subscriptions: () => subscriptions };
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
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await Promise.all(active.splice(0).map((probe) => probe.dispose()));
});
afterAll(() => { rmSync(fixtureRoot, { recursive: true, force: true }); });

describe('staged Canvas 173 probe (synthetic SDK boundary)', () => {
  async function artifactFixture(projectLocal = false) {
    const root = mkdtempSync(join(fixtureRoot, 'artifacts-'));
    const directory = join(root, projectLocal ? '.github' : 'com.github.copilot', 'extensions', 'canvas-173');
    mkdirSync(directory, { recursive: true });
    const source = readFileSync(new URL(modulePath, import.meta.url));
    writeFileSync(join(directory, 'probe.mjs'), source);
    writeFileSync(join(directory, 'extension.mjs'), '// synthetic entry only\n');
    writeFileSync(join(root, 'plugin.json'), '{"version":"0.0.0","private":"never-return"}');
    const imported = await import(pathToFileURL(join(directory, 'probe.mjs')).href);
    const probe = imported.createProbe((options: unknown) => options, ProbeError, {
      moduleUrl: pathToFileURL(join(root, 'never-read-caller-path.mjs')).href,
    });
    active.push(probe);
    probe.bind({ sessionId, on: () => () => {} });
    await probe.canvas.open(openCtx());
    return {
      root, directory, probe,
      snapshot: () => probe.canvas.actions[0].handler(ctx()).artifactProvenance,
    };
  }

  it('hashes the actual module-relative artifacts independently without source, paths or commit claims', async () => {
    const { probe } = fixture();
    await probe.canvas.open(openCtx());
    const provenance = probe.canvas.actions[0].handler(ctx()).artifactProvenance;
    expect(provenance.scope).toBe('own-artifacts-at-observation-time');
    expect(provenance.limitation).toContain('not immutable in-memory code');
    expect(provenance.maxArtifactBytes).toEqual({ source: 262144, manifest: 16384 });
    expect(provenance.readCapsBytes).toEqual({ source: 262145, manifest: 16385 });
    for (const [label, url] of [
      ['extension.mjs', new URL('../spikes/canvas-173/com.github.copilot/extensions/canvas-173/extension.mjs', import.meta.url)],
      ['probe.mjs', new URL(modulePath, import.meta.url)],
      ['plugin.json', new URL('../spikes/canvas-173/plugin.json', import.meta.url)],
    ] as const) {
      const bytes = readFileSync(url);
      expect(provenance.artifacts[label]).toMatchObject({
        status: 'available', sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length,
      });
      expect(provenance.artifacts[label].sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(provenance.artifacts['plugin.json'].version).toEqual({ status: 'available', value: '0.0.0' });
    expect(JSON.stringify(provenance)).not.toContain(fileURLToPath(new URL('..', import.meta.url)));
    expect(JSON.stringify(provenance)).not.toContain('import {');
    expect(() => probe.canvas.actions[0].handler({ ...ctx(), input: { moduleUrl: 'file:///private' } })).toThrow('empty object');
  });

  it('uses observation-time bytes and never falls back to repository manifests for project-local loading', async () => {
    const f = await artifactFixture(true);
    expect(f.snapshot().artifacts['plugin.json']).toEqual({ status: 'unavailable', reason: 'unsupported-layout' });
    const before = f.snapshot().artifacts['extension.mjs'].sha256;
    writeFileSync(join(f.directory, 'extension.mjs'), '// changed after import\n');
    const after = f.snapshot().artifacts['extension.mjs'];
    expect(after.sha256).not.toBe(before);
    expect(after.sha256).toBe(createHash('sha256').update('// changed after import\n').digest('hex'));
    expect(JSON.stringify(f.snapshot())).not.toContain('never-return');
  });

  it('reports absent, malformed and unsafe manifest versions without exposing their values', async () => {
    const f = await artifactFixture();
    const manifest = join(f.root, 'plugin.json');
    const observedManifest = async () => {
      // Windows metadata observers can update ctime just after a fixture write.
      // Keep production's conservative "changed" result; only settle this parser fixture.
      let result;
      for (let attempt = 0; attempt < 10; attempt++) {
        result = f.snapshot().artifacts['plugin.json'];
        if (result.reason !== 'changed') {
          return result;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return result;
    };
    unlinkSync(manifest);
    expect(f.snapshot().artifacts['plugin.json']).toEqual({ status: 'unavailable', reason: 'missing' });
    writeFileSync(manifest, '{private invalid');
    expect(await observedManifest()).toMatchObject({
      status: 'available', version: { status: 'unavailable', reason: 'malformed-manifest' },
    });
    for (const version of [undefined, null, 123, '../private', '1.2.3\nprivate', '1.2.3\n', '1.2.3\r\n', 'x'.repeat(65)]) {
      writeFileSync(manifest, JSON.stringify({ version }));
      expect((await observedManifest()).version).toEqual({ status: 'unavailable', reason: 'invalid-or-missing-version' });
    }
    writeFileSync(manifest, JSON.stringify({ version: '1.2.3-preview.1+build.2' }));
    expect((await observedManifest()).version).toEqual({ status: 'available', value: '1.2.3-preview.1+build.2' });
    writeFileSync(manifest, ' '.repeat(16385));
    expect(f.snapshot().artifacts['plugin.json']).toEqual({ status: 'unavailable', reason: 'too-large' });
  });

  it('refuses oversized, missing, nonregular and linked fixed artifacts', async () => {
    const f = await artifactFixture();
    const entry = join(f.directory, 'extension.mjs');
    writeFileSync(entry, Buffer.alloc(262144));
    expect(f.snapshot().artifacts['extension.mjs']).toMatchObject({ status: 'available', sizeBytes: 262144 });
    writeFileSync(entry, Buffer.alloc(262145));
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'too-large' });
    unlinkSync(entry);
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'missing' });
    mkdirSync(entry);
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'not-regular' });
    rmSync(entry, { recursive: true });
    // Directory junctions work on Windows without symlink privileges.
    symlinkSync(selectedRoot, entry, process.platform === 'win32' ? 'junction' : 'dir');
    const opens = vi.spyOn(fs, 'openSync');
    syncBuiltinESMExports();
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'link' });
    expect(opens.mock.calls.some(([path]) => path === entry)).toBe(false);
    unlinkSync(entry);
    const linkedTarget = join(f.root, 'synthetic-link-target');
    writeFileSync(linkedTarget, 'synthetic linked content must not be read');
    fs.linkSync(linkedTarget, entry);
    opens.mockClear();
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'link' });
    expect(opens.mock.calls.some(([path]) => path === entry)).toBe(false);
    unlinkSync(entry);
    writeFileSync(entry, '// synthetic');
    const displaced = `${f.directory}-displaced`;
    renameSync(f.directory, displaced);
    symlinkSync(displaced, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
    opens.mockClear();
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'link' });
    expect(opens.mock.calls.some(([path]) => path === entry)).toBe(false);
    unlinkSync(f.directory);
    renameSync(displaced, f.directory);
  });

  it('does no artifact opens for rejected context and redacts known and unexpected open errors', async () => {
    const f = await artifactFixture();
    const spy = vi.spyOn(fs, 'openSync');
    syncBuiltinESMExports();
    for (const context of [
      { ...ctx(), sessionId: 'other' }, { ...ctx(), input: { path: selectedRoot } },
      { ...ctx(), session: { workingDirectory: otherRoot } }, { ...ctx(), actionName: 'write' },
    ]) {
      expect(() => f.probe.canvas.actions[0].handler(context)).toThrow();
    }
    expect(spy).not.toHaveBeenCalled();
    await f.probe.canvas.open(openCtx());
    const snapshot = f.probe.canvas.actions[0].handler({
      ...ctx(), moduleUrl: pathToFileURL(join(f.root, 'never-read-context-path.mjs')).href,
    });
    expect(snapshot.artifactProvenance.artifacts['probe.mjs'].status).toBe('available');
    expect([...new Set(spy.mock.calls.map(([path]) => path))].sort()).toEqual([
      join(f.directory, 'extension.mjs'), join(f.directory, 'probe.mjs'), join(f.root, 'plugin.json'),
    ].sort());
    for (const [code, reason] of [['EACCES', 'permission-denied'], ['EPERM', 'permission-denied'], ['EIO', 'io-error'], ['PRIVATE', 'unexpected-error'], ['__proto__', 'unexpected-error']]) {
      spy.mockImplementation(() => { throw Object.assign(new Error(`private ${f.root}`), { code }); });
      syncBuiltinESMExports();
      expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'error', reason });
      expect(JSON.stringify(f.snapshot())).not.toContain(f.root);
    }
  });

  it.runIf(process.platform === 'win32')('accepts zero pathname device IDs but retains both stat-family identity checks', async () => {
    const f = await artifactFixture();
    const entry = join(f.directory, 'extension.mjs');
    const originalLstat = fs.lstatSync;
    const originalFstat = fs.fstatSync;
    let pathCalls = 0;
    let handleCalls = 0;
    let changePath = false;
    let changeHandle = false;
    let changeInode = false;
    vi.spyOn(fs, 'lstatSync').mockImplementation(((path: fs.PathLike, options: any) => {
      const stat = (originalLstat as any)(path, options);
      if (path === entry) {
        Object.defineProperty(stat, 'dev', { value: changePath && ++pathCalls === 2 ? 1n : 0n });
      }
      return stat;
    }) as any);
    vi.spyOn(fs, 'fstatSync').mockImplementation(((fd: number, options: any) => {
      const stat = (originalFstat as any)(fd, options);
      Object.defineProperty(stat, 'dev', { value: changeHandle && ++handleCalls === 2 ? 817n : 816n });
      if (changeInode) {
        Object.defineProperty(stat, 'ino', { value: stat.ino + 1n });
      }
      return stat;
    }) as any);
    syncBuiltinESMExports();
    expect(f.snapshot().artifacts['extension.mjs']).toMatchObject({
      status: 'available', sha256: createHash('sha256').update(readFileSync(entry)).digest('hex'),
    });
    changePath = true;
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'changed' });
    changePath = false;
    changeHandle = true;
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'changed' });
    changeHandle = false;
    changeInode = true;
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'changed' });
  });

  it('rejects a fixed-file substitution between lstat and open before reading it', async () => {
    const f = await artifactFixture();
    const entry = join(f.directory, 'extension.mjs');
    const originalOpen = fs.openSync;
    const originalRead = fs.readSync;
    let currentPath: fs.PathLike | undefined;
    let replacementReads = 0;
    const read = vi.spyOn(fs, 'readSync').mockImplementation((...args: any[]) => {
      if (currentPath === entry) {
        replacementReads++;
      }
      return (originalRead as any)(...args);
    });
    let replaced = false;
    vi.spyOn(fs, 'openSync').mockImplementation((path, flags, mode) => {
      if (path === entry && !replaced) {
        replaced = true;
        renameSync(entry, `${entry}-displaced`);
        writeFileSync(entry, '// replacement that must not be read');
      }
      currentPath = path;
      return originalOpen(path, flags, mode);
    });
    syncBuiltinESMExports();
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'changed' });
    expect(read).toHaveBeenCalled();
    expect(replacementReads).toBe(0);
  });

  it('caps reads during growth, detects same-size mutation and always closes opened handles', async () => {
    const f = await artifactFixture();
    const entry = join(f.directory, 'extension.mjs');
    const originalRead = fs.readSync;
    const closed: number[] = [];
    const originalClose = fs.closeSync;
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => { closed.push(fd); originalClose(fd); });
    let first = true;
    const read = vi.spyOn(fs, 'readSync').mockImplementation((...args: any[]) => {
      if (first) { first = false; writeFileSync(entry, Buffer.alloc(300000)); closed.length = 0; }
      return (originalRead as any)(...args);
    });
    syncBuiltinESMExports();
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'too-large' });
    expect(read.mock.calls[0][3]).toBe(262145);
    expect(closed).toHaveLength(3);
    writeFileSync(entry, '1234');
    first = true;
    read.mockImplementation((...args: any[]) => {
      if (first) {
        first = false;
        writeFileSync(entry, '5678');
        fs.utimesSync(entry, new Date(0), new Date(0));
        closed.length = 0;
      }
      return (originalRead as any)(...args);
    });
    syncBuiltinESMExports();
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'unavailable', reason: 'changed' });
    read.mockImplementation(() => { throw new Error('private read failure'); });
    syncBuiltinESMExports();
    expect(f.snapshot().artifacts['extension.mjs']).toEqual({ status: 'error', reason: 'unexpected-error' });
    expect(closed).toHaveLength(6);
  });

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

  it('projects bounded opaque correlations without raw IDs, arbitrary text or payload traversal', async () => {
    const f = fixture();
    await f.probe.canvas.open(openCtx());
    const event = {
      type: 'session.idle', timestamp: '2026-11-02T16:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000001', parentId: '00000000-0000-4000-8000-000000000002',
      agentId: 'private-agent', data: { prompt: '<secret>', cwd: 'private-root', model: 'private-model' },
    };
    f.emit(event);
    const action = f.probe.canvas.actions[0].handler;
    const projected = action(ctx()).events[0];
    expect(projected).toMatchObject({
      type: 'session.idle', producerTime: { status: 'valid' }, receiptTime: { status: 'valid' },
      event: { status: 'available' }, previousEvent: { status: 'available' }, actor: { status: 'available' },
      toolCall: { status: 'unavailable', reason: 'not-applicable' },
    });
    f.emit({ ...event, id: event.parentId, parentId: event.id });
    const next = action(ctx()).events[1];
    expect(next.previousEvent.alias).toBe(projected.event.alias);
    expect(next.event.alias).toBe(projected.previousEvent.alias);
    expect(next.actor.alias).toBe(projected.actor.alias);
    expect(next.actor.alias).not.toBe(next.event.alias);
    const invalid = sanitizeEvent({ ...event, timestamp: '2026-02-31T16:00:00Z', id: '<secret>', parentId: 'opaque' });
    expect(invalid).toMatchObject({
      producerTime: { status: 'unavailable', reason: 'invalid-or-unsupported-format' },
      event: { status: 'unavailable', reason: 'invalid-or-oversized' },
      previousEvent: { status: 'unavailable', reason: 'invalid-or-oversized' },
    });
    expect(sanitizeEvent({ ...event, type: 'user.message' })).toBeUndefined();
    expect(sanitizeEvent({ ...event, type: '<arbitrary>' })).toBeUndefined();
    expect(sanitizeEvent({ type: 'session.start', get data() { throw new Error('must not inspect data'); } }))
      .toMatchObject({ type: 'session.start', actor: { status: 'unavailable', reason: 'missing' } });
    for (const type of ['tool.execution_start', 'tool.execution_complete']) {
      f.emit({ ...event, type, data: { toolCallId: 'private-tool', get arguments() { throw new Error('private'); },
        get result() { throw new Error('private'); } } });
    }
    const tools = action(ctx()).events.slice(-2);
    expect(tools[0].toolCall.alias).toBe(tools[1].toolCall.alias);
    expect(tools[0].toolCall.status).toBe('available');
    const serialized = JSON.stringify(action(ctx()));
    for (const privateValue of [event.id, event.parentId, event.agentId, 'private-tool', '<secret>', 'private-root', event.timestamp]) {
      expect(serialized).not.toContain(privateValue);
    }
    for (let i = 0; i < 80; i++) {
      f.emit({ type: 'assistant.turn_start' });
    }
    expect(action(ctx()).events).toHaveLength(32);
    expect(action(ctx()).observation).toMatchObject({ accepted: 84, retained: 32, eventEvictions: 52,
      previousEventMeaning: 'chronologically-previous-event; not agent hierarchy' });
    const snapshot = action(ctx());
    snapshot.events.length = 0;
    expect(action(ctx()).events).toHaveLength(32);
  });

  it('reuses listeners, isolates instances, caps servers and closes/reopens with fresh capability', async () => {
    const f = fixture();
    const a = await f.probe.canvas.open(openCtx());
    const b = await f.probe.canvas.open(openCtx());
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

  it('immediately revokes all observations on context change and rejects queued callbacks until a new matching open', async () => {
    const f = fixture();
    const action = f.probe.canvas.actions[0].handler;
    await f.probe.canvas.open(openCtx());
    await f.probe.canvas.open(openCtx('second'));
    const first = f.callbacks[0];
    const second = f.callbacks[1];
    first({ type: 'session.idle', agentId: 'private-before-revoke' });
    const generation = action(ctx()).observation.generation;
    second({ type: 'session.context_changed', get data() { throw new Error('never follow context root'); } });
    expect(f.subscriptions()).toBe(0);
    for (const id of ['synthetic-panel', 'second']) {
      expect(() => action(ctx(id))).toThrow('new matching open callback');
    }
    first({ type: 'session.idle', agentId: 'queued-old' });
    await expect(f.probe.canvas.open({ ...openCtx(), session: { workingDirectory: otherRoot } }))
      .rejects.toMatchObject({ code: 'probe_root_mismatch' });
    expect(f.subscriptions()).toBe(0);
    await f.probe.canvas.open(openCtx());
    first({ type: 'session.idle' }); second({ type: 'session.context_changed' });
    const fresh = action(ctx());
    expect(fresh.observation.generation).not.toBe(generation);
    expect(fresh.events).toEqual([]);
    expect(fresh.observation).toMatchObject({ accepted: 0, ignored: 0, retainedAliases: 0, aliasEvictions: 0 });
    expect(() => action(ctx('second'))).toThrow('new matching open callback');
    await f.probe.canvas.open(openCtx('second'));
    expect(f.subscriptions()).toBe(2);
    const old = [...f.callbacks];
    await f.probe.canvas.onClose(ctx());
    expect(f.subscriptions()).toBe(1);
    await f.probe.canvas.open(openCtx());
    for (const callback of old.slice(0, 3)) callback({ type: 'session.idle' });
    expect(action(ctx()).events).toEqual([]);
    await f.probe.dispose();
    expect(f.subscriptions()).toBe(0);
    old.forEach((callback) => callback({ type: 'session.context_changed' }));
  });

  it('revokes on replaced host root context without following workspacePath or reviving on snapshot', async () => {
    const f = fixture();
    await f.probe.canvas.open(openCtx());
    const action = f.probe.canvas.actions[0].handler;
    const old = f.callbacks[0];
    old({ type: 'session.idle' });
    expect(() => action({ ...ctx(), session: { workingDirectory: otherRoot } })).toThrow('Exact active directory');
    expect(f.subscriptions()).toBe(0);
    expect(() => action(ctx())).toThrow('new matching open callback');
    await f.probe.canvas.open(openCtx());
    old({ type: 'session.idle' });
    expect(action(ctx()).events).toEqual([]);
    expect(action(ctx()).sessionArtifactWorkspaceAvailable).toBe(true);
  });

  it('starts fresh generations on replacement host opens and close/reopen with owned unsubscribe', async () => {
    const f = fixture();
    const action = f.probe.canvas.actions[0].handler;
    const first = await f.probe.canvas.open(openCtx());
    f.callbacks[0]({ type: 'session.idle', agentId: 'private-agent' });
    const before = action(ctx());
    const replacement = await f.probe.canvas.open(openCtx());
    expect(replacement.url).toBe(first.url);
    expect(f.subscriptions()).toBe(1);
    f.callbacks[0]({ type: 'session.idle' });
    const after = action(ctx());
    expect(after.events).toEqual([]);
    expect(after.observation.generation).not.toBe(before.observation.generation);
    await f.probe.canvas.onClose(ctx());
    expect(f.subscriptions()).toBe(0);
    await f.probe.canvas.open(openCtx());
    f.callbacks[1]({ type: 'session.context_changed' });
    expect(action(ctx()).events).toEqual([]);
    expect(action(ctx()).observation.generation).not.toBe(after.observation.generation);
    expect(f.subscriptions()).toBe(1);
  });

  it('owns unsubscribe even when context revocation occurs synchronously during registration', async () => {
    const probe = createProbe((options: unknown) => options, ProbeError);
    active.push(probe);
    const unsubscribe = vi.fn();
    probe.bind({ sessionId, on(callback: (event: unknown) => void) {
      callback({ type: 'session.context_changed' });
      return unsubscribe;
    } });
    await expect(probe.canvas.open(openCtx())).rejects.toMatchObject({ code: 'probe_observation_revoked' });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await probe.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('clears every observation before upstream unsubscribe and stays revoked if cleanup throws', async () => {
    const probe = createProbe((options: unknown) => options, ProbeError);
    active.push(probe);
    const callbacks: Array<(event: unknown) => void> = [];
    const cleanups: number[] = [];
    const observed: string[] = [];
    probe.bind({ sessionId, on(callback: (event: unknown) => void) {
      const index = callbacks.length;
      callbacks.push(callback);
      return () => {
        cleanups.push(index);
        for (const id of ['synthetic-panel', 'second']) {
          try { probe.canvas.actions[0].handler(ctx(id)); observed.push('stale-snapshot'); }
          catch (error) { observed.push((error as ProbeError).code); }
        }
        throw new Error('private upstream cleanup error');
      };
    } });
    await probe.canvas.open(openCtx());
    await probe.canvas.open(openCtx('second'));
    callbacks[0]({ type: 'session.context_changed' });
    expect(cleanups).toEqual([0, 1]);
    expect(observed).toEqual(Array(4).fill('probe_observation_revoked'));
    callbacks.forEach((callback) => callback({ type: 'session.idle' }));
    await probe.dispose();
    expect(cleanups).toEqual([0, 1]);
  });

  it('does not let an invalidated pending open return stale results or erase its newer generation', async () => {
    const f = fixture();
    const opening = f.probe.canvas.open(openCtx());
    const rejected = expect(opening).rejects.toMatchObject({ code: 'probe_closed' });
    f.callbacks[0]({ type: 'session.context_changed' });
    const replacement = f.probe.canvas.open(openCtx());
    await rejected;
    await replacement;
    expect(f.probe.canvas.actions[0].handler(ctx()).events).toEqual([]);
    expect(f.subscriptions()).toBe(1);
  });

  it('replaces pre-ready opens with an empty fresh observation and owns each unsubscribe exactly once', async () => {
    const f = fixture();
    const action = f.probe.canvas.actions[0].handler;
    await f.probe.canvas.open(openCtx());
    const previousGeneration = action(ctx()).observation.generation;
    await f.probe.canvas.onClose(ctx());

    const opening = f.probe.canvas.open(openCtx());
    const rejected = expect(opening).rejects.toMatchObject({ code: 'probe_closed' });
    const stale = f.callbacks[1];
    stale({ type: 'session.idle', agentId: 'private-pre-replacement' });
    const replacement = f.probe.canvas.open(openCtx());
    expect(f.callbacks).toHaveLength(3);
    expect(f.unsubscribed).toEqual(f.callbacks.slice(0, 2));
    expect(f.subscriptions()).toBe(1);
    stale({ type: 'session.idle', agentId: 'private-queued-old' });
    stale({ type: 'session.context_changed' });
    await rejected;
    const hosted = await replacement;
    const fresh = action(ctx());
    expect(fresh.events).toEqual([]);
    expect(fresh.observation).toMatchObject({
      accepted: 0, ignored: 0, retainedAliases: 0, eventEvictions: 0, aliasEvictions: 0,
    });
    expect(fresh.observation.generation).not.toBe(previousGeneration);
    expect((await get(hosted.url)).status).toBe(200);
    f.callbacks[2]({ type: 'session.idle', agentId: 'private-fresh' });
    expect(action(ctx()).events).toHaveLength(1);
    expect(action(ctx()).events[0].actor.alias).toBe(`${fresh.observation.generation}-actor-1`);
    await f.probe.dispose();
    expect(f.unsubscribed).toEqual(f.callbacks);
    expect(f.subscriptions()).toBe(0);
    f.callbacks.forEach((callback) => callback({ type: 'session.context_changed' }));
    await expect(get(hosted.url)).rejects.toThrow();
  });

  it('bounds FIFO alias storage, discloses eviction and never reuses evicted correlations', async () => {
    const f = fixture();
    await f.probe.canvas.open(openCtx());
    const action = f.probe.canvas.actions[0].handler;
    f.emit({ type: 'session.idle', agentId: 'first-private' });
    const first = action(ctx()).events[0].actor.alias;
    for (let i = 0; i < 128; i++) f.emit({ type: 'session.idle', agentId: `private-${i}` });
    f.emit({ type: 'session.idle', agentId: 'first-private' });
    f.emit({ type: 'tool.execution_start', agentId: 'x'.repeat(257), data: { toolCallId: 'x'.repeat(257) } });
    f.emit({ type: 'unknown.private', data: 'secret' });
    const snapshot = action(ctx());
    expect(snapshot.observation).toMatchObject({ accepted: 131, ignored: 1, retained: 32, eventEvictions: 99,
      retainedAliases: 128, aliasEvictions: 2, limits: { events: 32, aliases: 128, idCharacters: 256 } });
    expect(snapshot.events.at(-2).actor.alias).not.toBe(first);
    expect(snapshot.events.at(-1)).toMatchObject({
      actor: { status: 'unavailable', reason: 'invalid-or-oversized' },
      toolCall: { status: 'unavailable', reason: 'invalid-or-oversized' },
    });
    snapshot.events[0].actor.alias = 'mutated';
    expect(JSON.stringify(action(ctx()))).not.toContain('mutated');
    expect(JSON.stringify(action(ctx()))).not.toContain('private');
  });

  it('distinguishes missing, null previous-event, invalid and unsupported time fields honestly', () => {
    const empty = sanitizeEvent({ type: 'session.idle', parentId: null });
    expect(empty).toMatchObject({
      event: { status: 'unavailable', reason: 'missing' }, previousEvent: { status: 'none' },
      actor: { status: 'unavailable', reason: 'missing' }, producerTime: { status: 'unavailable', reason: 'missing' },
    });
    expect(empty.receiptTime.unixMs).toBeGreaterThan(0);
    for (const timestamp of ['2026-11-02T16:00:00Z', '2026-11-02T16:00:00.1Z', '2026-11-02T16:00:00.012Z']) {
      expect(sanitizeEvent({ type: 'session.start', timestamp }).producerTime).toEqual({ status: 'valid' });
    }
    for (const timestamp of [null, 123, '2026-02-31T16:00:00Z', '2026-11-02T24:00:00Z',
      '2026-11-02T16:00:00+00:00', 'secret'.repeat(1000)]) {
      expect(sanitizeEvent({ type: 'session.start', timestamp }).producerTime)
        .toEqual({ status: 'unavailable', reason: 'invalid-or-unsupported-format' });
    }
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
