# Cantonese → Mandarin live comparison, 23 September 2026

The explicit Cantonese live mode remains on Tencent `16k_zh_large` + Hunyuan `hy-mt2-pro` for this release. Fun-ASR realtime recognized these read clips more accurately and cost less, but its translated text was rewritten about twice as often and settled later. Since a live audience reads the drafts, we should test presentation changes with real conversations before changing the explicit Cantonese route. This does not change the multilingual automatic mode, which uses Fun-ASR because its cross-language recognition was stronger in the separate multilingual fixture.

## Setup

Both arms received the same 40 Cantonese Google FLEURS utterances, 506.7 seconds of original speech, plus 3 seconds of closing silence. Audio was streamed at 1× speed through the app's production `SplitStream` (Tencent) and `MultilingualStream` (Fun-ASR 400 ms endpointing). Both used Hunyuan Pro for rolling and final Cantonese → Mandarin translation, two preceding source lines as context, and the same 900 ms draft interval. They ran sequentially so the shared translation account's 60 requests/minute limit could not bias one arm. Neither arm dropped audio, reconnected, hit a rate limit, or fell back to another translation model.

The input was 16 kHz mono PCM, SHA-256 `2ba46c173105b43821fd0b1ecb838ba9c8105c8c8477533f6b6fc3ef8cd333cf`. The reference IDs, wording, and timing are in `turns.json` and `refs.json`. The source dataset is [Google FLEURS](https://huggingface.co/datasets/google/fleurs), licensed CC BY 4.0. The input PCM is omitted because it can be regenerated from those public source clips. The exact event and translation-call traces are in the two compressed JSON files; they contain no API keys.

## Results

| Measure | Tencent | Fun-ASR |
|---|---:|---:|
| Mean per-turn Cantonese character error, lower is better | 10.1% | **6.2%** |
| Whole-stream character error | 9.9% | **6.7%** |
| Mandarin reference overlap (chrF-style, higher is better) | 27.6 | **29.8** |
| First translated words visible, median / 95th percentile | 3.32 / 4.55 s | **3.27 / 4.39 s** |
| Last visible change relative to turn end, median / 95th percentile | **−0.01 / 1.19 s** | 0.48 / 1.73 s |
| Non-append rewrites of visible translated text, total / median per turn | **85 / 2** | 168 / 4 |
| Characters removed or replaced during those rewrites | **439** | 1,246 |
| Turns with at least one rewrite | **34/40** | 40/40 |
| Estimated recognition + translation cost per hour | ¥4.92 | **¥1.34** |

The paired, turn-level bootstrap 95% interval for Fun minus Tencent character error is −7.1 to −1.1 percentage points. For the Mandarin reference-overlap score it is +0.02 to +4.50 points. For example, Fun preserved the end of “这肯定不公平” and “并形成共识” in two lines where Tencent dropped it; Tencent made fewer changes to the subtitles people were already reading. Neither arm lost a complete turn by the ≥80% error threshold.

The first-visible metric uses the first nonempty `targetText` event assigned to each reference turn. “Last visible change” uses the final *distinct* `targetText` value, including changes after the spoken turn ends. A rewrite counts when a new nonempty value is not an append to the preceding value for the same displayed sentence. The totals are aggregated across the same 40 turns, so Fun's fewer sentence boundaries do not artificially lower the rewrite count. Event timing is measured at pipeline emission; the browser can coalesce events in a single animation frame. Character error normalizes Unicode and converts Traditional Chinese to Simplified. Mandarin overlap is a character n-gram reference metric; alternate valid translations may score poorly, so it is directional evidence rather than a human quality score.

The recognition advantage is measured on read speech. Conversation, overlapping speakers, soft voices, code switching, and venue audio could change the ranking. These results support keeping the current Tencent Cantonese mode for stability, while making Fun-ASR a strong candidate for a later Cantonese trial with a less changeable draft policy.

To recompute: install Python `opencc`, then run `python3 score.py` and `python3 live_metrics.py` from this directory. The raw traces were produced by `server/probe-cantonese-live.js` against the server's existing credentials; the scripts here only read saved traces.
