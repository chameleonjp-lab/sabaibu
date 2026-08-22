import { describe, expect, it } from "vitest";
import { canSubmitRankingResult, normalizeRankingName, rankingSlugForMode } from "@/hooks/useGameRanking";

describe("shared ranking contract", () => {
  it("keeps Normal and Endless in separate leaderboards", () => {
    expect(rankingSlugForMode("normal")).toBe("sabaibu_normal");
    expect(rankingSlugForMode("endless")).toBe("sabaibu_endless");
  });

  it("normalizes display names before sending them", () => {
    expect(normalizeRankingName("  Operator　７  ")).toBe("Operator 7");
    expect(normalizeRankingName("A\u0000B\u202eC")).toBe("ABC");
  });

  it("limits names to the shared twenty-character boundary", () => {
    expect(normalizeRankingName("1234567890123456789012345")).toBe("12345678901234567890");
  });
  it("does not submit failed, retired, preview, or disabled runs", () => {
    expect(canSubmitRankingResult("clear", false, false)).toBe(false);
    expect(canSubmitRankingResult("clear", true, true)).toBe(false);
    expect(canSubmitRankingResult("failed", false, true)).toBe(false);
    expect(canSubmitRankingResult("retired", false, true)).toBe(false);
    expect(canSubmitRankingResult("clear", false, true)).toBe(true);
  });
});

