import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GameWorld } from "./GameWorld";
import type { GameSnapshot } from "./types";

describe("GameWorld runtime smoke", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("advances a bounded simulation and emits ordered sound events", () => {
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const engine = new NullEngine({ renderWidth: 390, renderHeight: 844, textureSize: 256 });
    const scene = new Scene(engine);
    let latestSnapshot: GameSnapshot | undefined;
    const world = new GameWorld(scene, (snapshot) => { latestSnapshot = snapshot; }, false, false, false, false, false, false, false, false, false, undefined, true, 0, 0, 0, 40, 0, 0, false, false, "normal");

    for (let frame = 0; frame < 600; frame += 1) world.update(1 / 60);

    expect(latestSnapshot).toBeDefined();
    expect(latestSnapshot?.soundEvents.every((event, index, events) => index === 0 || event.id > events[index - 1].id)).toBe(true);
    expect(latestSnapshot?.enemyCount).toBeLessThanOrEqual(56);

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
