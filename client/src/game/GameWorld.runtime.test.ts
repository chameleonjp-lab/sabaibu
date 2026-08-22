import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GameWorld } from "./GameWorld";
import type { GameSnapshot } from "./types";

type RuntimeEnemy = { hp: number; missionBossStage?: 1 | 2 | 3 };
type RuntimeWorld = {
  elapsed: number;
  activeMissionBossStage: 0 | 1 | 2 | 3;
  phase: GameSnapshot["phase"];
  enemies: RuntimeEnemy[];
  spawnedNormalBossStages: Set<1 | 2 | 3>;
  updateNormalMission: (resolveTimeout?: boolean) => void;
  destroyEnemy: (enemy: RuntimeEnemy) => boolean;
};

const stubWindow = () => {
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
};

const createNormalWorld = (onSnapshot: (snapshot: GameSnapshot) => void) => {
  const engine = new NullEngine({ renderWidth: 390, renderHeight: 844, textureSize: 256 });
  const scene = new Scene(engine);
  const world = new GameWorld(scene, onSnapshot, false, false, false, false, false, false, false, false, false, undefined, false, 0, 0, 0, 0, 0, 0, false, false, "normal");
  return { engine, scene, world, runtime: world as unknown as RuntimeWorld };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GameWorld runtime smoke", () => {
  it("advances a bounded simulation and emits ordered sound events", () => {
    stubWindow();
    const engine = new NullEngine({ renderWidth: 390, renderHeight: 844, textureSize: 256 });
    const scene = new Scene(engine);
    let latestSnapshot: GameSnapshot | undefined;
    const world = new GameWorld(scene, (snapshot) => { latestSnapshot = snapshot; }, false, false, false, false, false, false, false, false, false, undefined, true, 0, 0, 0, 40, 0, 0, false, false, "normal");

    world.setTouchDirection(0.4, 0.2);
    for (let frame = 0; frame < 600; frame += 1) world.update(1 / 60);

    expect(latestSnapshot).toBeDefined();
    expect(latestSnapshot?.soundEvents.every((event, index, events) => index === 0 || event.id > events[index - 1].id)).toBe(true);
    expect(latestSnapshot?.enemyCount).toBeLessThanOrEqual(57);

    world.setPaused(true);
    const pausedSeconds = latestSnapshot?.seconds;
    world.update(2);
    expect(latestSnapshot?.phase).toBe("paused");
    expect(latestSnapshot?.seconds).toBe(pausedSeconds);
    world.setPaused(false);

    world.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("GameWorld damage ordering", () => {
  it("honors dodge invulnerability even during the shared damage cooldown", () => {
    stubWindow();
    const engine = new NullEngine({ renderWidth: 390, renderHeight: 844, textureSize: 256 });
    const scene = new Scene(engine);
    const world = new GameWorld(scene, () => undefined, false, false, false, false, false, false, false, false, false, undefined, false, 0, 0, 0, 0, 0, 0, false, false, "normal");
    const runtime = world as unknown as { damageTimer: number; dodgeInvulnerable: number; damagePlayer: (amount: number, cooldown: number, source: "contact") => string; perfectDodges: number };
    runtime.damageTimer = 0.5;
    runtime.dodgeInvulnerable = 0.2;
    expect(runtime.damagePlayer(10, 0.5, "contact")).toBe("perfect");
    expect(runtime.perfectDodges).toBe(1);
    world.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("GameWorld Normal upgrade and boss reward policy", () => {
  it("removes durability upgrades from Normal while keeping Barrier in Endless", () => {
    stubWindow();
    const createWorld = (mode: "normal" | "endless") => {
      const engine = new NullEngine({ renderWidth: 390, renderHeight: 844, textureSize: 256 });
      const scene = new Scene(engine);
      const world = new GameWorld(scene, () => undefined, false, false, false, false, false, false, false, false, false, undefined, false, 0, 0, 0, 0, 0, 0, false, false, mode);
      return { engine, scene, world };
    };

    const normal = createWorld("normal");
    const endless = createWorld("endless");
    const normalRuntime = normal.world as unknown as { getUpgradeCandidatePool: () => Array<{ id: string }>; getMasteryFallbackOptions: () => Array<{ id: string }> };
    const endlessRuntime = endless.world as unknown as { getUpgradeCandidatePool: () => Array<{ id: string }>; getMasteryFallbackOptions: () => Array<{ id: string }> };

    expect(normalRuntime.getUpgradeCandidatePool().map((option) => option.id)).not.toContain("barrier");
    expect(normalRuntime.getMasteryFallbackOptions().map((option) => option.id)).toEqual(["pulse", "orbit", "relay"]);
    expect(endlessRuntime.getUpgradeCandidatePool().map((option) => option.id)).toContain("barrier");
    expect(endlessRuntime.getMasteryFallbackOptions().map((option) => option.id)).toEqual(["pulse", "relay", "barrier"]);

    normal.world.dispose();
    normal.scene.dispose();
    normal.engine.dispose();
    endless.world.dispose();
    endless.scene.dispose();
    endless.engine.dispose();
  });

  it("offers exactly attack +4% or durability +5 and applies the selected reward", () => {
    stubWindow();
    const { engine, scene, world } = createNormalWorld(() => undefined);
    const runtime = world as unknown as {
      phase: GameSnapshot["phase"];
      attackAmplifier: number;
      health: number;
      maxHealth: number;
      getBossRewardOptions: () => Array<{ id: string; enabled: boolean }>;
    };

    runtime.phase = "bossReward";
    expect(runtime.getBossRewardOptions().map((reward) => ({ id: reward.id, enabled: reward.enabled }))).toEqual([
      { id: "amplify", enabled: true },
      { id: "fortify", enabled: true },
    ]);

    world.chooseBossReward("amplify");
    expect(runtime.attackAmplifier).toBeCloseTo(1.04, 10);
    expect(runtime.phase).toBe("playing");

    runtime.phase = "bossReward";
    runtime.health = 70;
    runtime.maxHealth = 100;
    world.chooseBossReward("fortify");
    expect(runtime.maxHealth).toBe(105);
    expect(runtime.health).toBe(75);
    expect(runtime.phase).toBe("playing");

    world.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("moves paired weapon evolution out of the boss reward and applies it automatically at level 3", () => {
    stubWindow();
    const { engine, scene, world } = createNormalWorld(() => undefined);
    const runtime = world as unknown as {
      phase: GameSnapshot["phase"];
      moduleTiers: Record<string, number>;
      upgradeOptions: Array<{ id: string }>;
      evolvedWeapons: Set<string>;
    };

    runtime.phase = "upgrade";
    runtime.moduleTiers.vector = 3;
    runtime.moduleTiers.laser = 2;
    runtime.upgradeOptions = [{ id: "laser" }];
    world.chooseUpgrade("laser");

    expect(runtime.moduleTiers.laser).toBe(3);
    expect(runtime.evolvedWeapons.has("vector-laser")).toBe(true);
    expect(runtime.phase).toBe("playing");

    world.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("GameWorld normal mission lifecycle", () => {
  it("runs the actual 03:00, 06:00, 09:15 boss sequence and fails at 10:00 when the final boss remains", () => {
    stubWindow();
    let latestSnapshot: GameSnapshot | undefined;
    const { engine, scene, world, runtime } = createNormalWorld((snapshot) => { latestSnapshot = snapshot; });

    const defeatBoss = (stage: 1 | 2) => {
      const boss = runtime.enemies.find((enemy) => enemy.missionBossStage === stage);
      expect(boss).toBeDefined();
      boss!.hp = 0;
      expect(runtime.destroyEnemy(boss!)).toBe(true);
      expect(latestSnapshot?.phase).toBe("bossReward");
      world.chooseBossReward("amplify");
      expect(latestSnapshot?.phase).toBe("playing");
    };

    runtime.elapsed = 179.999;
    runtime.updateNormalMission(false);
    expect(runtime.activeMissionBossStage).toBe(0);

    runtime.elapsed = 180;
    runtime.updateNormalMission(false);
    expect(runtime.activeMissionBossStage).toBe(1);
    defeatBoss(1);

    runtime.elapsed = 360;
    runtime.updateNormalMission(false);
    expect(runtime.activeMissionBossStage).toBe(2);
    defeatBoss(2);

    runtime.elapsed = 555;
    runtime.updateNormalMission(false);
    expect(runtime.activeMissionBossStage).toBe(3);
    expect(runtime.enemies.some((enemy) => enemy.missionBossStage === 3)).toBe(true);

    runtime.elapsed = 600;
    runtime.updateNormalMission(true);
    expect(latestSnapshot?.phase).toBe("gameover");
    expect(latestSnapshot?.outcome).toBe("failed");
    expect(latestSnapshot?.deathCause).toBe("制限時間内に最終ボスを撃破できず");

    world.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("clears Normal when the actual final boss is defeated before 10:00", () => {
    stubWindow();
    let latestSnapshot: GameSnapshot | undefined;
    const { engine, scene, world, runtime } = createNormalWorld((snapshot) => { latestSnapshot = snapshot; });

    runtime.spawnedNormalBossStages.add(1);
    runtime.spawnedNormalBossStages.add(2);
    runtime.elapsed = 599;
    runtime.updateNormalMission(false);
    expect(runtime.activeMissionBossStage).toBe(3);

    const finalBoss = runtime.enemies.find((enemy) => enemy.missionBossStage === 3);
    expect(finalBoss).toBeDefined();
    finalBoss!.hp = 0;
    expect(runtime.destroyEnemy(finalBoss!)).toBe(true);
    expect(latestSnapshot?.phase).toBe("gameover");
    expect(latestSnapshot?.outcome).toBe("clear");

    world.dispose();
    scene.dispose();
    engine.dispose();
  });
});
