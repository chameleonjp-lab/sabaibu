/**
 * Amberline Cataclysm: HUD contract for a tactical 3D survival arena.
 * Game modules remain React-free; this file is the narrow visual state boundary.
 */

export type GamePhase = "playing" | "paused" | "upgrade" | "bossReward" | "gameover";
export type GameMode = "normal" | "endless";
export type GameOutcome = "running" | "clear" | "failed" | "retired";
export type GameSoundCue =
  | "start"
  | "attack"
  | "kill"
  | "xp"
  | "level-up"
  | "warning"
  | "perfect"
  | "dodge"
  | "boss"
  | "damage"
  | "low-health"
  | "clear"
  | "gameover"
  | "choice";
export interface SoundEvent {
  id: number;
  cue: GameSoundCue;
}
export type BossRewardId = "amplify" | "fortify";
export type EvolutionId =
  | "vector-laser"
  | "ricochet-chain"
  | "gravity-mortar"
  | "mirage-pylon"
  | "nova-saw"
  | "mine-decoy";

export type StandardUpgradeId = "pulse" | "scatter" | "orbit" | "relay" | "barrier";
export type ModuleId = "vector" | "nova" | "mirage" | "pylon" | "reactive" | "cryo" | "ricochet" | "gravity" | "decoy" | "mortar" | "split" | "boomerang" | "laser" | "chain" | "mine" | "fan" | "skyfall" | "cleaver" | "needle" | "saw" | "harpoon" | "thermal" | "sonic" | "cluster" | "corrosion";
export type UpgradeId = StandardUpgradeId | ModuleId;
export type AttackId = "rail" | "scatter" | "orbit" | ModuleId;
export type IconId = AttackId | "pulse" | "relay" | "barrier";

export interface AttackStatus {
  id: AttackId;
  label: string;
  detail: string;
  iconId: IconId;
  tier: number;
  active: boolean;
}

export interface AttackResultStat {
  id: AttackId;
  label: string;
  iconId: IconId;
  tier: number;
  damage: number;
  kills: number;
}

export interface UpgradeOption {
  id: UpgradeId;
  code: string;
  title: string;
  description: string;
  iconId: IconId;
  category: "standard" | "module";
  currentLevel?: number;
  nextLevel?: number;
  changeSummary?: string;
  role?: string;
  synergy?: string;
  evolutionHint?: string;
}

export interface BossRewardOption {
  id: BossRewardId;
  title: string;
  description: string;
  enabled: boolean;
}

export interface ScoreBreakdown {
  killPoints: number;
  timePoints: number;
  levelPoints: number;
  hitPenalty: number;
  damagePenalty: number;
  positiveTotal: number;
  penaltyTotal: number;
  total: number;
}

export interface GameSnapshot {
  phase: GamePhase;
  mode: GameMode;
  outcome: GameOutcome;
  score: number;
  damageHits: number;
  damageTaken: number;
  scoreBreakdown: ScoreBreakdown;
  combo: number;
  comboMultiplier: number;
  maxCombo: number;
  bossesDefeated: number;
  perfectDodges: number;
  dodgeCooldown: number;
  dodgeCooldownMax: number;
  dodgeBoostSeconds: number;
  missionLabel: string;
  objectiveText: string;
  nextBossSeconds?: number;
  activeBossLabel?: string;
  deathCause: string | null;
  evolvedWeapons: EvolutionId[];
  bossRewards: BossRewardOption[];
  health: number;
  maxHealth: number;
  damageFlash: number;
  dangerSignal: number;
  soundEvents: SoundEvent[];
  xp: number;
  xpNeeded: number;
  level: number;
  kills: number;
  seconds: number;
  weaponTier: number;
  weaponCount: number;
  weaponLimit: number;
  utilityCount: number;
  utilityLimit: number;
  moduleMilestone: boolean;
  rerollsRemaining: number;
  enemyCount: number;
  debugStatus?: string;
  attacks: AttackStatus[];
  totalDamage: number;
  resultStats: AttackResultStat[];
  upgrades: UpgradeOption[];
}

export const STANDARD_UPGRADES: UpgradeOption[] = [
  { id: "pulse", code: "武器-01", title: "レール増幅器", description: "いちばん近い敵を自動で狙う主砲を強くします。", iconId: "pulse", category: "standard" },
  { id: "scatter", code: "武器-24", title: "散弾アレイ", description: "進んでいる方向へ3発の弾を同時に撃ちます。", iconId: "scatter", category: "standard" },
  { id: "orbit", code: "武器-52", title: "周回センチネル", description: "自分の周りを回る刃が、近づいた敵を攻撃します。", iconId: "orbit", category: "standard" },
  { id: "relay", code: "機能-24", title: "フラックス中継機", description: "主砲を速く撃てるようにし、移動も速くします。", iconId: "relay", category: "standard" },
  { id: "barrier", code: "防御-09", title: "防壁コア", description: "最大体力を8増やし、その場で体力を30回復します。", iconId: "barrier", category: "standard" },
];

export const MODULE_UPGRADES: UpgradeOption[] = [
  { id: "vector", code: "補助-10", title: "ベクターランス", description: "体力が多い敵を優先して、強い弾を撃ちます。", iconId: "vector", category: "module" },
  { id: "nova", code: "補助-14", title: "ノヴァリング", description: "自分の周り全体へ衝撃波を出します。", iconId: "nova", category: "module" },
  { id: "mirage", code: "補助-21", title: "ミラージュドローン", description: "自分の周りを飛ぶ小型機が、敵を自動で撃ちます。", iconId: "mirage", category: "module" },
  { id: "pylon", code: "補助-27", title: "セントリーパイロン", description: "近くの敵を自動で撃つ砲台を置きます。", iconId: "pylon", category: "module" },
  { id: "reactive", code: "補助-33", title: "リアクティブ装甲", description: "受けるダメージを減らし、被弾時に周囲へ反撃します。", iconId: "reactive", category: "module" },
  { id: "cryo", code: "補助-41", title: "クライオロック", description: "攻撃が当たった敵の動きを遅くします。", iconId: "cryo", category: "module" },
  { id: "ricochet", code: "補助-46", title: "跳弾バースト", description: "敵から別の敵へ跳ねる弾を撃ちます。", iconId: "ricochet", category: "module" },
  { id: "gravity", code: "補助-54", title: "特異点弾", description: "敵を1か所へ引き寄せ、まとめて攻撃します。", iconId: "gravity", category: "module" },
  { id: "decoy", code: "補助-63", title: "デコイビーコン", description: "敵を引きつけ、最後に爆発するおとりを置きます。", iconId: "decoy", category: "module" },
  { id: "mortar", code: "補助-68", title: "迫撃アーク", description: "敵が集まっている場所へ、上から爆発弾を落とします。", iconId: "mortar", category: "module" },
  { id: "split", code: "補助-72", title: "プリズム分裂", description: "当たると小さな弾に分かれ、近くの敵も攻撃します。", iconId: "split", category: "module" },
  { id: "boomerang", code: "補助-79", title: "リターンブレード", description: "前へ飛び、戻りながらもう一度攻撃する刃です。", iconId: "boomerang", category: "module" },
  { id: "laser", code: "補助-83", title: "イオンランス", description: "体力が多い敵を優先し、一直線の敵をまとめて攻撃します。", iconId: "laser", category: "module" },
  { id: "chain", code: "補助-88", title: "アーク連鎖", description: "電撃が近くの敵へ次々につながります。", iconId: "chain", category: "module" },
  { id: "mine", code: "補助-94", title: "近接地雷", description: "歩いた後ろへ、敵が近づくと爆発する地雷を置きます。", iconId: "mine", category: "module" },
  { id: "fan", code: "補助-97", title: "プリズム扇撃", description: "前方へ扇形にビームを広げて撃ちます。", iconId: "fan", category: "module" },
  { id: "skyfall", code: "補助-101", title: "スカイフォール標識", description: "敵が集まった場所へ雷を落とします。", iconId: "skyfall", category: "module" },
  { id: "cleaver", code: "補助-106", title: "位相クリーヴァー", description: "横に広い斬撃で、並んだ敵をまとめて攻撃します。", iconId: "cleaver", category: "module" },
  { id: "needle", code: "補助-110", title: "ニードルレイン", description: "敵が集まった場所へ、上から針を降らせます。", iconId: "needle", category: "module" },
  { id: "saw", code: "補助-114", title: "ソーハロ", description: "自分の周りを回るノコギリが、近い敵を攻撃します。", iconId: "saw", category: "module" },
  { id: "harpoon", code: "補助-119", title: "チェーンハープーン", description: "体力が多い敵を鎖で引き寄せます。", iconId: "harpoon", category: "module" },
  { id: "thermal", code: "補助-123", title: "サーマルアーク", description: "熱線が敵へつながり、最後の場所で爆発します。", iconId: "thermal", category: "module" },
  { id: "sonic", code: "補助-127", title: "ソニックブレイカー", description: "前方へ音の波を出し、敵を押し戻します。", iconId: "sonic", category: "module" },
  { id: "cluster", code: "補助-132", title: "クラスターコア", description: "当たると追いかける小弾に分かれます。", iconId: "cluster", category: "module" },
  { id: "corrosion", code: "補助-137", title: "腐食刻印", description: "当てた敵へ少しずつダメージを与え、動きも弱めます。", iconId: "corrosion", category: "module" },
];

export const UPGRADE_CATALOG: UpgradeOption[] = [...STANDARD_UPGRADES, ...MODULE_UPGRADES];
