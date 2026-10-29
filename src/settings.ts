import { GLOBAL_KEY_DEBUG_ENABLED, GLOBAL_KEY_SHOW_AREAS, GLOBAL_KEY_SOUND_ENABLED } from './constants.js';
import type { PodSettings } from './types.js';

interface SettingsStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: boolean): PromiseLike<void>;
}

export function readSettings(store: SettingsStore): PodSettings {
  return {
    soundEnabled: store.get(GLOBAL_KEY_SOUND_ENABLED, true),
    debugEnabled: store.get(GLOBAL_KEY_DEBUG_ENABLED, false),
    showAreas: store.get(GLOBAL_KEY_SHOW_AREAS, false),
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
  const key = setting === 'soundEnabled' ? GLOBAL_KEY_SOUND_ENABLED
    : setting === 'debugEnabled' ? GLOBAL_KEY_DEBUG_ENABLED : GLOBAL_KEY_SHOW_AREAS;
  await store.update(key, enabled);
}
