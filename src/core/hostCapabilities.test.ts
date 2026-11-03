import { describe, expect, it } from 'vitest';
import { CANVAS_OBSERVER_CAPABILITIES, STANDALONE_OBSERVER_CAPABILITIES } from './hostCapabilities.js';

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
});
