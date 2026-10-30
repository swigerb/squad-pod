import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { isSoundEnabled, setSoundEnabled, unlockAudio } from './notificationSound.js';
import type { OutboundMessage } from '../../src/types.js';
import { createHostClientFixture } from './__tests__/hostClientFixture.js';
import type { HostClientFixture } from './__tests__/hostClientFixture.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

class RecordingAudioParam {
  readonly events: Array<{ type: string; value?: number; time: number }> = [];

  setValueAtTime(value: number, time: number): void {
    this.events.push({ type: 'set', value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push({ type: 'linear', value, time });
  }

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.events.push({ type: 'exponential', value, time });
  }

  cancelScheduledValues(time: number): void {
    this.events.push({ type: 'cancel', time });
  }
}

class RecordingOscillator {
  readonly frequency = { value: 0 };
  type: OscillatorType = 'sine';
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  disconnected = false;
  onended: (() => void) | null = null;

  connect(_destination: unknown): void {}
  disconnect(): void { this.disconnected = true; }
  start(time: number): void { this.starts.push(time); }
  stop(time: number): void { this.stops.push(time); }
}

class RecordingGain {
  readonly gain = new RecordingAudioParam();
  disconnected = false;

  connect(_destination: unknown): void {}
  disconnect(): void { this.disconnected = true; }
}

class RecordingAudioContext {
  static readonly instances: RecordingAudioContext[] = [];
  readonly state: AudioContextState = 'suspended';
  readonly currentTime = 12;
  readonly destination = {};
  readonly oscillators: RecordingOscillator[] = [];
  readonly gains: RecordingGain[] = [];
  resumeCalls = 0;

  constructor() {
    RecordingAudioContext.instances.push(this);
  }

  createOscillator(): RecordingOscillator {
    const oscillator = new RecordingOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain(): RecordingGain {
    const gain = new RecordingGain();
    this.gains.push(gain);
    return gain;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    return Promise.resolve();
  }
}

describe('muted notification sound transitions at the App host boundary', () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: HostClientFixture;

  function send(message: OutboundMessage): void {
    act(() => client.emit(message));
  }

  function click(text: string): void {
    const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
    expect(button, text).toBeDefined();
    act(() => button!.click());
  }

  function setSoundPreference(enabled: boolean): void {
    const sound = host.querySelector<HTMLInputElement>('#squad-pod-sound');
    expect(sound).toBeDefined();
    expect(sound!.checked).not.toBe(enabled);
    act(() => sound!.click());
  }

  function loadLayout(): void {
    send({
      type: 'layoutLoaded',
      layout: { version: 1, cols: 5, rows: 5, tiles: Array(25).fill(1), furniture: [] },
    });
  }

  function snapshot(status: 'active' | 'idle'): void {
    send({
      type: 'existingAgents',
      agents: [{
        id: 'fixture-agent',
        name: 'Synthetic Fixture Agent',
        role: 'Developer',
        paletteIndex: 0,
        seatId: null,
        status,
        currentTask: null,
      }],
    });
  }

  beforeEach(() => {
    client = createHostClientFixture();
    vi.stubGlobal('AudioContext', RecordingAudioContext);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<App client={client} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    setSoundEnabled(false);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fails closed before settingsLoaded, including a synthetic pre-settings reconnect transition', () => {
    expect(isSoundEnabled()).toBe(false);
    loadLayout();
    click('Settings');
    setSoundPreference(true);
    expect(isSoundEnabled()).toBe(false);
    send({ type: 'soundEnabled', enabled: true });
    expect(isSoundEnabled()).toBe(false);
    snapshot('active');

    // Synthetic host injection: the real provider sends settingsLoaded before snapshots on webviewReady.
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });
    expect(RecordingAudioContext.instances).toHaveLength(0);

    send({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: false });
    snapshot('active');
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'waiting' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });

    expect(RecordingAudioContext.instances).toHaveLength(0);
  });

  it('keeps buffered reconnect activity silent when persisted mute is known first', () => {
    send({ type: 'settingsLoaded', soundEnabled: false, debugEnabled: false, showAreas: false });
    snapshot('active');
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'waiting' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });
    loadLayout();

    expect(RecordingAudioContext.instances).toHaveLength(0);
  });

  it('cancels queued notes on mute and only schedules new notes after unmuting', () => {
    send({ type: 'settingsLoaded', soundEnabled: true, debugEnabled: false, showAreas: false });
    loadLayout();
    snapshot('active');
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });

    const [context] = RecordingAudioContext.instances;
    expect(context).toBeDefined();
    expect(context.state).toBe('suspended');
    expect(context.resumeCalls).toBe(1);
    expect(context.oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([659.25, 1318.5]);
    expect(context.oscillators.map((oscillator) => oscillator.starts)).toEqual([[12], [12.15]]);

    click('Settings');
    setSoundPreference(false);
    expect(isSoundEnabled()).toBe(false);
    expect(context.oscillators.every((oscillator) => oscillator.disconnected)).toBe(true);
    expect(context.gains.every((gain) => gain.disconnected)).toBe(true);
    expect(context.gains.every((gain) => gain.gain.events.some((event) => event.type === 'cancel'))).toBe(true);
    expect(context.gains.every((gain) => gain.gain.events.some((event) =>
      event.type === 'set' && event.value === 0 && event.time === context.currentTime))).toBe(true);
    expect(context.oscillators.every((oscillator) => oscillator.stops.at(-1) === context.currentTime)).toBe(true);

    const resumesAfterMute = context.resumeCalls;
    unlockAudio();
    expect(context.resumeCalls).toBe(resumesAfterMute);

    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });
    expect(context.oscillators).toHaveLength(2);

    setSoundPreference(true);
    expect(isSoundEnabled()).toBe(true);
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });

    expect(RecordingAudioContext.instances).toHaveLength(1);
    expect(context.oscillators).toHaveLength(4);
    expect(context.oscillators.slice(2).map((oscillator) => oscillator.frequency.value)).toEqual([659.25, 1318.5]);
    expect(context.oscillators.slice(2).every((oscillator) => !oscillator.disconnected)).toBe(true);
  });

  it('preserves the enabled two-note chime for an active-to-waiting transition', () => {
    send({ type: 'settingsLoaded', soundEnabled: true, debugEnabled: false, showAreas: false });
    expect(isSoundEnabled()).toBe(true);
    loadLayout();
    snapshot('active');
    const oscillatorCount = RecordingAudioContext.instances.at(-1)?.oscillators.length ?? 0;
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'waiting' });

    const context = RecordingAudioContext.instances.at(-1);
    expect(context).toBeDefined();
    expect(context!.oscillators.slice(oscillatorCount).map((oscillator) => oscillator.frequency.value))
      .toEqual([659.25, 1318.5]);
    expect(context!.oscillators.slice(oscillatorCount).map((oscillator) => oscillator.starts))
      .toEqual([[12], [12.15]]);
  });
});
