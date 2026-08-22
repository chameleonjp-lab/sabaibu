import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameSoundCue } from "@/game/types";

const AUDIO_STORAGE_KEY = "neon-siege-player-audio-v1";

const externalSampleSources: Partial<Record<GameSoundCue, string>> = {
  boss: `${import.meta.env.BASE_URL}audio/cc0-metal1.wav`,
  kill: `${import.meta.env.BASE_URL}audio/kill-confirm.wav`,
  choice: `${import.meta.env.BASE_URL}audio/cc0-switch1.wav`,
};

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
  kill: [150, 420, 840],
  xp: [520],
  "level-up": [330, 494, 660],
  warning: [110, 146],
  perfect: [880, 1175],
  dodge: [620, 930],
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
  dodge: 0.11,
  boss: 0.18,
  damage: 0.1,
  "low-health": 0.12,
  clear: 0.2,
  gameover: 0.22,
  choice: 0.09,
};

/**
 * Most cues are synthesized for tight timing. A small number of CC0 samples
 * are layered on the same AudioContext clock after they have been decoded.
 * AudioContext is created and resumed only from an explicit user gesture.
 */
export function useGameAudio() {
  const contextRef = useRef<AudioContext | null>(null);
  const externalBuffersRef = useRef<Partial<Record<GameSoundCue, AudioBuffer>>>({});
  const externalLoadingRef = useRef<Partial<Record<GameSoundCue, boolean>>>({});
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

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(AUDIO_STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Continue with the in-memory preference if storage is unavailable.
    }
  }, []);

  const preloadExternalSamples = useCallback((context: AudioContext) => {
    Object.entries(externalSampleSources).forEach(([cue, source]) => {
      const sampleCue = cue as GameSoundCue;
      if (!source || externalBuffersRef.current[sampleCue] || externalLoadingRef.current[sampleCue]) return;
      externalLoadingRef.current[sampleCue] = true;
      void fetch(source)
        .then((response) => {
          if (!response.ok) throw new Error(`Audio sample request failed: ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => {
          if (contextRef.current === context) externalBuffersRef.current[sampleCue] = buffer;
        })
        .catch(() => undefined)
        .finally(() => {
          externalLoadingRef.current[sampleCue] = false;
        });
    });
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

    const externalBuffer = externalBuffersRef.current[cue];
    if (externalBuffer) {
      const sampleGain = context.createGain();
      sampleGain.gain.setValueAtTime(0.0001, now);
      sampleGain.gain.exponentialRampToValueAtTime(cue === "boss" ? 0.16 : cue === "kill" ? 0.14 : 0.12, now + 0.006);
      sampleGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(externalBuffer.duration, 0.72));
      sampleGain.connect(context.destination);
      const sample = context.createBufferSource();
      sample.buffer = externalBuffer;
      sample.connect(sampleGain);
      sample.start(now);
      sample.stop(now + Math.min(externalBuffer.duration, 0.72) + 0.02);
    }

    frequenciesForCue.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = cue === "damage" || cue === "warning" ? "sawtooth" : cue === "kill" ? "square" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.035);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.72), now + duration);
      oscillator.connect(master);
      oscillator.start(now + index * 0.035);
      oscillator.stop(now + duration + 0.02);
    });
  }, [enabled]);

  const unlock = useCallback(async () => {
    const context = getContext();
    if (!context) return;
    await context.resume().catch(() => undefined);
    preloadExternalSamples(context);
  }, [getContext, preloadExternalSamples]);

  useEffect(() => () => {
    const context = contextRef.current;
    if (context) void context.close().catch(() => undefined);
  }, []);

  return useMemo(() => ({ enabled, setEnabled, unlock, play }), [enabled, play, setEnabled, unlock]);
}
