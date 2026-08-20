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
  NORMAL_BOSS_TIMINGS,
  NORMAL_MAX_ENEMIES,
  NORMAL_MAX_ENEMIES_PER_SECOND,
  NORMAL_TARGET_SECONDS,
  UTILITY_SLOT_LIMIT,
  canEvolve,
  getComboMultiplier,
  getEvolutionRecipe,
  getNextNormalBossTime,
  getSecondsUntilNextNormalBoss,
  isNormalTargetReached,
  isObjectiveComplete,
  scoreForClear,
  scoreForEnemy,
} from "./rules";

describe("normal-mode rules", () => {
  it("keeps the normal target and scheduled boss timings fixed", () => {
    expect(NORMAL_TARGET_SECONDS).toBe(600);
    expect(NORMAL_BOSS_TIMINGS).toEqual([180, 360, 555]);
    expect(isNormalTargetReached(599.999)).toBe(false);
    expect(isNormalTargetReached(600)).toBe(true);
    expect(isObjectiveComplete("endless", 600)).toBe(false);
    expect(isObjectiveComplete("normal", 600)).toBe(true);
  });

  it("exposes the hard density and loadout limits", () => {
    expect(NORMAL_MAX_ENEMIES).toBe(56);
    expect(NORMAL_MAX_ENEMIES_PER_SECOND).toBe(4);
    expect(ATTACK_SLOT_LIMIT).toBe(6);
    expect(UTILITY_SLOT_LIMIT).toBe(4);
  });

  it("uses the requested dodge constants", () => {
    expect(DODGE_COOLDOWN_SECONDS).toBe(4.2);
    expect(DODGE_INVULNERABILITY_SECONDS).toBe(0.28);
    expect(DODGE_PERFECT_WINDOW_SECONDS).toBe(0.34);
    expect(DODGE_DISTANCE).toBe(3.4);
  });

  it("calculates the requested score values", () => {
    expect(scoreForEnemy("scout")).toBe(100);
    expect(scoreForEnemy("striker")).toBe(150);
    expect(scoreForEnemy("bulwark")).toBe(350);
    expect(scoreForEnemy("variant", 4)).toBe(290);
    expect(scoreForEnemy("midboss")).toBe(3000);
    expect(scoreForEnemy("final")).toBe(10000);
    expect(scoreForClear()).toBe(5000);
  });

  it("steps the combo multiplier at the defined thresholds", () => {
    expect(COMBO_WINDOW_SECONDS).toBe(3);
    expect(COMBO_THRESHOLDS.map(({ combo }) => combo)).toEqual([5, 15, 30, 50]);
    expect(getComboMultiplier(0)).toBe(1);
    expect(getComboMultiplier(4)).toBe(1);
    expect(getComboMultiplier(5)).toBe(1.25);
    expect(getComboMultiplier(15)).toBe(1.5);
    expect(getComboMultiplier(30)).toBe(1.75);
    expect(getComboMultiplier(50)).toBe(2);
  });

  it("reports scheduled bosses and evolution recipe requirements", () => {
    expect(getNextNormalBossTime(0)).toBe(180);
    expect(getNextNormalBossTime(180)).toBe(360);
    expect(getSecondsUntilNextNormalBoss(181)).toBe(179);
    expect(getNextNormalBossTime(555)).toBeUndefined();

    expect(EVOLUTION_RECIPES).toHaveLength(6);
    const recipe = getEvolutionRecipe("vector-laser");
    expect(recipe.modules).toEqual(["vector", "laser"]);
    expect(recipe.name).toBe("ベクター・イオンランス");
    expect(canEvolve(["vector", "laser"], recipe)).toBe(true);
    expect(canEvolve(["vector"], recipe)).toBe(false);
  });
});
