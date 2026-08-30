import { describe, expect, it } from "vitest";
import { buildShareText } from "./ShareButton";

describe("ShareButton share text", () => {
  it("adds the game URL as a plain-text line", () => {
    expect(buildShareText("【サバサバ】通常 / 生存時間 10:00 / スコア 12,345", "https://chameleonjp.github.io/sabasaba/"))
      .toBe("【サバサバ】通常 / 生存時間 10:00 / スコア 12,345\nhttps://chameleonjp.github.io/sabasaba/");
  });

  it("removes trailing whitespace before the URL", () => {
    expect(buildShareText("ゲームをシェアします。  \n", "https://example.com/game/"))
      .toBe("ゲームをシェアします。\nhttps://example.com/game/");
  });
});
