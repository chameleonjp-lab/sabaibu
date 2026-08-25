import type { EvolutionId, GameMode, GameOutcome, ModuleId, ScoreBreakdown } from "./types";

/** The normal run's fixed objective and scheduled boss encounters. */
export const NORMAL_TARGET_SECONDS = 600;
export const NORMAL_BOSS_TIMINGS = [180, 360, 555] as const;
/** Final boss HP multiplier: the previous 12x value increased by the requested 1.5x. */
export const NORMAL_FINAL_BOSS_HP_MULTIPLIER = 18;

/** Normal-mode 周回センチネル progression and overflow reward. */
export const NORMAL_SENTINEL_MAX_LEVEL = 7;
export const NORMAL_SENTINEL_OVERFLOW_HEAL = 30;

/** Contact with the player's visible safety ring is a fixed, separate hit. */
export const PLAYER_RING_CONTACT_DAMAGE = 2;

/** Shared cap for every maximum-health increase, including Endless boss rewards. */
export const PLAYER_MAX_HEALTH_CAP = 200;

/** Long-run counters shared by the game, score calculation, and server contract. */
export const MAX_TRACKED_KILLS = 100_000;
export const MAX_TRACKED_SECONDS = 86_400;
export const MAX_PLAYER_LEVEL = 200;
export const MAX_TRACKED_DAMAGE_HITS = 100_000;
export const MAX_TRACKED_DAMAGE_TAKEN = 100_000_000;

/** Simulation timing limits used to keep throttled tabs from fast-forwarding or stalling indefinitely. */
export const SIMULATION_DEBT_CAP_SECONDS = 5;
export const SIMULATION_FRAME_BUDGET_SECONDS = 1;

/** Celebrate every 100 confirmed defeats. */
export const KILL_MILESTONE_INTERVAL = 100;

/** Hard encounter-density limits used by normal mode. The boss may coexist with 56 regular enemies. */
export const NORMAL_MAX_ENEMIES = 57;
/** Regular Normal spawning reserves one slot for the scheduled boss. */
export const NORMAL_MAX_REGULAR_ENEMIES = NORMAL_MAX_ENEMIES - 1;
/** Maximum total Endless enemies, including one active periodic boss. */
export const ENDLESS_MAX_ENEMIES = 95;
/** Regular Endless spawning reserves one slot for the periodic boss. */
export const ENDLESS_MAX_REGULAR_ENEMIES = ENDLESS_MAX_ENEMIES - 1;
export const NORMAL_MAX_ENEMIES_PER_SECOND = 4;
export const NORMAL_HARD_CAPS = {
  enemies: NORMAL_MAX_ENEMIES,
  enemiesPerSecond: NORMAL_MAX_ENEMIES_PER_SECOND,
} as const;

/** Player loadout limits. Rail occupies one of the attack slots. */
export const ATTACK_SLOT_LIMIT = 6;
export const UTILITY_SLOT_LIMIT = 4;

/** Dodge behavior shared by simulation and presentation. */
export const DODGE_COOLDOWN_SECONDS = 120;
export const DODGE_INVULNERABILITY_SECONDS = 0.28;
export const DODGE_PERFECT_WINDOW_SECONDS = 0.34;
export const DODGE_DISTANCE = 3.4;
export const DODGE_RULES = {
  cooldownSeconds: DODGE_COOLDOWN_SECONDS,
  invulnerabilitySeconds: DODGE_INVULNERABILITY_SECONDS,
  perfectWindowSeconds: DODGE_PERFECT_WINDOW_SECONDS,
  distance: DODGE_DISTANCE,
} as const;

/** Score weights shared with the verified Supabase submission function. */
export const SCORE_RULES = {
  killPoints: 100,
  normalRemainingSecondPoints: 100,
  endlessSurvivalSecondPoints: 10,
  levelPoints: 250,
  damageHitPenalty: 400,
  damagePointPenalty: 10,
} as const;

/** Combo remains active for this many seconds without a qualifying kill. */
export const COMBO_WINDOW_SECONDS = 3;
export const COMBO_THRESHOLDS = [
  { combo: 5, multiplier: 1.25 },
  { combo: 15, multiplier: 1.5 },
  { combo: 30, multiplier: 1.75 },
  { combo: 50, multiplier: 2 },
] as const;

export interface EvolutionRecipe {
  id: EvolutionId;
  name: string;
  modules: readonly [ModuleId, ModuleId];
}

export interface ScoreInput {
  mode: GameMode;
  outcome: GameOutcome;
  kills: number;
  seconds: number;
  level: number;
  damageHits: number;
  damageTaken: number;
}

/** Paired module recipes used to unlock an evolved weapon. */
export const EVOLUTION_RECIPES: readonly EvolutionRecipe[] = [
  { id: "vector-laser", name: "ベクター・イオンランス", modules: ["vector", "laser"] },
  { id: "ricochet-chain", name: "跳弾アーク", modules: ["ricochet", "chain"] },
  { id: "gravity-mortar", name: "特異点迫撃", modules: ["gravity", "mortar"] },
  { id: "mirage-pylon", name: "ミラージュ砲列", modules: ["mirage", "pylon"] },
  { id: "nova-saw", name: "ノヴァ・ソーハロ", modules: ["nova", "saw"] },
  { id: "mine-decoy", name: "誘爆ビーコン", modules: ["mine", "decoy"] },
];

const EVOLUTION_RECIPE_MAP: Readonly<Record<EvolutionId, EvolutionRecipe>> = Object.fromEntries(
  EVOLUTION_RECIPES.map((recipe) => [recipe.id, recipe]),
) as Record<EvolutionId, EvolutionRecipe>;

const safeInteger = (value: number, maximum = Number.MAX_SAFE_INTEGER) => (
  Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.trunc(value))) : 0
);

/** Return every 100-kill boundary crossed by the latest simulation update. */
export function getCrossedKillMilestones(previousKills: number, currentKills: number): number[] {
  const previous = safeInteger(previousKills, MAX_TRACKED_KILLS);
  const current = safeInteger(currentKills, MAX_TRACKED_KILLS);
  if (current <= previous) return [];

  const milestones: number[] = [];
  let milestone = (Math.floor(previous / KILL_MILESTONE_INTERVAL) + 1) * KILL_MILESTONE_INTERVAL;
  while (milestone <= current) {
    milestones.push(milestone);
    milestone += KILL_MILESTONE_INTERVAL;
  }
  return milestones;
}

/** Calculate all positive and negative score components without hidden bonuses. */
export function calculateScoreBreakdown(input: ScoreInput): ScoreBreakdown {
  const kills = safeInteger(input.kills, MAX_TRACKED_KILLS);
  const seconds = safeInteger(input.seconds, MAX_TRACKED_SECONDS);
  const level = Math.max(1, safeInteger(input.level, MAX_PLAYER_LEVEL));
  const damageHits = safeInteger(input.damageHits, MAX_TRACKED_DAMAGE_HITS);
  const damageTaken = safeInteger(input.damageTaken, MAX_TRACKED_DAMAGE_TAKEN);
  const killPoints = kills * SCORE_RULES.killPoints;
  const timePoints = input.mode === "normal"
    ? input.outcome === "clear"
      ? Math.max(0, NORMAL_TARGET_SECONDS - seconds) * SCORE_RULES.normalRemainingSecondPoints
      : 0
    : seconds * SCORE_RULES.endlessSurvivalSecondPoints;
  const levelPoints = level * SCORE_RULES.levelPoints;
  const hitPenalty = damageHits * SCORE_RULES.damageHitPenalty;
  const damagePenalty = damageTaken * SCORE_RULES.damagePointPenalty;
  const positiveTotal = killPoints + timePoints + levelPoints;
  const penaltyTotal = hitPenalty + damagePenalty;
  return {
    killPoints,
    timePoints,
    levelPoints,
    hitPenalty,
    damagePenalty,
    positiveTotal,
    penaltyTotal,
    total: Math.max(0, positiveTotal - penaltyTotal),
  };
}

/** Only completed Normal runs and non-retired Endless deaths are rankable. */
export function isRankableOutcome(mode: GameMode, outcome: GameOutcome): boolean {
  return mode === "normal" ? outcome === "clear" : outcome === "failed";
}

/** Resolve the active combo multiplier from the current combo count. */
export function getComboMultiplier(combo: number): number {
  const normalizedCombo = Number.isFinite(combo) ? Math.max(0, combo) : 0;
  let multiplier = 1;
  for (const tier of COMBO_THRESHOLDS) {
    if (normalizedCombo < tier.combo) break;
    multiplier = tier.multiplier;
  }
  return multiplier;
}

/** Whether the fixed normal-mode objective has been reached. */
export function isNormalTargetReached(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= NORMAL_TARGET_SECONDS;
}

/** Whether a mode's objective is complete. Endless mode has no fixed target. */
export function isObjectiveComplete(mode: GameMode, seconds: number): boolean {
  return mode === "normal" && isNormalTargetReached(seconds);
}

/** Return the next scheduled normal-mode boss time, in absolute seconds. */
export function getNextNormalBossTime(seconds: number): number | undefined {
  const normalizedSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return NORMAL_BOSS_TIMINGS.find((bossTime) => bossTime > normalizedSeconds);
}

/** Return seconds remaining until the next scheduled normal-mode boss. */
export function getSecondsUntilNextNormalBoss(seconds: number): number | undefined {
  const nextBossTime = getNextNormalBossTime(seconds);
  if (nextBossTime === undefined) return undefined;
  return Math.max(0, nextBossTime - seconds);
}

/** Return the first scheduled boss stage that is due and has not spawned. */
export function getDueNormalBossStage(seconds: number, spawnedStages: ReadonlySet<number>): 1 | 2 | 3 | undefined {
  for (let index = 0; index < NORMAL_BOSS_TIMINGS.length; index += 1) {
    const stage = (index + 1) as 1 | 2 | 3;
    if (seconds >= NORMAL_BOSS_TIMINGS[index] && !spawnedStages.has(stage)) return stage;
  }
  return undefined;
}

/** Split elapsed time into collision-safe steps without discarding any supplied time. */
export function splitSimulationDelta(delta: number, maximumStep = 0.05): number[] {
  const safeDelta = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  const safeMaximumStep = Number.isFinite(maximumStep) ? Math.max(0.001, maximumStep) : 0.05;
  const steps: number[] = [];
  let remaining = safeDelta;
  while (remaining > 0.0000001) {
    const step = Math.min(safeMaximumStep, remaining);
    steps.push(step);
    remaining -= step;
  }
  return steps;
}

/** Add one render interval to the simulation debt and consume a bounded amount. */
export function consumeSimulationDebt(currentDebt: number, frameDelta: number, shouldAdvance = true) {
  if (!shouldAdvance) return { budget: 0, remainingDebt: 0 };
  const safeDebt = Number.isFinite(currentDebt) ? Math.max(0, currentDebt) : 0;
  const safeFrameDelta = Number.isFinite(frameDelta) ? Math.max(0, frameDelta) : 0;
  const debt = Math.min(SIMULATION_DEBT_CAP_SECONDS, safeDebt + safeFrameDelta);
  const budget = Math.min(debt, SIMULATION_FRAME_BUDGET_SECONDS);
  return { budget, remainingDebt: Math.max(0, debt - budget) };
}

/** Find a recipe by id without mutating the shared recipe table. */
export function getEvolutionRecipe(id: EvolutionId): EvolutionRecipe {
  return EVOLUTION_RECIPE_MAP[id];
}

/** Check whether both component modules are present in a loadout. */
export function canEvolve(modules: readonly ModuleId[], recipe: EvolutionRecipe | EvolutionId): boolean {
  const resolvedRecipe = typeof recipe === "string" ? getEvolutionRecipe(recipe) : recipe;
  return resolvedRecipe.modules.every((moduleId) => modules.includes(moduleId));
}
