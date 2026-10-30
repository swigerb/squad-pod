import { afterEach, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { PersistedAgentMeta } from './types.js';
vi.mock('./teamParser.js', () => ({ readTeamRoster: vi.fn() }));
import { readTeamRoster } from './teamParser.js';
import { initializeAgents, setExternalCharacterPalettes, disposeAgentManager } from './agentManager.js';
import { EXTERNAL_CHARACTER_BASE } from './characterAssets.js';
import { WORKSPACE_KEY_AGENTS } from './constants.js';

afterEach(() => { disposeAgentManager(); vi.clearAllMocks(); });

it('preserves persisted indices and assigns new members stable external slots before legacy slots', () => {
  const meta: PersistedAgentMeta = { legacy: { palette: 7 }, external: { palette: EXTERNAL_CHARACTER_BASE + 48 } };
  const store = {
    get: (key: string) => key === WORKSPACE_KEY_AGENTS ? meta : {},
    update: vi.fn(),
  };
  const context = { workspaceState: store } as unknown as vscode.ExtensionContext;
  vi.mocked(readTeamRoster).mockReturnValue(['legacy', 'external', 'new', 'next'].map((slug) => ({
    slug, name: slug, role: 'Dev', status: 'Active', charterPath: '',
  })));
  setExternalCharacterPalettes([EXTERNAL_CHARACTER_BASE + 96, EXTERNAL_CHARACTER_BASE + 48]);
  let agents = initializeAgents('fixture', context);
  expect([...agents.values()].map((agent) => agent.paletteIndex)).toEqual([
    7, EXTERNAL_CHARACTER_BASE + 48, EXTERNAL_CHARACTER_BASE + 96, 0,
  ]);
  setExternalCharacterPalettes([]);
  agents = initializeAgents('fixture', context);
  expect(agents.get('legacy')?.paletteIndex).toBe(7);
  expect(agents.get('external')?.paletteIndex).toBe(EXTERNAL_CHARACTER_BASE + 48);
  expect(store.update).toHaveBeenCalledWith(WORKSPACE_KEY_AGENTS, expect.objectContaining({
    legacy: { palette: 7, seatId: undefined },
    external: { palette: EXTERNAL_CHARACTER_BASE + 48, seatId: undefined },
  }));
});
