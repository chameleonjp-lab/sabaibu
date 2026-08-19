# アーキテクチャ

## 設計方針

Neon Siege: Survivorは、**ReactがDOM UIと入力の橋渡しを担当し、Babylon.jsとプレーンTypeScriptが3D世界とゲームループを担当する**構成です。HUDへ渡す値はスナップショット契約に集約し、ゲームロジックをReactの再レンダーから切り離します。

```text
GameCanvas (React HUD / input)
        │ GameHandle commands + GameSnapshot
        ▼
scene.ts (Babylon scene / camera / lifecycle)
        ▼
GameWorld.ts (simulation / combat / progression / telemetry)
        │
        ├── arena.ts (shared obstacle geometry)
        ├── types.ts (snapshot, upgrades, attack contracts)
        └── assets.ts (external visual asset URLs)
```

## モジュール責務

| モジュール | 責務 | 変更時の注意 |
| --- | --- | --- |
| `GameCanvas.tsx` | 一度だけのBabylon初期化、HUD、アップグレード・リザルト画面、キーボード・タッチ入力、確認URL。 | Reactの状態からゲーム世界を直接操作しすぎない。`GameHandle`を通す。 |
| `scene.ts` | Babylonシーン、カメラ、光、アリーナ、リサイズ、画面比プロファイル、破棄。 | カメラ・画面比の変更は縦横スマホを必ず確認。 |
| `GameWorld.ts` | 移動、敵生成、侵入、攻撃、衝突、経験値、ドロップ、成長、ボス、統計、ゲームオーバー。 | 共有関数を優先し、個別攻撃経路へ同じ修正を複製しない。 |
| `types.ts` | UI契約、標準強化、モジュールカタログ、攻撃統計の型。 | HUDとゲーム世界の両方が依存するため、型と初期スナップショットを同時に更新。 |
| `arena.ts` | 障害物座標とプレイヤー衝突半径。 | シーン上の見た目とゲーム上の衝突を必ず同じ定数から構成。 |
| `index.css` | Amberline HUD、モバイル画面比、スワイプレール、仮想スティック。 | `pointer-events`、`touch-action`、safe area、z-indexの関係を維持。 |

## データフロー

1. `GameCanvas`が`scene.ts`を初期化し、`GameHandle`を保持します。
2. `GameWorld`はフレームごとにシミュレーションを更新し、`GameSnapshot`を生成します。
3. `GameCanvas`はスナップショットを受け取り、DOM HUD、強化選択、リザルトを描画します。
4. プレイヤー入力とUI選択は`GameHandle`の命令としてゲーム世界へ戻ります。

この境界により、攻撃統計、選択候補、体力、経験値、敵数などをReact側で安全に表示できます。

## ライフサイクルと破棄

ゲーム開始・再出撃・シーン破棄では、敵メッシュ、投射物、エフェクト、オーラ、マテリアル、パーティクル、タイマー、イベント購読を回収します。敵データだけを配列から消してメッシュを残すと、無敵の残留物や描画リークにつながるため、撃破処理はデータと描画資産を同じ所有者で破棄します。

> React 19の開発環境ではStrictModeにより副作用が二重に走る可能性があります。Babylonのエンジン・シーン初期化はrefなどで一度だけ実行し、アンマウント時に明示的に破棄してください。

## 戦闘の共有境界

攻撃ごとの違いは発生源、軌道、範囲、持続時間ですが、次の概念は共有します。

| 境界 | 共有する理由 |
| --- | --- |
| 戦闘対象判定 | 壁外侵入中の無敵が壁内へ持ち越されないようにする。 |
| 実ダメージ適用 | 要求値ではなく実際に減少したHPを戦績へ計上する。 |
| 最終撃破処理 | ドロップ、統計、メッシュ破棄、爆発条件を一度だけ実行する。 |
| 敵の実寸 | 標的選択、投射物、接触、突進で視覚サイズと判定を近づける。 |

## モバイル入力とHUDのレイヤー

フローティング移動面は画面全体の下層に置き、武器レールなどの対話HUDはその上に置きます。仮想スティックは開始したポインターだけを捕捉し、`pointerup`、`pointercancel`、lost captureで必ず方向をゼロへ戻します。武器レールは`touch-action: pan-x`を使い、移動面ではなくネイティブ横スクロールが指を受け取ります。

画面比は`scene.ts`のカメラプロファイルと、`GameCanvas`が付与するviewportクラスで共有します。CSSは縦長・標準縦・コンパクト横を分け、体力、経験値、武器レール、補助表示の密度を調整します。
