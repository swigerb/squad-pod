/// <reference types="vitest/globals" />
import type { SquadTeamMember } from './types.js';

// Mock teamParser BEFORE importing agentManager
vi.mock('./teamParser.js', () => ({
  readTeamRoster: vi.fn(),
}));

// Mock timerManager to avoid real timers interfering
vi.mock('./timerManager.js', () => ({
  resetActivityTimer: vi.fn(),
  cancelActivityTimer: vi.fn(),
  cancelAllTimers: vi.fn(),
}));

import { readTeamRoster } from './teamParser.js';
import { resetActivityTimer } from './timerManager.js';
import {
  initializeAgents,
  refreshAgents,
  updateAgentStatus,
  saveAgentSeats,
  sendExistingAgents,
  disposeAgentManager,
  getAgents,
  resolveAgentId,
  setLiveAgentStatus,
} from './agentManager.js';

const mockReadTeamRoster = readTeamRoster as ReturnType<typeof vi.fn>;

function makeMember(name: string, slug: string, role = 'Dev'): SquadTeamMember {
  return {
    name,
    slug,
    role,
    status: '✅ Active',
    charterPath: `.squad/agents/${slug}/charter.md`,
  };
}

function createMockWebview() {
  return { postMessage: vi.fn() } as any;
}

function createMockContext() {
  return {
    workspaceState: {
      get: vi.fn().mockReturnValue({}),
      update: vi.fn(),
    },
  } as any;
}

describe('agentManager', () => {
  let webview: any;
  let context: any;

  beforeEach(() => {
    webview = createMockWebview();
    context = createMockContext();
    mockReadTeamRoster.mockReturnValue([]);
  });

  afterEach(() => {
    disposeAgentManager();
    vi.clearAllMocks();
  });

  describe('initializeAgents', () => {
    it('creates agents from roster without posting (snapshot is sent separately)', () => {
      const members = [
        makeMember('Homer Simpson', 'homer-simpson', 'Lead'),
        makeMember('Lisa Simpson', 'lisa-simpson', 'Core Dev'),
        makeMember('Bart Simpson', 'bart-simpson', 'Tester'),
      ];
      mockReadTeamRoster.mockReturnValue(members);

      const agents = initializeAgents('/workspace', context, webview);

      expect(agents.size).toBe(3);
      expect(agents.get('homer-simpson')?.name).toBe('Homer Simpson');
      expect(agents.get('lisa-simpson')?.role).toBe('Core Dev');

      expect(webview.postMessage).not.toHaveBeenCalled();
      const palettes = new Set([...agents.values()].map(a => a.paletteIndex));
      expect(palettes.size).toBe(3);
    });

    it('agents start with idle status and no current task', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);

      const agents = initializeAgents('/workspace', context, webview);

      const homer = agents.get('homer');
      expect(homer?.status).toBe('idle');
      expect(homer?.currentTask).toBeNull();
      expect(homer?.lastActiveAt).toBeNull();
      expect(homer?.lastActiveAtStatus).toBe('unobserved');
    });

    it('does not turn file hints, idle bookkeeping, or roster reloads into activity timestamps', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('TestBot', 'testbot')]);
      initializeAgents('/workspace', context, webview);
      setLiveAgentStatus('testbot', true, 'Live task without a source timestamp', webview);
      expect(getAgents().get('testbot')?.lastActiveAt).toBeNull();
      expect(getAgents().get('testbot')?.lastActiveAtStatus).toBe('unobserved');
      setLiveAgentStatus('testbot', false, null, webview);
      updateAgentStatus('testbot', 'active', 'File activity hint', webview);
      expect(getAgents().get('testbot')?.lastActiveAt).toBeNull();

      const observedAt = Date.now() - 60_000;
      setLiveAgentStatus('testbot', true, 'Actual live task', webview, observedAt);
      expect(getAgents().get('testbot')?.lastActiveAt).toBe(observedAt);
      expect(getAgents().get('testbot')?.lastActiveAtStatus).toBe('available');

      setLiveAgentStatus('testbot', true, 'Actual live task', webview, observedAt);
      updateAgentStatus('testbot', 'active', 'Later file hint', webview);
      setLiveAgentStatus('testbot', false, null, webview);
      expect(getAgents().get('testbot')?.lastActiveAt).toBe(observedAt);

      updateAgentStatus('testbot', 'idle', null, webview);
      refreshAgents('/workspace', context, webview);
      expect(getAgents().get('testbot')?.lastActiveAt).toBe(observedAt);

      const completedAt = Date.now() - 30_000;
      setLiveAgentStatus('testbot', true, 'Completed live task', webview, observedAt);
      setLiveAgentStatus('testbot', false, null, webview, completedAt);
      expect(getAgents().get('testbot')?.lastActiveAt).toBe(completedAt);

      initializeAgents('/workspace', context, webview);
      expect(getAgents().get('testbot')?.lastActiveAt).toBeNull();
      expect(getAgents().get('testbot')?.lastActiveAtStatus).toBe('unobserved');
    });

    it('does not store future live timestamps and accepts a later valid observation', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('TestBot', 'testbot')]);
      initializeAgents('/workspace', context, webview);
      const previousAt = Date.now() - 2 * 60 * 1000;
      const futureAt = Date.now() + 60 * 1000;
      const laterValidAt = Date.now() - 1000;

      setLiveAgentStatus('testbot', true, 'Actual live task', webview, futureAt);
      expect(getAgents().get('testbot')?.lastActiveAt).toBeNull();
      expect(getAgents().get('testbot')?.lastActiveAtStatus).toBe('clock-skew');

      setLiveAgentStatus('testbot', true, 'Actual live task', webview, previousAt);
      setLiveAgentStatus('testbot', true, 'Actual live task', webview, futureAt);
      expect(getAgents().get('testbot')?.lastActiveAt).toBe(previousAt);
      expect(getAgents().get('testbot')?.lastActiveAtStatus).toBe('clock-skew');

      setLiveAgentStatus('testbot', true, 'Actual live task', webview, laterValidAt);
      expect(getAgents().get('testbot')?.lastActiveAt).toBe(laterValidAt);
      expect(getAgents().get('testbot')?.lastActiveAtStatus).toBe('available');
    });

    it('keeps the previous member timestamp when a live task is reassigned', () => {
      mockReadTeamRoster.mockReturnValue([
        makeMember('Ada', 'ada'),
        makeMember('Grace', 'grace'),
      ]);
      initializeAgents('/workspace', context, webview);
      const adaAt = Date.now() - 60_000;
      const graceAt = Date.now() - 30_000;

      setLiveAgentStatus('ada', true, 'Inspect fixture', webview, adaAt);
      setLiveAgentStatus('ada', false, null, webview);
      setLiveAgentStatus('grace', true, 'Inspect fixture', webview, graceAt);

      expect(getAgents().get('ada')?.lastActiveAt).toBe(adaAt);
      expect(getAgents().get('grace')?.lastActiveAt).toBe(graceAt);
    });

    it('does not carry expired source hints into a newly initialized workspace with the same member', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('TestBot', 'testbot')]);
      initializeAgents('/workspace-one', context, webview);
      updateAgentStatus('testbot', 'active', 'Old workspace file hint', webview);
      initializeAgents('/workspace-two', context, webview);
      expect(getAgents().get('testbot')).toMatchObject({
        status: 'idle', currentTask: null, currentTaskSource: null,
      });
      setLiveAgentStatus('testbot', true, 'Old live source', webview);
      initializeAgents('/workspace-three', context, webview);
      updateAgentStatus('testbot', 'active', 'New workspace hint', webview);
      expect(getAgents().get('testbot')).toMatchObject({
        status: 'active', currentTask: 'New workspace hint', currentTaskSource: 'file',
      });
    });
  });

  describe('updateAgentStatus', () => {
    it('expires file hints in state, snapshots and detail updates without retaining old work', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('TestBot', 'testbot')]);
      initializeAgents('/workspace', context, webview);
      updateAgentStatus('testbot', 'active', 'File changed: history.md', webview);
      expect(getAgents().get('testbot')).toMatchObject({
        currentTask: 'File changed: history.md', currentTaskSource: 'file',
      });
      expect(getAgents().get('testbot')?.lastActiveAt).toBeNull();
      expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'agentToolStart', status: 'File activity hint: File changed: history.md',
      }));
      const callback = vi.mocked(resetActivityTimer).mock.calls.at(-1)![2];
      callback();
      expect(getAgents().get('testbot')).toMatchObject({ status: 'idle', currentTask: null, currentTaskSource: null });
      expect(getAgents().get('testbot')?.lastActiveAt).toBeNull();
      expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'agentStatus', status: 'idle', currentTask: null, currentTaskSource: null,
      }));
      sendExistingAgents(getAgents(), context, webview);
      expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'existingAgents', agents: [expect.objectContaining({ currentTask: null, currentTaskSource: null })],
      }));
      updateAgentStatus('testbot', 'active', null, webview);
      expect(getAgents().get('testbot')?.currentTask).toBeNull();
    });

    it('keeps live provenance through file overlap and clears it on source fallback', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('TestBot', 'testbot')]);
      initializeAgents('/workspace', context, webview);
      updateAgentStatus('testbot', 'active', 'file hint', webview);
      const callback = vi.mocked(resetActivityTimer).mock.calls.at(-1)![2];
      setLiveAgentStatus('testbot', true, 'Actual live task', webview);
      callback();
      updateAgentStatus('testbot', 'active', 'file overwrite', webview);
      expect(getAgents().get('testbot')).toMatchObject({
        status: 'active', currentTask: 'Actual live task', currentTaskSource: 'live',
      });
      sendExistingAgents(getAgents(), context, webview);
      expect(webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'existingAgents', agents: [expect.objectContaining({ currentTaskSource: 'live' })],
      }));
      setLiveAgentStatus('testbot', false, null, webview);
      expect(getAgents().get('testbot')).toMatchObject({ status: 'idle', currentTask: null, currentTaskSource: null });
      updateAgentStatus('testbot', 'active', 'new file hint', webview);
      expect(getAgents().get('testbot')).toMatchObject({ currentTask: 'new file hint', currentTaskSource: 'file' });
    });
    it('never lets file activity or an already queued idle timer overwrite a live run', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Ada', 'ada')]);
      initializeAgents('/workspace', context, webview);
      updateAgentStatus('ada', 'active', 'file task', webview);
      const callback = vi.mocked(resetActivityTimer).mock.calls.at(-1)![2];
      setLiveAgentStatus('ada', true, 'live task', webview);
      webview.postMessage.mockClear();
      callback();
      updateAgentStatus('ada', 'idle', null, webview);
      updateAgentStatus('ada', 'active', 'file overwrite', webview);
      expect(getAgents().get('ada')).toMatchObject({ status: 'active', currentTask: 'live task' });
      expect(webview.postMessage).not.toHaveBeenCalled();
      setLiveAgentStatus('ada', false, null, webview);
      expect(getAgents().get('ada')).toMatchObject({ status: 'idle', currentTask: null });
      updateAgentStatus('ada', 'active', 'file fallback', webview);
      expect(getAgents().get('ada')?.currentTask).toBe('file fallback');
    });
    it('sends agentStatus and agentToolStart when going active', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
      initializeAgents('/workspace', context, webview);
      webview.postMessage.mockClear();

      updateAgentStatus('homer', 'active', 'writing tests', webview);

      const types = webview.postMessage.mock.calls.map(([msg]: [any]) => msg.type);
      expect(types).toContain('agentStatus');
      expect(types).toContain('agentToolStart');

      const statusCall = webview.postMessage.mock.calls.find(
        ([msg]: [any]) => msg.type === 'agentStatus',
      );
      expect(statusCall[0].status).toBe('active');
      expect(statusCall[0].currentTask).toBe('writing tests');
    });

    it('sends changed tasks without a status transition and clears the idle task payload', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
      initializeAgents('/workspace', context, webview);
      updateAgentStatus('homer', 'active', 'first task', webview);
      webview.postMessage.mockClear();
      updateAgentStatus('homer', 'active', 'second task', webview);
      updateAgentStatus('homer', 'idle', null, webview);
      const statuses = webview.postMessage.mock.calls.map(([message]) => message)
        .filter(message => message.type === 'agentStatus');
      expect(statuses).toEqual([
        { type: 'agentStatus', agentId: 'homer', status: 'active', currentTask: 'second task', currentTaskSource: 'file' },
        { type: 'agentStatus', agentId: 'homer', status: 'idle', currentTask: null, currentTaskSource: null },
      ]);
    });

    it('includes the authoritative live task and clears it on completion', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
      initializeAgents('/workspace', context, webview);
      webview.postMessage.mockClear();
      setLiveAgentStatus('homer', true, 'live task', webview);
      setLiveAgentStatus('homer', false, null, webview);
      expect(webview.postMessage.mock.calls.map(([message]) => message)
        .filter(message => message.type === 'agentStatus')).toEqual([
        { type: 'agentStatus', agentId: 'homer', status: 'active', currentTask: 'live task', currentTaskSource: 'live' },
        { type: 'agentStatus', agentId: 'homer', status: 'idle', currentTask: null, currentTaskSource: null },
      ]);
    });

    it('is a no-op for unknown agent IDs', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
      initializeAgents('/workspace', context, webview);
      webview.postMessage.mockClear();

      updateAgentStatus('unknown-agent', 'active', 'task', webview);
      expect(webview.postMessage).not.toHaveBeenCalled();
    });

    describe('telemetry events', () => {
      it('emits a telemetryEvent message on every status transition', () => {
        mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
        initializeAgents('/workspace', context, webview);
        webview.postMessage.mockClear();

        updateAgentStatus('homer', 'active', 'writing code', webview);

        const telemetryCalls = webview.postMessage.mock.calls.filter(
          ([msg]: [any]) => msg.type === 'telemetryEvent',
        );
        expect(telemetryCalls).toHaveLength(1);
      });

      it('telemetry event has correct TelemetryEvent structure', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

        mockReadTeamRoster.mockReturnValue([makeMember('Homer Simpson', 'homer')]);
        initializeAgents('/workspace', context, webview);
        webview.postMessage.mockClear();

        updateAgentStatus('homer', 'active', 'fixing bugs', webview);

        const telemetryCall = webview.postMessage.mock.calls.find(
          ([msg]: [any]) => msg.type === 'telemetryEvent',
        );
        expect(telemetryCall).toBeDefined();
        const event = telemetryCall[0].event;

        expect(event.id).toMatch(/^tel-\d+-\d+$/);
        expect(event.timestamp).toBe(Date.now());
        expect(event.category).toBe('status');
        expect(event.agentId).toBe('homer');
        expect(event.agentName).toBe('Homer Simpson');
        expect(typeof event.summary).toBe('string');
        expect(event.summary.length).toBeGreaterThan(0);

        vi.useRealTimers();
      });

      it('summary says "became active" with task when going active', () => {
        mockReadTeamRoster.mockReturnValue([makeMember('Homer Simpson', 'homer')]);
        initializeAgents('/workspace', context, webview);
        webview.postMessage.mockClear();

        updateAgentStatus('homer', 'active', 'writing tests', webview);

        const event = webview.postMessage.mock.calls.find(
          ([msg]: [any]) => msg.type === 'telemetryEvent',
        )[0].event;
        expect(event.summary).toContain('Homer Simpson became active');
        expect(event.summary).toContain('writing tests');
      });

      it('summary says "went idle" when going idle', () => {
        mockReadTeamRoster.mockReturnValue([makeMember('Homer Simpson', 'homer')]);
        initializeAgents('/workspace', context, webview);
        updateAgentStatus('homer', 'active', 'task', webview);
        webview.postMessage.mockClear();

        updateAgentStatus('homer', 'idle', null, webview);

        const event = webview.postMessage.mock.calls.find(
          ([msg]: [any]) => msg.type === 'telemetryEvent',
        )[0].event;
        expect(event.summary).toContain('Homer Simpson went idle');
      });

      it('summary says "is waiting for input" when going to waiting', () => {
        mockReadTeamRoster.mockReturnValue([makeMember('Homer Simpson', 'homer')]);
        initializeAgents('/workspace', context, webview);
        webview.postMessage.mockClear();

        updateAgentStatus('homer', 'waiting', 'needs approval', webview);

        const event = webview.postMessage.mock.calls.find(
          ([msg]: [any]) => msg.type === 'telemetryEvent',
        )[0].event;
        expect(event.summary).toContain('Homer Simpson is waiting for input');
        expect(event.summary).toContain('needs approval');
      });

      it('summary omits task suffix when task is null', () => {
        mockReadTeamRoster.mockReturnValue([makeMember('Homer Simpson', 'homer')]);
        initializeAgents('/workspace', context, webview);
        // First go active so currentTask gets set
        updateAgentStatus('homer', 'active', 'some task', webview);
        webview.postMessage.mockClear();

        updateAgentStatus('homer', 'idle', null, webview);

        const event = webview.postMessage.mock.calls.find(
          ([msg]: [any]) => msg.type === 'telemetryEvent',
        )[0].event;
        expect(event.summary).not.toContain('some task');
        expect(event.summary).not.toContain(': null');
      });

      it('category is always "status" for status transitions', () => {
        mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
        initializeAgents('/workspace', context, webview);
        webview.postMessage.mockClear();

        updateAgentStatus('homer', 'active', 'task1', webview);
        updateAgentStatus('homer', 'waiting', 'task2', webview);
        updateAgentStatus('homer', 'idle', null, webview);

        const telemetryCalls = webview.postMessage.mock.calls.filter(
          ([msg]: [any]) => msg.type === 'telemetryEvent',
        );
        expect(telemetryCalls.length).toBeGreaterThanOrEqual(3);
        for (const [msg] of telemetryCalls) {
          expect(msg.event.category).toBe('status');
        }
      });

      it('emits unique IDs across multiple telemetry events', () => {
        mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
        initializeAgents('/workspace', context, webview);
        webview.postMessage.mockClear();

        updateAgentStatus('homer', 'active', 'task1', webview);
        updateAgentStatus('homer', 'idle', null, webview);
        updateAgentStatus('homer', 'active', 'task2', webview);

        const ids = webview.postMessage.mock.calls
          .filter(([msg]: [any]) => msg.type === 'telemetryEvent')
          .map(([msg]: [any]) => msg.event.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      });

      it('does not emit telemetry for unknown agents', () => {
        mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
        initializeAgents('/workspace', context, webview);
        webview.postMessage.mockClear();

        updateAgentStatus('unknown-agent', 'active', 'task', webview);

        const telemetryCalls = webview.postMessage.mock.calls.filter(
          ([msg]: [any]) => msg.type === 'telemetryEvent',
        );
        expect(telemetryCalls).toHaveLength(0);
      });
    });
  });

  describe('refreshAgents', () => {
    it('sends the selected workspace stable directory identity in creates and snapshots', () => {
      initializeAgents('/workspace', context, webview);
      mockReadTeamRoster.mockReturnValue([makeMember('Synthetic Member', 'synthetic-member')]);
      const directoryId = 'workspace:file:///selected-root';
      const directoryIds = [directoryId, 'saved-stable-id'];
      const agents = refreshAgents('/workspace', context, webview, directoryIds);
      const created = webview.postMessage.mock.calls.find(([message]: [any]) => message.type === 'agentCreated')?.[0];
      expect(created.agent).toMatchObject({ id: 'synthetic-member', directoryId, directoryMappingIds: directoryIds });

      webview.postMessage.mockClear();
      sendExistingAgents(agents, context, webview, directoryIds);
      const snapshot = webview.postMessage.mock.calls.find(([message]: [any]) => message.type === 'existingAgents')?.[0];
      expect(snapshot.agents).toEqual([expect.objectContaining({
        id: 'synthetic-member', directoryId, directoryMappingIds: directoryIds,
      })]);
    });

    it('adds new members and removes departed ones', () => {
      // Start with homer and lisa
      mockReadTeamRoster.mockReturnValue([
        makeMember('Homer Simpson', 'homer-simpson'),
        makeMember('Lisa Simpson', 'lisa-simpson'),
      ]);
      initializeAgents('/workspace', context, webview);
      webview.postMessage.mockClear();

      // Refresh: lisa stays, homer departs, bart joins
      mockReadTeamRoster.mockReturnValue([
        makeMember('Lisa Simpson', 'lisa-simpson'),
        makeMember('Bart Simpson', 'bart-simpson'),
      ]);
      const agents = refreshAgents('/workspace', context, webview);

      // Homer was removed
      expect(agents.has('homer-simpson')).toBe(false);
      // Bart was added
      expect(agents.has('bart-simpson')).toBe(true);
      // Lisa still exists
      expect(agents.has('lisa-simpson')).toBe(true);

      const closedCalls = webview.postMessage.mock.calls.filter(
        ([msg]: [any]) => msg.type === 'agentClosed',
      );
      expect(closedCalls).toHaveLength(1);
      expect(closedCalls[0][0].agentId).toBe('homer-simpson');

      const createdCalls = webview.postMessage.mock.calls.filter(
        ([msg]: [any]) => msg.type === 'agentCreated',
      );
      expect(createdCalls).toHaveLength(1);
      expect(createdCalls[0][0].agent.id).toBe('bart-simpson');
    });
  });

  describe('saveAgentSeats', () => {
    it('persists seat assignments to workspace state', () => {
      mockReadTeamRoster.mockReturnValue([
        makeMember('Homer', 'homer'),
        makeMember('Lisa', 'lisa'),
      ]);
      initializeAgents('/workspace', context, webview);

      saveAgentSeats({ homer: 'seat-1', lisa: 'seat-2' }, context);

      expect(context.workspaceState.update).toHaveBeenCalled();
      const agents = getAgents();
      expect(agents.get('homer')?.seatId).toBe('seat-1');
      expect(agents.get('lisa')?.seatId).toBe('seat-2');
    });
  });

  describe('resolveAgentId', () => {
    it('maps display names, first names and suffixed slugs to roster ids', () => {
      mockReadTeamRoster.mockReturnValue([
        makeMember('Homer Simpson', 'homer-simpson'),
        makeMember('Lisa Simpson', 'lisa'),
      ]);
      initializeAgents('/workspace', context, webview);

      expect(resolveAgentId('homer-simpson')).toBe('homer-simpson');
      expect(resolveAgentId('Homer Simpson')).toBe('homer-simpson');
      expect(resolveAgentId('Homer')).toBe('homer-simpson');
      expect(resolveAgentId('lisa-auth-choice')).toBe('lisa');
      expect(resolveAgentId('marge')).toBeNull();
    });

    it('routes activity reported by display name to the roster member', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer Simpson', 'homer-simpson')]);
      initializeAgents('/workspace', context, webview);
      webview.postMessage.mockClear();

      updateAgentStatus('Homer Simpson', 'active', 'reviewing', webview);

      expect(getAgents().get('homer-simpson')?.status).toBe('active');
    });
  });

  describe('activity lifecycle', () => {
    it('resets the idle timer on every active event but posts status once', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
      initializeAgents('/workspace', context, webview);
      webview.postMessage.mockClear();

      updateAgentStatus('homer', 'active', 'task', webview);
      updateAgentStatus('homer', 'active', 'task', webview);

      expect(resetActivityTimer).toHaveBeenCalledTimes(2);
      const statusCalls = webview.postMessage.mock.calls.filter(
        ([msg]: [any]) => msg.type === 'agentStatus',
      );
      expect(statusCalls).toHaveLength(1);
    });

    it('clears tools when an agent goes idle', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
      initializeAgents('/workspace', context, webview);
      updateAgentStatus('homer', 'active', 'task', webview);
      webview.postMessage.mockClear();

      updateAgentStatus('homer', 'idle', null, webview);

      const types = webview.postMessage.mock.calls.map(([msg]: [any]) => msg.type);
      expect(types).toContain('agentToolDone');
      expect(types).toContain('agentToolsClear');
    });
  });

  describe('refreshAgents', () => {
    it('updates name and role of existing members', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer', 'Dev')]);
      initializeAgents('/workspace', context, webview);

      mockReadTeamRoster.mockReturnValue([makeMember('Homer J.', 'homer', 'Lead')]);
      const agents = refreshAgents('/workspace', context, webview);

      expect(agents.get('homer')?.name).toBe('Homer J.');
      expect(agents.get('homer')?.role).toBe('Lead');
    });
  });

  describe('saveAgentSeats', () => {
    it('clears seats missing from the latest map', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer'), makeMember('Lisa', 'lisa')]);
      initializeAgents('/workspace', context, webview);
      saveAgentSeats({ homer: 'seat-1', lisa: 'seat-2' }, context);

      saveAgentSeats({ homer: 'seat-3' }, context);

      expect(getAgents().get('homer')?.seatId).toBe('seat-3');
      expect(getAgents().get('lisa')?.seatId ?? null).toBeNull();
    });
  });

  describe('disposeAgentManager', () => {
    it('clears the agents map', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);
      initializeAgents('/workspace', context, webview);
      expect(getAgents().size).toBe(1);

      disposeAgentManager();
      expect(getAgents().size).toBe(0);
    });
  });
});
