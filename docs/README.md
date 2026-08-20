# プロジェクトドキュメント

Neon Siege: Survivorの仕様、構造、運用手順を用途別に分割した資料群です。初めて触る場合は、まずルートの[README](../README.md)を読み、目的に応じて以下の資料へ進んでください。

| 読みたい内容 | 資料 |
| --- | --- |
| 開始画面、Normal／Endless、戦闘、Dodge、成長、ボス報酬、スコア、リザルト | [GAMEPLAY_SYSTEMS.md](GAMEPLAY_SYSTEMS.md) |
| 10分NormalとEndless分離を決めたコード根拠・リスク | [GAMEPLAY_REDESIGN.md](GAMEPLAY_REDESIGN.md) |
| React、Babylon.js、ゲーム状態、ライフサイクル | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 実装変更、デバッグ、テスト、モバイル確認、PR運用 | [DEVELOPMENT_AND_VERIFICATION.md](DEVELOPMENT_AND_VERIFICATION.md) |
| 高レベル帯の数値曲線 | [../high_level_balance_report.md](../high_level_balance_report.md) |
| 音素材の出典と同期方法 | [AUDIO_CREDITS.md](AUDIO_CREDITS.md) |
| 敵変種の設計と詳細パラメータ | [../high_level_variant_report.md](../high_level_variant_report.md)、[../high_level_variant_parameters.md](../high_level_variant_parameters.md) |
| モジュール火力の比較と再調整履歴 | [../module_dps_report.md](../module_dps_report.md) |
| 過去の命中・侵入状態の不具合調査 | [../combat_debug_report.md](../combat_debug_report.md) |

> 現在の実装値は `client/src/game/rules.ts`、`client/src/game/GameWorld.ts`、`client/src/game/types.ts` を正とします。数値バランスの変更では、概要資料だけでなく、対応する数値報告書、純粋ルールテスト、確認用URLも更新してください。
