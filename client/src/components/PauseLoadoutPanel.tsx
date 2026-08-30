import { EVOLUTION_RECIPES } from "@/game/rules";
import { WEAPON_LIBRARY, type WeaponLibraryEntry } from "@/game/weaponCatalog";
import type {
  AttackStatus,
  EvolutionId,
  GameSnapshot,
  IconId,
  ModuleId,
  UpgradeId,
} from "@/game/types";

type PauseLoadoutPanelProps = {
  attacks: GameSnapshot["attacks"];
  weaponCount: number;
  weaponLimit: number;
  utilityCount: number;
  utilityLimit: number;
  evolvedWeapons: GameSnapshot["evolvedWeapons"];
};

type AcquiredWeapon = {
  id: UpgradeId;
  title: string;
  iconId: IconId;
  tier: number;
  detail: string;
};

type SynergyState = "complete" | "ready" | "building" | "locked";
type SynergyNodeState = "maxed" | "acquired" | "next" | "missing";

const catalogById = new Map<UpgradeId, WeaponLibraryEntry>(
  WEAPON_LIBRARY.map((entry) => [entry.id, entry] as const),
);

const EVOLUTION_EFFECTS: Record<EvolutionId, string> = {
  "vector-laser": "一直線を貫く高威力攻撃",
  "ricochet-chain": "跳弾と電撃が連鎖する攻撃",
  "gravity-mortar": "敵を集めて爆発弾で一掃",
  "mirage-pylon": "ドローンと砲台の連携射撃",
  "nova-saw": "衝撃波と回転刃の周囲攻撃",
  "mine-decoy": "おとりと地雷の連動爆発",
};

const PauseModuleIcon = ({ id, className = "" }: { id: IconId; className?: string }) => (
  <span className={"module-icon module-icon-" + id + " " + className} aria-hidden="true" />
);

const catalogIdForAttack = (attack: AttackStatus): UpgradeId => (
  attack.id === "rail" ? "pulse" : attack.id
);

const getAcquiredMap = (
  attacks: readonly AttackStatus[],
  evolvedWeapons: readonly EvolutionId[],
) => {
  const acquired = new Map<UpgradeId, AcquiredWeapon>();

  for (const attack of attacks) {
    if (!attack.active) continue;
    const id = catalogIdForAttack(attack);
    const entry = catalogById.get(id);
    acquired.set(id, {
      id,
      title: attack.label || entry?.title || id,
      iconId: attack.iconId,
      tier: attack.tier,
      detail: attack.detail,
    });
  }

  for (const evolutionId of evolvedWeapons) {
    const recipe = EVOLUTION_RECIPES.find((candidate) => candidate.id === evolutionId);
    if (!recipe) continue;
    for (const moduleId of recipe.modules) {
      const entry = catalogById.get(moduleId);
      const existing = acquired.get(moduleId);
      if (existing && existing.tier >= 3) continue;
      acquired.set(moduleId, {
        id: moduleId,
        title: entry?.title || moduleId,
        iconId: entry?.iconId || moduleId,
        tier: 3,
        detail: "進化素材として統合済み",
      });
    }
  }

  return acquired;
};

const getSynergyState = (
  recipe: (typeof EVOLUTION_RECIPES)[number],
  acquired: ReadonlyMap<UpgradeId, AcquiredWeapon>,
  evolvedWeapons: readonly EvolutionId[],
): SynergyState => {
  if (evolvedWeapons.includes(recipe.id)) return "complete";
  const left = acquired.get(recipe.modules[0]);
  const right = acquired.get(recipe.modules[1]);
  if (left && right && left.tier >= 3 && right.tier >= 3) return "ready";
  if (left || right) return "building";
  return "locked";
};

const getNodeState = (
  item: AcquiredWeapon | undefined,
  partner: AcquiredWeapon | undefined,
): SynergyNodeState => {
  if (!item) return partner ? "next" : "missing";
  return item.tier >= 3 ? "maxed" : "acquired";
};

const getTitle = (id: ModuleId) => catalogById.get(id)?.title || id;

const getSynergyProgressCopy = (
  recipe: (typeof EVOLUTION_RECIPES)[number],
  state: SynergyState,
  acquired: ReadonlyMap<UpgradeId, AcquiredWeapon>,
) => {
  if (state === "complete") return "完成済み：この相乗効果が有効です。";
  if (state === "ready") return "発動条件達成：次の強化で自動進化します。";

  const missing = recipe.modules.filter((moduleId) => !acquired.has(moduleId));
  if (missing.length === 0) {
    return "あと一歩：" + recipe.modules.map(getTitle).join(" と ") + "をそれぞれLv.3まで強化。";
  }
  if (missing.length === 1) {
    const current = recipe.modules.find((moduleId) => acquired.has(moduleId));
    return "次に必要：" + getTitle(missing[0]) + "（" + (current ? getTitle(current) : "もう一方") + "と両方Lv.3）";
  }
  return "必要：" + missing.map(getTitle).join(" / ") + "をそれぞれLv.3まで。";
};

const getNodeProgressCopy = (
  state: SynergyNodeState,
  item: AcquiredWeapon | undefined,
) => {
  if (state === "next") return "次に必要";
  if (state === "missing") return "未獲得";
  if (!item) return "未獲得";
  if (state === "maxed") return "Lv.3 / 準備完了";
  return "Lv." + Math.min(3, Math.max(1, item.tier)) + " / 獲得済み";
};

function PauseSynergyNode({
  moduleId,
  item,
  partner,
}: {
  moduleId: ModuleId;
  item: AcquiredWeapon | undefined;
  partner: AcquiredWeapon | undefined;
}) {
  const state = getNodeState(item, partner);
  const entry = catalogById.get(moduleId);

  return (
    <div className={"pause-synergy-node pause-synergy-node-" + state} data-testid={"pause-synergy-node-" + moduleId}>
      <div className="pause-synergy-node-icon">
        <PauseModuleIcon id={entry?.iconId || moduleId} />
      </div>
      <div className="pause-synergy-node-copy">
        <strong>{entry?.title || moduleId}</strong>
        <small>{getNodeProgressCopy(state, item)}</small>
      </div>
    </div>
  );
}

function PauseSynergyResult({
  recipe,
  state,
}: {
  recipe: (typeof EVOLUTION_RECIPES)[number];
  state: SynergyState;
}) {
  return (
    <div className={"pause-synergy-result pause-synergy-result-" + state} aria-label={recipe.name + " " + EVOLUTION_EFFECTS[recipe.id]}>
      <div className="pause-synergy-result-icon" aria-hidden="true">
        <PauseModuleIcon id={recipe.modules[0]} className="pause-synergy-result-glyph pause-synergy-result-glyph-a" />
        <PauseModuleIcon id={recipe.modules[1]} className="pause-synergy-result-glyph pause-synergy-result-glyph-b" />
        <span className="pause-synergy-result-star">✦</span>
      </div>
      <strong>{recipe.name}</strong>
      <small>{state === "complete" ? "有効" : state === "ready" ? "進化可能" : "進化先"}</small>
      <p>{EVOLUTION_EFFECTS[recipe.id]}</p>
    </div>
  );
}

export default function PauseLoadoutPanel({
  attacks,
  weaponCount,
  weaponLimit,
  utilityCount,
  utilityLimit,
  evolvedWeapons,
}: PauseLoadoutPanelProps) {
  const activeWeapons = attacks.filter((attack) => attack.active);
  const acquired = getAcquiredMap(attacks, evolvedWeapons);

  return (
    <>
      <section className="pause-loadout-panel" aria-labelledby="pause-loadout-title" data-testid="pause-loadout-panel">
        <header className="pause-loadout-header">
          <div>
            <span>装備状況</span>
            <h3 id="pause-loadout-title">現在の装備</h3>
          </div>
          <small>
            攻撃 {weaponCount}/{weaponLimit}　補助 {utilityCount}/{utilityLimit}
          </small>
        </header>
        {activeWeapons.length > 0 ? (
          <div className="pause-loadout-grid" data-testid="pause-loadout-list">
            {activeWeapons.map((attack) => (
              <div className="pause-loadout-item" data-testid={"pause-loadout-" + attack.id} key={attack.id}>
                <PauseModuleIcon id={attack.iconId} className="pause-loadout-icon" />
                <div>
                  <strong>{attack.label}</strong>
                  <small>Lv.{Math.max(1, attack.tier)}　//　{attack.detail}</small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="pause-loadout-empty">まだ装備を取得していません。</p>
        )}
      </section>

      <section className="pause-synergy-section" aria-labelledby="pause-synergy-title" data-testid="pause-synergy-panel">
        <header className="pause-synergy-header">
          <div>
            <span>進化ルート // 相関図</span>
            <h3 id="pause-synergy-title">相乗効果</h3>
          </div>
          <small>2つをLv.3まで</small>
        </header>
        <p className="pause-synergy-intro">アイコン同士を揃えると、強力な進化武器が自動で解放されます。</p>
        <div className="pause-synergy-legend" aria-label="相関図の見方">
          <span><i className="pause-synergy-legend-swatch is-bright" />獲得済み</span>
          <span><i className="pause-synergy-legend-swatch is-next" />次に必要</span>
          <span><i className="pause-synergy-legend-swatch is-dim" />未獲得</span>
        </div>
        <div className="pause-synergy-list">
          {EVOLUTION_RECIPES.map((recipe) => {
            const state = getSynergyState(recipe, acquired, evolvedWeapons);
            const left = acquired.get(recipe.modules[0]);
            const right = acquired.get(recipe.modules[1]);
            return (
              <article className={"pause-synergy-card pause-synergy-card-" + state} data-testid={"pause-synergy-" + recipe.id} key={recipe.id}>
                <div className="pause-synergy-path">
                  <div className="pause-synergy-components">
                    <PauseSynergyNode moduleId={recipe.modules[0]} item={left} partner={right} />
                    <PauseSynergyNode moduleId={recipe.modules[1]} item={right} partner={left} />
                  </div>
                  <div className="pause-synergy-connector" aria-hidden="true"><span>＋</span><i>→</i></div>
                  <PauseSynergyResult recipe={recipe} state={state} />
                </div>
                <p className="pause-synergy-progress">{getSynergyProgressCopy(recipe, state, acquired)}</p>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
