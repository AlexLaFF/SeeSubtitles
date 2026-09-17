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

「定稿」is when a line stops changing, measured from the sentence end **the arm's own service reported**.
Milliseconds.

| talk | A + hotwords | B · 16k_zh_large | A p90 | B p90 |
|---|---|---|---|---|
| 6 Sep 13:47 | 1340 | **812** | 1835 | **912** |
| 5 Sep 16:33 | 1198 | **789** | 1789 | **918** |
| 5 Sep 19:27 | 1225 | **827** | 1598 | **937** |
| 6 Sep 9:32 | **558** | 867 | 713 | **971** |

A varies by 782 ms across the four talks; B by 78. B wins p90 in all four. Both pipelines rewrite a line
three or four times before it settles, and B keeps slightly more of what the audience has already read.

### What this table cannot say yet

Treat it as recorded, not as settled. Each talk was played once, so three things arrive in one column and
cannot be told apart: the pipeline, that talk, and the one connection the arm happened to get.

- **B winning three of four talks is a coin.** As a paired sign test that is p = 0.625; even a clean sweep
  of four would be p = 0.125. The four numbers are the right shape but there are not enough of them.
- **The two arms are not timed from the same event.** Each is measured from its own service's `end_time`,
  and 实时语音翻译 and 实时语音识别 end a sentence by their own VAD. If one stamps the end of speech and the
  other the moment its silence timer fired, the arms differ by that timer before either has translated a
  word. A default `vad_silence_time` is several hundred milliseconds, which is most of the gap being
  claimed — so the table may be comparing endpointing rather than speed. `probe-ab.js` now also reports
  「自停顿」, timed from the last frame of the recording louder than the room: one event, the same for every
  arm. **Until that column exists, "B settles sooner" is not established.**
- **Nothing recorded which machine answered.** asr.cloud.tencent.com is a load balancer, so "we landed on a
  slower backend" was never testable from this run — no arm wrote down its edge. It is also a poor fit for
  what was seen: B held to 78 ms across the same four sittings while A swung 782. The two arms do reach
  different backend pools (`/asr/speech_translate` against `/asr/v2/`), so that is evidence rather than
  proof — but a lottery that only ever draws for one arm is a strange lottery, and A's own numbers line up
  with the talks, not with the clock. The likelier reading is that A's figure follows the speaking in each
  recording — pauses, sentence length, how often it revises — which is deterministic, ours to measure, and
  partly ours to tune through `vad_silence_time` and `max_speak_time`.

### What settles it

One sitting, on the machine that holds the recordings and the keys:

```sh
npm run probe:ab -- talk1.wav talk2.wav talk3.wav talk4.wav --repeat 3 --arms arms.json --out shootout
```

Twelve passes, about two hours of wall time and the same again in Tencent minutes per arm. Playing
identical audio more than once is what separates the three explanations: whatever still moves between two
passes of one recording is the run (the connection, the backend, the minute); whatever only moves between
recordings is the talk. The closing report prints both spreads per arm, the sign test over all twelve
cells, both clocks side by side, and which edge every pass landed on.

Read it in this order: if 自停顿 disagrees with 定稿, the first table was measuring VAD. If an arm's
same-audio spread is as large as its between-talk spread, the run is deciding and a pipeline cannot be
chosen on speed at all. Only if B is still ahead on 自停顿, across most of twelve cells, is it quicker.

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
