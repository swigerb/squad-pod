import { describe, expect, it } from 'vitest';
import { GLOBAL_KEY_DEBUG_ENABLED, GLOBAL_KEY_SOUND_ENABLED } from './constants.js';
import { readSettings, saveSetting } from './settings.js';

describe('host-persisted settings', () => {
  function createStore(values = new Map<string, unknown>()) {
    return {
      get<T>(key: string, defaultValue: T): T {
        return (values.has(key) ? values.get(key) : defaultValue) as T;
      },
      async update(key: string, value: boolean) { values.set(key, value); },
    };
  }

  it('defaults debug off and preserves the existing sound default', () => {
    expect(readSettings(createStore())).toEqual({ soundEnabled: true, debugEnabled: false });
  });

  it('restores both toggles from the same storage after recreating the reader', async () => {
    const values = new Map<string, unknown>();
    await saveSetting(createStore(values), 'soundEnabled', false);
    await saveSetting(createStore(values), 'debugEnabled', true);
    expect(values.get(GLOBAL_KEY_SOUND_ENABLED)).toBe(false);
    expect(values.get(GLOBAL_KEY_DEBUG_ENABLED)).toBe(true);
    expect(readSettings(createStore(values))).toEqual({ soundEnabled: false, debugEnabled: true });
    await saveSetting(createStore(values), 'debugEnabled', false);
    expect(readSettings(createStore(values)).debugEnabled).toBe(false);
  });

  it('rejects invalid input without replacing a saved value and propagates storage failures', async () => {
    const store = createStore();
    await saveSetting(store, 'soundEnabled', false);
    await expect(saveSetting(store, 'soundEnabled', 'true')).rejects.toThrow('expected a boolean');
    expect(readSettings(store).soundEnabled).toBe(false);
    await expect(saveSetting({ ...store, update: () => Promise.reject(new Error('disk full')) },
      'debugEnabled', true)).rejects.toThrow('disk full');
  });
});
