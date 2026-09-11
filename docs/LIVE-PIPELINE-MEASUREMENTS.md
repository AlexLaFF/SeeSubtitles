# Which live pipeline, and which engine

Measured over four different Cantonese lectures, ten minutes each, September 2026. Every arm is fed the
same audio on the same clock at speaking pace, simultaneously, so nothing gets easier input than anything
else: `npm run probe:ab -- talk.wav --arms arms.json`.

Two pipelines are compared.

- **A — 实时语音翻译.** What the app ships. One Tencent stream recognises and translates together.
- **B — split.** 实时语音识别 returns the words; we call 混元翻译 (`hy-mt2-lite`) ourselves, re-translating
  the sentence while it is still being spoken so the caption rolls rather than appearing all at once,
  with `max_speak_time` capping a line at ten seconds.

## Timing

「定稿」is when a line stops changing, measured from the moment the speaker stopped. Milliseconds.

| talk | A + hotwords | B · 16k_zh_large | A p90 | B p90 |
|---|---|---|---|---|
| 6 Sep 13:47 | 1340 | **812** | 1835 | **912** |
| 5 Sep 16:33 | 1198 | **789** | 1789 | **918** |
| 5 Sep 19:27 | 1225 | **827** | 1598 | **937** |
| 6 Sep 9:32 | **558** | 867 | 713 | **971** |

A varies by 782 ms across the four talks; B by 78. B wins p90 in all four. Both pipelines rewrite a line
three or four times before it settles, and B keeps slightly more of what the audience has already read.

## Engines

There is no reference transcript to score against, so the yardstick is the talk's own vocabulary, taken
from the AI summary the app produced for that recording: a garbled transcript does not accidentally say
巨噬细胞.

- **Use `16k_zh_large` with hotwords.** It returns verbatim Cantonese — 嘅 嚟 咩 呢啲 intact — near
  character-for-character identical to what 实时语音翻译 produces, which suggests they share a
  recognition front-end.
- **`16k_yue` ignores `hotword_list` entirely.** Its output is byte-identical with and without one, and
  it scored worst of the mainstream engines (17/43 against 42/43 on the first talk) despite being the
  Cantonese engine. The first version of this comparison used it and reached the wrong conclusion.
- **`16k_zh_en_2.0` rewrites Cantonese into Mandarin while recognising.** 佢经过胃嘅时间好快 comes back
  as 它经过胃的时间很快. Cantonese-only characters per thousand fall to 33–59, against 76–115 for the
  other two. It therefore tops a Mandarin-worded glossary while producing a source track that is no
  longer Cantonese — the exported 粤语字幕 would be wrong. The metric flatters it; do not use it.
- `16k_zh_dialect` is unusable on this audio: 63% of the characters and almost no overlap with anything.
- `16k_zh_medical` and `16k_multi_lang` do not open on this account.

`/asr/v2/` accepts and honours `hotword_list`, `max_speak_time` and `vad_silence_time`. It drops a
connection that has sent no audio for 15 seconds (`4008`), so anything delaying the first frame kills it.

## Hotwords are the bigger win

On the first talk, hotwords alone took the shipped pipeline from 33/43 to 42/43 — a larger improvement
than changing the architecture. Whatever happens to the pipeline, a per-talk glossary is worth having.

## Cost

**大模型实时语音翻译 — what the app uses live — bills at the flat list rate of ¥5.00/h**, checked against the
account's invoice, with no volume discount at our size.

实时语音识别 is sold by the hour and in packages; a 30-hour package lists at ¥3.00/h, and promotions go well
below that. So recognition costs at most ¥3.00/h against ¥5.00/h for recognition-plus-translation, which is
where the saving would come from. What remains unknown is whether a **大模型** engine such as `16k_zh_large`
draws down such a package at all or bills as its own SKU (大模型 1.0, ¥3.00–4.80/h). A daily settlement
covering a test run answers it: if a line named 大模型 appears, it does not.

The billing API cannot be used for this. `finance:*` is denied to the speech sub-user — deliberately, since
that is what limits a leaked key — so figures like these come from the console's exported invoice.
