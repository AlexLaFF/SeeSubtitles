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

## Tuning both pipelines (16 September)

Five more rounds on the same four clips, eight connections per clip, 84 connections per pipeline in all. Every
setting tried on one pipeline was tried on the other. Translation quality was scored blind: for each stretch of
speech a judge saw both tracks' Cantonese and Mandarin with the sides shuffled, and scored accuracy and readability
from 1 to 5. The judges were Claude models, not the audience, so read their scores as a consistent second opinion.

### With the same settings, A and B are one pipeline up to the translation

- With `vad_silence_time` and `max_speak_time` set explicitly, A and B end lines at the same moment 97–100% of the
  time and produce the same Mandarin for the same Cantonese 95–99% of the time. Both honour both parameters for
  Cantonese, although Tencent documents them for zh, en and zh_en only.
- A's `hunyuan-translation-lite` is TokenHub's `hy-mt2-lite` (identical output on 97% of lines). A's
  `hunyuan-translation` behaves like `hy-mt2-pro` (76% identical, against 25% with lite). The price of A does not
  depend on the model.
- At the defaults they diverge: line ends agree as little as 63% of the time, and A's own segmentation changes between
  runs of the same audio (109 lines one run, 130 the next).
- **The 9 月 6 日 9:32 talk** has few one-second pauses, so at the defaults both pipelines run lines to the cap (today A
  87 lines, B 83). The earlier run where A looked better on it was A on a different backend: see below.

### Where they still differ

| | A · 实时语音翻译 | B · split |
|---|---|---|
| a line settles, after the speaker stops (700 ms / 6 s) | 0.99 s | **0.55 s** |
| as shipped today (defaults) | 1.11 s | — |
| rewrites of text on screen ≥ 1.5 s that lose over half of it, per 100 lines | 16 | **6** |
| blackouts: audio rejected after a network stall (`6000`), 8–24 s of nothing, 2–6% of the talk lost | 7 of 84 connections | **0** |
| other connection failures | — | one `4008` (the same stall), three one-line translation errors |
| per-connection lottery | 2 connections on 10 Sept landed on a faster translator that invents more (0 of 84 tonight) | **5 of 84 connections recognised noticeably worse** from the first minute (0 of 84 for A) |
| translation it can reach | lite or standard; no context | pro, with context and folding (below) |
| source languages | 9 | 26 engines |

The blackouts are A's: after the network stalls, the socket flushes its backlog at once and 实时语音翻译 refuses more
than three seconds of audio per second. The app's translator paces its sends, so this is what a real talk on a bad
network would see. B's recognition endpoint accepted the same bursts.

B's weak point is its recognition connection. On 5 of 84 connections the text was noticeably noisier than on sibling
connections fed the same audio — wrong words throughout, and once a slide into Mandarin (食 → 吃, 嚟 → 来). A never
did this, though it shares the front-end. Nothing in the stream flags it yet; word-level confidence (`word_info`) is
the next thing to try.

### Pause and cap

Pooled over rounds, connections without errors. B's figures; A's lines are the same.

| pause / cap | lines per 10 min | median line | cut by the cap | under 1.5 s | over 30 chars | A settles | B settles | worst wait (p90) |
|---|---|---|---|---|---|---|---|---|
| default (1000 / 10) | 107 | 4.5 s | 22% | 4% | 18% | 1101 | 679 | 10.6 s |
| 1000 / 6 | 129 | 4.5 s | 41% | 7% | 4% | 1089 | 683 | 7.1 s |
| 800 / 6 | 126 | 4.7 s | 45% | 4% | 4% | 1071 | 675 | 7.2 s |
| 700 / 10 | 119 | 3.7 s | 17% | 9% | 15% | 1008 | 554 | 10.5 s |
| 700 / 7 | 132 | 3.7 s | 27% | 8% | 7% | 1006 | 566 | 8.0 s |
| **700 / 6** | 140 | 3.8 s | 34% | 10% | 4% | 994 | **553** | 7.1 s |
| 600 / 7 | 150 | 2.9 s | 19% | 14% | 4% | 1015 | 584 | 7.7 s |
| 600 / 6 | 154 | 3.0 s | 25% | 14% | 3% | 983 | 582 | 6.9 s |
| 500 / 6 | 155 | 2.9 s | 24% | 15% | 3% | 1034 | 578 | 7.0 s |

"Worst wait" is how long the first word of a line waits for its final translation. 800 ms behaves like the default.
Below 700 ms the engine starts cutting at breaths: judges preferred 700 / 6 over 600 / 7 (55 blocks to 45), with fewer
lines broken mid-phrase. A cap alone (1000 / 6) cuts 41% of lines mid-thought.

Two connections with identical explicit settings on the same audio agree on 99–100% of line ends, on both pipelines.

### Translation, on B

On identical recognised lines, judged blind, counting blocks where the two differ:

| comparison | preferred |
|---|---|
| `hy-mt2-pro` + context against `hy-mt2-lite` + context | pro, 132 to 45 (accuracy 4.44 against 4.23; mistranslations 30 against 72) |
| pro + context against pro | context, 79 to 41 |
| lite + context against lite | context, 123 to 68 (reads far better, 4.51 against 4.07; slightly less accurate) |
| short fragments folded into a neighbour, against not | folded, 61 to 37 (mid-phrase breaks 14 against 62) |
| `hy-mt2-pro` against `hy-mt2-lite` + context | pro, 135 to 94 (accuracy 4.53 against 4.41) — so context does not substitute for pro, and an all-lite B cannot reach A's standard model on words |

Context is TokenHub's `context` field with the previous two final lines; it works on streaming calls. Folding joins a
final line under six characters to the line within 600 ms of it. `hy-mt2-pro` is limited to **60 requests a minute
on this account** (HTTP 429): rolling translation alone needs about 47 a minute per talk, so pro can only take the
final translation of each line (about 15 a minute per talk). Lite handled roughly 480 a minute without a refusal.

### On identical settings, only the clock separates them

68 pairs of connections ran the same settings on the same clip in the same round.

| measure | A better | B better |
|---|---|---|
| a line settles | **0** | **68** |
| rewrites of read text, same translator on both | 1 | 57 |
| first text on screen after a line starts | 27 | 40 |
| translation, judged blind (546 blocks, same model both sides) | 53 blocks | 45 blocks |

So B is faster in every run without exception, and steadier on screen; the words themselves are a coin flip, which
follows from the two pipelines sharing a translator. Per talk the blind judge split 4–5, 42–24, 6–7 and 1–9: the one
talk A won clearly is the talk where B's connection was one of the noisy ones described above.

### Best against best

Round five ran A with `hunyuan-translation`, 700 / 6, against B with 700 / 6, lite rolling every 900 ms, the final
translation on pro with two lines of context, folding, and one retry of a failed final:

- **On healthy connections B was preferred 118 blocks to 46** over the four talks (accuracy 4.24 against 4.07,
  readability 4.22 against 4.06). On the one noisy B connection A was preferred, 43 to 35.
- B settles in 0.75 s against A's 1.07 s. The pro final rewords lite's rolling draft, so B then rewrites on-screen text
  more than A (23 per 100 lines against 17); an all-lite B with context and folding settles in 0.60 s at 16.
- Folding lengthens lines, which is where B's worst wait slips: capping a merged line at 30 characters puts the 90th
  percentile line back to 6.6 s on all four talks, the same as not folding, while still removing most fragments.
  Simulated on the recognised lines, not yet run live.
- A is ahead on two measures once B adds the pro final and folding: it rewrites read text less (17 per 100 lines
  against 23, A ahead in 6 of the 10 pairs) and its worst wait is shorter (A ahead in 5 of 10). The all-lite B beats
  A on both again.
- Pro and A's standard model are not deterministic: two identical connections gave the same Mandarin on 53–84% of
  lines, against 97–100% with lite.

Review videos for the four talks are in `~/Downloads/字幕对照/调参后` (left A, right B, both tuned).

### Round six: dropping the fold (16 September, midday)

Folding was what made B rewrite more and wait longer, so a sixth round ran A against B with the pro final and context
but **no folding**, on the same four clips, eight connections each. Everything in this table comes from that one round.

| | A tuned, standard model | B, pro + context, no folding | B, pro + context, folding capped at 30 chars | B plain lite |
|---|---|---|---|---|
| a line settles | 1148 ms | **825 ms** | 826 ms | 661 ms |
| worst wait (p90) | 7.69 s | **7.37 s** | 7.74 s | 7.20 s |
| rewrites of read text per 100 lines | 17 | 18 | 23 | 7 |
| of a rewritten line, how much survives | 55% | 44% | 46% | 60% |
| preferred, judged blind over 548 blocks | 72 blocks | **100 blocks** | — | — |

**B without folding is the configuration to build.** It settles a third of a second sooner than A, waits less, reads
better (accuracy 4.39 against 4.29, readability 4.41 against 4.31) and won all four talks. Rewrites are level with A;
A keeps a little more of a line when it does rewrite, because B's pro final replaces lite's rolling draft.

Folding still wins its own comparison on wording (61 blocks to 37) but costs five rewrites per hundred lines and
0.37 s of worst wait, and the 30-character cap did not recover either. With pro and context the fragments it used to
fix are no longer a penalty: the judges tagged lines broken mid-phrase about equally often on both sides.

### Round seven: one model, not two (16 September, afternoon)

Two-thirds of the rewrites in round six landed at the moment lite's rolling draft was replaced by pro's final
(63 of 99, against 21 of 37 when lite did both). Round seven therefore ran each pipeline on a single model.

| live setup | settles | rewrites per 100 lines | worst wait |
|---|---|---|---|
| A tuned, standard model | 1154 ms | 18 | 7.69 s |
| **B, `hy-mt2-pro` for draft and final, context 2** | **802 ms** | **8.8** | **7.34 s** |
| B, `hy-mt2-lite` with context | 631 ms | 13.1 | 7.14 s |
| B, plain `hy-mt2-lite` | 641 ms | 6.8 | 7.15 s |

**One model throughout halves the rewriting** and keeps pro's wording: 8.8 per 100 lines against A's 18, still
settling 350 ms sooner. Context on lite *raises* churn (13.1 against 6.8) because a line's draft shifts as the
previous line settles; on pro that cost is absorbed.

The model ladder, all judged blind on identical recognised lines, each with two lines of context:

| | preferred |
|---|---|
| `hy-mt2-pro` against `hy-mt2-plus` | pro, 116 blocks to 55 (accuracy 4.55 against 4.45) |
| `hy-mt2-plus` against `hy-mt2-lite` | plus, 183 to 67 (readability 4.58 against 4.14) |
| plain `hy-mt2-lite` against A's standard model, live | **A, 202 to 53** (readability 4.51 against 4.00) |

So a cheap live model is not a free swap: plain lite live is visibly worse than A. Rate limits run the other way —
pro refuses past 60 requests a minute (about one live talk at 46), while plus took 516 a minute in a burst with no
refusal. Exports already use pro: `server/lib/tokenhub.js` defaults to it, so recordings and subtitle files get the
strongest model whatever runs live.

### Recommended settings

- **Either pipeline:** send `vad_silence_time` 700 and `max_speak_time` 6 s explicitly. On A this alone cuts the
  worst wait from 11 s to 7.5 s and halves on-screen rewrites; in the app it is a change of defaults in
  `core/schema.js`, and switching A to `hunyuan-translation` costs nothing extra.
- **B:** `16k_zh_large` with the talk's hotwords; **one model for both the rolling draft and the final** — `hy-mt2-pro`
  with two lines of context while the account carries about one talk at a time, `hy-mt2-plus` if more talks must run
  at once; **no folding**; retry a failed final once; reconnect on `4008`. Recordings and exports stay on pro.

## Languages the split pipeline could offer (checked against the account, 16 September)

**Spoken (17).** Every engine that opens for us *and* is a translation source: Cantonese, Mandarin, Mandarin with
English mixed, English, Japanese, Korean, Vietnamese, Malay, Indonesian, Filipino, Thai, Portuguese, Turkish, Arabic,
Spanish, Hindi, French, German. Mandarin also has Taiwan, mainland-dialect and medical engines; English has an
education engine; 8 kHz telephony engines exist for Mandarin and English. `16k_ru` and `16k_it` are refused on this
account, so **Russian would be lost as a spoken language** (the app offers it today through 实时语音翻译).
`16k_zh_medical` and `16k_multi_lang` now open, having been refused on 10 September.

**Subtitles (36).** What `hy-mt2` accepts, in both directions: zh yue en ja ko fr de es pt it ru ar hi th vi id ms
fil tr pl nl cs he uk fa ur bn ta te mr kk mn my km bo ug. That list is a hard ceiling: 57 further codes and
spellings were refused (`语言不支持`), including Traditional Chinese, Swedish, Danish, Norwegian, Finnish, Greek,
Romanian, Hungarian and Bulgarian, and there is no auto-detect source.

Today the app offers 9 spoken languages with restricted pairs (`LIVE_PAIRS` in `core/schema.js`), so this is roughly
double the spoken languages and any of 36 subtitle languages from each.

**What could still be added, both needing an account change:**

- **混元ASR `Hy-ASR-3.0-preview`**, Tencent's 大模型 2.0 engine — Mandarin, English and 20 mainland dialects
  (Sichuanese, Shanghainese, Henan and so on) at the ¥1.00/h tier, [documented here](https://cloud.tencent.com/document/product/1093/135476).
  It is a closed beta (内测) and this account is not on it: all five spellings of the engine name return
  `4001 参数不合法`. TokenHub lists the model but serves no audio endpoint (eight paths, all 404) and refuses it for
  billing, so the only route is a ticket to Tencent. Note the beta's own limits before counting on it: **no VAD, no
  vocabulary replacement, no noise threshold, and audio only up to one minute per recognition**. Our whole
  segmentation (700 ms pause, 6 s cap) is a VAD feature, so as it stands the engine cannot drop into the live
  pipeline — it would need us to cut the audio into pieces ourselves. It is independent of the translation model:
  recognition and translation can be decided separately.
- **A general model for the languages `hy-mt2` refuses.** TokenHub carries 121 models, including DeepSeek, GLM, Kimi
  and Qwen, any of which can translate into Swedish, Greek or Traditional Chinese. Slower and untuned for subtitles,
  so a fit for exports rather than live.

Untested: every language except Cantonese into Mandarin. Right-to-left scripts (Arabic, Hebrew, Persian, Urdu) and
Thai, Burmese, Khmer, Tibetan, Uyghur and the Indic scripts need fonts the app does not bundle; the display, poster
and burned-in video each need checking per script before any of them is offered.

## The shipped pipeline, measured through the relay (16 September, evening)

Everything above was measured with `server/probe-ab.js`, which drives the services directly. This is the same
four talks streamed through what the app actually uses: a client sending 200 ms frames to
`server/lib/live-proxy.js`, which runs `core/split-stream.js` — 700 ms pause, 6 s cap, `hy-mt2-pro` with two
lines of context.

| talk | lines, probe → relay | a line settles | p90 | Cantonese heard | glossary terms heard |
|---|---|---|---|---|---|
| 13:47 | 143 → 144 | 805 → 846 ms | 924 → 953 ms | 1888 → 1902 chars | 13/36 → 13/36 |
| 16:33 | 146 → 145 | 806 → 853 ms | 955 → 965 ms | 1577 → 1583 chars | 14/28 → 14/28 |
| 19:27 | 143 → 142 | 807 → 843 ms | 940 → 958 ms | 1903 → 1908 chars | 11/23 → 11/23 |
| 9:32 | 126 → 126 | 790 → 832 ms | 944 → 977 ms | 1918 → 1911 chars | 20/32 → 21/32 |

Recognition is identical within a rounding error, and a line settles about 40 ms later than the probe measured —
the hop from the app to the relay, which the probe does not have.

**Two differences the check found were ours, and both are fixed.** Pacing the recognition socket the way
实时语音翻译 must be paced (a chunk per 200 ms tick) put 1099 ms between the speaker and a settled line instead of
846; 实时语音识别 has no three-to-one rule, so audio now goes out as it arrives. And the rolling draft was being
translated without the context the final was given, so the wording changed every time a line settled.

**One difference is real but smaller than it looks.** Counting rewrites of text that had been on screen for 1.5 s,
the relay shows about twice the probe's figure (20 against 10 per 100 lines on the 13:47 talk). The rewrites are
the same size — both keep 40% of the line — and the relay makes slightly *fewer* revisions in total (412 against
455). What differs is that the last draft sits about 300 ms longer before the final replaces it, which pushes many
lines across the 1.5 s line: at a 0.8 s threshold the two are 67 and 62. Rolling faster would close it, but at
600 ms a talk needs about 70 translations a minute, past `hy-mt2-pro`'s limit of 60.
