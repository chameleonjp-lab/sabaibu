/**
 * サバサバの表示と入力を管理します。
 *
 * The pre-run screen owns the only path that creates Babylon. Once a run has
 * started, this component remains a thin DOM/input bridge around GameHandle;
 * the simulation still owns combat and progression.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createGameScene, type GameHandle } from "@/game/scene";
import { GAME_ASSETS } from "@/game/assets";
import { MODULE_UPGRADES, type BossRewardId, type GameMode, type GameSnapshot, type IconId, type ModuleId, type UpgradeId } from "@/game/types";
import { WEAPON_LIBRARY } from "@/game/weaponCatalog";
import KillMilestoneRain from "@/components/KillMilestoneRain";
import ShareButton from "@/components/ShareButton";
import { useGameAudio } from "@/hooks/useGameAudio";
import { canSubmitRankingResult, createClientRunId, normalizeRankingName, type RankingRow, type RankingRunSession, useGameRanking } from "@/hooks/useGameRanking";
import "../settings-console.css";

type ViewportMode = "portrait-narrow" | "portrait" | "landscape-compact" | "landscape" | "desktop";
type PlayerSettings = { stickOpacity: number; cameraZoom: number };
type RankingStatus = "idle" | "submitting" | "submitted" | "failed";

const PLAYER_SETTINGS_STORAGE_KEY = "neon-siege-player-settings-v2";
const PLAYER_NAME_STORAGE_KEY = "neon-siege-player-name-v1";
const BEST_SCORE_STORAGE_KEY = "neon-siege-best-score-v1";
const TUTORIAL_STORAGE_KEY = "neon-siege-tutorial-complete-v1";
const DEFAULT_PLAYER_SETTINGS: PlayerSettings = { stickOpacity: 0.56, cameraZoom: 1 };

const INITIAL_SNAPSHOT: GameSnapshot = {
  phase: "playing",
  mode: "normal",
  outcome: "running",
  health: 100,
  maxHealth: 100,
  damageFlash: 0,
  dangerSignal: 0,
  soundEvents: [],
  xp: 0,
  xpNeeded: 9,
  level: 1,
  kills: 0,
  seconds: 0,
  weaponTier: 1,
  weaponCount: 0,
  weaponLimit: 6,
  utilityCount: 0,
  utilityLimit: 4,
  moduleMilestone: false,
  rerollsRemaining: 3,
  enemyCount: 0,
  attacks: [],
  totalDamage: 0,
  resultStats: [],
  upgrades: [],
  score: 0,
  damageHits: 0,
  damageTaken: 0,
  scoreBreakdown: { killPoints: 0, timePoints: 0, levelPoints: 250, hitPenalty: 0, damagePenalty: 0, positiveTotal: 250, penaltyTotal: 0, total: 250 },
  combo: 0,
  comboMultiplier: 1,
  maxCombo: 0,
  bossesDefeated: 0,
  perfectDodges: 0,
  dodgeCooldown: 0,
  dodgeCooldownMax: 1,
  dodgeBoostSeconds: 0,
  missionLabel: "封鎖区域 // セクター07",
  objectiveText: "侵入を食い止め、境界を守れ。",
  deathCause: null,
  evolvedWeapons: [],
  bossRewards: [],
};

const formatTime = (seconds: number) => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, "0")}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;
const formatStat = (value: number) => new Intl.NumberFormat("ja-JP").format(Math.round(Number.isFinite(value) ? value : 0));
const formatCooldown = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)}分${Math.ceil(seconds % 60)}秒` : `${seconds.toFixed(1)}秒`;
const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
const ModuleIcon = ({ id, className = "" }: { id: IconId; className?: string }) => <span className={`module-icon module-icon-${id} ${className}`} aria-hidden="true" />;

const loadPlayerSettings = (): PlayerSettings => {
  try {
    const raw = window.localStorage.getItem(PLAYER_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_PLAYER_SETTINGS;
    const value = JSON.parse(raw) as Partial<PlayerSettings>;
    return {
      stickOpacity: Number.isFinite(value.stickOpacity) ? Math.max(0.2, Math.min(1, value.stickOpacity!)) : DEFAULT_PLAYER_SETTINGS.stickOpacity,
      cameraZoom: Number.isFinite(value.cameraZoom) ? Math.max(0.82, Math.min(1.22, value.cameraZoom!)) : DEFAULT_PLAYER_SETTINGS.cameraZoom,
    };
  } catch {
    return DEFAULT_PLAYER_SETTINGS;
  }
};

const loadPlayerName = () => {
  try {
    return window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const loadTutorialComplete = () => {
  try {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const loadBestScores = (): Record<GameMode, number> => {
  try {
    const value = JSON.parse(window.localStorage.getItem(BEST_SCORE_STORAGE_KEY) ?? "{}") as Partial<Record<GameMode, number>>;
    return {
      normal: Number.isFinite(value.normal) ? Math.max(0, value.normal!) : 0,
      endless: Number.isFinite(value.endless) ? Math.max(0, value.endless!) : 0,
    };
  } catch {
    return { normal: 0, endless: 0 };
  }
};

const saveBestScores = (scores: Record<GameMode, number>) => {
  try {
    window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, JSON.stringify(scores));
  } catch {
    // Continue with the in-memory score if storage is unavailable.
  }
};

const savePlayerName = (name: string) => {
  try {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  } catch {
    // Continue with the in-memory name if storage is unavailable.
  }
};

const getViewportMode = (width: number, height: number): ViewportMode => {
  const aspect = width / Math.max(1, height);
  if (aspect < 0.68) return "portrait-narrow";
  if (aspect < 1) return "portrait";
  if (width < 960 && height < 600) return "landscape-compact";
  if (width < 1280) return "landscape";
  return "desktop";
};

const MODE_LABELS: Record<GameMode, string> = { normal: "通常", endless: "無限" };

const outcomeLabel = (outcome: GameSnapshot["outcome"]) => {
  if (outcome === "clear") return "成功";
  if (outcome === "retired") return "終了";
  return "失敗";
};

const tutorialSteps = [
  { title: "移動", copy: "画面の任意位置をタップしてドラッグ。PCでは W・A・S・D / 矢印キーで移動します。" },
  { title: "経験値を集める", copy: "敵を倒して出現するエネルギーを拾い、リアクターを同期させます。" },
  { title: "強化を選ぶ", copy: "レベルアップで戦闘が止まります。3つからひとつを選んで出撃を続けます。" },
  { title: "赤い予告を避ける", copy: "赤い予告線・円・突進から離れ、回避で危険を抜けてください。" },
];

const EVOLUTION_LABELS: Record<string, string> = {
  "vector-laser": "ベクター・イオンランス",
  "ricochet-chain": "跳弾アーク",
  "gravity-mortar": "特異点迫撃",
  "mirage-pylon": "ミラージュ砲列",
  "nova-saw": "ノヴァ・ソーハロ",
  "mine-decoy": "誘爆ビーコン",
};

const RANKING_PREVIEW_ROWS: RankingRow[] = [
  { rank: 1, displayName: "アルファ", bestScore: 48200, playCount: 12 },
  { rank: 2, displayName: "ネオン", bestScore: 40150, playCount: 8 },
  { rank: 3, displayName: "確認用", bestScore: 28450, playCount: 1 },
  { rank: 4, displayName: "ヴォイド", bestScore: 19700, playCount: 5 },
  { rank: 5, displayName: "ルーマ", bestScore: 12600, playCount: 3 },
];

export default function GameCanvas() {
  const mainRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const weaponLibraryCloseRef = useRef<HTMLButtonElement>(null);
  const weaponDetailCloseRef = useRef<HTMLButtonElement>(null);
  const startedRef = useRef(false);
  const handleRef = useRef<GameHandle | null>(null);
  const joystickPointerIdRef = useRef<number | null>(null);
  const stickOriginRef = useRef({ x: 0, y: 0 });
  const phaseRef = useRef<GameSnapshot["phase"]>("playing");
  const lastSoundEventIdRef = useRef(0);
  const perfectDodgeTimerRef = useRef<number | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const playerSettingsRef = useRef<PlayerSettings>(DEFAULT_PLAYER_SETTINGS);
  const pausedBySettingsRef = useRef(false);
  const pausedByTutorialRef = useRef(false);
  const tutorialOpenRef = useRef(false);
  const pauseOpenRef = useRef(false);
  const pendingPauseRef = useRef<boolean | null>(null);
  const lifecyclePauseRequestedRef = useRef(false);
  const rankingRunIdRef = useRef(0);
  const rankingSubmissionKeyRef = useRef("");
  const rankingSessionRef = useRef<RankingRunSession | null>(null);
  const rankingStartPromiseRef = useRef<Promise<RankingRunSession | null> | null>(null);

  const searchParams = new URLSearchParams(window.location.search);
  const previewMode: GameMode = searchParams.get("mode") === "endless" ? "endless" : "normal";
  const rerollPreview = Number(searchParams.get("reroll") ?? (searchParams.has("reroll") ? "1" : "0"));
  const levelPreview = Math.max(0, Math.min(200, Math.floor(Number(searchParams.get("level") ?? "0"))));
  const balancePreviewLevel = Math.max(0, Math.min(200, Math.floor(Number(searchParams.get("balance") ?? "0"))));
  const variantPreviewLevel = Math.max(0, Math.min(200, Math.floor(Number(searchParams.get("variants") ?? "0"))));
  const milestoneBossPreviewLevel = Math.max(0, Math.min(200, Math.floor(Number(searchParams.get("milestoneBoss") ?? "0"))));
  const milestoneRewardPreviewLevel = Math.max(0, Math.min(200, Math.floor(Number(searchParams.get("milestoneReward") ?? "0"))));
  const obstaclePreview = searchParams.has("obstacle");
  const rankingPreview = searchParams.has("ranking");
  const resultPreview = searchParams.has("result") || rankingPreview;
  const touchPreview = searchParams.has("touch");
  const settingsPreview = searchParams.has("settings");
  const demoMode = searchParams.has("demo");
  const forceUpgrade = searchParams.has("upgrade") || rerollPreview > 0 || levelPreview > 0;
  const forceModulePreview = searchParams.has("modules");
  const bossPreview = searchParams.has("boss");
  const strikerPreview = searchParams.has("striker");
  const idlePreview = searchParams.has("idle");
  const explosionPreview = searchParams.has("explosion");
  const bossExplosionPreview = searchParams.has("bossExplosion");
  const bossExplosionFarPreview = searchParams.has("bossExplosionFar");
  const auditValue = searchParams.get("audit");
  const auditModule = MODULE_UPGRADES.some((option) => option.id === auditValue) ? auditValue as ModuleId : undefined;
  const debugMode = searchParams.has("debug") || Boolean(auditModule) || balancePreviewLevel > 0 || variantPreviewLevel > 0 || milestoneBossPreviewLevel > 0 || milestoneRewardPreviewLevel > 0 || obstaclePreview || resultPreview || idlePreview || explosionPreview || bossExplosionPreview || bossExplosionFarPreview;
  const previewAutostart = demoMode || forceUpgrade || forceModulePreview || bossPreview || strikerPreview || idlePreview || explosionPreview || bossExplosionPreview || bossExplosionFarPreview || Boolean(auditModule) || debugMode || touchPreview || settingsPreview;
  const settingsOpenRef = useRef(settingsPreview);

  const audio = useGameAudio();
  const ranking = useGameRanking();
  const [snapshot, setSnapshot] = useState<GameSnapshot>(INITIAL_SNAPSHOT);
  const snapshotView = snapshot;
  const [viewportMode, setViewportMode] = useState<ViewportMode>(() => getViewportMode(window.innerWidth, window.innerHeight));
  const [playerSettings, setPlayerSettings] = useState<PlayerSettings>(() => {
    const loaded = loadPlayerSettings();
    playerSettingsRef.current = loaded;
    return loaded;
  });
  const [playerName, setPlayerName] = useState(() => previewAutostart ? "確認用" : loadPlayerName());
  const [selectedMode, setSelectedMode] = useState<GameMode>(previewMode);
  const [activeMode, setActiveMode] = useState<GameMode>(previewMode);
  const [bestScores, setBestScores] = useState<Record<GameMode, number>>(loadBestScores);
  const [runStarted, setRunStarted] = useState(previewAutostart);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [nameError, setNameError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(settingsPreview);
  const [weaponLibraryOpen, setWeaponLibraryOpen] = useState(false);
  const [weaponDetailId, setWeaponDetailId] = useState<UpgradeId | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [tutorialComplete, setTutorialComplete] = useState(loadTutorialComplete);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [stickOffset, setStickOffset] = useState({ x: 0, y: 0 });
  const [floatingStick, setFloatingStick] = useState<{ x: number; y: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [perfectDodgeCue, setPerfectDodgeCue] = useState(0);
  const [rankingStatus, setRankingStatus] = useState<RankingStatus>("idle");
  const [rankingMessage, setRankingMessage] = useState("");
  const [rankingRows, setRankingRows] = useState<RankingRow[]>([]);
  const [rankingLoadError, setRankingLoadError] = useState("");

  useEffect(() => {
    if (!resultPreview) return;
    setRankingStatus("submitted");
    setRankingMessage("確認用の表示です。実際のランキング送信は行いません。");
    setRankingRows(RANKING_PREVIEW_ROWS);
    setRankingLoadError("");
  }, [resultPreview]);

  useEffect(() => {
    phaseRef.current = snapshot.phase;
  }, [snapshot.phase]);

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  useEffect(() => {
    pauseOpenRef.current = pauseOpen;
  }, [pauseOpen]);

  useEffect(() => {
    tutorialOpenRef.current = tutorialOpen;
  }, [tutorialOpen]);

  const setDirection = useCallback((x: number, z: number) => {
    handleRef.current?.setTouchDirection(x, z);
  }, []);

  const resetJoystick = useCallback(() => {
    joystickPointerIdRef.current = null;
    setStickOffset({ x: 0, y: 0 });
    setFloatingStick(null);
    setDirection(0, 0);
  }, [setDirection]);

  const setPausedCommand = useCallback((paused: boolean) => {
    pendingPauseRef.current = paused;
    const handle = handleRef.current;
    if (!handle) return;
    handle.setPaused(paused);
    pendingPauseRef.current = null;
  }, []);

  const updatePlayerSettings = useCallback((next: PlayerSettings) => {
    const safe = {
      stickOpacity: Math.max(0.2, Math.min(1, next.stickOpacity)),
      cameraZoom: Math.max(0.82, Math.min(1.22, next.cameraZoom)),
    };
    playerSettingsRef.current = safe;
    setPlayerSettings(safe);
    handleRef.current?.setCameraZoomMultiplier(safe.cameraZoom);
    try {
      window.localStorage.setItem(PLAYER_SETTINGS_STORAGE_KEY, JSON.stringify(safe));
    } catch {
      // Continue with the in-memory preference if storage is unavailable.
    }
  }, []);

  const rememberFocus = useCallback(() => {
    const active = document.activeElement;
    lastFocusedElementRef.current = active instanceof HTMLElement ? active : null;
  }, []);

  const restoreFocus = useCallback(() => {
    lastFocusedElementRef.current?.focus();
    lastFocusedElementRef.current = null;
  }, []);

  const openSettings = useCallback((fromPause = false) => {
    rememberFocus();
    resetJoystick();
    settingsOpenRef.current = true;
    if (runStarted && phaseRef.current === "playing") {
      pausedBySettingsRef.current = !fromPause;
      setPausedCommand(true);
    }
    if (!fromPause) {
      pauseOpenRef.current = false;
      setPauseOpen(false);
    }
    setSettingsOpen(true);
  }, [rememberFocus, resetJoystick, runStarted, setPausedCommand]);

  const closeSettings = useCallback(() => {
    settingsOpenRef.current = false;
    setSettingsOpen(false);
    if (!pauseOpen && !tutorialOpen && pausedBySettingsRef.current) {
      pausedBySettingsRef.current = false;
      lifecyclePauseRequestedRef.current = false;
      setPausedCommand(false);
    }
    restoreFocus();
  }, [pauseOpen, restoreFocus, setPausedCommand, tutorialOpen]);

  const completeTutorial = useCallback(() => {
    setTutorialComplete(true);
    tutorialOpenRef.current = false;
    setTutorialOpen(false);
    setTutorialStep(0);
    if (pausedByTutorialRef.current && !settingsOpenRef.current && !pauseOpenRef.current) {
      pausedByTutorialRef.current = false;
      lifecyclePauseRequestedRef.current = false;
      setPausedCommand(false);
    } else if (!pausedByTutorialRef.current && phaseRef.current === "paused" && !settingsOpenRef.current) {
      pauseOpenRef.current = true;
      setPauseOpen(true);
    }
    try {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "1");
    } catch {
      // Continue with the in-memory completion state if storage is unavailable.
    }
  }, [setPausedCommand]);

  const resetRankingState = useCallback(() => {
    rankingRunIdRef.current += 1;
    rankingSubmissionKeyRef.current = "";
    rankingSessionRef.current = null;
    rankingStartPromiseRef.current = null;
    setRankingStatus("idle");
    setRankingMessage("");
    setRankingRows([]);
    setRankingLoadError("");
  }, []);

  const beginRankingRun = useCallback((mode: GameMode, displayName: string) => {
    if (previewAutostart || !ranking.enabled) return;
    const runId = rankingRunIdRef.current;
    const clientRunId = createClientRunId();
    setRankingMessage("ランキング用のプレイ記録を開始しています…");
    const request = ranking.startRun(mode, displayName, clientRunId)
      .then((session) => {
        if (rankingRunIdRef.current !== runId) return null;
        rankingSessionRef.current = session;
        setRankingMessage(`${MODE_LABELS[mode]}のプレイ回数を記録しました。`);
        return session;
      })
      .catch(() => {
        if (rankingRunIdRef.current === runId) setRankingMessage("ランキング用の開始記録に失敗しました。この出撃は端末記録のみです。");
        return null;
      });
    rankingStartPromiseRef.current = request;
  }, [previewAutostart, ranking]);

  const advanceTutorial = useCallback((fromUserGesture = false) => {
    if (fromUserGesture) void audio.unlock().then(() => audio.play("choice"));
    else audio.play("choice");
    if (tutorialStep >= tutorialSteps.length - 1) completeTutorial();
    else setTutorialStep((step) => step + 1);
  }, [audio, completeTutorial, tutorialStep]);

  const startRun = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmedName = playerName.trim();
    if (!trimmedName && !previewAutostart) {
      setNameError("プレイヤー名を入力してください");
      window.requestAnimationFrame(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    const safeName = trimmedName || "プレイヤー01";
    savePlayerName(safeName);
    setPlayerName(safeName);
    setNameError("");
    setActiveMode(selectedMode);
    lastSoundEventIdRef.current = 0;
    setSnapshot(INITIAL_SNAPSHOT);
    setSceneError(null);
    resetRankingState();
    beginRankingRun(selectedMode, safeName);
    setWeaponDetailId(null);
    setWeaponLibraryOpen(false);
    setRunStarted(true);
    setIsPaused(false);
    pauseOpenRef.current = false;
    lifecyclePauseRequestedRef.current = false;
    setPauseOpen(false);
    settingsOpenRef.current = false;
    setSettingsOpen(false);
    pausedBySettingsRef.current = false;
    // 出撃開始時は戦闘へ直行する。移動説明を含む自動チュートリアルで
    // 初回操作を止めない。
    const shouldShowTutorial = false;
    setTutorialStep(0);
    tutorialOpenRef.current = shouldShowTutorial;
    pausedByTutorialRef.current = shouldShowTutorial;
    if (shouldShowTutorial) pendingPauseRef.current = true;
    setTutorialOpen(shouldShowTutorial);
    void audio.unlock().then(() => audio.play("start"));
  };

  const returnToTitle = useCallback(() => {
    resetRankingState();
    lastSoundEventIdRef.current = 0;
    resetJoystick();
    setPausedCommand(false);
    pendingPauseRef.current = false;
    lifecyclePauseRequestedRef.current = false;
    setSettingsOpen(false);
    settingsOpenRef.current = false;
    setWeaponDetailId(null);
    setWeaponLibraryOpen(false);
    pauseOpenRef.current = false;
    setPauseOpen(false);
    tutorialOpenRef.current = false;
    setTutorialOpen(false);
    pausedByTutorialRef.current = false;
    pausedBySettingsRef.current = false;
    setSceneReady(false);
    setRunStarted(false);
    setSnapshot(INITIAL_SNAPSHOT);
  }, [resetJoystick, resetRankingState, setPausedCommand]);

  const retryRun = useCallback(() => {
    resetRankingState();
    beginRankingRun(activeMode, playerName);
    lastSoundEventIdRef.current = 0;
    setSnapshot(INITIAL_SNAPSHOT);
    void audio.unlock().then(() => audio.play("start"));
    resetJoystick();
    setPausedCommand(false);
    pendingPauseRef.current = false;
    lifecyclePauseRequestedRef.current = false;
    pausedBySettingsRef.current = false;
    settingsOpenRef.current = false;
    setSettingsOpen(false);
    setPauseOpen(false);
    handleRef.current?.restart();
  }, [activeMode, audio, beginRankingRun, playerName, resetJoystick, resetRankingState, setPausedCommand]);

  const retireRun = useCallback(() => {
    resetJoystick();
    handleRef.current?.retire();
  }, [resetJoystick]);

  const loadRanking = useCallback(async (mode: GameMode, runId: number) => {
    try {
      if (!ranking.enabled) {
        setRankingRows([]);
        setRankingLoadError("");
        return;
      }
      const rows = await ranking.fetchRanking(mode, 5);
      if (rankingRunIdRef.current !== runId) return;
      setRankingRows(rows);
      setRankingLoadError("");
    } catch {
      if (rankingRunIdRef.current !== runId) return;
      setRankingRows([]);
      setRankingLoadError("ランキングを読み込めませんでした。");
    }
  }, [ranking]);

  const submitRankingScore = useCallback(async (resultSnapshot: GameSnapshot, force = false) => {
    if (previewAutostart || !ranking.enabled) return;
    const runId = rankingRunIdRef.current;
    const mode = resultSnapshot.mode ?? activeMode;
    if (!canSubmitRankingResult(mode, resultSnapshot.outcome, previewAutostart, ranking.enabled)) {
      setRankingStatus("idle");
      setRankingMessage(mode === "normal" ? "通常は正規クリア時だけランキングへ送信します。" : "無限はリタイアではなく、ゲームオーバー時だけ送信します。");
      void loadRanking(mode, runId);
      return;
    }
    const displayName = normalizeRankingName(playerName);
    if (!displayName) {
      setRankingStatus("failed");
      setRankingMessage("名前を確認できなかったため、ランキングへ送信できませんでした。");
      return;
    }
    const session = rankingSessionRef.current ?? await rankingStartPromiseRef.current;
    if (!session || rankingRunIdRef.current !== runId) {
      setRankingStatus("failed");
      setRankingMessage("サーバー発行のプレイ識別番号がないため送信できません。端末の最高得点は保存されています。");
      return;
    }
    const submissionKey = `${session.playToken}:${resultSnapshot.score}:${resultSnapshot.seconds}`;
    if (!force && rankingSubmissionKeyRef.current === submissionKey) return;
    rankingSubmissionKeyRef.current = submissionKey;
    setRankingStatus("submitting");
    setRankingMessage("検証付きランキングへ送信中…");
    setRankingLoadError("");
    try {
      const result = await ranking.submitRun(session, resultSnapshot);
      if (rankingRunIdRef.current !== runId) return;
      setRankingStatus("submitted");
      setRankingMessage(result.alreadySubmitted ? "同じ記録は重複登録せず、送信済みの結果を確認しました。" : result.isNewBest ? "自己ベストをランキングへ更新しました。" : "今回の記録をランキングへ送信しました。");
    } catch {
      if (rankingRunIdRef.current !== runId) return;
      setRankingStatus("failed");
      setRankingMessage("送信に失敗しました。記録はこの端末へ保存したため、再読込後も再送できます。");
    } finally {
      if (rankingRunIdRef.current === runId) void loadRanking(mode, runId);
    }
  }, [activeMode, loadRanking, playerName, previewAutostart, ranking]);

  const retryRankingSubmission = useCallback(() => {
    if (snapshot.phase !== "gameover" || rankingStatus === "submitting") return;
    void submitRankingScore(snapshot, true);
  }, [rankingStatus, snapshot, submitRankingScore]);

  useEffect(() => {
    if (previewAutostart || !ranking.enabled) return;
    void ranking.retryPendingSubmissions().then(({ submitted }) => {
      if (submitted > 0) setRankingMessage(`${submitted}件の未送信記録を再送しました。`);
    }).catch(() => undefined);
  }, [previewAutostart, ranking]);

  const updateJoystick = useCallback((clientX: number, clientY: number) => {
    const bounds = mainRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const range = 42;
    const rawX = clientX - bounds.left - stickOriginRef.current.x;
    const rawY = clientY - bounds.top - stickOriginRef.current.y;
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > range ? range / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    setStickOffset({ x, y });
    setDirection(x / range, -y / range);
  }, [setDirection]);

  const beginJoystick = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (!event.isPrimary || joystickPointerIdRef.current !== null || phaseRef.current !== "playing" || isPaused || settingsOpen) return;
    const bounds = mainRef.current?.getBoundingClientRect();
    if (!bounds) return;
    joystickPointerIdRef.current = event.pointerId;
    stickOriginRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    setFloatingStick(stickOriginRef.current);
    setStickOffset({ x: 0, y: 0 });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Older Safari builds can reject capture after a gesture has ended.
    }
    updateJoystick(event.clientX, event.clientY);
  };

  const moveJoystick = (event: ReactPointerEvent<HTMLElement>) => {
    if (joystickPointerIdRef.current === event.pointerId) updateJoystick(event.clientX, event.clientY);
  };

  const endJoystick = (event: ReactPointerEvent<HTMLElement>) => {
    if (joystickPointerIdRef.current !== event.pointerId) return;
    resetJoystick();
  };

  const selectUpgrade = (id: UpgradeId) => {
    void audio.unlock().then(() => audio.play("choice"));
    handleRef.current?.chooseUpgrade(id);
  };

  const selectBossReward = (id: BossRewardId) => {
    void audio.unlock().then(() => audio.play("choice"));
    handleRef.current?.chooseBossReward(id);
  };

  const rerollUpgrades = () => {
    void audio.unlock().then(() => audio.play("choice"));
    handleRef.current?.rerollUpgrades();
  };

  const requestDodge = () => {
    // Resolve the gameplay input in the same pointer event. Waiting for
    // AudioContext.resume() here makes a first-use iPhone dodge arrive late;
    // the start gesture already unlocks audio, and a missing cue must never
    // delay the invulnerability window.
    handleRef.current?.requestDodge();
    void audio.unlock();
  };

  useEffect(() => {
    if (!runStarted) return;

    // iOS Safari can emit a transient window blur while the browser UI or
    // viewport is changing. Treating every blur as a run exit made a normal
    // touch/drag open the pause screen. Only pause when the document is
    // actually hidden (backgrounded, navigated away, or the page is unloaded).
    const pauseForLifecycleChange = () => {
      resetJoystick();
      if (phaseRef.current === "playing" && !settingsOpenRef.current) {
        lifecyclePauseRequestedRef.current = true;
        setPausedCommand(true);
        setPauseOpen(true);
        setAnnouncement("一時停止しました");
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        pauseForLifecycleChange();
      }
    };
    // pagehide marks a lifecycle transition even when Safari reports the
    // document as visible for a short moment. Pause unconditionally so a
    // returning tab cannot resume with a stale frame delta.
    const onPageHide = () => {
      pauseForLifecycleChange();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [resetJoystick, runStarted, setPausedCommand]);

  useEffect(() => {
    if (!runStarted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (settingsOpen) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeSettings();
          return;
        }
        if (tutorialOpen) {
          event.preventDefault();
          event.stopImmediatePropagation();
          completeTutorial();
          return;
        }
        if (pauseOpen || isPaused) {
          event.preventDefault();
          event.stopImmediatePropagation();
          lifecyclePauseRequestedRef.current = false;
          pauseOpenRef.current = false;
          setPausedCommand(false);
          setPauseOpen(false);
          restoreFocus();
          return;
        }
      }
      if (event.key.toLowerCase() === "p" && phaseRef.current === "playing" && !settingsOpen && !tutorialOpen) {
        pauseOpenRef.current = !isPaused;
        lifecyclePauseRequestedRef.current = false;
        setPausedCommand(!isPaused);
        setPauseOpen(!isPaused);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSettings, completeTutorial, isPaused, pauseOpen, restoreFocus, runStarted, setPausedCommand, settingsOpen, tutorialOpen]);

  useEffect(() => {
    if (!runStarted) return;
    if (snapshot.phase === "paused") {
      setIsPaused(true);
      if (!settingsOpen && !tutorialOpen && !pausedBySettingsRef.current) {
        pauseOpenRef.current = true;
        setPauseOpen(true);
      }
      return;
    }
    if (snapshot.phase === "playing") {
      setIsPaused(false);
      setPauseOpen(false);
    }
  }, [runStarted, settingsOpen, snapshot.phase, tutorialOpen]);

  useEffect(() => {
    if (snapshot.phase !== "playing") resetJoystick();
  }, [resetJoystick, snapshot.phase]);

  useEffect(() => {
    if (!runStarted || !sceneReady) return;
    if (settingsOpen) setPausedCommand(true);
  }, [runStarted, sceneReady, setPausedCommand, settingsOpen]);

  useEffect(() => {
    if (!runStarted) return;
    const dialogIsOpen = settingsOpen || pauseOpen || tutorialOpen || snapshot.phase === "upgrade" || snapshot.phase === "bossReward" || snapshot.phase === "gameover";
    if (!dialogIsOpen) return;
    const root = document.querySelector<HTMLElement>("[data-dialog-root]");
    const focusables = Array.from(root?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
    (focusables[0] ?? root)?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    root?.addEventListener("keydown", trapFocus);
    return () => root?.removeEventListener("keydown", trapFocus);
  }, [pauseOpen, runStarted, settingsOpen, snapshot.phase, tutorialOpen]);


  useEffect(() => {
    if (snapshot.phase !== "gameover") return;
    resetJoystick();
    setIsPaused(false);
    pauseOpenRef.current = false;
    lifecyclePauseRequestedRef.current = false;
    setPauseOpen(false);
    pausedBySettingsRef.current = false;
    settingsOpenRef.current = false;
    setSettingsOpen(false);
    setTutorialOpen(false);
    const score = Math.max(0, Number(snapshotView.score ?? 0));
    const mode = snapshotView.mode ?? activeMode;
    setBestScores((current) => {
      if (score <= current[mode]) return current;
      const next = { ...current, [mode]: score };
      saveBestScores(next);
      return next;
    });
  }, [activeMode, resetJoystick, snapshot.phase, snapshotView.mode, snapshotView.score]);

  useEffect(() => {
    const next = snapshotView;
    if (runStarted) {
      for (const event of next.soundEvents ?? []) {
        if (event.id <= lastSoundEventIdRef.current) continue;
        audio.play(event.cue);
        if (event.cue === "kill" || event.cue.startsWith("kill-")) setAnnouncement(`撃破数 ${next.kills}。`);
        if (event.cue === "level-up") setAnnouncement(`レベル${next.level}。強化を選んでください。`);
        if (event.cue === "perfect") {
          setAnnouncement("完全回避。短時間、攻撃力が上がります。");
          setPerfectDodgeCue(next.perfectDodges);
          if (perfectDodgeTimerRef.current !== null) window.clearTimeout(perfectDodgeTimerRef.current);
          perfectDodgeTimerRef.current = window.setTimeout(() => setPerfectDodgeCue(0), 900);
        }
        if (event.cue === "low-health") setAnnouncement("耐久値が低下しています。");
        if (event.cue === "boss" && next.activeBossLabel) setAnnouncement(`ボス出現：${next.activeBossLabel}`);
        if (event.cue === "clear" || event.cue === "gameover") {
          setAnnouncement(outcomeLabel(next.outcome));
          void submitRankingScore(next);
        }
        lastSoundEventIdRef.current = event.id;
      }
    }
  }, [audio, runStarted, snapshotView, submitRankingScore]);

  useEffect(() => () => {
    if (perfectDodgeTimerRef.current !== null) window.clearTimeout(perfectDodgeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!runStarted) return;
    const canvas = canvasRef.current;
    if (!canvas || startedRef.current) return;
    startedRef.current = true;
    setSceneReady(false);
    let engine: Engine;
    try {
      engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, adaptToDeviceRatio: true });
      // Keep high-DPI iPhones inside a predictable fill-rate budget.
      engine.setHardwareScalingLevel(Math.max(1, (window.devicePixelRatio || 1) / 1.75));
    } catch (error: unknown) {
      setSceneError(error instanceof Error ? error.message : "この端末で3D画面を開始できませんでした。");
      startedRef.current = false;
      return;
    }
    let cancelled = false;
    const onContextLost = (event: Event) => {
      event.preventDefault();
      lifecyclePauseRequestedRef.current = true;
      setPausedCommand(true);
      setSceneError("グラフィック機能が一時停止しました。復旧後に再開してください。");
    };
    const onContextRestored = () => {
      setSceneError(null);
      setAnnouncement("グラフィック機能が復旧しました。");
    };
    canvas.addEventListener("webglcontextlost", onContextLost, { passive: false });
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    const sceneOptions = {
      mode: activeMode,
      demoMode,
      forceUpgrade,
      forceModulePreview,
      bossPreview,
      strikerPreview,
      idlePreview,
      explosionPreview,
      bossExplosionPreview,
      bossExplosionFarPreview,
      auditModule,
      debugMode,
      rerollPreview,
      levelPreview,
      balancePreviewLevel,
      variantPreviewLevel,
      milestoneBossPreviewLevel,
      milestoneRewardPreviewLevel,
      obstaclePreview,
      resultPreview,
      onSnapshot: setSnapshot,
    };

    void createGameScene(engine, canvas, sceneOptions).then((handle) => {
      if (cancelled) {
        handle.dispose();
        return;
      }
      handleRef.current = handle;
      handle.setCameraZoomMultiplier(playerSettingsRef.current.cameraZoom);
      const shouldPause = settingsOpenRef.current || pauseOpenRef.current || tutorialOpenRef.current || lifecyclePauseRequestedRef.current || pendingPauseRef.current === true;
      handle.setPaused(shouldPause);
      pendingPauseRef.current = null;
      setSceneReady(true);
      engine.runRenderLoop(() => handle.scene.render());
    }).catch((error: unknown) => {
      if (cancelled) return;
      setSceneError(error instanceof Error ? error.message : "戦場を開始できませんでした。");
      setSceneReady(false);
      startedRef.current = false;
      engine.dispose();
    });

    let resizeFrame = 0;
    const onResize = () => {
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        engine.resize();
        const width = mainRef.current?.clientWidth ?? window.innerWidth;
        const height = mainRef.current?.clientHeight ?? window.innerHeight;
        const nextMode = getViewportMode(width, height);
        setViewportMode((currentMode) => currentMode === nextMode ? currentMode : nextMode);
      });
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    if (mainRef.current) resizeObserver?.observe(mainRef.current);
    window.visualViewport?.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("scroll", onResize);
    window.addEventListener("resize", onResize);
    onResize();
    return () => {
      cancelled = true;
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", onResize);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      resetJoystick();
      handleRef.current?.dispose();
      handleRef.current = null;
      engine.dispose();
      setSceneReady(false);
      startedRef.current = false;
    };
  }, [activeMode, auditModule, balancePreviewLevel, bossExplosionFarPreview, bossExplosionPreview, bossPreview, debugMode, demoMode, explosionPreview, forceModulePreview, forceUpgrade, idlePreview, levelPreview, milestoneBossPreviewLevel, milestoneRewardPreviewLevel, resetJoystick, resultPreview, rerollPreview, runStarted, setPausedCommand, strikerPreview, variantPreviewLevel]);

  useEffect(() => {
    if (!touchPreview || !runStarted) return;
    setFloatingStick({ x: window.innerWidth * 0.68, y: window.innerHeight * 0.62 });
  }, [runStarted, touchPreview]);

  const healthPercent = clampPercent((snapshot.health / Math.max(1, snapshot.maxHealth)) * 100);
  const xpPercent = clampPercent((snapshot.xp / Math.max(1, snapshot.xpNeeded)) * 100);
  const dodgeCooldown = Math.max(0, Number(snapshotView.dodgeCooldown ?? 0));
  const dodgeCooldownMax = Math.max(0.01, Number(snapshotView.dodgeCooldownMax ?? 1));
  const dodgePercent = clampPercent((1 - dodgeCooldown / dodgeCooldownMax) * 100);
  const score = Number(snapshotView.score ?? 0);
  const combo = Number(snapshotView.combo ?? 0);
  const comboMultiplier = Number(snapshotView.comboMultiplier ?? 1);
  const maxCombo = Number(snapshotView.maxCombo ?? 0);
  const bossesDefeated = Number(snapshotView.bossesDefeated ?? 0);
  const perfectDodges = Number(snapshotView.perfectDodges ?? 0);
  const evolvedWeapons = snapshotView.evolvedWeapons ?? [];
  const evolvedWeaponLabels = evolvedWeapons.map((id) => EVOLUTION_LABELS[id] ?? id);
  const bossRewards = snapshotView.bossRewards ?? [];
  const currentMode = snapshotView.mode ?? activeMode;
  const resultOutcome = outcomeLabel(snapshotView.outcome);
  const isGameover = runStarted && snapshot.phase === "gameover";
  const rankingVisible = isGameover && (!previewAutostart || resultPreview);
  const rankingCurrentName = normalizeRankingName(playerName);
  const isBossReward = runStarted && snapshot.phase === "bossReward";
  const isUpgrade = runStarted && (snapshot.phase === "upgrade" || snapshot.phase === "bossReward");
  const settingsDialog = settingsOpen && runStarted;
  const selectedWeapon = weaponDetailId === null ? undefined : WEAPON_LIBRARY.find((weapon) => weapon.id === weaponDetailId);

  const closeWeaponLibrary = useCallback(() => {
    setWeaponDetailId(null);
    setWeaponLibraryOpen(false);
    restoreFocus();
  }, [restoreFocus]);

  useEffect(() => {
    if (!weaponLibraryOpen) return;
    const shell = mainRef.current;
    const previousOverflow = shell?.style.overflow ?? "";
    if (shell) shell.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      const closeButton = weaponDetailId === null ? weaponLibraryCloseRef.current : weaponDetailCloseRef.current;
      closeButton?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (weaponDetailId !== null) setWeaponDetailId(null);
      else closeWeaponLibrary();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
      if (shell) shell.style.overflow = previousOverflow;
    };
  }, [closeWeaponLibrary, weaponDetailId, weaponLibraryOpen]);

  const renderSettingsFields = (startScreen = false) => (
    <div className={`settings-fields ${startScreen ? "settings-fields-start" : ""}`}>
      <label className="settings-control"><span><b>スティック表示</b><i>{Math.round(playerSettings.stickOpacity * 100)}%</i></span><input data-testid="stick-opacity" aria-label="スティック表示" type="range" min="20" max="100" step="1" value={Math.round(playerSettings.stickOpacity * 100)} onChange={(event) => updatePlayerSettings({ ...playerSettings, stickOpacity: Number(event.target.value) / 100 })} /><small>フローティング仮想スティックの透明度</small></label>
      <div className="settings-stick-preview" style={{ "--preview-opacity": playerSettings.stickOpacity } as CSSProperties} aria-label="現在の操作表示の見本"><i /><b>操作表示の見本</b></div>
      <label className="settings-control"><span><b>カメラ倍率</b><i>{Math.round(playerSettings.cameraZoom * 100)}%</i></span><input data-testid="camera-zoom" aria-label="カメラ倍率" type="range" min="82" max="122" step="1" value={Math.round(playerSettings.cameraZoom * 100)} onChange={(event) => updatePlayerSettings({ ...playerSettings, cameraZoom: Number(event.target.value) / 100 })} /><small>低い値で近く、高い値で広い視界（射程・敵出現は変わりません）</small></label>
      <label className="settings-toggle-row"><span><b>効果音</b><small>開始、警告、ダメージ、結果の音</small></span><input data-testid="sound-toggle" aria-label="効果音" type="checkbox" checked={audio.enabled} onChange={(event) => { audio.unlock(); audio.setEnabled(event.target.checked); }} /></label>
      <button className="settings-reset" data-testid="reset-settings" type="button" onClick={() => { updatePlayerSettings(DEFAULT_PLAYER_SETTINGS); audio.setEnabled(true); }}>初期設定に戻す</button>
    </div>
  );

  const weaponLibraryModal = weaponLibraryOpen ? createPortal(
    <div className="weapon-library-layer" data-testid="weapon-library" onClick={(event) => { if (event.target === event.currentTarget) closeWeaponLibrary(); }}>
      <section className="weapon-library-panel" role="dialog" aria-modal="true" aria-labelledby="weapon-library-title" data-dialog-root="true" onClick={(event) => event.stopPropagation()}>
        <header className="weapon-library-header"><div><p className="modal-eyebrow">装備データベース // 出撃前確認</p><h2 id="weapon-library-title">武器一覧</h2></div><button ref={weaponLibraryCloseRef} type="button" className="weapon-library-close" aria-label="武器一覧を閉じる" onClick={closeWeaponLibrary}>×</button></header>
        <p className="weapon-library-intro">名前だけでなく、攻撃の向き・範囲・役割まで確認できます。カードを選ぶと、レベルごとの変化と進化条件を表示します。</p>
        <div className="weapon-library-grid">
          {WEAPON_LIBRARY.map((weapon) => <button key={weapon.id} className="weapon-library-card" type="button" onClick={() => setWeaponDetailId(weapon.id)}><ModuleIcon id={weapon.iconId} className="weapon-library-icon" /><span className="weapon-library-category">{weapon.category}</span><strong>{weapon.title}</strong><small>{weapon.role}</small><p>{weapon.description}</p><i>詳細を見る</i></button>)}
        </div>
      </section>
      {selectedWeapon && <div className="weapon-detail-layer" data-testid="weapon-detail" onClick={(event) => { if (event.target === event.currentTarget) setWeaponDetailId(null); }}>
        <article className="weapon-detail-panel" role="dialog" aria-modal="true" aria-labelledby="weapon-detail-title" onClick={(event) => event.stopPropagation()}>
          <header className="weapon-detail-header"><div><p className="modal-eyebrow">{selectedWeapon.code} // {selectedWeapon.category}</p><h2 id="weapon-detail-title"><ModuleIcon id={selectedWeapon.iconId} className="weapon-detail-icon" />{selectedWeapon.title}</h2></div><button ref={weaponDetailCloseRef} type="button" className="weapon-library-close" aria-label="武器の詳細を閉じる" onClick={() => setWeaponDetailId(null)}>×</button></header>
          <div className="weapon-detail-lead"><strong>{selectedWeapon.role}</strong><p>{selectedWeapon.description}</p></div>
          <section className="weapon-level-section" aria-labelledby="weapon-level-title"><header><h3 id="weapon-level-title">レベルごとの変化</h3><span>{selectedWeapon.maxLevelText}</span></header><ol>{selectedWeapon.levelDetails.map((detail, index) => <li key={`${selectedWeapon.id}-level-${index}`}><b>Lv.{index + 1}</b><span>{detail.replace(/^レベル\d+：/, "")}</span></li>)}</ol></section>
          {selectedWeapon.synergy && <section className="weapon-synergy-section"><h3>組み合わせと進化</h3><p>{selectedWeapon.synergy}</p></section>}
          <p className="weapon-availability">{selectedWeapon.availability}</p>
        </article>
      </div>}
    </div>,
    document.body,
  ) : null;

  if (!runStarted) {
    return (
      <main ref={mainRef} className={`game-shell pre-run-shell viewport-${viewportMode}`} onContextMenu={(event) => event.preventDefault()} aria-labelledby="pre-run-title" data-testid="game-shell" data-phase="ready">
        <div className="pre-run-backdrop" aria-hidden="true" />
        <section className="pre-run-panel" data-testid="pre-run-panel">
          <img src={GAME_ASSETS.sigil} className="pre-run-sigil" alt="" aria-hidden="true" />
          <p className="modal-eyebrow">封鎖区域 // セクター07</p>
          <h1 id="pre-run-title">サバサバ</h1>
          <p className="pre-run-purpose">自動射撃で敵の波を切り抜け、経験値を集め、装備を進化させる見下ろし型サバイバル。</p>
          <form className="pre-run-form" noValidate onSubmit={startRun}>
            <label className="name-field"><span>プレイヤー名</span><input ref={nameInputRef} data-testid="player-name" autoComplete="nickname" maxLength={18} value={playerName} onChange={(event) => { setPlayerName(event.target.value); if (nameError) setNameError(""); }} placeholder="プレイヤー01" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "name-help name-error" : "name-help"} /><small id="name-help">次回の出撃にも保存されます。</small></label>
            {nameError && <div id="name-error" className="name-entry-alert" role="alert" aria-live="assertive"><span aria-hidden="true">!</span><strong>{nameError}</strong></div>}
            <fieldset className="mode-picker"><legend>モードを選択</legend><div role="radiogroup" aria-label="ゲームモード"><button data-testid="mode-normal" type="button" role="radio" aria-checked={selectedMode === "normal"} className={selectedMode === "normal" ? "selected" : ""} onClick={() => setSelectedMode("normal")}><b>通常</b><small>10分以内に最終ボスを撃破。</small></button><button data-testid="mode-endless" type="button" role="radio" aria-checked={selectedMode === "endless"} className={selectedMode === "endless" ? "selected" : ""} onClick={() => setSelectedMode("endless")}><b>無限</b><small>終わりなき波。得点を伸ばす。</small></button></div></fieldset>
            <button className="start-run-button" data-testid="start-run" type="submit">出撃開始 <span>開始</span></button>
          </form>
          <button className="weapon-library-trigger" data-testid="weapon-list" type="button" onClick={() => { rememberFocus(); setWeaponDetailId(null); setWeaponLibraryOpen(true); }}><span>武器一覧</span><small>効果・レベル・進化条件を見る</small><b>開く</b></button>
          <ShareButton className="home-share-action" label="ゲームをシェア" testId="share-home" title="サバサバ" text="【サバサバ】自動射撃で敵の波を切り抜ける、見下ろし型サバイバルゲーム。" />
          <details className="pre-run-settings" open><summary>出撃前の設定</summary><p>端末に保存されます。出撃中は一時停止画面から変更できます。</p>{renderSettingsFields(true)}</details>
          {sceneError && <p className="scene-error" role="alert">{sceneError}</p>}
        </section>
        {weaponLibraryModal}
      </main>
    );
  }

  return (
    <main ref={mainRef} className={`game-shell viewport-${viewportMode} ${isPaused ? "is-paused" : ""} ${healthPercent <= 25 ? "low-health" : ""}`} onContextMenu={(event) => event.preventDefault()} style={{ "--stick-opacity": playerSettings.stickOpacity } as CSSProperties} aria-label="サバサバ" data-testid="game-shell" data-phase={snapshot.phase} data-mode={currentMode}>
      <canvas ref={canvasRef} className="game-canvas" style={{ touchAction: "none" }} aria-label="3D戦場" />
      <KillMilestoneRain kills={snapshot.kills} />
      <div className="containment-floor-overlay" aria-hidden="true" /><img src={GAME_ASSETS.sigil} className="combat-sigil" alt="" aria-hidden="true" /><div className="threat-perimeter" aria-hidden="true"><i /><i /><i /><i /></div><div className="safety-frame" aria-hidden="true"><span className="frame-code frame-code-a">稼働区画 // 07-A</span><span className="frame-code frame-code-b">境界を守れ</span></div><div className="tactical-vignette" aria-hidden="true" />
      <section className="hud-layer" aria-label="戦闘情報">
        <header className="mission-bar"><div className="brand-lockup"><img src={GAME_ASSETS.sigil} className="brand-sigil" alt="" aria-hidden="true" /><div><p className="eyebrow">{snapshotView.missionLabel ?? "封鎖区域 // セクター07"}</p><h1>サバサバ</h1></div></div><div className="timer-panel"><span className="timer-label">生存時間</span><strong>{formatTime(snapshot.seconds)}</strong>{demoMode && <em>確認用出撃中</em>}</div><div className="kills-panel"><span>撃破数</span><strong>{String(snapshot.kills).padStart(3, "0")}</strong><small>接近中の敵 {snapshot.enemyCount}体</small></div><div className="run-controls"><span className="mode-badge">{MODE_LABELS[currentMode]}</span><button className="pause-trigger" data-testid="pause-run" type="button" disabled={!sceneReady || snapshot.phase !== "playing"} onClick={() => { rememberFocus(); resetJoystick(); pauseOpenRef.current = true; setPausedCommand(true); setPauseOpen(true); }}>一時停止</button></div></header>
        <aside className={`health-unit ${snapshot.damageFlash > 0 ? "damage-alert" : ""}`} aria-label={`耐久値 ${Math.ceil(snapshot.health)} / ${snapshot.maxHealth}`}><div className="unit-header"><span>耐久値</span><strong>{Math.ceil(snapshot.health)}<i>/{snapshot.maxHealth}</i></strong></div><div className="meter health-meter" role="progressbar" aria-label="耐久値" aria-valuemin={0} aria-valuemax={snapshot.maxHealth} aria-valuenow={Math.max(0, Math.ceil(snapshot.health))}><i style={{ width: `${healthPercent}%` }} /></div><p>プレイヤー // {playerName.toUpperCase()}</p></aside>
        {snapshot.debugStatus && <aside className="combat-debug-panel">{snapshot.debugStatus}</aside>}
        <aside className="combat-metrics" aria-label="戦闘記録"><span><small>得点</small><b>{formatStat(score)}</b></span><span><small>連続撃破</small><b>{combo} <i>×{comboMultiplier.toFixed(1)}</i></b></span><span><small>最高</small><b>{formatStat(Math.max(bestScores[currentMode], score))}</b></span></aside>
        <div className="mission-objective"><span>{snapshotView.objectiveText ?? "侵入を食い止め、境界を守れ。"}</span>{snapshotView.activeBossLabel && <b>ボス // {snapshotView.activeBossLabel}</b>}{typeof snapshotView.nextBossSeconds === "number" && !snapshotView.activeBossLabel && <small>次のボスまで {Math.ceil(snapshotView.nextBossSeconds)}秒</small>}</div>
        {perfectDodgeCue > 0 && <div className="perfect-dodge-cue" role="status"><strong>完全回避</strong><small>短時間の攻撃強化</small></div>}
        <div className="xp-unit"><div className="xp-readout"><span>経験値 // レベル{String(snapshot.level).padStart(2, "0")}</span><b>{snapshot.xp} / {snapshot.xpNeeded}</b></div><div className="meter xp-meter" role="progressbar" aria-label="経験値" aria-valuemin={0} aria-valuemax={snapshot.xpNeeded} aria-valuenow={Math.max(0, snapshot.xp)}><i style={{ width: `${xpPercent}%` }} /></div></div>
        <footer className="loadout-rail" role="region" tabIndex={0} aria-label="装備レール。左右へスワイプして全ての武器とモジュールを確認" data-testid="loadout-rail"><div className="loadout-mark">装備<br /><strong>{String(snapshot.weaponCount).padStart(2, "0")}</strong></div>{snapshot.attacks.map((attack) => <div key={attack.id} className={`weapon-card ${attack.active ? "active" : "muted"}`}><ModuleIcon id={attack.iconId} className="weapon-glyph" /><div><b>{attack.label}</b><small>{attack.active ? `レベル${String(attack.tier).padStart(2, "0")} // ${attack.detail}` : attack.detail}</small></div></div>)}<div className="instruction"><kbd>W・A・S・D</kbd><span>境界を守る</span></div></footer>
        {snapshot.phase === "playing" && sceneReady && <div className="floating-control-surface" data-testid="touch-surface" role="group" aria-label="任意位置タップ移動エリア" onContextMenu={(event) => event.preventDefault()} onPointerDown={beginJoystick} onPointerMove={moveJoystick} onPointerUp={endJoystick} onPointerCancel={endJoystick} onLostPointerCapture={endJoystick} />}
        {floatingStick && <div className="touch-drive touch-drive-floating" data-testid="floating-stick" aria-hidden="true" style={{ left: floatingStick.x, top: floatingStick.y }}><span className="joystick-rings" /><span className="joystick-knob" style={{ transform: `translate(calc(-50% + ${stickOffset.x}px), calc(-50% + ${stickOffset.y}px))` }}><i /></span><small>移動操作</small></div>}
        <button className="dodge-button" data-testid="dodge-button" type="button" onPointerDown={(event) => { event.preventDefault(); requestDodge(); }} onClick={requestDodge} disabled={!sceneReady || snapshot.phase !== "playing" || isPaused || dodgeCooldown > 0} aria-label={dodgeCooldown > 0 ? `回避再使用まで ${formatCooldown(dodgeCooldown)}` : "回避"}><span>回避</span><b>{dodgeCooldown > 0 ? formatCooldown(dodgeCooldown) : "準備完了"}</b><i style={{ width: `${dodgePercent}%` }} /></button>

        {tutorialOpen && <div className="tutorial-layer" data-testid="tutorial-layer"><aside className="tutorial-console" role="dialog" aria-modal="true" aria-live="polite" aria-atomic="true" aria-labelledby="tutorial-title" data-dialog-root="true" data-testid="tutorial-dialog"><p className="modal-eyebrow">操作案内 // {tutorialStep + 1}/4</p><h2 id="tutorial-title">{tutorialSteps[tutorialStep].title}</h2><p>{tutorialSteps[tutorialStep].copy}</p><div className="tutorial-progress" role="progressbar" aria-label="案内の進行" aria-valuemin={1} aria-valuemax={tutorialSteps.length} aria-valuenow={tutorialStep + 1}><i style={{ width: `${((tutorialStep + 1) / tutorialSteps.length) * 100}%` }} /></div><footer><button data-testid="tutorial-dismiss" type="button" onClick={completeTutorial}>閉じる</button><button className="primary-dialog-button" data-testid="tutorial-next" type="button" onClick={() => advanceTutorial(true)}>{tutorialStep >= tutorialSteps.length - 1 ? "了解" : "次へ"}</button></footer></aside></div>}
        {isPaused && !settingsDialog && <div className="modal-layer pause-layer"><section className="pause-console" role="dialog" aria-modal="true" aria-labelledby="pause-title" data-dialog-root="true" data-testid="pause-dialog"><p className="modal-eyebrow">出撃状態 // 一時停止</p><h2 id="pause-title">その場で<br /><em>停止中。</em></h2><p>戦闘は停止しています。準備ができたら再開してください。</p><div className="pause-actions"><button className="primary-dialog-button" data-testid="resume-run" type="button" onClick={() => { lifecyclePauseRequestedRef.current = false; pauseOpenRef.current = false; setPausedCommand(false); setPauseOpen(false); restoreFocus(); void audio.unlock(); }}>再開</button><button type="button" onClick={() => openSettings(true)}>設定</button><button type="button" className="danger-dialog-button" onClick={retireRun}>出撃を終了</button></div></section></div>}
        {settingsDialog && <div className="modal-layer settings-layer"><section className="settings-console settings-dialog" id="player-settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-dialog-root="true" data-testid="settings-dialog"><header><div><span>プレイヤー設定</span><h2 id="settings-title">出撃の<em>設定</em></h2></div><button type="button" onClick={closeSettings} aria-label="設定を閉じる">閉じる</button></header><p>端末に保存され、次回の出撃にも適用されます。</p>{renderSettingsFields(false)}<footer><small>初期値：56% / 100%</small></footer></section></div>}
        {isUpgrade && <div className="modal-layer"><section className="upgrade-console" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" data-dialog-root="true" data-testid="upgrade-dialog"><p className="modal-eyebrow">{isBossReward ? "ボス報酬 // 選択可能" : snapshot.moduleMilestone ? "モジュール枠を拡張" : "強化候補を確認"}</p><h2 id="upgrade-title">{isBossReward ? <>ボス報酬を<br /><em>選択</em></> : <>戦場の<br /><em>強化を選択</em></>}</h2><p className="modal-copy">{isBossReward ? "撃破報酬をひとつ選び、戦闘を再開してください。" : snapshot.moduleMilestone ? "新規攻撃モジュール候補です。ひとつだけ導入してください。" : "既存装備の強化候補から、ひとつだけ承認してください。"} {!isBossReward && <>攻撃枠 {snapshot.weaponCount}/{snapshot.weaponLimit}（レール含む）・補助枠 {snapshot.utilityCount}/{snapshot.utilityLimit}。</>}</p>{(isBossReward || bossRewards.length > 0) && <section className="boss-reward-panel" aria-labelledby="boss-reward-title"><header><span>ボス報酬</span><h3 id="boss-reward-title">報酬を選ぶ</h3></header>{bossRewards.length > 0 ? <div className="boss-reward-grid">{bossRewards.map((reward) => <button key={reward.id} type="button" className="boss-reward-card" disabled={!reward.enabled} onClick={() => selectBossReward(reward.id)}><strong>{reward.title}</strong><small>{reward.description}</small><i>{reward.enabled ? "取得" : "選択不可"}</i></button>)}</div> : <p className="boss-reward-empty">報酬候補を読み込み中です。</p>}</section>}{!isBossReward && <><div className="upgrade-actions"><button className="reroll-button" type="button" onClick={rerollUpgrades} disabled={snapshot.rerollsRemaining <= 0}>引き直す <span>{snapshot.rerollsRemaining}/3</span></button><small>候補を再抽選</small></div><div className="upgrade-grid">{snapshot.upgrades.map((upgrade, index) => { const current = upgrade.currentLevel !== undefined ? `レベル${upgrade.currentLevel}` : "現在"; const next = upgrade.nextLevel !== undefined ? `レベル${upgrade.nextLevel}` : "次"; const role = upgrade.role ?? (upgrade.category === "module" ? "戦場モジュール" : "標準武器"); const change = upgrade.changeSummary ?? upgrade.description; const synergy = upgrade.synergy; return <button key={upgrade.id} data-testid="upgrade-card" type="button" className="upgrade-card" onClick={() => selectUpgrade(upgrade.id)}><span className="choice-number">0{index + 1}</span><ModuleIcon id={upgrade.iconId} className="upgrade-symbol" /><span className="upgrade-code">{upgrade.code}</span><strong>{upgrade.title}</strong><span className="upgrade-role">{role}</span><span className="upgrade-delta"><b>{current}</b><i>→</i><b>{next}</b></span><small>{change}</small>{synergy && <span className="upgrade-synergy"><b>組合せ</b>{synergy}</span>}<i className="install-label">決定</i></button>; })}</div></>}</section></div>}
        {isGameover && <div className="modal-layer"><section className={`failure-console result-console result-${snapshotView.outcome ?? "failed"}`} role="dialog" aria-modal="true" aria-labelledby="result-title" data-dialog-root="true" data-testid="result-dialog"><p className="modal-eyebrow danger">戦闘報告 // {resultOutcome}</p><h2 id="result-title">{resultOutcome === "成功" ? <>作戦<br />成功。</> : resultOutcome === "終了" ? <>出撃<br />終了。</> : <>信号<br /><em>断絶。</em></>}</h2><div className="result-summary"><span><small>得点</small><b>{formatStat(score)}</b></span><span><small>生存時間</small><b>{formatTime(snapshot.seconds)}</b></span><span><small>撃破数</small><b>{formatStat(snapshot.kills)}</b></span><span><small>最終レベル</small><b>レベル{String(snapshot.level).padStart(2, "0")}</b></span></div><div className="result-goal-stats"><span><small>連続撃破</small><b>{combo} <i>×{comboMultiplier.toFixed(1)}</i></b></span><span><small>最大連続撃破</small><b>{maxCombo}</b></span><span><small>完全回避</small><b>{perfectDodges}</b></span><span><small>撃破ボス数</small><b>{bossesDefeated}</b></span></div><section className="score-breakdown" aria-label="得点の加点と減点"><header><span>得点内訳</span><b>{formatStat(snapshot.scoreBreakdown.total)}点</b></header><div className="score-positive"><span>撃破数による加点<b>+{formatStat(snapshot.scoreBreakdown.killPoints)}</b></span><span>{currentMode === "normal" ? "クリア時間による加点" : "生存時間による加点"}<b>+{formatStat(snapshot.scoreBreakdown.timePoints)}</b></span><span>レベルによる加点<b>+{formatStat(snapshot.scoreBreakdown.levelPoints)}</b></span></div><div className="score-negative"><span>被弾回数 {snapshot.damageHits}回<b>-{formatStat(snapshot.scoreBreakdown.hitPenalty)}</b></span><span>被ダメージ {snapshot.damageTaken}<b>-{formatStat(snapshot.scoreBreakdown.damagePenalty)}</b></span></div></section>{snapshotView.deathCause && resultOutcome !== "成功" && <p className="death-cause">原因 // {snapshotView.deathCause}</p>}{snapshotView.dodgeBoostSeconds !== undefined && <p className="dodge-result">回避強化 // {Number(snapshotView.dodgeBoostSeconds).toFixed(1)}秒</p>}{evolvedWeapons.length > 0 && <section className="evolution-result" aria-label="完成した進化武器"><header>完成した進化武器</header><p>{evolvedWeaponLabels.join("・")}</p></section>}<p className="total-damage-result">総ダメージ // {formatStat(snapshot.totalDamage)}</p><section className="result-breakdown" aria-label="武器別戦闘統計"><header><span>武器別戦績</span><small>ダメージ / 撃破</small></header><div className="result-stat-list">{snapshot.resultStats.map((stat, index) => <div className="result-stat-row" key={stat.id}><span className="result-rank">{String(index + 1).padStart(2, "0")}</span><ModuleIcon id={stat.iconId} className="result-stat-icon" /><strong>{stat.label}<small>レベル{String(stat.tier).padStart(2, "0")}</small></strong><b>{formatStat(stat.damage)}<small>ダメージ</small></b><i>{formatStat(stat.kills)}<small>撃破</small></i></div>)}</div></section>{rankingVisible && <section className="result-ranking-panel" data-testid="result-ranking" aria-labelledby="result-ranking-title"><header><div><span>全体ランキング // {MODE_LABELS[currentMode]}</span><h3 id="result-ranking-title">上位記録</h3></div><small>{rankingStatus === "submitting" ? "送信中" : rankingStatus === "submitted" ? "保存済み" : rankingStatus === "failed" ? "再送可能" : "待機中"}</small></header><p className={`result-ranking-status ranking-status-${rankingStatus}`} data-testid="ranking-status" aria-live="polite">{rankingMessage || (ranking.enabled ? "正規結果を検証してランキングへ送信します。" : "ランキング連携を利用できません。端末記録のみ保存します。")}</p>{rankingRows.length > 0 ? <ol className="result-ranking-list">{rankingRows.map((row) => <li key={`${row.rank}-${row.displayName}`} className={row.displayName === rankingCurrentName ? "is-current-player" : undefined}><b>{row.rank}</b><span>{row.displayName}{row.displayName === rankingCurrentName && <small>あなた</small>}</span><strong>{formatStat(row.bestScore)}</strong></li>)}</ol> : <p className="result-ranking-empty">{rankingLoadError || (rankingStatus === "submitting" ? "ランキングを読み込み中…" : "まだランキング記録がありません。")}</p>}{rankingStatus === "failed" && <button className="ranking-retry-button" data-testid="ranking-retry" type="button" onClick={retryRankingSubmission}>記録を再送</button>}</section>}<p>記録された戦闘結果を確認し、次の出撃に備えてください。</p><p className="best-score-line">{MODE_LABELS[currentMode]}の最高得点 // {formatStat(bestScores[currentMode])}</p><div className="result-actions"><ShareButton className="result-share-action" label="結果をシェア" testId="share-result" title="サバサバ" text={`【サバサバ】${playerName || "プレイヤー"}の戦闘結果\n${resultOutcome} / 得点 ${formatStat(score)} / 生存 ${formatTime(snapshot.seconds)} / 撃破 ${formatStat(snapshot.kills)}`} /><button className="primary-dialog-button" data-testid="retry-run" type="button" onClick={retryRun}>もう一度出撃 <span>開始</span></button><button data-testid="return-title" type="button" onClick={returnToTitle}>タイトルへ戻る</button></div></section></div>}
      </section>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      {!sceneReady && !sceneError && <div className="scene-loading" role="status">戦場を準備中…</div>}
      {sceneError && <div className="scene-error scene-error-overlay" role="alert"><p>{sceneError}</p><button type="button" onClick={returnToTitle}>タイトルへ戻る</button></div>}
    </main>
  );
}
