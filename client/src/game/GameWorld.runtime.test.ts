import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GameWorld } from "./GameWorld";
import type { GameSnapshot } from "./types";
import { PLAYER_MAX_HEALTH_CAP } from "./rules";

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

  it("caps the normal 周回センチネル at level 7 and turns later picks into healing", () => {
    stubWindow();
    const { engine, scene, world } = createNormalWorld(() => undefined);
    const runtime = world as unknown as {
      phase: GameSnapshot["phase"];
      hasOrbit: boolean;
      orbitTier: number;
      health: number;
      maxHealth: number;
      upgradeOptions: Array<{ id: "orbit" }>;
    };

    runtime.phase = "upgrade";
    runtime.hasOrbit = true;
    runtime.orbitTier = 7;
    runtime.health = 42;
    runtime.maxHealth = 100;
    runtime.upgradeOptions = [{ id: "orbit" }];

    world.chooseUpgrade("orbit");

    expect(runtime.orbitTier).toBe(7);
    expect(runtime.health).toBe(72);

    world.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("deals exactly 2 damage when an enemy touches the player safety ring", () => {
    stubWindow();
    const { engine, scene, world } = createNormalWorld(() => undefined);
    const runtime = world as unknown as {
      health: number;
      damageTimer: number;
      enemies: Array<{
        enteringContainment: boolean;
        mesh: { position: { x: number; z: number } };
      }>;
      spawnEnemy: (kind?: "scout", highVariant?: string, allowHighVariant?: boolean) => void;
      updateEnemies: (delta: number) => void;
    };

    runtime.spawnEnemy("scout", undefined, false);
    const enemy = runtime.enemies[0];
    enemy.enteringContainment = false;
    enemy.mesh.position.x = 0;
    enemy.mesh.position.z = 0;
    runtime.damageTimer = 0;
    runtime.updateEnemies(1 / 60);

    expect(runtime.health).toBe(98);

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


type EndlessRuntime = {
  phase: GameSnapshot["phase"];
  level: number;
  health: number;
  maxHealth: number;
  kills: number;
  enemies: Array<{
    hp: number;
    milestoneBoss?: boolean;
    highVariant?: string;
    enteringContainment: boolean;
    variantTimer: number;
    variantTelegraphTimer: number;
    mesh: { position: { x: number; z: number } };
  }>;
  milestoneBossLevels: Set<number>;
  upgradeOptions: Array<{ id: string }>;
  updateSpawning: (delta: number) => void;
  spawnEnemy: (kind?: "scout" | "striker" | "bulwark", highVariant?: string, allowHighVariant?: boolean) => void;
  destroyEnemy: (enemy: { hp: number; milestoneBoss?: boolean }) => boolean;
  getBossRewardOptions: () => Array<{ id: string; enabled: boolean }>;
  updateHighVariantAction: (enemy: unknown, canThreatenPlayer: boolean, delta: number) => number;
  setupHighVariantPreview: (level: number) => void;
  moduleTiers: Record<string, number>;
  deployDecoy: () => void;
  isEnemyDodgeThreatened: (enemy: unknown, origin: Vector3) => boolean;
  perfectDodges: number;
  dodgeCooldown: number;
  dodgeInvulnerable: number;
  damagePlayer: (amount: number, cooldown: number, source: "contact") => string;
};

const createEndlessWorld = (onSnapshot: (snapshot: GameSnapshot) => void = () => undefined) => {
  const engine = new NullEngine({ renderWidth: 390, renderHeight: 844, textureSize: 256 });
  const scene = new Scene(engine);
  const world = new GameWorld(scene, onSnapshot, false, false, false, false, false, false, false, false, false, undefined, false, 0, 0, 0, 0, 0, 0, false, false, "endless");
  return { engine, scene, world, runtime: world as unknown as EndlessRuntime };
};

describe("GameWorld Endless milestone lifecycle", () => {
  it("runs every scheduled Endless milestone through boss defeat, reward, and resume", () => {
    stubWindow();
    for (const level of [5, 10, 15, 20, 30, 40, 50, 60]) {
      const { engine, scene, world, runtime } = createEndlessWorld();
      runtime.level = level;
      runtime.phase = "upgrade";
      runtime.upgradeOptions = [{ id: "relay" }];

      world.chooseUpgrade("relay");

      expect(runtime.milestoneBossLevels.has(level)).toBe(true);
      const boss = runtime.enemies.find((enemy) => enemy.milestoneBoss);
      expect(boss).toBeDefined();
      expect(runtime.enemies).toHaveLength(1);

      runtime.updateSpawning(1);
      expect(runtime.enemies).toHaveLength(1);

      boss!.hp = 0;
      expect(runtime.destroyEnemy(boss!)).toBe(true);
      expect(runtime.phase).toBe("bossReward");
      expect(runtime.getBossRewardOptions().every((reward) => reward.enabled)).toBe(true);

      world.chooseBossReward("amplify");
      expect(runtime.phase).toBe("playing");

      world.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("applies the shared maximum-health cap to repeated Endless boss rewards", () => {
    stubWindow();
    const { engine, scene, world, runtime } = createEndlessWorld();

    runtime.maxHealth = PLAYER_MAX_HEALTH_CAP - 2;
    runtime.health = PLAYER_MAX_HEALTH_CAP - 2;
    runtime.phase = "bossReward";
    world.chooseBossReward("fortify");

    expect(runtime.maxHealth).toBe(PLAYER_MAX_HEALTH_CAP);
    expect(runtime.health).toBe(PLAYER_MAX_HEALTH_CAP);

    runtime.phase = "bossReward";
    world.chooseBossReward("fortify");
    expect(runtime.maxHealth).toBe(PLAYER_MAX_HEALTH_CAP);
    expect(runtime.health).toBe(PLAYER_MAX_HEALTH_CAP);

    world.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("GameWorld Endless outcome lifecycle", () => {
  it("finishes Endless as a failed game over after lethal damage", () => {
    stubWindow();
    let latestSnapshot: GameSnapshot | undefined;
    const { engine, scene, world, runtime } = createEndlessWorld((snapshot) => { latestSnapshot = snapshot; });

    runtime.health = 1;
    runtime.phase = "playing";
    runtime.dodgeInvulnerable = 0;
    runtime.damagePlayer(2, 0.6, "contact");

    expect(latestSnapshot?.phase).toBe("gameover");
    expect(latestSnapshot?.outcome).toBe("failed");
    expect(latestSnapshot?.health).toBe(0);
    expect(latestSnapshot?.deathCause).toBe("敵との接触");

    const snapshotAfterGameOver = latestSnapshot;
    world.update(1);
    expect(latestSnapshot).toBe(snapshotAfterGameOver);

    world.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("GameWorld Endless high-level enemies", () => {
  it("loads the Lv40, Lv50, and Lv60 high-variant groups", () => {
    stubWindow();
    for (const level of [40, 50, 60]) {
      const { engine, scene, world, runtime } = createEndlessWorld();
      runtime.setupHighVariantPreview(level);
      expect(runtime.enemies.length).toBeGreaterThan(0);
      expect(runtime.enemies.every((enemy) => typeof enemy.highVariant === "string")).toBe(true);
      world.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it("does not grant Perfect Dodge when a decoy has redirected a pulse enemy", () => {
    stubWindow();
    const { engine, scene, world, runtime } = createEndlessWorld();
    runtime.setupHighVariantPreview(60);
    const pulseEnemy = runtime.enemies.find((enemy) => enemy.highVariant === "void-archon");
    expect(pulseEnemy).toBeDefined();

    pulseEnemy!.mesh.position.x = 0;
    pulseEnemy!.mesh.position.z = 0;
    pulseEnemy!.variantTelegraphTimer = 0.2;
    runtime.moduleTiers.decoy = 1;
    runtime.deployDecoy();

    expect(runtime.isEnemyDodgeThreatened(pulseEnemy, new Vector3(0, 0, 0))).toBe(false);
    world.requestDodge();
    expect(runtime.perfectDodges).toBe(0);

    world.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("resolves a high-level pulse attack and allows the enemy to be defeated", () => {
    stubWindow();
    const { engine, scene, world, runtime } = createEndlessWorld();
    runtime.setupHighVariantPreview(60);
    const pulseEnemy = runtime.enemies.find((enemy) => enemy.highVariant === "void-archon");
    expect(pulseEnemy).toBeDefined();

    pulseEnemy!.mesh.position.x = 0;
    pulseEnemy!.mesh.position.z = 0;
    pulseEnemy!.variantTimer = 0;
    const healthBefore = runtime.health;
    runtime.updateHighVariantAction(pulseEnemy, true, 0);
    expect(pulseEnemy!.variantTelegraphTimer).toBeGreaterThan(0);
    runtime.updateHighVariantAction(pulseEnemy, true, 0.62);
    expect(runtime.health).toBeLessThan(healthBefore);

    pulseEnemy!.hp = 0;
    expect(runtime.destroyEnemy(pulseEnemy!)).toBe(true);
    expect(runtime.kills).toBe(1);
    expect(runtime.phase).toBe("playing");

    world.dispose();
    scene.dispose();
    engine.dispose();
  });
});
