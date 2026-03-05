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
