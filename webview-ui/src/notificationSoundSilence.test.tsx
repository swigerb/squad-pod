import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { NotificationSound } from './notificationSound.js';
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
  static nextResume: Promise<void> | undefined;
  state: AudioContextState = 'suspended';
  readonly currentTime = 12;
  readonly destination = {};
  readonly oscillators: RecordingOscillator[] = [];
  readonly gains: RecordingGain[] = [];
  resumeCalls = 0;
  closeCalls = 0;
  resumeResult: Promise<void> = Promise.resolve();

  constructor() {
    this.resumeResult = RecordingAudioContext.nextResume ?? Promise.resolve();
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
    return this.resumeResult.then(() => { this.state = 'running'; });
  }

  close(): Promise<void> {
    this.closeCalls++;
    this.state = 'closed';
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
    const sound = host.querySelector<HTMLInputElement>('[id$="-sound"]');
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
    RecordingAudioContext.instances.length = 0;
    RecordingAudioContext.nextResume = undefined;
    client = createHostClientFixture();
    vi.stubGlobal('AudioContext', RecordingAudioContext);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<StrictMode><App client={client} /></StrictMode>));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    RecordingAudioContext.nextResume = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fails closed before settingsLoaded, including a synthetic pre-settings reconnect transition', () => {
    loadLayout();
    click('Settings');
    setSoundPreference(true);
    send({ type: 'soundEnabled', enabled: true });
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

  it('cancels queued notes on mute and only schedules new notes after unmuting', async () => {
    send({ type: 'settingsLoaded', soundEnabled: true, debugEnabled: false, showAreas: false });
    loadLayout();
    snapshot('active');
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });
    await act(async () => {});

    const [context] = RecordingAudioContext.instances;
    expect(context).toBeDefined();
    expect(context.state).toBe('running');
    expect(context.resumeCalls).toBe(1);
    expect(context.oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([659.25, 1318.5]);
    expect(context.oscillators.map((oscillator) => oscillator.starts)).toEqual([[12], [12.15]]);

    click('Settings');
    setSoundPreference(false);
    expect(host.querySelector<HTMLInputElement>('[id$="-sound"]')!.checked).toBe(false);
    expect(context.oscillators.every((oscillator) => oscillator.disconnected)).toBe(true);
    expect(context.gains.every((gain) => gain.disconnected)).toBe(true);
    expect(context.gains.every((gain) => gain.gain.events.some((event) => event.type === 'cancel'))).toBe(true);
    expect(context.gains.every((gain) => gain.gain.events.some((event) =>
      event.type === 'set' && event.value === 0 && event.time === context.currentTime))).toBe(true);
    expect(context.oscillators.every((oscillator) => oscillator.stops.at(-1) === context.currentTime)).toBe(true);

    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });
    expect(context.oscillators).toHaveLength(2);

    setSoundPreference(true);
    expect(host.querySelector<HTMLInputElement>('[id$="-sound"]')!.checked).toBe(true);
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });

    expect(RecordingAudioContext.instances).toHaveLength(1);
    expect(context.oscillators).toHaveLength(4);
    expect(context.oscillators.slice(2).map((oscillator) => oscillator.frequency.value)).toEqual([659.25, 1318.5]);
    expect(context.oscillators.slice(2).every((oscillator) => !oscillator.disconnected)).toBe(true);
  });

  it('preserves the enabled two-note chime for an active-to-waiting transition', async () => {
    send({ type: 'settingsLoaded', soundEnabled: true, debugEnabled: false, showAreas: false });
    loadLayout();
    snapshot('active');
    const oscillatorCount = RecordingAudioContext.instances.at(-1)?.oscillators.length ?? 0;
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'waiting' });
    await act(async () => {});

    const context = RecordingAudioContext.instances.at(-1);
    expect(context).toBeDefined();
    expect(context!.oscillators.slice(oscillatorCount).map((oscillator) => oscillator.frequency.value))
      .toEqual([659.25, 1318.5]);
    expect(context!.oscillators.slice(oscillatorCount).map((oscillator) => oscillator.starts))
      .toEqual([[12], [12.15]]);
  });

  it('cancels the first effect runtime and plays once after synchronous-host StrictMode replay', async () => {
    act(() => root.unmount());
    root = createRoot(host);
    let resolve!: () => void;
    RecordingAudioContext.nextResume = new Promise<void>(done => { resolve = done; });
    vi.mocked(client.send).mockImplementation(message => {
      if (message.type !== 'webviewReady') return;
      client.emit({ type: 'settingsLoaded', soundEnabled: true, debugEnabled: false, showAreas: false });
      client.emit({ type: 'layoutLoaded', layout: {
        version: 1, cols: 5, rows: 5, tiles: Array(25).fill(1), furniture: [],
      } });
      client.emit({ type: 'existingAgents', agents: [{
        id: 'fixture-agent', name: 'Replay fixture', role: 'Developer', paletteIndex: 0,
        seatId: null, status: 'active', currentTask: null,
      }] });
      client.emit({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });
    });
    act(() => root.render(<StrictMode><App client={client} /></StrictMode>));
    const [discarded, current] = RecordingAudioContext.instances;
    expect(RecordingAudioContext.instances).toHaveLength(2);
    expect(discarded.closeCalls).toBe(1);
    expect(current.closeCalls).toBe(0);
    resolve();
    await act(async () => {});
    expect(discarded.oscillators).toHaveLength(0);
    expect(current.oscillators).toHaveLength(2);
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
    send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'waiting' });
    expect(current.oscillators).toHaveLength(4);
  });

  it('isolates preferences, real message playback and teardown across two StrictMode Apps', async () => {
    const peerHost = document.createElement('div');
    document.body.append(peerHost);
    const peerClient = createHostClientFixture();
    const peerRoot = createRoot(peerHost);
    act(() => peerRoot.render(<StrictMode><App client={peerClient} /></StrictMode>));
    const peerSend = (message: OutboundMessage) => act(() => peerClient.emit(message));
    const transition = (emit: typeof send) => {
      emit({ type: 'agentStatus', agentId: 'fixture-agent', status: 'active' });
      emit({ type: 'agentStatus', agentId: 'fixture-agent', status: 'waiting' });
    };
    try {
      loadLayout();
      peerSend({ type: 'layoutLoaded', layout: {
        version: 1, cols: 5, rows: 5, tiles: Array(25).fill(1), furniture: [],
      } });
      snapshot('active');
      peerSend({ type: 'existingAgents', agents: [{
        id: 'fixture-agent', name: 'Peer fixture', role: 'Developer', paletteIndex: 0, seatId: null,
        status: 'active', currentTask: null,
      }] });
      send({ type: 'settingsLoaded', soundEnabled: true, debugEnabled: false, showAreas: false });
      // Merely enabling A cannot enable B, and neither settings nor snapshots play.
      expect(RecordingAudioContext.instances).toHaveLength(0);
      transition(peerSend);
      peerSend({ type: 'soundEnabled', enabled: true });
      transition(peerSend);
      expect(RecordingAudioContext.instances).toHaveLength(0);
      transition(send);
      await act(async () => {});
      const [a] = RecordingAudioContext.instances;
      expect(a.oscillators).toHaveLength(2);
      peerSend({ type: 'settingsLoaded', soundEnabled: true, debugEnabled: false, showAreas: false });
      transition(peerSend);
      await act(async () => {});
      const b = RecordingAudioContext.instances[1];
      expect(RecordingAudioContext.instances).toHaveLength(2);
      expect(b.oscillators).toHaveLength(2);
      expect(a.oscillators).toHaveLength(2);
      click('Settings');
      setSoundPreference(false);
      expect(client.send).toHaveBeenCalledWith({ type: 'setSoundEnabled', enabled: false });
      expect(peerClient.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setSoundEnabled' }));
      expect(a.oscillators.every(note => note.disconnected)).toBe(true);
      expect(b.oscillators.every(note => !note.disconnected)).toBe(true);
      transition(send);
      transition(peerSend);
      expect(a.oscillators).toHaveLength(2);
      expect(b.oscillators).toHaveLength(4);
      peerSend({ type: 'soundEnabled', enabled: false });
      setSoundPreference(true);
      transition(peerSend);
      transition(send);
      expect(a.oscillators).toHaveLength(4);
      expect(b.oscillators).toHaveLength(4);
      // Unknown agents, snapshots, tools and repeated non-active status stay silent.
      send({ type: 'agentStatus', agentId: 'unknown', status: 'idle' });
      send({ type: 'agentStatus', agentId: 'fixture-agent', status: 'idle' });
      send({ type: 'agentToolDone', agentId: 'fixture-agent', tool: 'Read' });
      snapshot('active');
      expect(a.oscillators).toHaveLength(4);
      act(() => root.unmount());
      root = createRoot(host);
      expect(a.closeCalls).toBe(1);
      expect(a.oscillators.every(note => note.disconnected)).toBe(true);
      expect(b.closeCalls).toBe(0);
      peerSend({ type: 'soundEnabled', enabled: true });
      transition(peerSend);
      expect(b.oscillators).toHaveLength(6);
      expect(b.oscillators.slice(-2).every(note => !note.disconnected)).toBe(true);
    } finally {
      act(() => peerRoot.unmount());
      peerHost.remove();
    }
    expect(RecordingAudioContext.instances.every(context => context.closeCalls === 1)).toBe(true);
  });
});

describe('notification runtime cancellation (controlled browser audio, no device qualification)', () => {
  beforeEach(() => {
    RecordingAudioContext.instances.length = 0;
    vi.stubGlobal('AudioContext', RecordingAudioContext);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    RecordingAudioContext.nextResume = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['mute', 'dispose'] as const)('invalidates pending resume across %s and reuse', async action => {
    let resolve!: () => void;
    RecordingAudioContext.nextResume = new Promise<void>(done => { resolve = done; });
    const sound = new NotificationSound();
    sound.activate();
    sound.setEnabled(true);
    expect(RecordingAudioContext.instances).toHaveLength(0);
    sound.playDoneSound();
    const [old] = RecordingAudioContext.instances;
    expect(old.oscillators).toHaveLength(0);
    if (action === 'mute') { sound.setEnabled(false); sound.setEnabled(true); }
    else { sound.dispose(); sound.activate(); }
    resolve();
    await act(async () => {});
    expect(old.oscillators).toHaveLength(0);
    RecordingAudioContext.nextResume = undefined;
    sound.playDoneSound();
    await act(async () => {});
    const current = RecordingAudioContext.instances.at(-1)!;
    expect(current.oscillators).toHaveLength(2);
    expect(current.closeCalls).toBe(0);
    // Natural completion removes nodes from the owner's cleanup set.
    current.oscillators.forEach(note => note.onended?.());
    const stops = current.oscillators.map(note => [...note.stops]);
    sound.dispose();
    sound.dispose();
    expect(current.oscillators.map(note => note.stops)).toEqual(stops);
    expect(current.closeCalls).toBe(1);
    sound.playDoneSound();
    expect(RecordingAudioContext.instances.at(-1)).toBe(current);
  });

  it.each(['NotAllowedError', 'NotSupportedError', 'SecurityError'])(
    'keeps browser %s resume silent without unhandled rejection or automatic retry', async name => {
    RecordingAudioContext.nextResume = Promise.reject(new DOMException('synthetic restriction', name));
    const sound = new NotificationSound();
    sound.activate();
    sound.setEnabled(true);
    sound.playDoneSound();
    await act(async () => {});
    const [context] = RecordingAudioContext.instances;
    expect(context.oscillators).toHaveLength(0);
    expect(context.resumeCalls).toBe(1);
    expect(console.error).not.toHaveBeenCalled();
    sound.dispose();
    expect(context.closeCalls).toBe(1);
  });

  it('keeps missing AudioContext and unsupported construction intentionally silent', () => {
    const sound = new NotificationSound();
    sound.activate();
    sound.setEnabled(true);
    vi.stubGlobal('AudioContext', undefined);
    sound.playDoneSound();
    vi.stubGlobal('AudioContext', class {
      constructor() { throw new DOMException('synthetic unsupported', 'NotSupportedError'); }
    });
    sound.playDoneSound();
    expect(console.error).not.toHaveBeenCalled();
    expect(RecordingAudioContext.instances).toHaveLength(0);
    sound.dispose();
  });

  it('diagnoses unexpected construction failures without exposing exception content', () => {
    vi.stubGlobal('AudioContext', class {
      constructor() { throw new Error('PRIVATE_SYNTHETIC_DATA'); }
    });
    const sound = new NotificationSound();
    sound.activate();
    sound.setEnabled(true);
    sound.playDoneSound();
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[NotificationSound] create context failed');
    expect(RecordingAudioContext.instances).toHaveLength(0);
    sound.dispose();
  });

  it('diagnoses unexpected resume rejection without scheduling or automatic retry', async () => {
    RecordingAudioContext.nextResume = Promise.reject(new Error('PRIVATE_SYNTHETIC_DATA'));
    const sound = new NotificationSound();
    sound.activate();
    sound.setEnabled(true);
    sound.playDoneSound();
    await act(async () => {});
    const [context] = RecordingAudioContext.instances;
    expect(context.oscillators).toHaveLength(0);
    expect(context.resumeCalls).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[NotificationSound] resume failed');
    sound.dispose();
  });

  it.each(['mute', 'dispose'] as const)('keeps stale rejected resume silent after %s', async action => {
    let reject!: (error: Error) => void;
    RecordingAudioContext.nextResume = new Promise<void>((_resolve, fail) => { reject = fail; });
    const sound = new NotificationSound();
    sound.activate();
    sound.setEnabled(true);
    sound.playDoneSound();
    if (action === 'mute') sound.setEnabled(false);
    else sound.dispose();
    reject(new Error('synthetic late failure'));
    await act(async () => {});
    expect(RecordingAudioContext.instances[0].oscillators).toHaveLength(0);
    expect(console.error).not.toHaveBeenCalled();
    sound.dispose();
  });

  it.each(['createGain', 'start'] as const)(
    'diagnoses %s failure and cleans partial nodes without interrupting a peer', async operation => {
    const sound = new NotificationSound();
    const peer = new NotificationSound();
    for (const owner of [sound, peer]) { owner.activate(); owner.setEnabled(true); }
    // Fail the second note after the first was scheduled, including partial pair creation.
    const failure = new DOMException('PRIVATE_SYNTHETIC_DATA', 'NotSupportedError');
    const originalGain = RecordingAudioContext.prototype.createGain;
    const originalStart = RecordingOscillator.prototype.start;
    const target = operation === 'createGain'
      ? vi.spyOn(RecordingAudioContext.prototype, 'createGain')
        .mockImplementationOnce(originalGain).mockImplementationOnce(() => { throw failure; })
      : vi.spyOn(RecordingOscillator.prototype, 'start')
        .mockImplementationOnce(originalStart).mockImplementationOnce(() => { throw failure; });
    sound.playDoneSound();
    await act(async () => {});
    const [failed] = RecordingAudioContext.instances;
    expect(failed.oscillators).toHaveLength(2);
    expect(failed.oscillators.every(note => note.disconnected && note.stops.at(-1) === 12)).toBe(true);
    expect(failed.gains).toHaveLength(operation === 'createGain' ? 1 : 2);
    expect(failed.gains.every(node => node.disconnected)).toBe(true);
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[NotificationSound] playback failed');
    target.mockRestore();
    peer.playDoneSound();
    await act(async () => {});
    const healthy = RecordingAudioContext.instances[1];
    expect(healthy.oscillators).toHaveLength(2);
    expect(healthy.oscillators.every(note => note.starts.length === 1 && !note.disconnected)).toBe(true);
    sound.dispose();
    expect(healthy.closeCalls).toBe(0);
    peer.dispose();
  });

  it.each(['reject', 'throw'] as const)('handles %s close failure once without leaking data', async mode => {
    const sound = new NotificationSound();
    sound.activate();
    sound.setEnabled(true);
    sound.playDoneSound();
    await act(async () => {});
    const [context] = RecordingAudioContext.instances;
    vi.spyOn(context, 'close').mockImplementation(() => {
      if (mode === 'throw') throw new Error('PRIVATE_SYNTHETIC_DATA');
      return Promise.reject(new Error('PRIVATE_SYNTHETIC_DATA'));
    });
    sound.dispose();
    sound.dispose();
    await act(async () => {});
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.oscillators.every(note => note.disconnected)).toBe(true);
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[NotificationSound] close failed');
  });

  it('continues teardown and closes context when automation cancellation fails', async () => {
    const sound = new NotificationSound();
    sound.activate();
    sound.setEnabled(true);
    sound.playDoneSound();
    await act(async () => {});
    const [context] = RecordingAudioContext.instances;
    vi.spyOn(context.gains[0].gain, 'cancelScheduledValues').mockImplementation(() => {
      throw new Error('PRIVATE_SYNTHETIC_DATA');
    });
    sound.dispose();
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[NotificationSound] cancel automation failed');
    expect(context.oscillators.every(note => note.disconnected)).toBe(true);
    expect(context.gains.every(node => node.disconnected)).toBe(true);
    expect(context.closeCalls).toBe(1);
  });
});
