# Multilingual live subtitles

Choose **Multilingual (automatic)** in the desktop live pipeline selector, or **Multilingual** in the phone's
spoken-language list. Choose one subtitle language. Speakers can change languages without changing settings.
Recognition uses Alibaba `gummy-realtime-v1`; rolling and final translations use Hunyuan on TokenHub, with the
previous two source lines as context. Source language is omitted from translation requests so Hunyuan detects it.
Both keys stay on the server. This mode always uses the metered relay, including for the owner's account.

Gummy recognises Mandarin, Cantonese, English, Japanese, Korean, German, French, Russian, Spanish, Italian,
Portuguese, Indonesian, Arabic and Thai. This is not unrestricted recognition of every language. Subtitle targets
come from Hunyuan's existing supported target list. Ordinary Cantonese and Mandarin talks retain the existing
Tencent split pipeline; Japanese uploaded files retain Fun-ASR plus contextual DeepSeek translation.

Gummy uses a 400 ms silence threshold. Tencent's hotwords and recognition tuning do not apply; those controls are
hidden for multilingual mode on desktop. Partial words appear immediately, rolling translations follow, and the
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
error score was approximately .07–.08 versus .15–.18). It still needs an end-to-end rolling-caption comparison;
long final sentences alone do not prove slow first captions. Gummy is the requested initial multilingual option,
not a demonstrated best-in-market recogniser. Other providers were not exhaustively tested.

Sources: local FLEURS comparison artifacts (`conv1-out`, `conv2-out`, `yue40-out`) from the September 23 run;
[Google FLEURS dataset](https://huggingface.co/datasets/google/fleurs);
[Alibaba Gummy WebSocket reference](https://help.aliyun.com/zh/model-studio/real-time-websocket-api).

## Verification

`server/test/gummy-stream.test.js` checks source detection, duplicate finals, captured-audio timing, reconnect
buffering and suppression of translations from a superseded target. `server/test/live-proxy.test.js` exercises
multilingual recognition and translation through the real relay with stand-ins, including usage accounting and
missing credentials. Desktop route tests prevent trusted accounts from sending multilingual audio to Tencent.
The iOS schema is generated from the same definitions; the phone selects the mixed relay when source is `auto`.


The isolated real-API smoke check used 45 seconds of the public FLEURS fixture (Thai, Indonesian, Italian and
Mandarin), followed by silence. It returned nine final translated cues, 31 translation calls, zero translation
failures and zero dropped audio bytes. This verifies operation, not recognition accuracy: Thai and Indonesian
still contained recognition mistakes. The fixture SHA-256 was
`8987b7487d27aa78544a164520c6d7834339717cf57f2692161c99d7071e64b5`.
