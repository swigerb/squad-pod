import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage, WebviewMessage } from './types.js';

const require = createRequire(path.resolve('package.json'));
interface Agent { id: string; name: string; role: string; summary: string; activity: string }
interface Fixture {
  workspaceRoot: string;
  messages: OutboundMessage[];
  sent: WebviewMessage[];
  calls: { documents: string[]; commands: Array<[string, string]>; information: string[]; terminals: unknown[] };
  send(message: WebviewMessage): void;
  removeAgent(id: string): void;
  noFocus(): void;
  dispose(): void;
}
const { createProviderFixture, agents } = require('./scripts/acceptance-interaction.cjs') as {
  createProviderFixture(options: { extensionCode: string }): Fixture; agents: Agent[];
};
const extensionCode = process.env.SQUAD_POD_EXTENSION_BUNDLE
  ? fs.readFileSync(process.env.SQUAD_POD_EXTENSION_BUNDLE, 'utf8')
  : buildSync({
    entryPoints: [path.resolve('src', 'extension.ts')], bundle: true, platform: 'node',
    format: 'cjs', external: ['vscode'], write: false,
  }).outputFiles[0].text;

describe('agent interaction through compiled extension/provider (mocked VS Code boundary)', () => {
  let fixture: Fixture;
  const details = () => fixture.messages.filter((m) => m.type === 'agentDetailLoaded');
  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createProviderFixture({ extensionCode });
    fixture.send({ type: 'webviewReady' });
  });
  afterEach(() => {
    try { fixture.noFocus(); } finally {
      fixture.dispose();
      vi.useRealTimers();
    }
  });

  it.each(agents)('returns exactly $name detail and opens that charter, never a terminal/session', (agent) => {
    const before = details().length;
    fixture.send({ type: 'requestAgentDetail', agentId: agent.id });
    expect(details().slice(before)).toEqual([{
      type: 'agentDetailLoaded', detail: {
        id: agent.id, name: agent.name, role: agent.role, status: 'idle',
        charterSummary: agent.summary, recentActivity: [agent.activity],
        currentTask: null, lastActiveAt: expect.any(Number),
      },
    }]);
    fixture.send({ type: 'openSquadAgent', agentId: agent.id });
    expect(fixture.calls.documents).toEqual([path.join(fixture.workspaceRoot, '.squad', 'agents', agent.id, 'charter.md')]);
    expect(fixture.calls.commands).toEqual([]);
    expect(fixture.calls.information).toEqual([]);
  });

  it.each(agents)('uses history, folder reveal, then information only for $name', (agent) => {
    const directory = path.join(fixture.workspaceRoot, '.squad', 'agents', agent.id);
    fs.unlinkSync(path.join(directory, 'charter.md'));
    fixture.send({ type: 'openSquadAgent', agentId: agent.id });
    expect(fixture.calls.documents).toEqual([path.join(directory, 'history.md')]);
    fs.unlinkSync(path.join(directory, 'history.md'));
    fixture.send({ type: 'openSquadAgent', agentId: agent.id });
    expect(fixture.calls.commands).toEqual([['revealInExplorer', directory]]);
    fs.rmdirSync(directory);
    fixture.send({ type: 'openSquadAgent', agentId: agent.id });
    expect(fixture.calls.information).toEqual([`Squad Pod: ${agent.name} has no charter or history yet.`]);
    expect(fixture.calls.documents).toHaveLength(1);
    expect(fixture.calls.commands).toHaveLength(1);
  });

  it('does not disclose or open files for unknown or removed agents', () => {
    fixture.removeAgent('ada');
    vi.advanceTimersByTime(2000);
    expect(fixture.messages.filter((m) => m.type === 'existingAgents').at(-1))
      .toMatchObject({ agents: [expect.objectContaining({ id: 'grace' })] });
    const before = details().length;
    for (const agentId of ['unknown', 'ada']) {
      fixture.send({ type: 'requestAgentDetail', agentId });
      fixture.send({ type: 'openSquadAgent', agentId });
    }
    expect(details()).toHaveLength(before);
    expect(fixture.calls.documents).toEqual([]);
    expect(fixture.calls.commands).toEqual([]);
    expect(fixture.calls.information).toEqual([]);
  });
});
