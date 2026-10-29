import { GLOBAL_KEY_DEBUG_ENABLED, GLOBAL_KEY_SOUND_ENABLED } from './constants.js';
import type { PodSettings } from './types.js';

interface SettingsStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: boolean): PromiseLike<void>;
}

export function readSettings(store: SettingsStore): PodSettings {
  return {
    soundEnabled: store.get(GLOBAL_KEY_SOUND_ENABLED, true),
    debugEnabled: store.get(GLOBAL_KEY_DEBUG_ENABLED, false),
  };
}

export async function saveSetting(
  store: SettingsStore,
  setting: keyof PodSettings,
  enabled: unknown,
): Promise<void> {
  if (typeof enabled !== 'boolean') {
    throw new Error(`Invalid ${setting} setting: expected a boolean`);
  }
  await store.update(setting === 'soundEnabled' ? GLOBAL_KEY_SOUND_ENABLED : GLOBAL_KEY_DEBUG_ENABLED, enabled);
}
