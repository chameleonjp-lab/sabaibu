import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type GameSoundCue =
  | "start"
  | "attack"
  | "kill"
  | "xp"
  | "level-up"
  | "warning"
  | "perfect"
  | "boss"
  | "damage"
  | "low-health"
  | "clear"
  | "gameover"
  | "choice";

const AUDIO_STORAGE_KEY = "neon-siege-player-audio-v1";

const readStoredAudio = () => {
  try {
    const raw = window.localStorage.getItem(AUDIO_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== "off";
  } catch {
    return true;
  }
};

const frequencies: Record<GameSoundCue, number[]> = {
  start: [220, 330, 440],
  attack: [260],
  kill: [180],
  xp: [520],
  "level-up": [330, 494, 660],
  warning: [110, 146],
  perfect: [880, 1175],
  boss: [92, 138, 184],
  damage: [86],
  "low-health": [72, 96],
  clear: [392, 523, 659, 784],
  gameover: [196, 147, 110],
  choice: [330, 440],
};

const cueDuration: Record<GameSoundCue, number> = {
  start: 0.12,
  attack: 0.025,
  kill: 0.045,
  xp: 0.055,
  "level-up": 0.16,
  warning: 0.1,
  perfect: 0.14,
  boss: 0.18,
  damage: 0.1,
  "low-health": 0.12,
  clear: 0.2,
  gameover: 0.22,
  choice: 0.09,
};

/**
 * Small synthesized cues keep the game responsive without shipping audio assets.
 * AudioContext is created and resumed only from an explicit user gesture.
 */
export function useGameAudio() {
  const contextRef = useRef<AudioContext | null>(null);
  const [enabled, setEnabledState] = useState(readStoredAudio);

  const getContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!contextRef.current) {
      try {
        contextRef.current = new AudioContextCtor();
      } catch {
        return null;
      }
    }
    return contextRef.current;
  }, []);

  const unlock = useCallback(async () => {
    const context = getContext();
    if (!context) return;
    await context.resume().catch(() => undefined);
  }, [getContext]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(AUDIO_STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Continue with the in-memory preference if storage is unavailable.
    }
  }, []);

  const play = useCallback((cue: GameSoundCue) => {
    if (!enabled) return;
    const context = contextRef.current;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    const duration = cueDuration[cue];
    const frequenciesForCue = frequencies[cue];
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    const peakGain = cue === "attack" ? 0.018 : cue === "kill" ? 0.035 : 0.06;
    master.gain.exponentialRampToValueAtTime(peakGain, now + 0.008);
    master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    master.connect(context.destination);

    frequenciesForCue.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = cue === "damage" || cue === "warning" ? "sawtooth" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.035);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.72), now + duration);
      oscillator.connect(master);
      oscillator.start(now + index * 0.035);
      oscillator.stop(now + duration + 0.02);
    });
  }, [enabled]);

  useEffect(() => () => {
    const context = contextRef.current;
    if (context) void context.close().catch(() => undefined);
  }, []);

  return useMemo(() => ({ enabled, setEnabled, unlock, play }), [enabled, play, setEnabled, unlock]);
}
