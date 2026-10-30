import type { PersistedAgentMeta, PodSettings, WebviewMessage } from '../../src/types.js';

export interface OfficePreferences {
  version: 1;
  settings: PodSettings;
  agents: PersistedAgentMeta;
}
export const defaultPreferences = (): OfficePreferences => ({
  version: 1, settings: { soundEnabled: false, debugEnabled: false, showAreas: false }, agents: {},
});
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function validPreferences(value: unknown): value is OfficePreferences {
  if (!record(value) || !exactKeys(value, ['version', 'settings', 'agents']) || value.version !== 1
    || !record(value.settings) || !exactKeys(value.settings, ['soundEnabled', 'debugEnabled', 'showAreas'])
    || !Object.values(value.settings).every(setting => typeof setting === 'boolean')
    || !record(value.agents) || Object.keys(value.agents).length > 128) return false;
  return Object.entries(value.agents).every(([id, meta]) =>
    /^[a-zA-Z0-9_-]{1,128}$/.test(id) && record(meta)
    && Object.keys(meta).every(key => key === 'palette' || key === 'seatId')
    && (meta.palette === undefined || (Number.isSafeInteger(meta.palette)
      && typeof meta.palette === 'number' && meta.palette >= 0 && meta.palette <= 4095))
    && (meta.seatId === undefined || (typeof meta.seatId === 'string'
      && meta.seatId.length > 0 && meta.seatId.length <= 256
      && !/[\u0000-\u001f\u007f]/.test(meta.seatId))));
}

export type PreferenceMutation = Extract<WebviewMessage, {
  type: 'saveAgentSeats' | 'setSoundEnabled' | 'setDebugEnabled' | 'setShowAreas'
}>;
export function validPreferenceMutation(value: unknown): value is PreferenceMutation {
  if (!record(value)) return false;
  if (value.type === 'saveAgentSeats') {
    return exactKeys(value, ['type', 'seats']) && record(value.seats)
      && Object.keys(value.seats).length <= 128
      && Object.entries(value.seats).every(([id, seat]) => /^[a-zA-Z0-9_-]{1,128}$/.test(id)
        && typeof seat === 'string' && seat.length > 0 && seat.length <= 256
        && !/[\u0000-\u001f\u007f]/.test(seat));
  }
  return ['setSoundEnabled', 'setDebugEnabled', 'setShowAreas'].includes(String(value.type))
    && exactKeys(value, ['type', 'enabled']) && typeof value.enabled === 'boolean';
}
