import { useMemo } from "react";
import type { GameMode, GameOutcome } from "@/game/types";

/**
 * The shared ChameleonJP ranking API accepts a public publishable key from the
 * browser. No service-role or secret key is ever included here.
 */
const SUPABASE_URL = "https://mlpnjgezrnhdxsxolyzj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM";
const SUBMIT_SCORE_RPC = "submit_score";
const BEST_RANKING_RPC = "get_best_score_ranking";
const REQUEST_TIMEOUT_MS = 8_000;
const RANKING_LIMIT = 5;

/**
 * Ranking is intentionally disabled until the local score contract is signed
 * off. Keeping the switch here makes accidental network writes impossible.
 */
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

export type RankingSubmission = {
  isNewBest: boolean;
  bestScore: number;
  playCount: number;
};

/** Match the shared ranking function's name limit while removing invisible controls. */
export const normalizeRankingName = (value: string) => String(value ?? "")
  .normalize("NFKC")
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
  .trim()
  .slice(0, 20);

export const rankingSlugForMode = (mode: GameMode) => GAME_SLUGS[mode];

export const canSubmitRankingResult = (outcome: GameOutcome, previewAutostart: boolean, enabled = RANKING_ENABLED) => (
  enabled && !previewAutostart && outcome === "clear"
);

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" ? value as Record<string, unknown> : null
);

const asFiniteNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const requestRpc = async (rpc: string, body: Record<string, unknown>) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        throw new Error("ranking_invalid_json");
      }
    }
    if (!response.ok) {
      throw new Error(`ranking_http_${response.status}`);
    }
    return data;
  } finally {
    window.clearTimeout(timeout);
  }
};

const firstResult = (value: unknown) => Array.isArray(value) ? asRecord(value[0]) : asRecord(value);

export function useGameRanking() {
  const submitScore = async (mode: GameMode, displayName: string, score: number): Promise<RankingSubmission> => {
    if (!RANKING_ENABLED) throw new Error("ranking_disabled");
    const normalizedName = normalizeRankingName(displayName);
    if (!normalizedName) throw new Error("ranking_name_required");
    const safeScore = Math.max(0, Math.min(100_000_000, Math.trunc(asFiniteNumber(score))));
    const result = firstResult(await requestRpc(SUBMIT_SCORE_RPC, {
      p_display_name: normalizedName,
      p_game_slug: rankingSlugForMode(mode),
      p_score: safeScore,
      p_client_version: "sabaibu-web-1.0.0-shared-ranking",
    }));
    if (!result || result.accepted !== true) throw new Error("ranking_not_accepted");
    return {
      isNewBest: result.is_new_best === true,
      bestScore: Math.max(0, Math.trunc(asFiniteNumber(result.result_best_score))),
      playCount: Math.max(0, Math.trunc(asFiniteNumber(result.result_play_count))),
    };
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

  return useMemo(() => ({ enabled: RANKING_ENABLED, submitScore, fetchRanking }), []);
}
