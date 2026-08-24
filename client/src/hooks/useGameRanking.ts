import { useMemo } from "react";
import type { GameMode, GameOutcome, GameSnapshot, ScoreBreakdown } from "@/game/types";
import { isRankableOutcome } from "@/game/rules";

const SUPABASE_URL = "https://mlpnjgezrnhdxsxolyzj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM";
const START_RUN_RPC = "start_sabaibu_run";
const SUBMIT_RUN_RPC = "submit_sabaibu_run";
const BEST_RANKING_RPC = "get_best_score_ranking";
const REQUEST_TIMEOUT_MS = 8_000;
const RANKING_LIMIT = 5;
const CLIENT_VERSION = "sabaibu-web-2.0.0-verified-ranking";
const PENDING_STORAGE_KEY = "sabaibu-ranking-pending-v2";

export const RANKING_ENABLED = false;

const GAME_SLUGS: Record<GameMode, string> = {
  normal: "sabaibu_normal",
  endless: "sabaibu_endless",
};

export type RankingRow = {
  rank: number;
  displayName: string;
  bestScore: number;
  playCount: number;
};

export type RankingRunSession = {
  playToken: string;
  clientRunId: string;
  mode: GameMode;
  displayName: string;
  playCount: number;
};

export type RankingSubmission = {
  isNewBest: boolean;
  alreadySubmitted: boolean;
  score: number;
  bestScore: number;
  playCount: number;
  scoreBreakdown: ScoreBreakdown;
};

type PendingSubmission = {
  playToken: string;
  mode: GameMode;
  outcome: GameOutcome;
  score: number;
  elapsedSeconds: number;
  kills: number;
  level: number;
  damageHits: number;
  damageTaken: number;
  queuedAt: string;
};

export const normalizeRankingName = (value: string) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
  .trim()
  .slice(0, 20);

export const rankingSlugForMode = (mode: GameMode) => GAME_SLUGS[mode];

export const canSubmitRankingResult = (mode: GameMode, outcome: GameOutcome, previewAutostart: boolean, enabled = RANKING_ENABLED) => (
  enabled && !previewAutostart && isRankableOutcome(mode, outcome)
);

export const createClientRunId = () => {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" ? value as Record<string, unknown> : null
);

const asFiniteNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const firstResult = (value: unknown) => Array.isArray(value) ? asRecord(value[0]) : asRecord(value);

const requestRpc = async (rpc: string, body: Record<string, unknown>) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try { data = JSON.parse(text) as unknown; }
      catch { throw new Error("ranking_invalid_json"); }
    }
    if (!response.ok) throw new Error(`ranking_http_${response.status}`);
    return data;
  } finally {
    window.clearTimeout(timeout);
  }
};

const readPending = (): PendingSubmission[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const row = asRecord(entry);
      if (!row || typeof row.playToken !== "string" || (row.mode !== "normal" && row.mode !== "endless")) return [];
      return [row as unknown as PendingSubmission];
    });
  } catch {
    return [];
  }
};

const writePending = (pending: PendingSubmission[]) => {
  try { window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending)); }
  catch { /* The current request still proceeds even when storage is unavailable. */ }
};

const queuePending = (payload: PendingSubmission) => {
  const pending = readPending().filter((entry) => entry.playToken !== payload.playToken);
  pending.push(payload);
  writePending(pending.slice(-20));
};

const removePending = (playToken: string) => {
  writePending(readPending().filter((entry) => entry.playToken !== playToken));
};

const parseSubmission = (data: unknown): RankingSubmission => {
  const result = firstResult(data);
  if (!result || result.accepted !== true) throw new Error("ranking_not_accepted");
  return {
    isNewBest: result.is_new_best === true,
    alreadySubmitted: result.already_submitted === true,
    score: Math.max(0, Math.trunc(asFiniteNumber(result.result_score))),
    bestScore: Math.max(0, Math.trunc(asFiniteNumber(result.result_best_score))),
    playCount: Math.max(0, Math.trunc(asFiniteNumber(result.result_play_count))),
    scoreBreakdown: {
      killPoints: Math.max(0, Math.trunc(asFiniteNumber(result.kill_points))),
      timePoints: Math.max(0, Math.trunc(asFiniteNumber(result.time_points))),
      levelPoints: Math.max(0, Math.trunc(asFiniteNumber(result.level_points))),
      hitPenalty: Math.max(0, Math.trunc(asFiniteNumber(result.hit_penalty))),
      damagePenalty: Math.max(0, Math.trunc(asFiniteNumber(result.damage_penalty))),
      positiveTotal: Math.max(0, Math.trunc(asFiniteNumber(result.positive_total))),
      penaltyTotal: Math.max(0, Math.trunc(asFiniteNumber(result.penalty_total))),
      total: Math.max(0, Math.trunc(asFiniteNumber(result.result_score))),
    },
  };
};

const submitPendingPayload = async (payload: PendingSubmission) => parseSubmission(await requestRpc(SUBMIT_RUN_RPC, {
  p_play_token: payload.playToken,
  p_mode: payload.mode,
  p_outcome: payload.outcome,
  p_score: payload.score,
  p_elapsed_seconds: payload.elapsedSeconds,
  p_kills: payload.kills,
  p_level: payload.level,
  p_damage_hits: payload.damageHits,
  p_damage_taken: payload.damageTaken,
  p_client_version: CLIENT_VERSION,
}));

export function useGameRanking() {
  const startRun = async (mode: GameMode, displayName: string, clientRunId: string): Promise<RankingRunSession> => {
    if (!RANKING_ENABLED) throw new Error("ranking_disabled");
    const normalizedName = normalizeRankingName(displayName);
    if (!normalizedName) throw new Error("ranking_name_required");
    const result = firstResult(await requestRpc(START_RUN_RPC, {
      p_display_name: normalizedName,
      p_mode: mode,
      p_client_run_id: clientRunId,
      p_client_version: CLIENT_VERSION,
    }));
    if (!result || typeof result.play_token !== "string") throw new Error("ranking_start_rejected");
    return {
      playToken: result.play_token,
      clientRunId,
      mode,
      displayName: normalizedName,
      playCount: Math.max(1, Math.trunc(asFiniteNumber(result.play_count, 1))),
    };
  };

  const submitRun = async (session: RankingRunSession, snapshot: GameSnapshot): Promise<RankingSubmission> => {
    if (!canSubmitRankingResult(session.mode, snapshot.outcome, false, RANKING_ENABLED)) throw new Error("ranking_outcome_not_allowed");
    const payload: PendingSubmission = {
      playToken: session.playToken,
      mode: session.mode,
      outcome: snapshot.outcome,
      score: Math.max(0, Math.trunc(asFiniteNumber(snapshot.score))),
      elapsedSeconds: Math.max(0, Math.trunc(asFiniteNumber(snapshot.seconds))),
      kills: Math.max(0, Math.trunc(asFiniteNumber(snapshot.kills))),
      level: Math.max(1, Math.trunc(asFiniteNumber(snapshot.level, 1))),
      damageHits: Math.max(0, Math.trunc(asFiniteNumber(snapshot.damageHits))),
      damageTaken: Math.max(0, Math.trunc(asFiniteNumber(snapshot.damageTaken))),
      queuedAt: new Date().toISOString(),
    };
    queuePending(payload);
    const result = await submitPendingPayload(payload);
    removePending(payload.playToken);
    return result;
  };

  const retryPendingSubmissions = async () => {
    let submitted = 0;
    let failed = 0;
    for (const payload of readPending()) {
      try {
        await submitPendingPayload(payload);
        removePending(payload.playToken);
        submitted += 1;
      } catch {
        failed += 1;
      }
    }
    return { submitted, failed };
  };

  const fetchRanking = async (mode: GameMode, limit = RANKING_LIMIT): Promise<RankingRow[]> => {
    if (!RANKING_ENABLED) return [];
    const data = await requestRpc(BEST_RANKING_RPC, {
      p_game_slug: rankingSlugForMode(mode),
      p_limit: Math.max(1, Math.min(100, Math.trunc(limit))),
    });
    if (!Array.isArray(data)) throw new Error("ranking_invalid_rows");
    return data.flatMap((value, index) => {
      const row = asRecord(value);
      if (!row) return [];
      const displayName = normalizeRankingName(String(row.display_name ?? ""));
      if (!displayName) return [];
      return [{
        rank: Math.max(1, Math.trunc(asFiniteNumber(row.rank_no, index + 1))),
        displayName,
        bestScore: Math.max(0, Math.trunc(asFiniteNumber(row.best_score))),
        playCount: Math.max(0, Math.trunc(asFiniteNumber(row.play_count))),
      }];
    });
  };

  return useMemo(() => ({ enabled: RANKING_ENABLED, startRun, submitRun, retryPendingSubmissions, fetchRanking }), []);
}
