import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parseAllMembers, parseTeamRoster } from '../../src/teamParser.js';
import { parseRecordedUsage, unavailableUsage, MAX_USAGE_BYTES } from '../../src/recordedUsage.js';
import { parseLayoutJson } from '../../src/layoutPersistence.js';
import { createDefaultOfficeLayout } from '../../src/defaultOfficeLayout.js';
import { ensureTileColors } from '../../src/core/layoutState.js';
import { resolveFileAgentId } from '../../src/core/agentIdentity.js';
import { loadAssetSnapshot } from '../../src/manifestAssets.js';
import { parseLogEntry, parseSessionFile, detectAgentFromFilename } from '../../src/squadWatcher.js';
import type { OutboundMessage, WebviewMessage, ExistingAgentsMessage } from '../../src/types.js';
import { ProjectFiles } from './projectFiles.js';
import { isObserverLayout } from './events.js';

const settings = { type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: false } as const;

export function createObserver(project: string, bundledAssetsRoot: string, pollMs = 1000) {
  const files = new ProjectFiles(project);
  const assets: OutboundMessage = {
    type: 'manifestAssetsLoaded',
    snapshot: loadAssetSnapshot(bundledAssetsRoot),
  };
  if (!assets.snapshot.furniture.length) throw new Error('Bundled office assets are missing. Rebuild/install the complete observer package.');
  let latestAgents: ExistingAgentsMessage['agents'] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  const fingerprints = new Map<string, string>();
  const listeners = new Set<(messages: OutboundMessage[]) => void>();
  const activity = new Map<string, { hash: string; changedAt: number | null }>();

  function readSnapshot(observeActivity = listeners.size > 0): OutboundMessage[] {
    const errors: string[] = [];
    let remainingBytes = 8 * 1024 * 1024;
    function read(relative: string, limit: number): string | null {
      try {
        if (remainingBytes <= 0) throw new Error('8 MiB project observation budget exhausted; reduce source sizes.');
        const content = files.read(relative, Math.min(limit, remainingBytes));
        if (content !== null) remainingBytes -= Buffer.byteLength(content);
        return content;
      }
      catch (error) {
        errors.push(`${relative}: ${String(error)}`);
        return null;
      }
    }
    let squad = '.squad';
    try { files.resolve(squad); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') squad = '.ai-team';
      else errors.push(String(error));
    }
    const team = read(path.join(squad, 'team.md'), 256 * 1024);
    const roster = parseTeamRoster(team ?? '');
    if (team !== null && (!/^##\s+Members/im.test(team) || !roster.length)) errors.push('Roster is empty or has no usable Members table.');
    if (roster.length > 128 || roster.some(m => !/^[a-zA-Z0-9_-]{1,128}$/.test(m.slug)
      || m.name.length > 256 || m.role.length > 256) || new Set(roster.map(m => m.slug)).size !== roster.length) {
      errors.push('Roster exceeds bounds or has invalid/duplicate member identifiers.');
      roster.length = 0;
    }
    const saved = read(path.join('.squad-pod', 'layout.json'), 2 * 1024 * 1024);
    const candidate = saved === null ? null : parseLayoutJson(saved);
    const parsed = candidate && isObserverLayout(candidate) ? candidate : null;
    if (saved !== null && !parsed) errors.push('Saved layout is malformed; showing bundled starter layout.');
    const layout = parsed ?? createDefaultOfficeLayout();
    ensureTileColors(layout);
    const errorsBeforeLedger = errors.length;
    const ledger = read(path.join(squad, 'log', 'usage.jsonl'), MAX_USAGE_BYTES);
    const usage = ledger === null
      ? { ...unavailableUsage(errorsBeforeLedger === errors.length
        ? 'No local usage ledger. No home/private logs are read.'
        : 'Cannot read local usage ledger; see source diagnostics. No home/private logs are read.'),
      state: errorsBeforeLedger === errors.length ? 'missing' as const : 'error' as const }
      : parseRecordedUsage(ledger, parseAllMembers(team ?? ''));
    usage.sourcePath = path.join(files.root, squad, 'log', 'usage.jsonl');
    const active = new Map<string, number>();
    const identities = new Map(roster.map(member => [member.slug, { id: member.slug, name: member.name }]));
    const seen = new Set<string>();
    for (const folder of ['sessions', 'log', 'orchestration-log']) {
      let names: string[] = [];
      try { names = files.entries(path.join(squad, folder)); }
      catch (error) { errors.push(`${folder}: ${String(error)}`); }
      for (const name of names) {
        if (!(folder === 'sessions' ? name.endsWith('.json') : name.endsWith('.md'))) continue;
        const relative = path.join(squad, folder, name);
        const content = read(relative, 128 * 1024);
        if (content === null) continue;
        seen.add(relative);
        const hash = createHash('sha256').update(content).digest('hex');
        const prior = activity.get(relative);
        const changedAt = !observeActivity ? null : prior?.hash === hash ? prior.changedAt : Date.now();
        activity.set(relative, { hash, changedAt });
        const reportedAgent = folder === 'sessions' ? parseSessionFile(content)?.agent
          : detectAgentFromFilename(name) ?? parseLogEntry(content)?.agent;
        const agent = reportedAgent ? resolveFileAgentId(reportedAgent, identities) : null;
        if (agent && changedAt !== null && Date.now() - changedAt < 30_000) active.set(agent, changedAt);
      }
    }
    for (const key of activity.keys()) if (!seen.has(key)) activity.delete(key);
    latestAgents = roster.map(member => ({
      id: member.slug, name: member.name, role: member.role,
      paletteIndex: createHash('sha256').update(member.slug).digest()[0] % 6, seatId: null,
      status: active.has(member.slug) ? 'active' : 'idle',
      currentTask: active.has(member.slug) ? 'Approximate local file activity (not live tool execution)' : null,
    }));
    return [
      settings,
      { type: 'sourceStatus', status: {
        workspaceRoot: files.root, squadDir: path.join(files.root, squad), teamFound: team !== null,
        observer: 'watching', nativeWatch: false, liveActivity: { state: 'off', sessionId: null },
        error: errors.length ? errors.slice(0, 8).join('\n').slice(0, 4096) : null,
      } },
      { type: 'layoutLoaded', layout, revision: null, workspaceRoot: files.root },
      { type: 'existingAgents', agents: latestAgents },
      { type: 'recordedUsage', snapshot: usage },
    ];
  }

  async function snapshot(): Promise<OutboundMessage[]> {
    if (disposed) throw new Error('Observer disposed.');
    return [assets, ...readSnapshot()];
  }
  function subscribe(listener: (messages: OutboundMessage[]) => void) {
    if (disposed) throw new Error('Observer disposed.');
    listeners.add(listener);
    if (!timer) {
      // Initial and resumed viewers baseline historical files before observing changes.
      readSnapshot(false);
      timer = setInterval(() => {
        const messages = readSnapshot();
        const changes = messages.filter(message => {
          const signature = JSON.stringify(message, (key, value: unknown) => key === 'checkedAt' ? undefined : value);
          if (fingerprints.get(message.type) === signature) return false;
          fingerprints.set(message.type, signature);
          return true;
        });
        if (changes.length) for (const notify of listeners) notify(changes);
      }, pollMs);
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size && timer) { clearInterval(timer); timer = undefined; }
    };
  }
  async function onRead(message: WebviewMessage): Promise<OutboundMessage[]> {
    if (message.type === 'getSettings') return [settings];
    if (message.type !== 'requestAgentDetail') return [];
    const agent = latestAgents.find(a => a.id === message.agentId);
    if (!agent) throw new Error('Unknown observed agent.');
    return [{ type: 'agentDetailLoaded',
      ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
      detail: {
        id: agent.id, name: agent.name, role: agent.role, workspaceRoot: files.root, status: agent.status,
        currentTask: agent.currentTask, charterSummary: null, recentActivity: [],
        charterContent: null, charterStatus: 'unavailable',
        expertise: null, responsibilities: null, boundaries: null,
        lastActiveAt: 0,
      },
    }];
  }
  return {
    root: files.root, snapshot, subscribe, onRead,
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      listeners.clear();
      activity.clear();
    },
    get subscriptionCount() { return listeners.size; },
  };
}
