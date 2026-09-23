# Multilingual live subtitles

Choose **Multilingual (automatic)** in the desktop live pipeline selector, or **Multilingual** in the phone's
spoken-language list. Choose one subtitle language. Speakers can change languages without changing settings.
Recognition uses Alibaba `fun-asr-realtime`; rolling and final translations use Hunyuan on TokenHub, with the
previous two source lines as context. Source language is omitted from translation requests so Hunyuan detects it.
Both keys stay on the server. This mode always uses the metered relay, including for the owner's account.

Recognition automatically detects languages supported by Fun-ASR. The rapid-switch fixture below exercises English,
Mandarin, Cantonese, Japanese, Korean, French, German, Spanish, Thai and Indonesian; this is not unrestricted
recognition of every language. Subtitle targets come from Hunyuan's existing supported target list. Ordinary
Cantonese and Mandarin talks retain the existing Tencent split pipeline; Japanese uploaded files retain Fun-ASR
plus contextual DeepSeek translation.

Fun-ASR uses a 400 ms silence threshold with semantic punctuation disabled. The language hint is omitted for
automatic recognition; `auto` is not a documented Fun-ASR language hint. Tencent's hotwords and recognition tuning
do not apply; those controls are hidden for multilingual mode on desktop. Partial words appear immediately, rolling translations follow, and the
final translation settles the cue. Recognition failures reconnect with a bounded one-second audio buffer, so
long outages can lose live audio. Recording still captures the microphone independently. English subtitle
cue times follow source speech; these are not English word-level forced alignments.

## Evidence recovered on 2026-09-23

Two fixtures concatenate 70 public Google FLEURS read utterances each, with 14 languages and different speakers.
These are reading tests with language switches between turns, not spontaneous meetings or within-word switching.
They are roughly 14 minutes each; many turns exceed the originally requested 5–10 seconds.

| Translation on Gummy's recognised text | Fixture 1 English chrF | Fixture 2 English chrF |
| --- | ---: | ---: |
| Gummy built-in | 51.0 | 50.6 |
| Hunyuan, source automatically detected | 54.0 | 57.5 |

For fixture 1 Mandarin output, Gummy scored 28.1 and Hunyuan with automatic source scored 31.0. Scores are custom
reference-overlap measurements, not human accuracy percentages. Do not compare English and Mandarin scores
against each other. The translation comparison assembled recognised segments into known fixture turns; this gives
cleaner boundaries than a real live stream and does not measure the deployed rolling drafts or their latency.

On 40 Cantonese FLEURS turns, the existing Tencent + Hunyuan pipeline scored 29.1 Mandarin chrF, versus Gummy's
25.2 with Cantonese specified and 24.8 with automatic recognition. This supports keeping the existing Cantonese
route, not a claim that Tencent wins on every recording or every language. A comparable reference-scored Mandarin
study has not established a decisive winner.

Fun-ASR recognised more accurately than Gummy on these multilingual fixtures (the custom mixed character/word
error score was approximately .07–.08 versus .15–.18). The earlier assumption that its longer final sentences meant slower first captions was not supported. The new
rolling-caption comparison below replaces Gummy with Fun-ASR. Other providers were not exhaustively tested.

Sources: local FLEURS comparison artifacts (`conv1-out`, `conv2-out`, `yue40-out`) from the September 23 run;
[Google FLEURS dataset](https://huggingface.co/datasets/google/fleurs);
[Alibaba Gummy WebSocket reference](https://help.aliyun.com/zh/model-studio/real-time-websocket-api).

## Verification

`server/test/multilingual-stream.test.js` checks source detection, duplicate finals, captured-audio timing, reconnect
buffering and suppression of translations from a superseded target. `server/test/live-proxy.test.js` exercises
multilingual recognition and translation through the real relay with stand-ins, including usage accounting and
missing credentials. Desktop route tests prevent trusted accounts from sending multilingual audio to Tencent.
The iOS schema is generated from the same definitions; the phone selects the mixed relay when source is `auto`.


The earlier Gummy implementation smoke check used 45 seconds of the public FLEURS fixture (Thai, Indonesian, Italian and
Mandarin), followed by silence. It returned nine final translated cues, 31 translation calls, zero translation
failures and zero dropped audio bytes. This verifies operation, not recognition accuracy: Thai and Indonesian
still contained recognition mistakes. The fixture SHA-256 was
`8987b7487d27aa78544a164520c6d7834339717cf57f2692161c99d7071e64b5`.

## Rapid switching through the live translator — September 23, 2026

**Selected: Fun-ASR realtime, automatic source, 400 ms VAD, then Hunyuan `hy-mt2-pro` for drafts and finals,
900 ms draft interval and two preceding source lines of context.** Qwen 3.1 is a close alternative, not a
statistically established improvement; Fun-ASR has supporting results from both earlier longer fixtures too.
The implementation is prepared on the isolated development branch; this report does not mean it is deployed.

20 turns (19 unique utterances; the Korean clip repeats), 10 languages, 164.18 seconds. Complete public Google
FLEURS utterances were selected solely by duration, without speeding up or cutting speech. Start-to-start language
switches are 6.40–9.58 seconds, with 400 ms inserted silence. These are selected clips from the earlier FLEURS pool,
not an independent held-out corpus or spontaneous conversation. Three seconds of final silence flush the stream.

| Recognition + identical Hunyuan translation | Mixed error ↓ | Whole-stream CER ↓ | English chrF ↑ | Lost turns | First English draft, median | Final after clip end, median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Gummy, 400 ms | 0.162 | 11.17% | 58.97 | 2/20 | 2.98 s | 0.47 s |
| Fun-ASR, 400 ms | 0.044 | 1.41% | 63.56 | 0/20 | 2.73 s | 0.95 s |
| Fun-ASR, semantic | 0.042 | 1.32% | 63.40 | 0/20 | 2.77 s | 0.80 s |
| Qwen 3.1 streaming, 400 ms, keep dialect | 0.042 | 1.57% | 64.42 | 0/20 | 2.67 s | 0.98 s |

The Fun settings are effectively tied. The 400 ms setting retains explicit pause control and slightly higher
English reference overlap. Differences of a few hundredths of a second between Fun and Qwen are not meaningful
from one serial run; their translation service response times were approximately 0.8 seconds.

All four arms completed without dropped input, translation failures or rate-limit fallback. Recognition emitted
40/22/22/22 final segments respectively; none overlapped multiple fixture turns by more than 300 ms. Input was
paced against a monotonic clock and sent only after a microphone-sized 200 ms chunk would have been captured;
maximum pacing error stayed below 10 ms. Tests ran serially with 65-second gaps to avoid competing for TokenHub RPM.
The exact live `SplitStream` draft/final translator received natural ASR events, not reference-sized sentences.
The tests exclude desktop rendering and the microphone-to-relay network hop.

Mixed error is the prior custom mean of clipped per-turn word/character errors, not standard WER. Whole-stream
CER uses normalized characters for every language, with simplified/traditional Chinese normalized, independently
of model segmentation. English chrF is averaged per reference turn, using actual final translations assigned by
overlap only for scoring. No reference text or reference boundaries were given to either model. First draft means
first nonempty translated output associated with a turn's source start, not first *correct* translation. Final
latency is measured against the full clip end, which can contain trailing silence. These timings do not establish
word-level alignment for translated English.

Gummy turned one Thai sentence into unrelated Russian/English/Chinese fragments. Both Fun and Qwen recovered the
Thai speech. Short clauses and names remain a limitation: the Indonesian sentence about Martelly's fifth CEP was
split into fragments; Fun recognized most words but Hunyuan mistranslated the name as “hammer.” This is a best-supported
starting configuration, not a guarantee of perfect multilingual dialogue or a best-in-market claim.

### Cost estimates

At published mainland rates, Gummy recognition is about **¥0.54/hour** and Fun-ASR **¥1.188/hour**. Extrapolating
observed Hunyuan token usage adds **¥0.134/hour** for Gummy or **¥0.169/hour** for Fun: approximately **¥0.67/hour**
and **¥1.36/hour** total, before free credits, tax or discounts. Qwen's final cumulative ASR counters were 8,046
input and 428 output tokens; using those counters once (they repeat in some events) projects approximately
**¥1.25/hour including Hunyuan** on this sample. Qwen is token-billed, so its cost varies with the recording.
These are sample-based estimates, not a bill or a fixed per-hour translation tariff.

Pricing checked September 23:
[Alibaba Fun-ASR and Qwen pricing](https://help.aliyun.com/zh/model-studio/model-pricing),
[Gummy pricing](https://help.aliyun.com/zh/model-studio/real-time-speech-translation/),
[Hunyuan Pro pricing](https://cloud.tencent.com/announce/detail/2322).
[Automatic language and VAD parameters](https://help.aliyun.com/zh/model-studio/fun-asr-client-events).

### Repeating the comparison

`server/probe-multilingual-live.js INPUT.pcm OUTPUT_DIRECTORY` accepts 16 kHz mono signed 16-bit little-endian PCM.
It sends audio to Alibaba and recognized text to TokenHub and incurs API charges; run only in an isolated server
environment with the provider keys, never bundled into the desktop app. It records ASR partials/finals, actual
caption events, translation token usage, pacing drift and failures. It runs the four configurations above with
the same live translator. The rapid fixture SHA-256 is
`c5f170fbc8f543b080de954820206193571a72805022d7c9c346268f41484453`.
Aggregate metrics and the fixture's sentence IDs/timings are in `docs/multilingual-rapid-results.json`.
The underlying audio/transcripts are [Google FLEURS](https://huggingface.co/datasets/google/fleurs), CC BY 4.0;
no audio or private recordings are committed with this report.
