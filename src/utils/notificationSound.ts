let audioContext: AudioContext | null = null;
let unlocked = false;
let lastPlayedAt = 0;

const SOUND_COOLDOWN_MS = 900;

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;

  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextCtor) return null;

  if (!audioContext) {
    audioContext = new AudioContextCtor();
  }

  return audioContext;
};

const playTone = (
  context: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  gainValue: number
) => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(gainValue, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
};

export const unlockNotificationSound = async () => {
  const context = getAudioContext();

  if (!context) return false;

  try {
    if (context.state === 'suspended') {
      await context.resume();
    }

    unlocked = true;
    return true;
  } catch {
    return false;
  }
};

export const playNotificationSound = async () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return;
  }

  const now = Date.now();

  if (now - lastPlayedAt < SOUND_COOLDOWN_MS) {
    return;
  }

  const context = getAudioContext();

  if (!context) return;

  try {
    if (context.state === 'suspended') {
      await context.resume();
    }

    if (!unlocked && context.state !== 'running') return;

    lastPlayedAt = now;

    const start = context.currentTime;
    playTone(context, 880, start, 0.09, 0.045);
    playTone(context, 1174.66, start + 0.11, 0.12, 0.038);
  } catch {
    // Notification sounds should never break the app.
  }
};

