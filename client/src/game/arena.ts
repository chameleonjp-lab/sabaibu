/** Amberline Cataclysm: shared static arena geometry for rendering and gameplay collision. */
export type ArenaObstacle = { x: number; z: number; width: number; depth: number };

export const ARENA_OBSTACLES: readonly ArenaObstacle[] = [
  { x: -17, z: -12, width: 2.4, depth: 2.8 },
  { x: 18, z: 12, width: 2.8, depth: 2.2 },
  { x: -21, z: 16, width: 2.2, depth: 3.4 },
  { x: 19, z: -17, width: 3.2, depth: 2.1 },
  { x: -8, z: 22, width: 3.1, depth: 2.3 },
  { x: 9, z: -23, width: 2.4, depth: 2.7 },
];

export const PLAYER_OBSTACLE_COLLISION_RADIUS = 0.62;
