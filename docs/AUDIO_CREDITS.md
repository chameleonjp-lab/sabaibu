# 音素材の出典

ゲーム内の短い効果音は、合成音とCC0素材を組み合わせています。素材はゲーム本体へ同梱し、外部サイトへ再生時に接続しません。

## CC0素材

出典リポジトリ: [code4fukui/sound-cc0](https://github.com/code4fukui/sound-cc0)

このリポジトリは、音素材をCC0 1.0 Universalでパブリックドメインとして公開し、個人・商用利用が可能で、表示義務はないとREADMEで説明しています。

| 同梱ファイル | 元ファイル | 用途 | 長さ | SHA-256 |
| --- | --- | --- | ---: | --- |
| `client/public/audio/cc0-switch1.wav` | `switch1.wav` | 強化・報酬・選択音への重ね合わせ | 0.385秒 | `43bfa8dde4a8553802b826518aff7246f510037e563009166b93584be626dba2` |
| `client/public/audio/cc0-metal1.wav` | `metal1.wav` | ボス出現音への重ね合わせ | 0.481秒 | `3d1f75a723cb43f34906f9d88cbe804e0ac1f9e02ac4c79a08efa080f6fcda0c` |

今回は元ファイルを再変換せず、そのまま同梱しています。

## 音ズレを防ぐ実装

`client/src/hooks/useGameAudio.ts`で素材を`AudioContext.decodeAudioData()`へ読み込み、合成音と同じ`AudioContext.currentTime`から再生します。素材がまだ読み込み中の場合は合成音だけをその場で再生するため、素材の読み込み待ちでゲーム内の反応が遅れません。

同じ素材を通常攻撃へ大量に割り当てず、ボス出現と選択操作だけへ限定しています。これにより音の重なりと、iPhoneでのデコード負荷を抑えています。
