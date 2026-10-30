import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage, WebviewMessage } from './types.js';

const require = createRequire(path.resolve('package.json'));
interface Fixture {
  messages: OutboundMessage[]; output: string[]; confirmations: string[]; reads: unknown[];
  enabled: boolean; send(message: WebviewMessage): void; append(text: string): void;
  setConsent(value: boolean): void; setExternal(value: boolean): void; dispose(): void;
}
const { createLiveFixture, spawn, tool, done, secret } = require('./scripts/acceptance-live-activity.cjs') as {
  createLiveFixture(options: { extensionCode: string; consent?: boolean }): Fixture;
  spawn(): string; tool(id: string, name: string, args: object): string; done(id: string, tokens?: number): string; secret: string;
};
const extensionCode = process.env.SQUAD_POD_EXTENSION_BUNDLE
  ? fs.readFileSync(process.env.SQUAD_POD_EXTENSION_BUNDLE, 'utf8')
  : buildSync({ entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', format: 'cjs',
    external: ['vscode'], write: false }).outputFiles[0].text;

describe('consent and privacy through compiled provider (mocked VS Code)', () => {
  let fixture: Fixture;
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createLiveFixture({ extensionCode, consent: false });
    fixture.send({ type: 'webviewReady' });
  });
  afterEach(() => { fixture.dispose(); vi.useRealTimers(); });

  it('opens nothing when off and declining the modal leaves the setting off', async () => {
    vi.advanceTimersByTime(6000);
    expect(fixture.reads).toEqual([]);
    fixture.send({ type: 'setLiveActivity', enabled: true });
    await settle();
    expect(fixture.confirmations).toHaveLength(1);
    expect(fixture.confirmations[0]).toContain('Prompts, other arguments and outputs are never displayed or stored');
    expect(fixture.enabled).toBe(false);
    expect(fixture.reads).toEqual([]);
    expect(fixture.messages.filter(m => m.type === 'sourceStatus').at(-1))
      .toMatchObject({ status: { liveActivity: { state: 'off', sessionId: null } } });
  });

  it('reads only after consent, preserves live precedence and clears immediately on disable', async () => {
    fixture.setConsent(true);
    fixture.send({ type: 'setLiveActivity', enabled: true });
    await settle();
    expect(fixture.enabled).toBe(true);
    expect(fixture.reads.length).toBeGreaterThan(0);
    fixture.append(spawn() + done('member-run') + tool('one', 'view', { path: `C:\\${secret}\\fixture.ts` }) + done('one'));
    vi.advanceTimersByTime(1000);
    expect(fixture.messages).toContainEqual({ type: 'agentToolDone', agentId: 'ada', toolId: 'one', tool: 'view' });
    expect(fixture.messages).toContainEqual({ type: 'agentContextUsage', agentId: 'ada', contextTokens: 800, maxContextTokens: 1000 });
    vi.advanceTimersByTime(1000);
    expect(fixture.messages.filter(m => m.type === 'agentStatus').at(-1)).toMatchObject({ status: 'active' });
    fixture.send({ type: 'webviewReady' });
    await settle();
    expect(fixture.messages.filter(m => m.type === 'agentContextUsage').at(-1)).toMatchObject({ contextTokens: 800 });
    fixture.send({ type: 'setLiveActivity', enabled: false });
    await settle();
    expect(fixture.enabled).toBe(false);
    const count = fixture.reads.length;
    vi.advanceTimersByTime(6000);
    expect(fixture.reads).toHaveLength(count);
    expect(fixture.messages.filter(m => m.type === 'agentStatus').at(-1)).toMatchObject({ status: 'idle' });
    expect(fixture.messages.filter(m => m.type === 'agentContextUsage').at(-1))
      .toMatchObject({ contextTokens: null, maxContextTokens: null });
    expect(JSON.stringify({ messages: fixture.messages, output: fixture.output })).not.toContain(secret);
  });

  it('never sends shell assignment or expression contents to any host sink', async () => {
    fixture.setConsent(true);
    fixture.send({ type: 'setLiveActivity', enabled: true });
    await settle();
    fixture.append(spawn()
      + tool('assignment', 'powershell', { command: `$env:API_KEY='${secret}'` })
      + tool('expression', 'powershell', { command: `Write-Output('${secret}')` })
      + tool('single-quote', 'powershell', { command: `'${secret}'` })
      + tool('double-quote', 'powershell', { command: `"${secret}"` })
      + tool('bash-assignment', 'bash', { command: `API_KEY='${secret}' npm test` }));
    vi.advanceTimersByTime(1000);
    expect(fixture.messages.filter(m => m.type === 'agentToolStart')).toHaveLength(5);
    expect(fixture.messages.filter(m => m.type === 'agentToolStart').every(m => m.status === 'Running: shell')).toBe(true);
    expect(JSON.stringify({ messages: fixture.messages, output: fixture.output })).not.toContain(secret);
  });

  it('requires modal consent for external setting changes, and external disable stops reading immediately', async () => {
    fixture.setExternal(true);
    await settle();
    expect(fixture.enabled).toBe(false);
    expect(fixture.confirmations).toHaveLength(1);
    expect(fixture.reads).toEqual([]);
    fixture.setConsent(true);
    fixture.setExternal(true);
    await settle();
    expect(fixture.confirmations).toHaveLength(2);
    expect(fixture.reads.length).toBeGreaterThan(0);
    fixture.append(spawn());
    vi.advanceTimersByTime(1000);
    fixture.setExternal(false);
    const readsAtDisable = fixture.reads.length;
    vi.advanceTimersByTime(5000);
    expect(fixture.reads).toHaveLength(readsAtDisable);
    expect(fixture.messages.filter(m => m.type === 'agentStatus').at(-1)).toMatchObject({ status: 'idle' });
  });

  it('does not open a session when disabling while a consent response is pending', async () => {
    fixture.setConsent(true);
    fixture.send({ type: 'setLiveActivity', enabled: true });
    fixture.send({ type: 'setLiveActivity', enabled: false });
    await settle();
    vi.advanceTimersByTime(6000);
    expect(fixture.enabled).toBe(false);
    expect(fixture.reads).toEqual([]);
    expect(fixture.messages.filter(m => m.type === 'sourceStatus').at(-1))
      .toMatchObject({ status: { liveActivity: { state: 'off', sessionId: null } } });
  });
});
