import { describe, expect, it } from "vitest";

import {
  ATTACK_SLOT_LIMIT,
  COMBO_THRESHOLDS,
  COMBO_WINDOW_SECONDS,
  DODGE_COOLDOWN_SECONDS,
  DODGE_DISTANCE,
  DODGE_INVULNERABILITY_SECONDS,
  DODGE_PERFECT_WINDOW_SECONDS,
  EVOLUTION_RECIPES,
  KILL_MILESTONE_INTERVAL,
  MAX_PLAYER_LEVEL,
  MAX_TRACKED_DAMAGE_HITS,
  MAX_TRACKED_DAMAGE_TAKEN,
  MAX_TRACKED_KILLS,
  MAX_TRACKED_SECONDS,
  NORMAL_BOSS_TIMINGS,
  NORMAL_FINAL_BOSS_HP_MULTIPLIER,
  ENDLESS_MAX_ENEMIES,
  ENDLESS_MAX_REGULAR_ENEMIES,
  NORMAL_MAX_ENEMIES,
  NORMAL_MAX_REGULAR_ENEMIES,
  NORMAL_MAX_ENEMIES_PER_SECOND,
  NORMAL_SENTINEL_MAX_LEVEL,
  NORMAL_SENTINEL_OVERFLOW_HEAL,
  NORMAL_TARGET_SECONDS,
  PLAYER_RING_CONTACT_DAMAGE,
  PLAYER_MAX_HEALTH_CAP,
  SIMULATION_DEBT_CAP_SECONDS,
  SIMULATION_FRAME_BUDGET_SECONDS,
  SCORE_RULES,
  UTILITY_SLOT_LIMIT,
  calculateScoreBreakdown,
  canEvolve,
  consumeSimulationDebt,
  getDueNormalBossStage,
  getCrossedKillMilestones,
  getEvolutionRecipe,
  getNextNormalBossTime,
  getSecondsUntilNextNormalBoss,
  isNormalTargetReached,
  isObjectiveComplete,
  isRankableOutcome,
  splitSimulationDelta,
  consumeSimulationDebt,
} from "./rules";

describe("normal-mode rules", () => {
  it("keeps the objective and all boss boundaries explicit", () => {
    expect(NORMAL_TARGET_SECONDS).toBe(600);
    expect(NORMAL_BOSS_TIMINGS).toEqual([180, 360, 555]);
    expect(NORMAL_FINAL_BOSS_HP_MULTIPLIER).toBe(18);
    expect(NORMAL_SENTINEL_MAX_LEVEL).toBe(7);
    expect(NORMAL_SENTINEL_OVERFLOW_HEAL).toBe(30);
    expect(PLAYER_RING_CONTACT_DAMAGE).toBe(2);
    expect(PLAYER_MAX_HEALTH_CAP).toBe(200);
    expect(getDueNormalBossStage(179.999, new Set())).toBeUndefined();
    expect(getDueNormalBossStage(180, new Set())).toBe(1);
    expect(getDueNormalBossStage(360, new Set([1]))).toBe(2);
    expect(getDueNormalBossStage(555, new Set([1, 2]))).toBe(3);
    expect(isNormalTargetReached(599.999)).toBe(false);
    expect(isNormalTargetReached(600)).toBe(true);
    expect(isObjectiveComplete("endless", 600)).toBe(false);
    expect(isObjectiveComplete("normal", 600)).toBe(true);
  });

  it("allows the scheduled boss to coexist with the regular enemy cap", () => {
    expect(NORMAL_MAX_ENEMIES).toBe(57);
    expect(NORMAL_MAX_REGULAR_ENEMIES).toBe(56);
    expect(ENDLESS_MAX_REGULAR_ENEMIES).toBe(94);
    expect(ENDLESS_MAX_ENEMIES).toBe(95);
    expect(NORMAL_MAX_ENEMIES_PER_SECOND).toBe(4);
    expect(ATTACK_SLOT_LIMIT).toBe(6);
    expect(UTILITY_SLOT_LIMIT).toBe(4);
  });

  it("uses the requested two-minute dodge cooldown", () => {
    expect(DODGE_COOLDOWN_SECONDS).toBe(120);
    expect(DODGE_INVULNERABILITY_SECONDS).toBe(0.28);
    expect(DODGE_PERFECT_WINDOW_SECONDS).toBe(0.34);
    expect(DODGE_DISTANCE).toBe(3.4);
  });

  it("reports every crossed 100-kill celebration once", () => {
    expect(KILL_MILESTONE_INTERVAL).toBe(100);
    expect(getCrossedKillMilestones(99, 100)).toEqual([100]);
    expect(getCrossedKillMilestones(100, 100)).toEqual([]);
    expect(getCrossedKillMilestones(100, 199)).toEqual([]);
    expect(getCrossedKillMilestones(99, 201)).toEqual([100, 200]);
    expect(getCrossedKillMilestones(250, 0)).toEqual([]);
  });

  it("calculates Normal additions and deductions transparently", () => {
    const result = calculateScoreBreakdown({ mode: "normal", outcome: "clear", kills: 100, seconds: 570, level: 20, damageHits: 3, damageTaken: 25 });
    expect(result).toEqual({
      killPoints: 10_000,
      timePoints: 3_000,
      levelPoints: 5_000,
      hitPenalty: 1_200,
      damagePenalty: 250,
      positiveTotal: 18_000,
      penaltyTotal: 1_450,
      total: 16_550,
    });
  });

  it("calculates Endless survival scoring and never returns a negative total", () => {
    expect(calculateScoreBreakdown({ mode: "endless", outcome: "failed", kills: 50, seconds: 600, level: 12, damageHits: 2, damageTaken: 15 }).total).toBe(13_050);
    expect(calculateScoreBreakdown({ mode: "endless", outcome: "failed", kills: 0, seconds: 1, level: 1, damageHits: 20, damageTaken: 2_000 }).total).toBe(0);
    expect(SCORE_RULES.damageHitPenalty).toBe(400);
  });

  it("separates rankable outcomes by mode", () => {
    expect(isRankableOutcome("normal", "clear")).toBe(true);
    expect(isRankableOutcome("normal", "failed")).toBe(false);
    expect(isRankableOutcome("endless", "failed")).toBe(true);
    expect(isRankableOutcome("endless", "retired")).toBe(false);
  });

  it("does not lose elapsed time at 5, 10, 30, or 60 frames per second", () => {
    for (const fps of [5, 10, 30, 60]) {
      let total = 0;
      for (let frame = 0; frame < fps * 600; frame += 1) {
        total += splitSimulationDelta(1 / fps).reduce((sum, step) => sum + step, 0);
      }
      expect(total).toBeCloseTo(600, 6);
    }
    expect(splitSimulationDelta(0.2)).toHaveLength(4);
    expect(splitSimulationDelta(0.2).reduce((sum, step) => sum + step, 0)).toBeCloseTo(0.2, 10);
  });

  it("discards accumulated frame debt while the game is not advancing", () => {
    expect(consumeSimulationDebt(4.9, 0.2, false)).toEqual({ budget: 0, remainingDebt: 0 });
    expect(consumeSimulationDebt(0, 0.2, true)).toEqual({ budget: 0.2, remainingDebt: 0 });
  });

  it("bounds throttled-frame debt while preserving a one-second frame budget", () => {
    expect(SIMULATION_DEBT_CAP_SECONDS).toBe(5);
    expect(SIMULATION_FRAME_BUDGET_SECONDS).toBe(1);
    expect(consumeSimulationDebt(0, 1)).toEqual({ budget: 1, remainingDebt: 0 });
    expect(consumeSimulationDebt(0, 10)).toEqual({ budget: 1, remainingDebt: 4 });
    expect(consumeSimulationDebt(4, Number.NaN)).toEqual({ budget: 1, remainingDebt: 3 });
  });

  it("reports scheduled bosses and evolution recipe requirements", () => {
    expect(getNextNormalBossTime(0)).toBe(180);
    expect(getNextNormalBossTime(180)).toBe(360);
    expect(getSecondsUntilNextNormalBoss(181)).toBe(179);
    expect(getNextNormalBossTime(555)).toBeUndefined();
    expect(COMBO_WINDOW_SECONDS).toBe(3);
    expect(COMBO_THRESHOLDS.map(({ combo }) => combo)).toEqual([5, 15, 30, 50]);
    expect(EVOLUTION_RECIPES).toHaveLength(6);
    const recipe = getEvolutionRecipe("vector-laser");
    expect(recipe.modules).toEqual(["vector", "laser"]);
    expect(canEvolve(["vector", "laser"], recipe)).toBe(true);
    expect(canEvolve(["vector"], recipe)).toBe(false);
  });
});


describe("Endless long-run caps", () => {
  it("uses one cap contract for score, level, damage, and milestone tracking", () => {
    expect(MAX_TRACKED_KILLS).toBe(100_000);
    expect(MAX_TRACKED_SECONDS).toBe(86_400);
    expect(MAX_PLAYER_LEVEL).toBe(200);
    expect(MAX_TRACKED_DAMAGE_HITS).toBe(100_000);
    expect(MAX_TRACKED_DAMAGE_TAKEN).toBe(100_000_000);

    expect(getCrossedKillMilestones(MAX_TRACKED_KILLS - 1, MAX_TRACKED_KILLS + 1)).toEqual([MAX_TRACKED_KILLS]);
    expect(getCrossedKillMilestones(MAX_TRACKED_KILLS, MAX_TRACKED_KILLS + 1)).toEqual([]);

    const capped = calculateScoreBreakdown({
      mode: "endless",
      outcome: "failed",
      kills: MAX_TRACKED_KILLS + 5,
      seconds: MAX_TRACKED_SECONDS + 5,
      level: MAX_PLAYER_LEVEL + 5,
      damageHits: MAX_TRACKED_DAMAGE_HITS + 5,
      damageTaken: MAX_TRACKED_DAMAGE_TAKEN + 5,
    });
    const atCap = calculateScoreBreakdown({
      mode: "endless",
      outcome: "failed",
      kills: MAX_TRACKED_KILLS,
      seconds: MAX_TRACKED_SECONDS,
      level: MAX_PLAYER_LEVEL,
      damageHits: MAX_TRACKED_DAMAGE_HITS,
      damageTaken: MAX_TRACKED_DAMAGE_TAKEN,
    });
    expect(capped).toEqual(atCap);
  });
});
