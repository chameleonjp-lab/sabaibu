import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GameWorld } from "./GameWorld";
import type { GameSnapshot } from "./types";
import {
  ENDLESS_MAX_ENEMIES,
  MAX_TRACKED_BOSSES_DEFEATED,
  MAX_TRACKED_COMBAT_DAMAGE,
  MAX_TRACKED_COMBO,
  MAX_TRACKED_KILLS,
  MAX_TRACKED_PERFECT_DODGES,
  PLAYER_MAX_HEALTH_CAP,
} from "./rules";

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
  elapsed: number;
  level: number;
  health: number;
  maxHealth: number;
  kills: number;
  enemies: Array<{
    hp: number;
    maxHp: number;
    speed: number;
    contactDamage: number;
    milestoneBoss?: boolean;
    lastDamagedBy?: string;
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
  spawnTimer: number;
  xp: number;
  xpNeeded: number;
  damage: number;
  weaponTier: number;
  scatterTier: number;
  orbitTier: number;
  hasScatter: boolean;
  hasOrbit: boolean;
  moduleTiers: Record<string, number>;
  deployDecoy: () => void;
  isEnemyDodgeThreatened: (enemy: unknown, origin: Vector3) => boolean;
  perfectDodges: number;
  dodgePerfectRegistered: boolean;
  bossesDefeated: number;
  combo: number;
  maxCombo: number;
  combatStats: Record<string, { damage: number; kills: number }>;
  recordDamage: (source: string, damage: number) => void;
  registerPerfectDodge: () => void;
  dodgeCooldown: number;
  dodgeInvulnerable: number;
  damagePlayer: (amount: number, cooldown: number, source: "contact") => string;
  ensureMilestoneBossForCurrentLevel: () => void;
};

const createEndlessWorld = (onSnapshot: (snapshot: GameSnapshot) => void = () => undefined, debugMode = false) => {
  const engine = new NullEngine({ renderWidth: 390, renderHeight: 844, textureSize: 256 });
  const scene = new Scene(engine);
  const world = new GameWorld(scene, onSnapshot, false, false, false, false, false, false, false, false, false, undefined, debugMode, 0, 0, 0, 0, 0, 0, false, false, "endless");
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

describe("GameWorld Endless enemy density", () => {
  it("keeps the periodic boss inside the long-run total enemy cap", () => {
    stubWindow();
    const { engine, scene, world, runtime } = createEndlessWorld();

    runtime.level = 60;
    runtime.elapsed = 3_600;
    runtime.spawnTimer = 0;
    while (runtime.enemies.length < ENDLESS_MAX_ENEMIES - 1) {
      runtime.updateSpawning(0);
      runtime.spawnTimer = 0;
    }

    expect(runtime.enemies).toHaveLength(ENDLESS_MAX_ENEMIES - 1);
    runtime.ensureMilestoneBossForCurrentLevel();
    expect(runtime.enemies).toHaveLength(ENDLESS_MAX_ENEMIES);

    runtime.updateSpawning(1);
    expect(runtime.enemies).toHaveLength(ENDLESS_MAX_ENEMIES);

    world.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("caps every Endless combat, drop, and sound queue during a synthetic spike", () => {
    stubWindow();
    const { engine, scene, world } = createEndlessWorld();
    type Disposable = { dispose: () => void };
    type ResourceItem = { mesh: Disposable; marker?: Disposable; cable?: Disposable; value?: number };
    type ResourceRuntime = {
      gems: ResourceItem[];
      recoveryItems: ResourceItem[];
      magnetItems: ResourceItem[];
      projectiles: ResourceItem[];
      shockwaves: ResourceItem[];
      ricochetShots: ResourceItem[];
      gravityCores: ResourceItem[];
      decoys: ResourceItem[];
      arcShells: ResourceItem[];
      splitShells: ResourceItem[];
      returnBlades: ResourceItem[];
      energyTraces: ResourceItem[];
      mines: ResourceItem[];
      skyfallStrikes: ResourceItem[];
      needleDrops: ResourceItem[];
      idleNeedles: ResourceItem[];
      harpoons: ResourceItem[];
      clusterCores: ResourceItem[];
      clusterShards: ResourceItem[];
      soundEvents: Array<{ id: number; cue: string }>;
      queueSound: (cue: "attack") => void;
      enforceTransientCaps: () => void;
    };
    const runtime = world as unknown as ResourceRuntime;
    const disposable = (): Disposable => ({ dispose: vi.fn() });
    const fill = (items: ResourceItem[], count: number, withMarker = false, withCable = false, withValue = false) => {
      while (items.length < count) {
        items.push({
          mesh: disposable(),
          ...(withMarker ? { marker: disposable() } : {}),
          ...(withCable ? { cable: disposable() } : {}),
          ...(withValue ? { value: 1 } : {}),
        });
      }
    };

    fill(runtime.gems, 101, false, false, true);
    fill(runtime.recoveryItems, 49);
    fill(runtime.magnetItems, 49);
    fill(runtime.projectiles, 121);
    fill(runtime.shockwaves, 181);
    fill(runtime.ricochetShots, 97);
    fill(runtime.gravityCores, 25);
    fill(runtime.decoys, 25);
    fill(runtime.arcShells, 97);
    fill(runtime.splitShells, 97);
    fill(runtime.returnBlades, 49);
    fill(runtime.energyTraces, 121);
    fill(runtime.mines, 25);
    fill(runtime.skyfallStrikes, 65, true);
    fill(runtime.needleDrops, 129);
    fill(runtime.idleNeedles, 65, true);
    fill(runtime.harpoons, 33, false, true);
    fill(runtime.clusterCores, 97);
    fill(runtime.clusterShards, 129);

    runtime.enforceTransientCaps();

    expect(runtime.gems).toHaveLength(100);
    expect(runtime.gems.reduce((total, item) => total + (item.value ?? 0), 0)).toBe(101);
    expect(runtime.recoveryItems).toHaveLength(48);
    expect(runtime.magnetItems).toHaveLength(48);
    expect(runtime.projectiles).toHaveLength(120);
    expect(runtime.shockwaves).toHaveLength(180);
    expect(runtime.ricochetShots).toHaveLength(96);
    expect(runtime.gravityCores).toHaveLength(24);
    expect(runtime.decoys).toHaveLength(24);
    expect(runtime.arcShells).toHaveLength(96);
    expect(runtime.splitShells).toHaveLength(96);
    expect(runtime.returnBlades).toHaveLength(48);
    expect(runtime.energyTraces).toHaveLength(120);
    expect(runtime.mines).toHaveLength(24);
    expect(runtime.skyfallStrikes).toHaveLength(64);
    expect(runtime.needleDrops).toHaveLength(128);
    expect(runtime.idleNeedles).toHaveLength(64);
    expect(runtime.harpoons).toHaveLength(32);
    expect(runtime.clusterCores).toHaveLength(96);
    expect(runtime.clusterShards).toHaveLength(128);

    for (let index = 0; index < 120; index += 1) runtime.queueSound("attack");
    expect(runtime.soundEvents).toHaveLength(96);

    world.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("keeps resource peaks bounded during a 60-second mixed Endless combat simulation", () => {
    stubWindow();
    let latestSnapshot: GameSnapshot | undefined;
    const { engine, scene, world, runtime } = createEndlessWorld((snapshot) => { latestSnapshot = snapshot; }, true);

    runtime.setupHighVariantPreview(60);
    runtime.milestoneBossLevels.add(60);
    // A real loadout has six module slots. Keep the long-run test legal and
    // leave the impossible all-module spike to the dedicated 60-second cap test.
    const activeModules = ["vector", "gravity", "decoy", "split", "skyfall", "cluster"] as const;
    for (const moduleId of activeModules) runtime.moduleTiers[moduleId] = 3;
    runtime.hasScatter = true;
    runtime.hasOrbit = true;
    runtime.scatterTier = 3;
    runtime.orbitTier = 7;
    runtime.weaponTier = 3;
    runtime.damage = 0;
    runtime.health = Number.MAX_SAFE_INTEGER;
    runtime.maxHealth = Number.MAX_SAFE_INTEGER;
    runtime.xp = 0;
    runtime.xpNeeded = Number.MAX_SAFE_INTEGER;
    runtime.spawnTimer = Number.POSITIVE_INFINITY;

    while (runtime.enemies.length < ENDLESS_MAX_ENEMIES) {
      runtime.spawnEnemy("scout", undefined, false);
      const enemy = runtime.enemies[runtime.enemies.length - 1];
      enemy.hp = Number.MAX_SAFE_INTEGER;
      enemy.maxHp = Number.MAX_SAFE_INTEGER;
      enemy.speed = 0;
      enemy.contactDamage = 0;
      enemy.enteringContainment = false;
      const angle = runtime.enemies.length * 0.37;
      enemy.mesh.position.x = Math.cos(angle) * 9;
      enemy.mesh.position.z = Math.sin(angle) * 9;
    }

    for (let step = 0; step < 1_200; step += 1) world.update(0.05);

    expect(runtime.phase).toBe("playing");
    expect(runtime.enemies.length).toBeLessThanOrEqual(ENDLESS_MAX_ENEMIES);
    expect(latestSnapshot?.debugMetrics?.peakEnemies).toBeLessThanOrEqual(ENDLESS_MAX_ENEMIES);
    expect(latestSnapshot?.debugMetrics?.peakTransientEffects).toBeLessThanOrEqual(1_340);
    expect(latestSnapshot?.debugMetrics?.peakDrops).toBeLessThanOrEqual(196);
    expect(latestSnapshot?.debugMetrics?.peakSoundEvents).toBeLessThanOrEqual(96);

    world.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("reports mesh, transient-effect, drop, and sound counts in debug mode", () => {
    stubWindow();
    let latestSnapshot: GameSnapshot | undefined;
    const { engine, scene, world } = createEndlessWorld((snapshot) => { latestSnapshot = snapshot; }, true);

    expect(latestSnapshot?.debugMetrics?.sceneMeshes).toBeGreaterThan(0);
    expect(latestSnapshot?.debugMetrics?.enemies).toBeGreaterThanOrEqual(0);
    expect(latestSnapshot?.debugMetrics?.transientEffects).toBeGreaterThanOrEqual(0);
    expect(latestSnapshot?.debugMetrics?.drops).toBeGreaterThanOrEqual(0);
    expect(latestSnapshot?.debugMetrics?.soundEvents).toBeGreaterThanOrEqual(0);
    expect(latestSnapshot?.debugMetrics?.peakSceneMeshes).toBeGreaterThanOrEqual(latestSnapshot?.debugMetrics?.sceneMeshes ?? 0);
    expect(latestSnapshot?.debugMetrics?.peakEnemies).toBeGreaterThanOrEqual(latestSnapshot?.debugMetrics?.enemies ?? 0);
    expect(latestSnapshot?.debugMetrics?.peakTransientEffects).toBeGreaterThanOrEqual(latestSnapshot?.debugMetrics?.transientEffects ?? 0);
    expect(latestSnapshot?.debugMetrics?.peakDrops).toBeGreaterThanOrEqual(latestSnapshot?.debugMetrics?.drops ?? 0);
    expect(latestSnapshot?.debugMetrics?.peakSoundEvents).toBeGreaterThanOrEqual(latestSnapshot?.debugMetrics?.soundEvents ?? 0);
    expect(latestSnapshot?.debugStatus).toContain("MESH:");
    expect(latestSnapshot?.debugStatus).toContain("FX:");
    expect(latestSnapshot?.debugStatus).toContain("DROP:");
    expect(latestSnapshot?.debugStatus).toContain("SND:");
    expect(latestSnapshot?.debugStatus).toContain("PEAK:MESH:");

    world.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("GameWorld Endless long-run timing", () => {
  it("keeps 10, 30, and 60 minutes of active high-level combat alive", () => {
    stubWindow();
    let latestSnapshot: GameSnapshot | undefined;
    const { engine, scene, world, runtime } = createEndlessWorld((snapshot) => { latestSnapshot = snapshot; }, true);

    runtime.setupHighVariantPreview(60);
    for (const moduleId of Object.keys(runtime.moduleTiers)) runtime.moduleTiers[moduleId] = 3;
    runtime.hasScatter = true;
    runtime.hasOrbit = true;
    runtime.scatterTier = 3;
    runtime.orbitTier = 7;
    runtime.weaponTier = 3;
    runtime.damage = 0;
    runtime.health = Number.MAX_SAFE_INTEGER;
    runtime.maxHealth = Number.MAX_SAFE_INTEGER;
    runtime.xp = 0;
    runtime.xpNeeded = Number.MAX_SAFE_INTEGER;
    runtime.spawnTimer = Number.POSITIVE_INFINITY;

    while (runtime.enemies.length < 24) runtime.spawnEnemy("scout", undefined, false);
    for (const [index, enemy] of runtime.enemies.entries()) {
      enemy.hp = Number.MAX_SAFE_INTEGER;
      enemy.maxHp = Number.MAX_SAFE_INTEGER;
      enemy.speed = 0;
      enemy.contactDamage = 0;
      enemy.enteringContainment = false;
      const angle = index * 0.47;
      enemy.mesh.position.x = Math.cos(angle) * 9;
      enemy.mesh.position.z = Math.sin(angle) * 9;
    }

    world.setTouchDirection(0.42, 0.28);
    const checkpoints = new Map<number, number>([
      [12_000, 600],
      [36_000, 1_800],
      [72_000, 3_600],
    ]);
    for (let step = 1; step <= 72_000; step += 1) {
      world.update(0.05);
      if (step % 32 === 0) world.requestDodge();
      const expectedSeconds = checkpoints.get(step);
      if (expectedSeconds !== undefined) {
        const metrics = latestSnapshot?.debugMetrics;
        expect(runtime.phase).toBe("playing");
        expect(runtime.elapsed).toBeCloseTo(expectedSeconds, 6);
        expect(runtime.enemies).toHaveLength(24);
        expect(runtime.enemies.some((enemy) => enemy.highVariant !== undefined)).toBe(true);
        expect(metrics?.peakEnemies).toBeLessThanOrEqual(ENDLESS_MAX_ENEMIES);
        expect(metrics?.peakTransientEffects).toBeLessThanOrEqual(1_340);
        expect(metrics?.peakDrops).toBeLessThanOrEqual(196);
        expect(metrics?.peakSoundEvents).toBeLessThanOrEqual(96);
        expect(metrics?.peakSceneMeshes).toBeLessThanOrEqual(4_000);
        expect(metrics?.soundEvents).toBeLessThanOrEqual(96);
        const soundEvents = latestSnapshot?.soundEvents ?? [];
        expect(soundEvents.every((event, index, events) => index === 0 || event.id > events[index - 1].id)).toBe(true);
      }
    }

    expect(runtime.elapsed).toBeCloseTo(3_600, 6);
    expect(runtime.phase).toBe("playing");
    expect(latestSnapshot?.debugMetrics?.peakEnemies).toBeLessThanOrEqual(ENDLESS_MAX_ENEMIES);
    expect(latestSnapshot?.debugMetrics?.peakTransientEffects).toBeLessThanOrEqual(1_340);
    expect(latestSnapshot?.debugMetrics?.peakDrops).toBeLessThanOrEqual(196);
    expect(latestSnapshot?.debugMetrics?.peakSoundEvents).toBeLessThanOrEqual(96);

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


describe("GameWorld Endless counter caps", () => {
  it("keeps combat statistics, combo, dodge, and boss counts finite", () => {
    stubWindow();
    const { engine, scene, world, runtime } = createEndlessWorld();

    runtime.recordDamage("rail", Number.POSITIVE_INFINITY);
    expect(runtime.combatStats.rail.damage).toBe(0);
    runtime.recordDamage("rail", MAX_TRACKED_COMBAT_DAMAGE + 1);
    expect(runtime.combatStats.rail.damage).toBe(MAX_TRACKED_COMBAT_DAMAGE);
    runtime.recordDamage("rail", 10);
    expect(runtime.combatStats.rail.damage).toBe(MAX_TRACKED_COMBAT_DAMAGE);

    runtime.perfectDodges = MAX_TRACKED_PERFECT_DODGES;
    runtime.dodgePerfectRegistered = false;
    runtime.registerPerfectDodge();
    expect(runtime.perfectDodges).toBe(MAX_TRACKED_PERFECT_DODGES);

    runtime.spawnEnemy("scout", undefined, false);
    const enemy = runtime.enemies[0];
    enemy.hp = 0;
    enemy.lastDamagedBy = "rail";
    runtime.kills = MAX_TRACKED_KILLS;
    runtime.combo = MAX_TRACKED_COMBO;
    runtime.maxCombo = MAX_TRACKED_COMBO;
    runtime.combatStats.rail.kills = MAX_TRACKED_KILLS;
    expect(runtime.destroyEnemy(enemy)).toBe(true);
    expect(runtime.kills).toBe(MAX_TRACKED_KILLS);
    expect(runtime.combo).toBe(MAX_TRACKED_COMBO);
    expect(runtime.maxCombo).toBe(MAX_TRACKED_COMBO);
    expect(runtime.combatStats.rail.kills).toBe(MAX_TRACKED_KILLS);

    runtime.spawnEnemy("scout", undefined, false);
    const boss = runtime.enemies[0];
    boss.hp = 0;
    boss.milestoneBoss = true;
    runtime.bossesDefeated = MAX_TRACKED_BOSSES_DEFEATED;
    expect(runtime.destroyEnemy(boss)).toBe(true);
    expect(runtime.bossesDefeated).toBe(MAX_TRACKED_BOSSES_DEFEATED);

    world.dispose();
    scene.dispose();
    engine.dispose();
  });
});
