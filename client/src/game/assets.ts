/**
 * Self-contained assets used by both the local preview and GitHub Pages.
 * BASE_URL keeps these references valid under the repository project path.
 */

export const GAME_ASSETS = {
  floor: `${import.meta.env.BASE_URL}assets/neon-siege-floor.svg`,
  dronePanel: `${import.meta.env.BASE_URL}assets/neon-siege-drone-panel.svg`,
  sigil: `${import.meta.env.BASE_URL}assets/neon-siege-sigil.svg`,
  visualTarget: `${import.meta.env.BASE_URL}assets/neon-siege-visual-target.svg`,
} as const;
