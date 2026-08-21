# Assets

**Art direction:** 黒曜石色の封鎖都市アリーナを斜め見下ろしで描く、産業安全グラフィックとレトロフューチャーSFを混ぜた3Dゲーム画面。環境は暗い石墨色と鈍い青緑で抑え、プレイヤーと戦術UIにのみ高視認の Siege Amber（#FFAD26）を使う。プレイヤーはアンバーの装甲を持つ整備兵、敵はティールの浮遊ドローン群、拾得物はアシッドライムの六角クリスタル、弾丸はアンバーの発光ボルト。実装はBabylon.jsの手続きメッシュ、発光素材、生成テクスチャを中心に構成する。

## 実装済みのPages対応アセット

GitHub Pagesはリポジトリ内の静的ファイルだけを配信するため、ゲーム実行に必要な軽量SVGを client/public/assets/ に同梱しています。import.meta.env.BASE_URL 経由で参照し、ローカル開発（/）とプロジェクトPages（/sabaibu/）の両方で同じコードを使います。

| 種別 | 用途 | 同梱ファイル |
|---|---|---|
| ビジュアルターゲット | 画面の構図・配色確認用の背景パターン | client/public/assets/neon-siege-visual-target.svg |
| ブランドマーク | ロゴ／HUDのシンボル | client/public/assets/neon-siege-sigil.svg |
| 床面テクスチャ | アリーナ用の継ぎ目ない舗装パターン | client/public/assets/neon-siege-floor.svg |
| 敵ドローン用テクスチャ | 敵の識別用ティール発光パネル | client/public/assets/neon-siege-drone-panel.svg |

以前の /manus-storage/... パスはWebDev環境での参考素材であり、GitHub Pagesからは参照しません。
