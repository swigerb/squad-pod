import {
  NOTIFICATION_NOTE_1_FREQ,
  NOTIFICATION_NOTE_2_FREQ,
  NOTIFICATION_NOTE_DURATION_SEC,
  NOTIFICATION_NOTE_GAP_SEC,
} from './constants.js';

type ScheduledNote = { oscillator: OscillatorNode; gainNode?: GainNode };
type AudioOperation = 'create context' | 'resume' | 'playback' | 'cancel automation' | 'silence' | 'stop' | 'disconnect' | 'close';

function reportAudioFailure(operation: AudioOperation): void {
  // Never include exception messages/stacks or notification/workspace data.
  console.error(`[NotificationSound] ${operation} failed`);
}

function isBrowserRestriction(error: unknown): boolean {
  return error instanceof DOMException
    && ['NotAllowedError', 'NotSupportedError', 'SecurityError'].includes(error.name);
}

export class NotificationSound {
  private audioContext: AudioContext | null = null;
  private enabled = false;
  private active = false;
  private generation = 0;
  private scheduledNotes = new Set<ScheduledNote>();

  // Effect replay reactivates the owner, but never resurrects its old runtime/work.
  activate(): void { this.active = true; }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.generation++;
      this.cancelNotes();
    }
  }

  private cancelNotes(): void {
    const now = this.audioContext?.currentTime ?? 0;
    for (const note of this.scheduledNotes) {
      if (note.gainNode) {
        const gain = note.gainNode.gain;
        this.cleanup('cancel automation', () => gain.cancelScheduledValues(now));
        this.cleanup('silence', () => gain.setValueAtTime(0, now));
      }
      this.cleanup('stop', () => note.oscillator.stop(now));
      this.disconnectNote(note);
    }
  }

  private cleanup(operation: AudioOperation, action: () => void): void {
    try { action(); } catch (error: unknown) {
      // Stopping a node that never started/already ended is harmless during cleanup.
      if (operation === 'stop' && error instanceof DOMException && error.name === 'InvalidStateError') return;
      reportAudioFailure(operation);
    }
  }

  private disconnectNote(note: ScheduledNote): void {
    this.scheduledNotes.delete(note);
    note.oscillator.onended = null;
    this.cleanup('disconnect', () => note.oscillator.disconnect());
    if (note.gainNode) this.cleanup('disconnect', () => note.gainNode!.disconnect());
  }

  dispose(): void {
    this.active = false;
    this.generation++;
    this.cancelNotes();
    const context = this.audioContext;
    this.audioContext = null;
    if (context) {
      this.cleanup('close', () => {
        void context.close().catch(() => reportAudioFailure('close'));
      });
    }
  }

  private playNote(context: AudioContext, frequency: number, startTime: number): void {
    const oscillator = context.createOscillator();
    // Track the oscillator before creating its partner so partial setup is owned.
    const note: ScheduledNote = { oscillator };
    this.scheduledNotes.add(note);
    const gainNode = context.createGain();
    note.gainNode = gainNode;
    oscillator.onended = () => this.disconnectNote(note);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + NOTIFICATION_NOTE_DURATION_SEC);
    oscillator.start(startTime);
    oscillator.stop(startTime + NOTIFICATION_NOTE_DURATION_SEC);
  }

  playDoneSound(): void {
    void this.play();
  }

  private async play(): Promise<void> {
    if (!this.active || !this.enabled) return;
    const generation = this.generation;
    let operation: AudioOperation = 'create context';
    try {
      // Only a legitimate notification request creates/resumes audio. Browser
      // permission/user-gesture policy remains authoritative; never prompt/retry.
      if (typeof AudioContext === 'undefined') return;
      const context = this.audioContext ??= new AudioContext();
      operation = 'resume';
      if (context.state === 'suspended') await context.resume();
      if (!this.active || !this.enabled || generation !== this.generation
        || context !== this.audioContext || context.state !== 'running') return;
      const now = context.currentTime;
      operation = 'playback';
      this.playNote(context, NOTIFICATION_NOTE_1_FREQ, now);
      this.playNote(context, NOTIFICATION_NOTE_2_FREQ,
        now + NOTIFICATION_NOTE_DURATION_SEC + NOTIFICATION_NOTE_GAP_SEC);
    } catch (error: unknown) {
      if (!this.active || !this.enabled || generation !== this.generation) return;
      if (operation !== 'playback' && isBrowserRestriction(error)) return;
      reportAudioFailure(operation);
      this.cancelNotes();
    }
  }
}
