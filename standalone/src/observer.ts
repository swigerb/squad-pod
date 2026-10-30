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
import { OfficeStore } from './officeStore.js';
import { CopilotSessionActivity, type LiveSessionSelection } from '../../src/copilotSessionActivity.js';
import type { LiveSourceStatus } from '../../src/types.js';

const settings = { type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: false } as const;

export interface ObserverOptions {
  liveActivity?: boolean;
  /** Local host configuration only; never supplied by a browser message. */
  copilotHome?: string;
  sessionSelection?: () => LiveSessionSelection;
}

export function createObserver(project: string, bundledAssetsRoot: string, pollMs = 1000, options: ObserverOptions = {}) {
  const files = new ProjectFiles(project);
  const office = new OfficeStore(project);
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
  const activity = new Map<string, { hash: string; changedAt: number | null; agentId: string | null }>();
  const liveAgents = new Map<string, string | null>();
  let liveStatus: LiveSourceStatus = { state: 'off', sessionId: null };
  let liveMessages: OutboundMessage[] = [];
  let liveStarted = false;
  const live = options.liveActivity ? new CopilotSessionActivity({
    workspaceRoot: files.root, copilotHome: options.copilotHome,
    sessionSelection: options.sessionSelection,
    roster: () => latestAgents.map(agent => ({ id: agent.id })),
    post: message => liveMessages.push(message),
    lifecycle: (id, running, task) => {
      if (running) liveAgents.set(id, task);
      else liveAgents.delete(id);
      // Like the native host, ignore file hints during live ownership and do not
      // resurrect an earlier file hint when a live run finishes or expires.
      for (const value of activity.values()) if (value.agentId === id) value.changedAt = null;
    },
    status: status => { liveStatus = status; },
  }) : undefined;

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
        ? 'No local usage ledger. Live observation does not create recorded usage.'
        : 'Cannot read local usage ledger; see source diagnostics. Live observation does not create recorded usage.'),
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
        const reportedAgent = folder === 'sessions' ? parseSessionFile(content)?.agent
          : detectAgentFromFilename(name) ?? parseLogEntry(content)?.agent;
        const agent = reportedAgent ? resolveFileAgentId(reportedAgent, identities) : null;
        const observedAt = agent && liveAgents.has(agent) ? null : changedAt;
        activity.set(relative, { hash, changedAt: observedAt, agentId: agent });
        if (agent && observedAt !== null && Date.now() - observedAt < 30_000) active.set(agent, observedAt);
      }
    }
    for (const key of activity.keys()) if (!seen.has(key)) activity.delete(key);
    let preferences: ReturnType<OfficeStore['readPreferences']>['value'] = null;
    try { preferences = office.readPreferences().value; }
    catch (error) { errors.push(`Office preferences: ${String(error)}`); }
    latestAgents = roster.map(member => ({
      id: member.slug, name: member.name, role: member.role,
      paletteIndex: preferences?.agents[member.slug]?.palette ?? createHash('sha256').update(member.slug).digest()[0] % 6,
      seatId: preferences?.agents[member.slug]?.seatId ?? null,
      status: active.has(member.slug) ? 'active' : 'idle',
      currentTask: active.has(member.slug) ? 'Approximate local file activity (not live tool execution)' : null,
      currentTaskSource: active.has(member.slug) ? 'file' : null,
    }));
    liveMessages = [];
    if (live) {
      if (!liveStarted) { liveStarted = true; live.start(false); }
      else live.replay();
      const selection = options.sessionSelection?.();
      liveStatus = { ...liveStatus,
        selection: selection?.preferredId === null ? 'unavailable'
          : selection?.preferredId ? 'owned-session' : 'matching-project',
        reason: selection?.preferredId ? liveStatus.state === 'following'
          ? 'Exact server-generated owned session; canonical project and Squad marker verified.'
          : selection.reason ?? 'Waiting for the exact owned session.'
          : selection?.reason ?? 'Newest matching-project Squad session; not an owned-terminal correlation.',
      };
      latestAgents = latestAgents.map(agent => {
        const task = liveAgents.get(agent.id);
        const fileActive = [...activity.values()].some(value => value.agentId === agent.id
          && value.changedAt !== null && Date.now() - value.changedAt < 30_000);
        return { ...agent,
          status: liveAgents.has(agent.id) || fileActive ? 'active' : 'idle',
          currentTask: liveAgents.has(agent.id) ? task ?? null
            : fileActive ? 'Approximate local file activity (not live tool execution)' : null,
          currentTaskSource: liveAgents.has(agent.id) ? task ? 'live' : null : fileActive ? 'file' : null,
        };
      });
    }
    return [
      { ...settings, ...preferences?.settings },
      { type: 'sourceStatus', status: {
        workspaceRoot: files.root, squadDir: path.join(files.root, squad), teamFound: team !== null,
        observer: 'watching', nativeWatch: false, liveActivity: liveStatus,
        error: errors.length ? errors.slice(0, 8).join('\n').slice(0, 4096) : null,
      } },
      { type: 'layoutLoaded', layout, revision: saved === null ? null : createHash('sha256').update(saved).digest('hex'), workspaceRoot: files.root },
      { type: 'existingAgents', agents: latestAgents },
      { type: 'recordedUsage', snapshot: usage },
      ...liveMessages,
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
        const liveTypes = new Set(liveMessages.map(message => message.type));
        const changes = messages.filter(message => {
          if (liveTypes.has(message.type)) return false;
          const signature = JSON.stringify(message, (key, value: unknown) => key === 'checkedAt' ? undefined : value);
          if (fingerprints.get(message.type) === signature) return false;
          fingerprints.set(message.type, signature);
          return true;
        });
        if (live) {
          const signature = JSON.stringify(liveMessages);
          if (fingerprints.get('live') !== signature || changes.some(message => message.type === 'existingAgents')) {
            fingerprints.set('live', signature);
            changes.push(...liveMessages);
          }
        }
        if (changes.length) for (const notify of listeners) notify(changes);
      }, pollMs);
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size && timer) {
        clearInterval(timer); timer = undefined;
        live?.stop(); liveStarted = false; liveMessages = [];
      }
    };
  }
  async function onRead(message: WebviewMessage): Promise<OutboundMessage[]> {
    if (message.type === 'getSettings') return [{ ...settings, ...office.readPreferences().value?.settings }];
    if (message.type !== 'requestAgentDetail') return [];
    const agent = latestAgents.find(a => a.id === message.agentId);
    if (!agent) throw new Error('Unknown observed agent.');
    return [{ type: 'agentDetailLoaded',
      ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
      detail: {
        id: agent.id, name: agent.name, role: agent.role, workspaceRoot: files.root, status: agent.status,
        currentTask: agent.currentTask, currentTaskSource: agent.currentTaskSource,
        charterSummary: null, recentActivity: [],
        charterContent: null, charterStatus: 'unavailable',
        expertise: null, responsibilities: null, boundaries: null,
        lastActiveAt: 0, lastActiveAtStatus: 'unobserved',
      },
    }];
  }
  return {
    root: files.root, snapshot, subscribe, onRead,
    dispose() {
      disposed = true;
      live?.stop();
      if (timer) clearInterval(timer);
      timer = undefined;
      listeners.clear();
      activity.clear();
    },
    get subscriptionCount() { return listeners.size; },
  };
}
