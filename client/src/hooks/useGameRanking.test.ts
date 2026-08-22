import { describe, expect, it } from "vitest";
import { canSubmitRankingResult, normalizeRankingName, rankingSlugForMode } from "@/hooks/useGameRanking";

describe("verified ranking contract", () => {
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
