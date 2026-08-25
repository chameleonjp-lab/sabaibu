import { useEffect, useRef, useState, type CSSProperties } from "react";

import { getCrossedKillMilestones } from "@/game/rules";

const RAIN_DURATION_MS = 5_000;
const PARTICLE_COUNT = 44;
// The latest particle must finish before the five-second celebration is removed.
const PARTICLE_MAX_DELAY_TENTHS = 26;

type Celebration = {
  id: number;
  milestone: number;
};

type RainParticleStyle = CSSProperties & {
  "--rain-x": string;
  "--rain-delay": string;
  "--rain-duration": string;
  "--rain-drift": string;
  "--rain-rotation": string;
  "--rain-scale": string;
};

const PARTICLES: readonly RainParticleStyle[] = Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
  "--rain-x": `${4 + ((index * 37) % 93)}%`,
  "--rain-delay": `${((index * 17) % PARTICLE_MAX_DELAY_TENTHS) / 10}s`,
  "--rain-duration": `${1.65 + ((index * 11) % 7) * 0.11}s`,
  "--rain-drift": `${-42 + ((index * 29) % 85)}px`,
  "--rain-rotation": `${-28 + ((index * 19) % 57)}deg`,
  "--rain-scale": `${0.74 + ((index * 13) % 9) * 0.065}`,
}));

const normalizeKills = (kills: number) => (
  Number.isFinite(kills) ? Math.max(0, Math.trunc(kills)) : 0
);

export default function KillMilestoneRain({ kills }: { kills: number }) {
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const previousKillsRef = useRef(0);
  const nextCelebrationIdRef = useRef(1);
  const removalTimersRef = useRef(new Map<number, number>());

  useEffect(() => {
    const currentKills = normalizeKills(kills);
    const previousKills = previousKillsRef.current;

    if (currentKills < previousKills) {
      removalTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      removalTimersRef.current.clear();
      setCelebrations([]);
      previousKillsRef.current = currentKills;
      return;
    }

    previousKillsRef.current = currentKills;
    const crossedMilestones = getCrossedKillMilestones(previousKills, currentKills);
    if (crossedMilestones.length === 0) return;

    const additions = crossedMilestones.map((milestone) => ({
      id: nextCelebrationIdRef.current++,
      milestone,
    }));
    setCelebrations((current) => [...current, ...additions]);

    for (const celebration of additions) {
      const timer = window.setTimeout(() => {
        removalTimersRef.current.delete(celebration.id);
        setCelebrations((current) => current.filter(({ id }) => id !== celebration.id));
      }, RAIN_DURATION_MS);
      removalTimersRef.current.set(celebration.id, timer);
    }
  }, [kills]);

  useEffect(() => () => {
    removalTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    removalTimersRef.current.clear();
  }, []);

  return (
    <>
      {celebrations.map(({ id, milestone }) => (
        <div
          key={id}
          className="kill-milestone-rain"
          data-testid="kill-milestone-rain"
          data-milestone={milestone}
          role="status"
          aria-label={`${milestone}体撃破`}>
          {PARTICLES.map((style, index) => (
            <span
              key={`${id}-${index}`}
              className="kill-milestone-particle"
              style={style}
              aria-hidden="true">
              {milestone}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}
