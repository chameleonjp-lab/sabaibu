/**
 * Neon Siege: Survivor UI shell.
 *
 * The pre-run screen owns the only path that creates Babylon. Once a run has
 * started, this component remains a thin DOM/input bridge around GameHandle;
 * the simulation still owns combat and progression.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createGameScene, type GameHandle } from "@/game/scene";
import { GAME_ASSETS } from "@/game/assets";
import { MODULE_UPGRADES, type BossRewardId, type GameMode, type GameSnapshot, type IconId, type ModuleId, type UpgradeId } from "@/game/types";
import { useGameAudio } from "@/hooks/useGameAudio";
import { canSubmitRankingResult, normalizeRankingName, type RankingRow, useGameRanking } from "@/hooks/useGameRanking";
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
  combo: 0,
  comboMultiplier: 1,
  maxCombo: 0,
  bossesDefeated: 0,
  perfectDodges: 0,
  dodgeCooldown: 0,
  dodgeCooldownMax: 1,
  dodgeBoostSeconds: 0,
  missionLabel: "CONTAINMENT // SECTOR 07",
  objectiveText: "Survive the breach and hold the perimeter.",
  deathCause: null,
  evolvedWeapons: [],
  bossRewards: [],
};

const formatTime = (seconds: number) => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, "0")}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;
const formatStat = (value: number) => new Intl.NumberFormat("ja-JP").format(Math.round(Number.isFinite(value) ? value : 0));
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

const outcomeLabel = (outcome: GameSnapshot["outcome"]) => {
  if (outcome === "clear") return "CLEAR";
  if (outcome === "retired") return "RETIRED";
  return "FAILED";
};

const tutorialSteps = [
  { title: "MOVE", copy: "画面の任意位置をタップしてドラッグ。PCでは WASD / 矢印キーで移動します。" },
  { title: "COLLECT XP", copy: "敵を倒して出現するエネルギーを拾い、リアクターを同期させます。" },
  { title: "CHOOSE UPGRADE", copy: "レベルアップで戦闘が止まります。3枚からひとつを選んで出撃を続けます。" },
  { title: "AVOID RED WARNINGS", copy: "赤い予告線・円・突進から離れ、DODGEで危険を抜けてください。" },
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
  { rank: 1, displayName: "ALPHA", bestScore: 48200, playCount: 12 },
  { rank: 2, displayName: "NEON", bestScore: 40150, playCount: 8 },
  { rank: 3, displayName: "TEST", bestScore: 28450, playCount: 1 },
  { rank: 4, displayName: "VOID", bestScore: 19700, playCount: 5 },
  { rank: 5, displayName: "LUMA", bestScore: 12600, playCount: 3 },
];

export default function GameCanvas() {
  const mainRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startedRef = useRef(false);
  const handleRef = useRef<GameHandle | null>(null);
  const joystickPointerIdRef = useRef<number | null>(null);
  const stickOriginRef = useRef({ x: 0, y: 0 });
  const phaseRef = useRef<GameSnapshot["phase"]>("playing");
  const previousSnapshotRef = useRef<GameSnapshot | null>(null);
  const lastAttackCueAtRef = useRef(0);
  const lastWarningCueAtRef = useRef(0);
  const perfectDodgeTimerRef = useRef<number | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const playerSettingsRef = useRef<PlayerSettings>(DEFAULT_PLAYER_SETTINGS);
  const pausedBySettingsRef = useRef(false);
  const pauseOpenRef = useRef(false);
  const pendingPauseRef = useRef<boolean | null>(null);
  const lifecyclePauseRequestedRef = useRef(false);
  const rankingRunIdRef = useRef(0);
  const rankingSubmissionKeyRef = useRef("");

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
  const [playerName, setPlayerName] = useState(() => previewAutostart ? "TEST" : loadPlayerName());
  const [selectedMode, setSelectedMode] = useState<GameMode>(previewMode);
  const [activeMode, setActiveMode] = useState<GameMode>(previewMode);
  const [bestScores, setBestScores] = useState<Record<GameMode, number>>(loadBestScores);
  const [runStarted, setRunStarted] = useState(previewAutostart);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [nameError, setNameError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(settingsPreview);
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
    setTutorialOpen(false);
    setTutorialStep(0);
    try {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "1");
    } catch {
      // Continue with the in-memory completion state if storage is unavailable.
    }
  }, []);

  const resetRankingState = useCallback(() => {
    rankingRunIdRef.current += 1;
    rankingSubmissionKeyRef.current = "";
    setRankingStatus("idle");
    setRankingMessage("");
    setRankingRows([]);
    setRankingLoadError("");
  }, []);

  const advanceTutorial = useCallback((fromUserGesture = false) => {
    if (fromUserGesture) audio.unlock();
    audio.play("choice");
    if (tutorialStep >= tutorialSteps.length - 1) completeTutorial();
    else setTutorialStep((step) => step + 1);
  }, [audio, completeTutorial, tutorialStep]);

  const startRun = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmedName = playerName.trim();
    if (!trimmedName && !previewAutostart) {
      setNameError("名前を入力してから出撃してください。");
      return;
    }
    const safeName = trimmedName || "TEST";
    savePlayerName(safeName);
    setPlayerName(safeName);
    setNameError("");
    setActiveMode(selectedMode);
    setSceneError(null);
    resetRankingState();
    setRunStarted(true);
    setIsPaused(false);
    pauseOpenRef.current = false;
    lifecyclePauseRequestedRef.current = false;
    setPauseOpen(false);
    settingsOpenRef.current = false;
    setSettingsOpen(false);
    pausedBySettingsRef.current = false;
    const shouldShowTutorial = !tutorialComplete && !previewAutostart;
    setTutorialStep(0);
    setTutorialOpen(shouldShowTutorial);
    void audio.unlock().then(() => audio.play("start"));
  };

  const returnToTitle = useCallback(() => {
    resetRankingState();
    resetJoystick();
    setPausedCommand(false);
    pendingPauseRef.current = false;
    lifecyclePauseRequestedRef.current = false;
    setSettingsOpen(false);
    settingsOpenRef.current = false;
    pauseOpenRef.current = false;
    setPauseOpen(false);
    setTutorialOpen(false);
    pausedBySettingsRef.current = false;
    setSceneReady(false);
    setRunStarted(false);
    setSnapshot(INITIAL_SNAPSHOT);
  }, [resetJoystick, resetRankingState, setPausedCommand]);

  const retryRun = useCallback(() => {
    resetRankingState();
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
  }, [audio, resetJoystick, resetRankingState, setPausedCommand]);

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
    if (previewAutostart) return;
    if (!ranking.enabled) {
      setRankingStatus("idle");
      setRankingMessage("ランキング連携は準備中です。記録はこの端末に保存されています。");
      return;
    }
    if (!canSubmitRankingResult(resultSnapshot.outcome, previewAutostart, ranking.enabled)) return;
    const runId = rankingRunIdRef.current;
    const mode = resultSnapshot.mode ?? activeMode;
    const displayName = normalizeRankingName(playerName);
    if (!displayName) {
      setRankingStatus("failed");
      setRankingMessage("名前を確認できなかったため、ランキングへ送信できませんでした。");
      return;
    }
    const scoreValue = Math.max(0, Math.trunc(Number(resultSnapshot.score ?? 0)));
    const submissionKey = `${runId}:${mode}:${displayName}:${scoreValue}`;
    if (!force && rankingSubmissionKeyRef.current === submissionKey) return;
    rankingSubmissionKeyRef.current = submissionKey;
    setRankingStatus("submitting");
    setRankingMessage("ランキングへ送信中…");
    setRankingLoadError("");
    try {
      const result = await ranking.submitScore(mode, displayName, scoreValue);
      if (rankingRunIdRef.current !== runId) return;
      setRankingStatus("submitted");
      setRankingMessage(result.isNewBest ? "自己ベストをランキングへ更新しました。" : "今回の記録をランキングへ送信しました。");
    } catch {
      if (rankingRunIdRef.current !== runId) return;
      setRankingStatus("failed");
      setRankingMessage("ランキング送信に失敗しました。通信状態を確認してください。");
    } finally {
      if (rankingRunIdRef.current === runId) void loadRanking(mode, runId);
    }
  }, [activeMode, loadRanking, playerName, previewAutostart, ranking]);

  const retryRankingSubmission = useCallback(() => {
    if (snapshot.phase !== "gameover" || rankingStatus === "submitting") return;
    void submitRankingScore(snapshot, true);
  }, [rankingStatus, snapshot, submitRankingScore]);

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
    audio.unlock();
    audio.play("choice");
    handleRef.current?.chooseUpgrade(id);
  };

  const selectBossReward = (id: BossRewardId) => {
    audio.unlock();
    audio.play("choice");
    handleRef.current?.chooseBossReward(id);
  };

  const rerollUpgrades = () => {
    audio.unlock();
    audio.play("choice");
    handleRef.current?.rerollUpgrades();
  };

  const requestDodge = () => {
    audio.unlock();
    handleRef.current?.requestDodge();
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
        setAnnouncement("RUN PAUSED");
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        pauseForLifecycleChange();
      }
    };
    const onPageHide = () => {
      if (document.visibilityState === "hidden") {
        pauseForLifecycleChange();
      }
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
    const dialogIsOpen = settingsOpen || pauseOpen || snapshot.phase === "upgrade" || snapshot.phase === "bossReward" || snapshot.phase === "gameover";
    if (!dialogIsOpen) return;
    const target = document.querySelector<HTMLElement>("[data-dialog-root] button, [data-dialog-root] input, [data-dialog-root] h2");
    target?.focus();
  }, [pauseOpen, runStarted, settingsOpen, snapshot.phase, tutorialOpen]);

  useEffect(() => {
    if (!runStarted || !tutorialOpen || isPaused || snapshot.phase !== "playing") return;
    const timer = window.setTimeout(() => advanceTutorial(), tutorialStep === 2 ? 5000 : 3600);
    return () => window.clearTimeout(timer);
  }, [advanceTutorial, isPaused, runStarted, snapshot.phase, tutorialOpen, tutorialStep]);

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
    const previous = previousSnapshotRef.current;
    if (previous && runStarted) {
      if (next.kills > previous.kills) {
        audio.play("kill");
        setAnnouncement(`Hostile purged. ${next.kills} total.`);
      }
      if (next.totalDamage > previous.totalDamage) {
        const now = typeof performance === "undefined" ? Date.now() : performance.now();
        if (now - lastAttackCueAtRef.current > 180) {
          lastAttackCueAtRef.current = now;
          audio.play("attack");
        }
      }
      if (next.xp > previous.xp) audio.play("xp");
      if (next.level > previous.level) {
        audio.play("level-up");
        setAnnouncement(`Level ${next.level}. Choose an upgrade.`);
      }
      if (next.damageFlash > previous.damageFlash) audio.play("damage");
      if (next.perfectDodges > previous.perfectDodges) {
        audio.play("perfect");
        setAnnouncement("Perfect dodge. Score plus 200. Output boosted.");
        setPerfectDodgeCue(next.perfectDodges);
        if (perfectDodgeTimerRef.current !== null) window.clearTimeout(perfectDodgeTimerRef.current);
        perfectDodgeTimerRef.current = window.setTimeout(() => setPerfectDodgeCue(0), 900);
      }
      if (next.dangerSignal > previous.dangerSignal) {
        const now = typeof performance === "undefined" ? Date.now() : performance.now();
        if (now - lastWarningCueAtRef.current > 650) {
          lastWarningCueAtRef.current = now;
          audio.play("warning");
        }
      }
      if (next.health / Math.max(1, next.maxHealth) <= 0.25 && previous.health / Math.max(1, previous.maxHealth) > 0.25) {
        audio.play("low-health");
        setAnnouncement("Low health warning.");
      }
      if (next.activeBossLabel && next.activeBossLabel !== previous.activeBossLabel) {
        audio.play("boss");
        setAnnouncement(`Boss active: ${next.activeBossLabel}`);
      }
      if (typeof next.nextBossSeconds === "number" && next.nextBossSeconds <= 5 && (previous.nextBossSeconds ?? 6) > 5) audio.play("warning");
      if ((next.phase === "upgrade" || next.phase === "bossReward") && previous.phase !== next.phase) audio.play("choice");
      if (next.phase === "gameover" && previous.phase !== "gameover") {
        audio.play(next.outcome === "clear" ? "clear" : "gameover");
        setAnnouncement(outcomeLabel(next.outcome));
        void submitRankingScore(next);
      }
    }
    previousSnapshotRef.current = next;
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
      setSceneError(error instanceof Error ? error.message : "Unable to initialize WebGL on this device.");
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
      const shouldPause = settingsOpenRef.current || pauseOpenRef.current || lifecyclePauseRequestedRef.current || pendingPauseRef.current === true;
      handle.setPaused(shouldPause);
      pendingPauseRef.current = null;
      setSceneReady(true);
      engine.runRenderLoop(() => handle.scene.render());
    }).catch((error: unknown) => {
      if (cancelled) return;
      setSceneError(error instanceof Error ? error.message : "Unable to initialize the field.");
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

  const renderSettingsFields = (startScreen = false) => (
    <div className={`settings-fields ${startScreen ? "settings-fields-start" : ""}`}>
      <label className="settings-control"><span><b>STICK VISIBILITY</b><i>{Math.round(playerSettings.stickOpacity * 100)}%</i></span><input data-testid="stick-opacity" aria-label="Stick visibility" type="range" min="20" max="100" step="1" value={Math.round(playerSettings.stickOpacity * 100)} onChange={(event) => updatePlayerSettings({ ...playerSettings, stickOpacity: Number(event.target.value) / 100 })} /><small>フローティング仮想スティックの透明度</small></label>
      <label className="settings-control"><span><b>CAMERA ZOOM</b><i>{Math.round(playerSettings.cameraZoom * 100)}%</i></span><input data-testid="camera-zoom" aria-label="Camera zoom" type="range" min="82" max="122" step="1" value={Math.round(playerSettings.cameraZoom * 100)} onChange={(event) => updatePlayerSettings({ ...playerSettings, cameraZoom: Number(event.target.value) / 100 })} /><small>低い値で近く、高い値で広い視界</small></label>
      <label className="settings-toggle-row"><span><b>SOUND CUES</b><small>開始、警告、ダメージ、リザルト音</small></span><input data-testid="sound-toggle" aria-label="Sound cues" type="checkbox" checked={audio.enabled} onChange={(event) => { audio.unlock(); audio.setEnabled(event.target.checked); }} /></label>
      <div className="settings-stick-preview" style={{ "--preview-opacity": playerSettings.stickOpacity } as CSSProperties} aria-hidden="true"><i /><b>STICK PREVIEW</b></div>
      <button className="settings-reset" data-testid="reset-settings" type="button" onClick={() => { updatePlayerSettings(DEFAULT_PLAYER_SETTINGS); audio.setEnabled(true); }}>RESET DEFAULTS</button>
    </div>
  );

  if (!runStarted) {
    return (
      <main ref={mainRef} className={`game-shell pre-run-shell viewport-${viewportMode}`} onContextMenu={(event) => event.preventDefault()} aria-labelledby="pre-run-title" data-testid="game-shell" data-phase="ready">
        <div className="pre-run-backdrop" aria-hidden="true" />
        <section className="pre-run-panel" data-testid="pre-run-panel">
          <img src={GAME_ASSETS.sigil} className="pre-run-sigil" alt="" aria-hidden="true" />
          <p className="modal-eyebrow">CONTAINMENT // SECTOR 07</p>
          <h1 id="pre-run-title">NEON SIEGE<span>:</span> SURVIVOR</h1>
          <p className="pre-run-purpose">自動射撃で敵の波を切り抜け、XPを集め、装備を進化させる見下ろし型サバイバル。</p>
          <form className="pre-run-form" onSubmit={startRun}>
            <label className="name-field"><span>OPERATOR NAME</span><input data-testid="player-name" autoComplete="nickname" maxLength={18} required value={playerName} onChange={(event) => { setPlayerName(event.target.value); if (nameError) setNameError(""); }} placeholder="ALPHA-13" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "name-error" : "name-help"} /><small id="name-help">次回の出撃にも保存されます。</small>{nameError && <strong id="name-error" role="alert">{nameError}</strong>}</label>
            <fieldset className="mode-picker"><legend>SELECT MODE</legend><div role="radiogroup" aria-label="Game mode"><button data-testid="mode-normal" type="button" role="radio" aria-checked={selectedMode === "normal"} className={selectedMode === "normal" ? "selected" : ""} onClick={() => setSelectedMode("normal")}><b>NORMAL</b><small>10分以内に最終ボスを撃破。</small></button><button data-testid="mode-endless" type="button" role="radio" aria-checked={selectedMode === "endless"} className={selectedMode === "endless" ? "selected" : ""} onClick={() => setSelectedMode("endless")}><b>ENDLESS</b><small>終わりなき波。スコアを伸ばす。</small></button></div></fieldset>
            <button className="start-run-button" data-testid="start-run" type="submit">START RUN <span>GO</span></button>
          </form>
          <div className="pre-run-controls"><span className="control-chip"><b>TOUCH</b> TAP + DRAG TO MOVE</span><span className="control-chip"><b>PC</b> WASD / ARROWS</span><span className="control-chip"><b>DODGE</b> BUTTON OR SPACE</span></div>
          <details className="pre-run-settings" open><summary>FIELD SETTINGS</summary><p>端末に保存されます。出撃中はポーズ画面から変更できます。</p>{renderSettingsFields(true)}</details>
          {sceneError && <p className="scene-error" role="alert">{sceneError}</p>}
        </section>
      </main>
    );
  }

  return (
    <main ref={mainRef} className={`game-shell viewport-${viewportMode} ${isPaused ? "is-paused" : ""} ${healthPercent <= 25 ? "low-health" : ""}`} onContextMenu={(event) => event.preventDefault()} style={{ "--stick-opacity": playerSettings.stickOpacity } as CSSProperties} aria-label="Neon Siege Survivor" data-testid="game-shell" data-phase={snapshot.phase} data-mode={currentMode}>
      <canvas ref={canvasRef} className="game-canvas" style={{ touchAction: "none" }} aria-label="3D survival arena" />
      <div className="containment-floor-overlay" aria-hidden="true" /><img src={GAME_ASSETS.sigil} className="combat-sigil" alt="" aria-hidden="true" /><div className="threat-perimeter" aria-hidden="true"><i /><i /><i /><i /></div><div className="safety-frame" aria-hidden="true"><span className="frame-code frame-code-a">LIVE GRID // 07-A</span><span className="frame-code frame-code-b">HOLD THE LINE</span></div><div className="tactical-vignette" aria-hidden="true" />
      <section className="hud-layer" aria-label="Combat HUD">
        <header className="mission-bar"><div className="brand-lockup"><img src={GAME_ASSETS.sigil} className="brand-sigil" alt="" aria-hidden="true" /><div><p className="eyebrow">{snapshotView.missionLabel ?? "CONTAINMENT // SECTOR 07"}</p><h1>NEON SIEGE<span>:</span> SURVIVOR</h1></div></div><div className="timer-panel"><span className="timer-label">SURVIVAL CLOCK</span><strong>{formatTime(snapshot.seconds)}</strong>{demoMode && <em>DEMO LINK ACTIVE</em>}</div><div className="kills-panel"><span>HOSTILES PURGED</span><strong>{String(snapshot.kills).padStart(3, "0")}</strong><small>{snapshot.enemyCount} SIGNALS IN RANGE</small></div><div className="run-controls"><span className="mode-badge">{currentMode.toUpperCase()}</span><button className="pause-trigger" data-testid="pause-run" type="button" disabled={!sceneReady || snapshot.phase !== "playing"} onClick={() => { rememberFocus(); resetJoystick(); pauseOpenRef.current = true; setPausedCommand(true); setPauseOpen(true); }}>PAUSE</button><button className="settings-trigger" data-testid="settings-trigger" type="button" disabled={snapshot.phase !== "playing" && snapshot.phase !== "paused"} onClick={() => openSettings(false)} aria-expanded={settingsDialog} aria-controls="player-settings-panel">SETTINGS</button></div></header>
        <aside className={`health-unit ${snapshot.damageFlash > 0 ? "damage-alert" : ""}`} aria-label={`Vital armor ${Math.ceil(snapshot.health)} of ${snapshot.maxHealth}`}><div className="unit-header"><span>VITAL ARMOR</span><strong>{Math.ceil(snapshot.health)}<i>/{snapshot.maxHealth}</i></strong></div><div className="meter health-meter" role="progressbar" aria-label="Vital armor" aria-valuemin={0} aria-valuemax={snapshot.maxHealth} aria-valuenow={Math.max(0, Math.ceil(snapshot.health))}><i style={{ width: `${healthPercent}%` }} /></div><p>OPERATOR // {playerName.toUpperCase()}</p></aside>
        {snapshot.debugStatus && <aside className="combat-debug-panel">{snapshot.debugStatus}</aside>}
        <aside className="combat-metrics" aria-label="Run metrics"><span><small>SCORE</small><b>{formatStat(score)}</b></span><span><small>COMBO</small><b>{combo} <i>x{comboMultiplier.toFixed(1)}</i></b></span><span><small>BEST</small><b>{formatStat(Math.max(bestScores[currentMode], score))}</b></span></aside>
        <div className="mission-objective"><span>{snapshotView.objectiveText ?? "Survive the breach and hold the perimeter."}</span>{snapshotView.activeBossLabel && <b>BOSS // {snapshotView.activeBossLabel}</b>}{typeof snapshotView.nextBossSeconds === "number" && !snapshotView.activeBossLabel && <small>NEXT BOSS {Math.ceil(snapshotView.nextBossSeconds)}s</small>}</div>
        {perfectDodgeCue > 0 && <div className="perfect-dodge-cue" role="status"><strong>PERFECT DODGE</strong><small>+200 // OUTPUT BOOST</small></div>}
        <div className="xp-unit"><div className="xp-readout"><span>REACTOR SYNC // LV.{String(snapshot.level).padStart(2, "0")}</span><b>{snapshot.xp} / {snapshot.xpNeeded}</b></div><div className="meter xp-meter" role="progressbar" aria-label="Reactor XP" aria-valuemin={0} aria-valuemax={snapshot.xpNeeded} aria-valuenow={Math.max(0, snapshot.xp)}><i style={{ width: `${xpPercent}%` }} /></div></div>
        <footer className="loadout-rail" role="region" tabIndex={0} aria-label="装備レール。左右へスワイプして全ての武器とモジュールを確認" data-testid="loadout-rail"><div className="loadout-mark">WPN<br /><strong>{String(snapshot.weaponCount).padStart(2, "0")}</strong></div>{snapshot.attacks.map((attack) => <div key={attack.id} className={`weapon-card ${attack.active ? "active" : "muted"}`}><ModuleIcon id={attack.iconId} className="weapon-glyph" /><div><b>{attack.label}</b><small>{attack.active ? `LV.${String(attack.tier).padStart(2, "0")} // ${attack.detail}` : attack.detail}</small></div></div>)}<div className="instruction"><kbd>W A S D</kbd><span>HOLD PERIMETER</span></div></footer>
        {snapshot.phase === "playing" && sceneReady && <div className="floating-control-surface" data-testid="touch-surface" role="group" aria-label="任意位置タップ移動エリア" onContextMenu={(event) => event.preventDefault()} onPointerDown={beginJoystick} onPointerMove={moveJoystick} onPointerUp={endJoystick} onPointerCancel={endJoystick} onLostPointerCapture={endJoystick} />}
        {floatingStick && <div className="touch-drive touch-drive-floating" data-testid="floating-stick" aria-hidden="true" style={{ left: floatingStick.x, top: floatingStick.y }}><span className="joystick-rings" /><span className="joystick-knob" style={{ transform: `translate(calc(-50% + ${stickOffset.x}px), calc(-50% + ${stickOffset.y}px))` }}><i /></span><small>VECTOR<br />DRIVE</small></div>}
        <button className="dodge-button" data-testid="dodge-button" type="button" onClick={requestDodge} disabled={!sceneReady || snapshot.phase !== "playing" || isPaused || dodgeCooldown > 0} aria-label={dodgeCooldown > 0 ? `Dodge recharging ${dodgeCooldown.toFixed(1)} seconds` : "Dodge"}><span>DODGE</span><b>{dodgeCooldown > 0 ? `${dodgeCooldown.toFixed(1)}s` : "READY"}</b><i style={{ width: `${dodgePercent}%` }} /></button><aside className="mobile-fire-status" aria-label="Automatic fire active"><span>WPN</span><b>AUTO<br />FIRE</b><i aria-hidden="true">✦</i></aside>

        {tutorialOpen && <div className="tutorial-layer" data-testid="tutorial-layer"><aside className="tutorial-console" role="region" aria-live="polite" aria-atomic="true" aria-labelledby="tutorial-title" data-testid="tutorial-dialog"><p className="modal-eyebrow">FIELD TIP // {tutorialStep + 1}/4</p><h2 id="tutorial-title">{tutorialSteps[tutorialStep].title}</h2><p>{tutorialSteps[tutorialStep].copy}</p><div className="tutorial-progress" role="progressbar" aria-label="Tutorial progress" aria-valuemin={1} aria-valuemax={tutorialSteps.length} aria-valuenow={tutorialStep + 1}><i style={{ width: `${((tutorialStep + 1) / tutorialSteps.length) * 100}%` }} /></div><footer><button data-testid="tutorial-dismiss" type="button" onClick={completeTutorial}>DISMISS</button><button className="primary-dialog-button" data-testid="tutorial-next" type="button" onClick={() => advanceTutorial(true)}>{tutorialStep >= tutorialSteps.length - 1 ? "GOT IT" : "NEXT"}</button></footer></aside></div>}
        {isPaused && !settingsDialog && <div className="modal-layer pause-layer"><section className="pause-console" role="dialog" aria-modal="true" aria-labelledby="pause-title" data-dialog-root="true" data-testid="pause-dialog"><p className="modal-eyebrow">RUN STATE // PAUSED</p><h2 id="pause-title">HOLD<br /><em>POSITION.</em></h2><p>戦闘は停止しています。準備ができたら再開してください。</p><div className="pause-actions"><button className="primary-dialog-button" data-testid="resume-run" type="button" onClick={() => { audio.unlock(); lifecyclePauseRequestedRef.current = false; pauseOpenRef.current = false; setPausedCommand(false); setPauseOpen(false); restoreFocus(); }}>RESUME</button><button type="button" onClick={() => openSettings(true)}>SETTINGS</button><button type="button" className="danger-dialog-button" onClick={retireRun}>RETIRE RUN</button></div></section></div>}
        {settingsDialog && <div className="modal-layer settings-layer"><section className="settings-console settings-dialog" id="player-settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-dialog-root="true" data-testid="settings-dialog"><header><div><span>PLAYER PREFERENCES</span><h2 id="settings-title">FIELD <em>SETTINGS</em></h2></div><button type="button" onClick={closeSettings} aria-label="設定を閉じる">CLOSE</button></header><p>端末に保存され、次回の出撃にも適用されます。</p>{renderSettingsFields(false)}<footer><button type="button" onClick={() => { pausedBySettingsRef.current = false; settingsOpenRef.current = false; setTutorialStep(0); setTutorialOpen(true); setSettingsOpen(false); setPauseOpen(false); setPausedCommand(false); }}>REPLAY TUTORIAL</button><small>DEFAULT: 56% / 100%</small></footer></section></div>}
        {isUpgrade && <div className="modal-layer"><section className="upgrade-console" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" data-dialog-root="true" data-testid="upgrade-dialog"><p className="modal-eyebrow">{isBossReward ? "BOSS REWARD // ADVANTAGE AVAILABLE" : snapshot.moduleMilestone ? "MODULE BAY EXPANDED" : "SIGNAL OVERRIDE ACCEPTED"}</p><h2 id="upgrade-title">{isBossReward ? <>SELECT A BOSS<br /><em>ADVANTAGE.</em></> : <>SELECT A FIELD<br /><em>MODIFICATION.</em></>}</h2><p className="modal-copy">{isBossReward ? "撃破報酬をひとつ選び、戦闘を再開してください。" : snapshot.moduleMilestone ? "新規攻撃モジュール候補です。ひとつだけ導入してください。" : "既存装備の強化候補から、ひとつだけ承認してください。"} {!isBossReward && <>攻撃枠 {snapshot.weaponCount}/{snapshot.weaponLimit}（Rail込）・補助枠 {snapshot.utilityCount}/{snapshot.utilityLimit}。</>}</p>{(isBossReward || bossRewards.length > 0) && <section className="boss-reward-panel" aria-labelledby="boss-reward-title"><header><span>BOSS REWARD</span><h3 id="boss-reward-title">CHOOSE YOUR ADVANTAGE</h3></header>{bossRewards.length > 0 ? <div className="boss-reward-grid">{bossRewards.map((reward) => <button key={reward.id} type="button" className="boss-reward-card" disabled={!reward.enabled} onClick={() => selectBossReward(reward.id)}><strong>{reward.title}</strong><small>{reward.description}</small><i>{reward.enabled ? "CLAIM" : "LOCKED"}</i></button>)}</div> : <p className="boss-reward-empty">報酬候補を読み込み中です。</p>}</section>}{!isBossReward && <><div className="upgrade-actions"><button className="reroll-button" type="button" onClick={rerollUpgrades} disabled={snapshot.rerollsRemaining <= 0}>REROLL <span>{snapshot.rerollsRemaining}/3</span></button><small>候補を再抽選</small></div><div className="upgrade-grid">{snapshot.upgrades.map((upgrade, index) => { const current = upgrade.currentLevel !== undefined ? `LV.${upgrade.currentLevel}` : "CURRENT"; const next = upgrade.nextLevel !== undefined ? `LV.${upgrade.nextLevel}` : "NEXT"; const role = upgrade.role ?? (upgrade.category === "module" ? "FIELD MODULE" : "STANDARD WEAPON"); const change = upgrade.changeSummary ?? upgrade.description; const synergy = upgrade.synergy ?? upgrade.evolutionHint; return <button key={upgrade.id} data-testid="upgrade-card" type="button" className="upgrade-card" onClick={() => selectUpgrade(upgrade.id)}><span className="choice-number">0{index + 1}</span><ModuleIcon id={upgrade.iconId} className="upgrade-symbol" /><span className="upgrade-code">{upgrade.code}</span><strong>{upgrade.title}</strong><span className="upgrade-role">{role}</span><span className="upgrade-delta"><b>{current}</b><i>→</i><b>{next}</b></span><small>{change}</small>{synergy && <em className="upgrade-synergy">SYNERGY // {synergy}</em>}<i className="install-label">INSTALL</i></button>; })}</div></>}</section></div>}
        {isGameover && <div className="modal-layer"><section className={`failure-console result-console result-${snapshotView.outcome ?? "failed"}`} role="dialog" aria-modal="true" aria-labelledby="result-title" data-dialog-root="true" data-testid="result-dialog"><p className="modal-eyebrow danger">AFTER ACTION REPORT // {resultOutcome}</p><h2 id="result-title">{resultOutcome === "CLEAR" ? <>FIELD<br />SECURED.</> : resultOutcome === "RETIRED" ? <>RUN<br />RETIRED.</> : <>SIGNAL<br /><em>LOST.</em></>}</h2><div className="result-summary"><span><small>SCORE</small><b>{formatStat(score)}</b></span><span><small>SURVIVAL TIME</small><b>{formatTime(snapshot.seconds)}</b></span><span><small>HOSTILES PURGED</small><b>{formatStat(snapshot.kills)}</b></span><span><small>FINAL LEVEL</small><b>LV.{String(snapshot.level).padStart(2, "0")}</b></span></div><div className="result-goal-stats"><span><small>COMBO</small><b>{combo} <i>x{comboMultiplier.toFixed(1)}</i></b></span><span><small>MAX COMBO</small><b>{maxCombo}</b></span><span><small>PERFECT DODGES</small><b>{perfectDodges}</b></span><span><small>BOSSES DEFEATED</small><b>{bossesDefeated}</b></span></div>{snapshotView.deathCause && resultOutcome !== "CLEAR" && <p className="death-cause">CAUSE // {snapshotView.deathCause}</p>}{snapshotView.dodgeBoostSeconds !== undefined && <p className="dodge-result">DODGE BOOST // {Number(snapshotView.dodgeBoostSeconds).toFixed(1)}s</p>}{evolvedWeapons.length > 0 && <section className="evolution-result" aria-label="Evolved weapons"><header>EVOLVED WEAPONS</header><p>{evolvedWeaponLabels.join(" · ")}</p></section>}<p className="total-damage-result">TOTAL DAMAGE // {formatStat(snapshot.totalDamage)}</p><section className="result-breakdown" aria-label="武器別戦闘統計"><header><span>WEAPON TELEMETRY</span><small>DAMAGE / KILLS</small></header><div className="result-stat-list">{snapshot.resultStats.map((stat, index) => <div className="result-stat-row" key={stat.id}><span className="result-rank">{String(index + 1).padStart(2, "0")}</span><ModuleIcon id={stat.iconId} className="result-stat-icon" /><strong>{stat.label}<small>LV.{String(stat.tier).padStart(2, "0")}</small></strong><b>{formatStat(stat.damage)}<small>DMG</small></b><i>{formatStat(stat.kills)}<small>KILLS</small></i></div>)}</div></section>{rankingVisible && <section className="result-ranking-panel" data-testid="result-ranking" aria-labelledby="result-ranking-title"><header><div><span>GLOBAL RANKING // {currentMode.toUpperCase()}</span><h3 id="result-ranking-title">TOP OPERATORS</h3></div><small>{rankingStatus === "submitting" ? "SYNCING" : rankingStatus === "submitted" ? "SAVED" : rankingStatus === "failed" ? "RETRY AVAILABLE" : "WAITING"}</small></header><p className={`result-ranking-status ranking-status-${rankingStatus}`} data-testid="ranking-status" aria-live="polite">{rankingMessage || (ranking.enabled ? "今回の記録をランキングへ送信します。" : "ランキング連携は準備中です。記録は端末に保存されています。")}</p>{rankingRows.length > 0 ? <ol className="result-ranking-list">{rankingRows.map((row) => <li key={`${row.rank}-${row.displayName}`} className={row.displayName === rankingCurrentName ? "is-current-player" : undefined}><b>{row.rank}</b><span>{row.displayName}{row.displayName === rankingCurrentName && <small>あなた</small>}</span><strong>{formatStat(row.bestScore)}</strong></li>)}</ol> : <p className="result-ranking-empty">{rankingLoadError || (rankingStatus === "submitting" ? "ランキングを読み込み中…" : "まだランキング記録がありません。")}</p>}{rankingStatus === "failed" && <button className="ranking-retry-button" data-testid="ranking-retry" type="button" onClick={retryRankingSubmission}>RETRY SUBMISSION</button>}</section>}<p>記録された戦闘テレメトリーを再確認し、次の出撃に備えてください。</p><p className="best-score-line">BEST {currentMode.toUpperCase()} SCORE // {formatStat(bestScores[currentMode])}</p><div className="result-actions"><button className="primary-dialog-button" data-testid="retry-run" type="button" onClick={retryRun}>RETRY {currentMode.toUpperCase()} <span>GO</span></button><button data-testid="return-title" type="button" onClick={returnToTitle}>RETURN TO TITLE</button></div></section></div>}
      </section>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      {!sceneReady && !sceneError && <div className="scene-loading" role="status">INITIALIZING FIELD…</div>}
      {sceneError && <div className="scene-error scene-error-overlay" role="alert"><p>{sceneError}</p><button type="button" onClick={returnToTitle}>RETURN TO TITLE</button></div>}
    </main>
  );
}
