# Neon Siege: Survivor

**Amberline Cataclysm** を舞台にした、Babylon.js製の見下ろし型3Dサバイバルアクションです。プレイヤーは敵群を移動で回避しながら自動攻撃を行い、経験値を集めて武器・防御・状態異常モジュールを選択・強化します。

## 主な機能

- **3Dトップダウン戦闘**: WASDとモバイル用バーチャルスティックによる移動、敵群への自動攻撃、画面内敵密度に応じたカメラ調整。
- **成長システム**: レベルアップ時のランダム3択、1ゲーム3回のリロール、武器枠上限、各モジュールの3段階強化。
- **攻撃モジュール**: 初期武器に加え、弾道・エネルギー・重力・設置・防御・状態異常にまたがる25種のモジュールを実装。
- **設置兵器の実戦性**: デコイビーコンの周期パルス、近接地雷の強制・連鎖起爆、追従・迎撃位置へ移動するセントリーパイロンを搭載。
- **敵とボス**: Scout、Striker、Bulwarkの3種。Strikerは予告付き高速ダッシュ、Bulwarkは衝撃波・突進・砲撃に加え、低耐久時の三連包囲砲撃を使用します。
- **生存支援**: 回復アイテム、全経験値を回収するマグネット、被弾警告、ボス体力バー、Corrosion Markによる継続ダメージ・減速。

## 技術構成

| 区分 | 内容 |
|---|---|
| UI | React 19 / TypeScript / Vite / Tailwind CSS |
| 3D | Babylon.js |
| 実装構造 | ReactはHUDと入力、`client/src/game/`のフレームワーク非依存TypeScriptがゲームロジックを担当 |
| パッケージ管理 | pnpm |

## 開発手順

```bash
pnpm install
pnpm dev
```

型検査と本番ビルドは以下で実行できます。

```bash
pnpm check
pnpm build
```

## 確認用URL

| URL | 内容 |
|---|---|
| `/?demo` | 自動戦闘とモジュール群のデモ |
| `/?boss` | Bulwarkの通常行動確認 |
| `/?demo&boss` | 低耐久Bulwarkの過駆動・三連包囲砲撃確認 |
| `/?striker` | Strikerの予告付きダッシュ確認 |
| `/?modules` | レベル10以降のモジュール選択確認 |
| `/?upgrade` | 標準アップグレード選択確認 |
| `/?reroll=N` | リロール残数を消費した状態の選択画面確認 |

## プロジェクト構成

```text
client/src/game/       # GameWorld、Babylon.jsシーン、モジュール・敵の戦闘ロジック
client/src/components/ # GameCanvasとHUD
module_dps_report.md   # モジュール理論DPS比較と調整記録
PLAN.md                # 開発計画
STRUCTURE.md           # 構造と責務の整理
ASSETS.md              # 使用アセットの記録
todo.md                # 実装・検証の進捗管理
```
