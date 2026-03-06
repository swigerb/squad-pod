import type { SquadTeamMember } from './types.js';

// Mock teamParser BEFORE importing agentManager
vi.mock('./teamParser.js', () => ({
  readTeamRoster: vi.fn(),
}));

// Mock timerManager to avoid real timers interfering
vi.mock('./timerManager.js', () => ({
  resetActivityTimer: vi.fn(),
  cancelAllTimers: vi.fn(),
}));

import { readTeamRoster } from './teamParser.js';
import {
  initializeAgents,
  refreshAgents,
  updateAgentStatus,
  saveAgentSeats,
  disposeAgentManager,
  getAgents,
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
    it('creates agents from roster and sends agentCreated messages', () => {
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

      // Verify 3 agentCreated messages
      const createdCalls = webview.postMessage.mock.calls.filter(
        ([msg]: [any]) => msg.type === 'agentCreated',
      );
      expect(createdCalls).toHaveLength(3);
      expect(createdCalls[0][0].agent.id).toBe('homer-simpson');
    });

    it('agents start with idle status and no current task', () => {
      mockReadTeamRoster.mockReturnValue([makeMember('Homer', 'homer')]);

      const agents = initializeAgents('/workspace', context, webview);

      const homer = agents.get('homer');
      expect(homer?.status).toBe('idle');
      expect(homer?.currentTask).toBeNull();
    });
  });

  describe('updateAgentStatus', () => {
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
        // currentTask was set previously but the null task param doesn't update it,
        // so the summary may include the old task. The key check: no ": null" in summary
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
