import { describe, expect, it } from 'vitest';
import { CANVAS_CONTROL_CAPABILITIES, CANVAS_OBSERVER_CAPABILITIES,
  STANDALONE_CONTROL_CAPABILITIES, STANDALONE_OBSERVER_CAPABILITIES } from './hostCapabilities.js';

describe('Canvas observer capabilities', () => {
  it('advertises only settings/detail reads and no recovery without changing standalone defaults', () => {
    expect(CANVAS_OBSERVER_CAPABILITIES).toEqual({
      actions: ['getSettings', 'requestAgentDetail'], recoveryState: 'unavailable',
    });
    expect(Object.isFrozen(CANVAS_OBSERVER_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(CANVAS_OBSERVER_CAPABILITIES.actions)).toBe(true);
    expect(CANVAS_OBSERVER_CAPABILITIES).not.toBe(STANDALONE_OBSERVER_CAPABILITIES);
    expect(STANDALONE_OBSERVER_CAPABILITIES).toEqual(CANVAS_OBSERVER_CAPABILITIES);
  });

  it('limits opted-in Canvas editing to the existing guarded standalone office operations', () => {
    expect(CANVAS_CONTROL_CAPABILITIES).toEqual(STANDALONE_CONTROL_CAPABILITIES);
    expect(CANVAS_CONTROL_CAPABILITIES.recoveryState).toBe('browser-storage');
    expect(CANVAS_CONTROL_CAPABILITIES.actions).toEqual([
      'getSettings', 'requestAgentDetail', 'saveLayout', 'saveAgentSeats',
      'setSoundEnabled', 'setDebugEnabled', 'setShowAreas', 'importLayout', 'exportLayout', 'exportLayoutSnapshot',
    ]);
    expect(Object.isFrozen(CANVAS_CONTROL_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(CANVAS_CONTROL_CAPABILITIES.actions)).toBe(true);
  });
});
