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
    const requestId = `${agent.id}-detail-1`;
    fixture.send({ type: 'requestAgentDetail', agentId: agent.id, requestId });
    expect(details().slice(before)).toEqual([{
      type: 'agentDetailLoaded', requestId, detail: {
        id: agent.id, name: agent.name, role: agent.role, workspaceRoot: fixture.workspaceRoot, status: 'idle',
        charterSummary: agent.summary, charterContent: expect.stringContaining(agent.summary),
        charterStatus: 'available', expertise: `${agent.name} expertise`, responsibilities: `- ${agent.name} responsibilities`,
        modelSources: expect.arrayContaining([
          expect.objectContaining({ sourcePath: path.join(fixture.workspaceRoot, '.squad', 'agents', agent.id, 'charter.md'), state: 'missing', values: [] }),
          expect.objectContaining({ sourcePath: path.join(fixture.workspaceRoot, '.squad', 'config.json'), state: 'missing', values: [] }),
        ]),
        boundaries: expect.stringContaining(`${agent.name} boundaries`), recentActivity: [agent.activity],
        currentTask: null, lastActiveAt: expect.any(Number),
      },
    }]);
    fixture.send({ type: 'openSquadAgent', agentId: agent.id });
    expect(fixture.calls.documents).toEqual([path.join(fixture.workspaceRoot, '.squad', 'agents', agent.id, 'charter.md')]);
    expect(fixture.calls.commands).toEqual([]);
    expect(fixture.calls.information).toEqual([]);
  });

  it('marks missing and unreadable charters explicitly without inventing fields', () => {
    const directory = path.join(fixture.workspaceRoot, '.squad', 'agents', 'ada');
    const charter = path.join(directory, 'charter.md');
    fs.unlinkSync(charter);
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    const missing = details().at(-1);
    expect(missing).toMatchObject({ type: 'agentDetailLoaded', detail: {
      id: 'ada', charterStatus: 'missing', charterContent: null, charterSummary: null,
      expertise: null, responsibilities: null, boundaries: null,
    } });

    fs.writeFileSync(charter, `# Oversized\n\n${'x'.repeat(65537)}`);
    const read = vi.spyOn(require('node:fs'), 'readSync');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)).toMatchObject({ type: 'agentDetailLoaded', detail: {
      id: 'ada', charterStatus: 'unreadable', charterContent: null, charterSummary: null,
    } });
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
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

  it('sends visible Squad Info roster entries keyed by parsed charter IDs', () => {
    fixture.send({ type: 'openSquadInfo' });
    const info = fixture.messages.filter(message => message.type === 'squadInfoLoaded').at(-1);
    expect(info).toMatchObject({
      type: 'squadInfoLoaded',
      info: {
        workspaceRoot: fixture.workspaceRoot,
        members: [
          { id: 'ada', name: 'Ada' },
          { id: 'grace', name: 'Grace' },
        ],
        hiddenMembers: [{ name: 'Scribe', role: 'Scribe' }],
      },
    });
  });

  it('returns conflicting declarations separately with exact-name keys and refreshes without runtime inference', () => {
    const squad = path.join(fixture.workspaceRoot, '.squad');
    const charter = path.join(squad, 'agents', 'ada', 'charter.md');
    fs.appendFileSync(charter, '\n## Model\n- **Preferred:** auto\n- **Rationale:** Synthetic task policy\n- **Fallback:** synthetic-fallback\n');
    fs.writeFileSync(path.join(squad, 'config.json'), JSON.stringify({
      defaultModel: 'synthetic-default', agentModelOverrides: { Ada: 'synthetic-override', ada: 'not-the-name' },
    }));
    fs.writeFileSync(path.join(fixture.workspaceRoot, 'squad.config.ts'), 'throw new Error("never execute")');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada', requestId: 'models-1' });
    expect(details().at(-1)).toMatchObject({ requestId: 'models-1', detail: { modelSources: [
      { sourcePath: charter, state: 'ready', values: [
        { key: 'Preferred', value: 'auto' }, { key: 'Rationale', value: 'Synthetic task policy' }, { key: 'Fallback', value: 'synthetic-fallback' },
      ] },
      { sourcePath: path.join(squad, 'config.json'), state: 'ready', values: [
        { key: 'defaultModel', value: 'synthetic-default' }, { key: 'agentModelOverrides["Ada"]', value: 'synthetic-override' },
      ] },
      { state: 'unsupported', values: [] }, { state: 'missing', values: [] },
    ] } });
    fs.writeFileSync(path.join(squad, 'config.json'), '{');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada', requestId: 'models-2' });
    expect(details().at(-1)).toMatchObject({ requestId: 'models-2', detail: {
      modelSources: expect.arrayContaining([expect.objectContaining({ state: 'malformed', values: [] })]),
    } });
    fs.writeFileSync(charter, '## Model\n**Preferred:** first\n**Preferred:** second');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)?.detail.modelSources?.[0]).toMatchObject({ state: 'ambiguous', values: [] });
  });

  it('withholds charter declarations from an escaping agent-directory junction', () => {
    const squad = path.join(fixture.workspaceRoot, '.squad');
    const directory = path.join(squad, 'agents', 'ada');
    fs.renameSync(directory, path.join(fixture.workspaceRoot, 'original-agent'));
    fs.symlinkSync(path.join(fixture.workspaceRoot, 'original-agent'), directory, 'junction');
    fixture.send({ type: 'requestAgentDetail', agentId: 'ada' });
    expect(details().at(-1)?.detail).toMatchObject({
      charterStatus: 'unreadable', charterContent: null,
      modelSources: expect.arrayContaining([expect.objectContaining({ state: 'unreadable', values: [] })]),
    });
  });
});
