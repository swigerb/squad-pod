import {
  NOTIFICATION_NOTE_1_FREQ,
  NOTIFICATION_NOTE_2_FREQ,
  NOTIFICATION_NOTE_DURATION_SEC,
  NOTIFICATION_NOTE_GAP_SEC,
} from './constants.js';

let audioContext: AudioContext | null = null;
let soundEnabled = true;

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

function playNote(frequency: number, startTime: number, duration: number): void {
  if (!audioContext) return;

  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

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
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
}
