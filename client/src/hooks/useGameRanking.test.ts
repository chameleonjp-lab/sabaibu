import { afterEach, describe, expect, it, vi } from "vitest";
import { RANKING_ENABLED, RANKING_LIMIT, canSubmitRankingResult, createClientRunId, normalizeRankingName, rankingSlugForMode } from "@/hooks/useGameRanking";

describe("verified ranking contract", () => {
  it("keeps ranking disabled until server-authoritative validation is ready", () => {
    expect(RANKING_ENABLED).toBe(false);
  });

  it("requests the top ten records when ranking is enabled", () => {
    expect(RANKING_LIMIT).toBe(10);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("creates a valid one-time id even without Web Crypto", () => {
    vi.stubGlobal("crypto", undefined);
    expect(createClientRunId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("keeps Normal and Endless in separate leaderboards", () => {
    expect(rankingSlugForMode("normal")).toBe("sabaibu_normal");
    expect(rankingSlugForMode("endless")).toBe("sabaibu_endless");
  });

  it("normalizes display names before starting a server run", () => {
    expect(normalizeRankingName("  Operator　７  ")).toBe("Operator 7");
    expect(normalizeRankingName("A\u0000B\u202eC")).toBe("ABC");
    expect(normalizeRankingName("1234567890123456789012345")).toBe("12345678901234567890");
  });

  it("submits only a Normal clear or an Endless game over", () => {
    expect(canSubmitRankingResult("normal", "clear", false, true)).toBe(true);
    expect(canSubmitRankingResult("normal", "failed", false, true)).toBe(false);
    expect(canSubmitRankingResult("endless", "failed", false, true)).toBe(true);
    expect(canSubmitRankingResult("endless", "retired", false, true)).toBe(false);
    expect(canSubmitRankingResult("normal", "clear", true, true)).toBe(false);
    expect(canSubmitRankingResult("normal", "clear", false, false)).toBe(false);
  });
});
