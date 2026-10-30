import {
  NOTIFICATION_NOTE_1_FREQ,
  NOTIFICATION_NOTE_2_FREQ,
  NOTIFICATION_NOTE_DURATION_SEC,
  NOTIFICATION_NOTE_GAP_SEC,
} from './constants.js';

let audioContext: AudioContext | null = null;
let soundEnabled = false;
const scheduledNotes = new Set<{ oscillator: OscillatorNode; gainNode: GainNode }>();

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
  if (!enabled && audioContext) {
    const now = audioContext.currentTime;
    for (const note of scheduledNotes) {
      note.gainNode.gain.cancelScheduledValues(now);
      note.gainNode.gain.setValueAtTime(0, now);
      note.oscillator.stop(now);
      note.oscillator.disconnect();
      note.gainNode.disconnect();
      scheduledNotes.delete(note);
    }
  }
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

function playNote(frequency: number, startTime: number, duration: number): void {
  if (!audioContext) return;

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const note = { oscillator, gainNode };
  scheduledNotes.add(note);
  oscillator.onended = () => {
    scheduledNotes.delete(note);
    oscillator.disconnect();
    gainNode.disconnect();
  };

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';

  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

export function playDoneSound(): void {
  if (!soundEnabled) return;

  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  const now = audioContext.currentTime;
  playNote(NOTIFICATION_NOTE_1_FREQ, now, NOTIFICATION_NOTE_DURATION_SEC);
  playNote(
    NOTIFICATION_NOTE_2_FREQ,
    now + NOTIFICATION_NOTE_DURATION_SEC + NOTIFICATION_NOTE_GAP_SEC,
    NOTIFICATION_NOTE_DURATION_SEC
  );
}

export function unlockAudio(): void {
  if (!soundEnabled) return;

  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}
