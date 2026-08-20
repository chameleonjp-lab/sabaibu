import type { EvolutionId, GameMode, ModuleId } from "./types";

/** The normal run's fixed objective and scheduled boss encounters. */
export const NORMAL_TARGET_SECONDS = 600;
export const NORMAL_BOSS_TIMINGS = [180, 360, 555] as const;

/** Hard encounter-density limits used by normal mode. */
export const NORMAL_MAX_ENEMIES = 56;
export const NORMAL_MAX_ENEMIES_PER_SECOND = 4;
export const NORMAL_HARD_CAPS = {
  enemies: NORMAL_MAX_ENEMIES,
  enemiesPerSecond: NORMAL_MAX_ENEMIES_PER_SECOND,
} as const;

/** Player loadout limits. Rail occupies one of the attack slots. */
export const ATTACK_SLOT_LIMIT = 6;
export const UTILITY_SLOT_LIMIT = 4;

/** Dodge behavior shared by simulation and presentation. */
export const DODGE_COOLDOWN_SECONDS = 4.2;
export const DODGE_INVULNERABILITY_SECONDS = 0.28;
export const DODGE_PERFECT_WINDOW_SECONDS = 0.34;
export const DODGE_DISTANCE = 3.4;
export const DODGE_RULES = {
  cooldownSeconds: DODGE_COOLDOWN_SECONDS,
  invulnerabilitySeconds: DODGE_INVULNERABILITY_SECONDS,
  perfectWindowSeconds: DODGE_PERFECT_WINDOW_SECONDS,
  distance: DODGE_DISTANCE,
} as const;

/** Score values for enemy classes and run completion. */
export const SCORE_VALUES = {
  scout: 100,
  striker: 150,
  bulwark: 350,
  variantBase: 150,
  variantXp: 35,
  midboss: 3000,
  final: 10000,
  clear: 5000,
} as const;

export type ScoreEnemyKind = "scout" | "striker" | "bulwark" | "variant" | "midboss" | "final";

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

/** Return the score awarded for one defeated enemy or boss. */
export function scoreForEnemy(kind: ScoreEnemyKind, xp = 0): number {
  if (kind === "variant") {
    return SCORE_VALUES.variantBase + SCORE_VALUES.variantXp * Math.max(0, xp);
  }

  return SCORE_VALUES[kind];
}

/** Return the score awarded when the normal objective is completed. */
export function scoreForClear(): number {
  return SCORE_VALUES.clear;
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

/** Return seconds remaining until the next normal-mode boss. */
export function getSecondsUntilNextNormalBoss(seconds: number): number | undefined {
  const nextBossTime = getNextNormalBossTime(seconds);
  if (nextBossTime === undefined) return undefined;
  return Math.max(0, nextBossTime - seconds);
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
