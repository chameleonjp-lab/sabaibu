from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Game types
# ---------------------------------------------------------------------------
types_path = Path("client/src/game/types.ts")
types_text = types_path.read_text(encoding="utf-8")
types_text = replace_once(
    types_text,
    'export type BossRewardId = "repair" | "amplify" | "evolve";',
    'export type BossRewardId = "amplify" | "fortify";',
    "BossRewardId",
)
types_path.write_text(types_text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Game world
# ---------------------------------------------------------------------------
world_path = Path("client/src/game/GameWorld.ts")
world_text = world_path.read_text(encoding="utf-8")

world_text = replace_once(
    world_text,
    '  private readonly evolvedWeapons = new Set<EvolutionId>();\n  private pendingEvolution: EvolutionId | undefined;\n',
    '  private readonly evolvedWeapons = new Set<EvolutionId>();\n',
    "remove pending evolution field",
)

world_text = replace_once(
    world_text,
    '''  chooseBossReward(id: BossRewardId) {
    if (this.phase !== "bossReward") return;
    const selectedReward = this.getBossRewardOptions().find((reward) => reward.id === id);
    if (!selectedReward?.enabled) return;
    if (id === "repair") {
      this.health = Math.min(this.maxHealth, this.health + Math.max(28, Math.ceil(this.maxHealth * 0.35)));
    } else if (id === "amplify") {
      this.attackAmplifier = Math.min(1.48, this.attackAmplifier + 0.08);
    } else if (this.pendingEvolution) {
      this.activateEvolution(this.pendingEvolution);
    }
    this.pendingEvolution = undefined;
    this.activeEncounterLabel = this.mode === "normal" ? "通常侵入" : "戦線再編";
    this.encounterTimer = Math.max(this.encounterTimer, 6);
    this.phase = "playing";
    this.emitSnapshot();
  }
''',
    '''  chooseBossReward(id: BossRewardId) {
    if (this.phase !== "bossReward") return;
    const selectedReward = this.getBossRewardOptions().find((reward) => reward.id === id);
    if (!selectedReward?.enabled) return;
    if (id === "amplify") {
      this.attackAmplifier += 0.04;
    } else if (id === "fortify") {
      this.maxHealth += 5;
      this.health = Math.min(this.maxHealth, this.health + 5);
    }
    this.activeEncounterLabel = this.mode === "normal" ? "通常侵入" : "戦線再編";
    this.encounterTimer = Math.max(this.encounterTimer, 6);
    this.phase = "playing";
    this.emitSnapshot();
  }
''',
    "boss reward application",
)

world_text = replace_once(
    world_text,
    '''    if (this.isModuleId(id)) {
      this.moduleTiers[id] = Math.min(3, this.moduleTiers[id] + 1);
      this.activateModule(id);
    } else if (id === "pulse") {
''',
    '''    if (this.isModuleId(id)) {
      this.moduleTiers[id] = Math.min(3, this.moduleTiers[id] + 1);
      this.activateModule(id);
      const evolution = this.getEligibleEvolution();
      if (evolution) this.activateEvolution(evolution.id);
    } else if (id === "pulse") {
''',
    "automatic evolution after module upgrade",
)

world_text = replace_once(
    world_text,
    '    this.deathCause = null;\n    this.pendingEvolution = undefined;\n    this.activeMissionBossStage = 0;\n',
    '    this.deathCause = null;\n    this.activeMissionBossStage = 0;\n',
    "remove pending evolution reset",
)

world_text = replace_once(
    world_text,
    '    this.pendingEvolution = this.getEligibleEvolution()?.id;\n    this.phase = "bossReward";\n',
    '    this.phase = "bossReward";\n',
    "remove evolution from boss reward",
)

world_text = replace_once(
    world_text,
    '''    // These three upgrades intentionally become uncapped mastery choices after
    // their normal tiers, so an exhaustive Endless build can never softlock.
    const masteryFallback = STANDARD_UPGRADES.filter((option) => option.id === "pulse" || option.id === "relay" || option.id === "barrier")
      .filter((option) => !candidates.some((candidate) => candidate.id === option.id));
''',
    '''    // Keep three repeatable choices without reintroducing durability in Normal.
    // Endless keeps Barrier as its defensive mastery fallback.
    const masteryFallback = this.getMasteryFallbackOptions()
      .filter((option) => !candidates.some((candidate) => candidate.id === option.id));
''',
    "candidate mastery fallback",
)

world_text = replace_once(
    world_text,
    '''    if (selected.length < 3) {
      const masteryFallback = STANDARD_UPGRADES.filter((option) => (option.id === "pulse" || option.id === "relay" || option.id === "barrier") && !selected.some((picked) => picked.id === option.id));
      selected.push(...this.pickWeightedOptions(masteryFallback, 3 - selected.length));
    }
''',
    '''    if (selected.length < 3) {
      const masteryFallback = this.getMasteryFallbackOptions()
        .filter((option) => !selected.some((picked) => picked.id === option.id));
      selected.push(...this.pickWeightedOptions(masteryFallback, 3 - selected.length));
    }
''',
    "milestone mastery fallback",
)

world_text = replace_once(
    world_text,
    '''  private canOfferExistingUpgrade(option: UpgradeOption) {
''',
    '''  private getMasteryFallbackOptions() {
    return STANDARD_UPGRADES.filter((option) =>
      option.id === "pulse"
      || option.id === "relay"
      || (this.mode === "normal" ? option.id === "orbit" : option.id === "barrier"),
    );
  }

  private canOfferExistingUpgrade(option: UpgradeOption) {
''',
    "mastery fallback helper",
)

world_text = replace_once(
    world_text,
    '    if (id === "barrier") return this.barrierTier > 0 ? this.barrierTier < 4 : this.getUtilityCount() < UTILITY_SLOT_LIMIT;\n',
    '''    if (id === "barrier") {
      if (this.mode === "normal") return false;
      return this.barrierTier > 0 ? this.barrierTier < 4 : this.getUtilityCount() < UTILITY_SLOT_LIMIT;
    }
''',
    "normal barrier exclusion",
)

world_text = replace_once(
    world_text,
    '''  private getBossRewardOptions() {
    if (this.phase !== "bossReward") return [];
    const evolution = this.pendingEvolution ? EVOLUTION_RECIPES.find((recipe) => recipe.id === this.pendingEvolution) : undefined;
    return [
      { id: "repair" as const, title: "修復", description: this.health < this.maxHealth ? `耐久を${Math.max(28, Math.ceil(this.maxHealth * 0.35))}回復` : "耐久最大のまま次の戦闘へ", enabled: true },
      { id: "amplify" as const, title: "増幅", description: `全攻撃 +8%（現在の倍率 ×${this.attackAmplifier.toFixed(2)}）`, enabled: this.attackAmplifier < 1.48 },
      { id: "evolve" as const, title: "改造", description: evolution ? `${evolution.name}へ進化` : "レベル3の対応武器ペアが必要", enabled: Boolean(evolution) },
    ];
  }
''',
    '''  private getBossRewardOptions() {
    if (this.phase !== "bossReward") return [];
    return [
      {
        id: "amplify" as const,
        title: "攻撃強化",
        description: `全攻撃ダメージ +4%（×${this.attackAmplifier.toFixed(2)} → ×${(this.attackAmplifier + 0.04).toFixed(2)}）`,
        enabled: true,
      },
      {
        id: "fortify" as const,
        title: "耐久強化",
        description: `最大耐久 +5（${this.maxHealth} → ${this.maxHealth + 5}）／現在耐久も5回復`,
        enabled: true,
      },
    ];
  }
''',
    "two boss reward options",
)

world_text = replace_once(
    world_text,
    ': `${option.title} レベル3 + ${partnerOption?.title ?? partner} レベル3 → ${recipe.name}`\n',
    ': `${option.title}と${partnerOption?.title ?? partner}を両方レベル3にすると${recipe.name}へ自動進化`\n',
    "automatic evolution hint",
)

world_text = replace_once(
    world_text,
    '      synergy: partner && this.moduleTiers[partner] > 0 ? `${partnerOption?.title ?? partner}と進化可能` : undefined,\n',
    '      synergy: partner && this.moduleTiers[partner] > 0 ? `${partnerOption?.title ?? partner}と両方レベル3で自動進化` : undefined,\n',
    "automatic evolution synergy",
)

if "pendingEvolution" in world_text:
    raise SystemExit("pendingEvolution remained after patch")

world_path.write_text(world_text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Runtime regression tests
# ---------------------------------------------------------------------------
test_path = Path("client/src/game/GameWorld.runtime.test.ts")
test_text = test_path.read_text(encoding="utf-8")
test_text = test_text.replace('world.chooseBossReward("repair");', 'world.chooseBossReward("amplify");')

insert_marker = 'describe("GameWorld normal mission lifecycle", () => {'
new_tests = r'''describe("GameWorld Normal upgrade and boss reward policy", () => {
  it("removes durability upgrades from Normal while keeping Barrier in Endless", () => {
    stubWindow();
    const createWorld = (mode: "normal" | "endless") => {
      const engine = new NullEngine({ renderWidth: 390, renderHeight: 844, textureSize: 256 });
      const scene = new Scene(engine);
      const world = new GameWorld(scene, () => undefined, false, false, false, false, false, false, false, false, false, undefined, false, 0, 0, 0, 0, 0, 0, false, false, mode);
      return { engine, scene, world };
    };

    const normal = createWorld("normal");
    const endless = createWorld("endless");
    const normalRuntime = normal.world as unknown as { getUpgradeCandidatePool: () => Array<{ id: string }>; getMasteryFallbackOptions: () => Array<{ id: string }> };
    const endlessRuntime = endless.world as unknown as { getUpgradeCandidatePool: () => Array<{ id: string }>; getMasteryFallbackOptions: () => Array<{ id: string }> };

    expect(normalRuntime.getUpgradeCandidatePool().map((option) => option.id)).not.toContain("barrier");
    expect(normalRuntime.getMasteryFallbackOptions().map((option) => option.id)).toEqual(["pulse", "orbit", "relay"]);
    expect(endlessRuntime.getUpgradeCandidatePool().map((option) => option.id)).toContain("barrier");
    expect(endlessRuntime.getMasteryFallbackOptions().map((option) => option.id)).toEqual(["pulse", "relay", "barrier"]);

    normal.world.dispose();
    normal.scene.dispose();
    normal.engine.dispose();
    endless.world.dispose();
    endless.scene.dispose();
    endless.engine.dispose();
  });

  it("offers exactly attack +4% or durability +5 and applies the selected reward", () => {
    stubWindow();
    const { engine, scene, world } = createNormalWorld(() => undefined);
    const runtime = world as unknown as {
      phase: GameSnapshot["phase"];
      attackAmplifier: number;
      health: number;
      maxHealth: number;
      getBossRewardOptions: () => Array<{ id: string; enabled: boolean }>;
    };

    runtime.phase = "bossReward";
    expect(runtime.getBossRewardOptions().map((reward) => ({ id: reward.id, enabled: reward.enabled }))).toEqual([
      { id: "amplify", enabled: true },
      { id: "fortify", enabled: true },
    ]);

    world.chooseBossReward("amplify");
    expect(runtime.attackAmplifier).toBeCloseTo(1.04, 10);
    expect(runtime.phase).toBe("playing");

    runtime.phase = "bossReward";
    runtime.health = 70;
    runtime.maxHealth = 100;
    world.chooseBossReward("fortify");
    expect(runtime.maxHealth).toBe(105);
    expect(runtime.health).toBe(75);
    expect(runtime.phase).toBe("playing");

    world.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("moves paired weapon evolution out of the boss reward and applies it automatically at level 3", () => {
    stubWindow();
    const { engine, scene, world } = createNormalWorld(() => undefined);
    const runtime = world as unknown as {
      phase: GameSnapshot["phase"];
      moduleTiers: Record<string, number>;
      upgradeOptions: Array<{ id: string }>;
      evolvedWeapons: Set<string>;
    };

    runtime.phase = "upgrade";
    runtime.moduleTiers.vector = 3;
    runtime.moduleTiers.laser = 2;
    runtime.upgradeOptions = [{ id: "laser" }];
    world.chooseUpgrade("laser");

    expect(runtime.moduleTiers.laser).toBe(3);
    expect(runtime.evolvedWeapons.has("vector-laser")).toBe(true);
    expect(runtime.phase).toBe("playing");

    world.dispose();
    scene.dispose();
    engine.dispose();
  });
});

'''
test_text = replace_once(test_text, insert_marker, new_tests + insert_marker, "runtime policy tests")
test_path.write_text(test_text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Boss reward layout
# ---------------------------------------------------------------------------
css_path = Path("client/src/index.css")
css_text = css_path.read_text(encoding="utf-8")
css_text = replace_once(
    css_text,
    '.boss-reward-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }',
    '.boss-reward-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }',
    "two-column boss reward layout",
)
css_path.write_text(css_text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------
readme_path = Path("README.md")
readme = readme_path.read_text(encoding="utf-8")
readme = replace_once(
    readme,
    '装備上限は**攻撃6枠（初期Railを含む）**と**補助4枠**です。攻撃枠が埋まると新規攻撃を候補から外し、所持装備の強化を優先します。補助枠にはRelay、Barrier、Reactive、Cryo、Corrosionが入り、進化で2つの攻撃を統合すると攻撃枠が1つ空きます。',
    '装備上限は**攻撃6枠（初期Railを含む）**と**補助4枠**です。攻撃枠が埋まると新規攻撃を候補から外し、所持装備の強化を優先します。補助枠にはRelay、Reactive、Cryo、Corrosionが入り、BarrierはEndlessだけで候補になります。Normalでは通常のレベルアップから耐久上限を増やさず、耐久強化はボス報酬で選びます。進化で2つの攻撃を統合すると攻撃枠が1つ空きます。',
    "README normal barrier",
)
readme = replace_once(
    readme,
    '実装済みのTier 3進化は、Vector + Laser、Ricochet + Chain、Gravity + Mortar、Mirage + Pylon、Nova + Saw、Mine + Decoyの6組です。対応ペアを両方Tier 3へ上げると、ボス報酬の「改造」から進化できます。',
    '実装済みのTier 3進化は、Vector + Laser、Ricochet + Chain、Gravity + Mortar、Mirage + Pylon、Nova + Saw、Mine + Decoyの6組です。対応ペアを両方Tier 3へ上げた時点で自動進化し、ボス報酬の選択枠は使いません。',
    "README automatic evolution",
)
readme = replace_once(
    readme,
    'Normalでは3:00に侵入母艦、6:00に突撃指揮機、9:15に重装破城機が出現します。ボス中は通常敵を整理して新規生成を止め、最終ボス撃破で任務をクリアします。Endlessでは従来どおり5LvごとにScout、Striker、Bulwarkを基礎とする巨大ボスが出現します。',
    'Normalでは3:00に侵入母艦、6:00に突撃指揮機、9:15に重装破城機が出現します。ボス出現時も既存の通常敵を残し、新規生成だけを止めます。最終ボス撃破で任務をクリアします。Endlessでは従来どおり5LvごとにScout、Striker、Bulwarkを基礎とする巨大ボスが出現します。',
    "README boss coexistence",
)
readme = replace_once(
    readme,
    'ミッドボスとEndlessの周期ボス討伐後は`bossReward`へ移り、**修復**（最大HPの35%、最低28回復）、**増幅**（全攻撃+8%、上限あり）、条件成立時の**改造**（Tier 3ペア進化）から1つだけを選びます。全回復、最大HP増加、追加レベルアップは同時付与しません。',
    'ミッドボスとEndlessの周期ボス討伐後は`bossReward`へ移り、**攻撃強化**（全攻撃ダメージ+4%）または**耐久強化**（最大耐久+5、現在耐久も5回復）の2択から1つを選びます。',
    "README boss rewards",
)
readme = replace_once(
    readme,
    'Dodgeは4.2秒クールダウン、3.4の移動、0.28秒の無敵を持ちます。予告終了直前0.34秒に危険範囲から実際に抜ける回避、または無敵中の被弾判定でPerfect Dodgeとなり、+200点と短時間の攻撃強化を得ます。旧停止針は通常プレイでは発生せず、`?idle`デバッグだけで確認できます。',
    'Dodgeは120秒クールダウン、3.4の移動、0.28秒の無敵を持ちます。予告終了直前0.34秒に危険範囲から実際に抜ける回避、または無敵中の被弾判定でPerfect Dodgeとなり、短時間の攻撃強化を得ます。1秒間停止すると、予告後に落下針が降ります。',
    "README current dodge and idle hazard",
)
readme_path.write_text(readme, encoding="utf-8")

spec_path = Path("docs/GAMEPLAY_SYSTEMS.md")
spec = spec_path.read_text(encoding="utf-8")
spec = replace_once(
    spec,
    '| `bossReward` | ボス撃破後の修復・増幅・改造選択。 | ボス報酬コンソール。 |',
    '| `bossReward` | ボス撃破後の攻撃強化・耐久強化の2択。 | ボス報酬コンソール。 |',
    "spec boss reward state",
)
spec = replace_once(
    spec,
    '| 補助 | 4 | Relay、Barrier、Reactive、Cryo、Corrosion。 |',
    '| 補助 | 4 | Relay、Reactive、Cryo、Corrosion。BarrierはEndlessのみ。 |',
    "spec barrier mode",
)
spec = replace_once(
    spec,
    '攻撃は原則Tier 3、RelayとBarrierはTier 4を上限とします。枠が埋まると未取得の同種装備を通常候補から除外します。進化した2攻撃は1攻撃として数えるため、攻撃枠が1つ空きます。',
    '攻撃は原則Tier 3、RelayはTier 4を上限とします。BarrierはEndlessだけでTier 4まで取得でき、Normalの通常強化候補には出ません。枠が埋まると未取得の同種装備を通常候補から除外します。進化した2攻撃は1攻撃として数えるため、攻撃枠が1つ空きます。',
    "spec barrier limits",
)
spec = replace_once(
    spec,
    '次の6組は、両方をTier 3へ上げるとボス報酬の「改造」で進化できます。',
    '次の6組は、両方をTier 3へ上げた時点で自動的に進化します。ボス報酬の選択枠は使いません。',
    "spec automatic evolution intro",
)
spec = replace_once(
    spec,
    '進化は2攻撃の挙動を統合し、火力だけでなく投射物・アクター数の削減も行います。成立するTier 3ペアがない場合、ボス報酬の改造は無効表示になります。',
    '進化は2攻撃の挙動を統合し、火力だけでなく投射物・アクター数の削減も行います。条件成立時に即時適用し、ボス報酬には表示しません。',
    "spec automatic evolution behavior",
)
spec = replace_once(
    spec,
    '''| 報酬 | 実装効果 |
| --- | --- |
| 修復 | 最大HPの35%を回復。最低28。全回復や最大HP増加ではない。 |
| 増幅 | 全攻撃ダメージ+8%。累積倍率1.48で上限。 |
| 改造 | 条件を満たしたTier 3ペアを進化。成立時だけ選択可能。 |
''',
    '''| 報酬 | 実装効果 |
| --- | --- |
| 攻撃強化 | 全攻撃ダメージ+4%。ボスごとに累積。 |
| 耐久強化 | 最大耐久+5。現在耐久も5回復。 |
''',
    "spec boss reward table",
)
spec_path.write_text(spec, encoding="utf-8")

print("normal mode and boss reward patch applied")
