#!/usr/bin/env node
'use strict';
// Step-0 probe for the upload pipeline: prove that 录音文件识别 (CreateRecTask/DescribeTaskStatus)
// and 机器翻译 (TextTranslateBatch) accept these credentials and return sentence timestamps.
//
//   node server/probe-batch.js clip.mp3 [--engine 16k_yue] [--target zh] [--tmt-source auto] [--url https://...]
//
// With a file: uploads it inline (SourceType=1, base64, max 5 MB). With --url: SourceType=0 (up to 5 h).
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, getCredentials } = require('@subs/core');
const { asr, tmt } = require('./lib/tc3');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const file = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const engine = flag('engine', '16k_yue');
const target = flag('target', 'zh');
const tmtSource = flag('tmt-source', 'auto');
const url = flag('url');
const envFile = flag('env', path.join(__dirname, '..', '.env'));

const ms = (n) => `${String(Math.floor(n / 60000)).padStart(2, '0')}:${String(Math.floor((n % 60000) / 1000)).padStart(2, '0')}.${String(n % 1000).padStart(3, '0')}`;
const sleep = (t) => new Promise((r) => setTimeout(r, t));

async function main() {
  loadEnv(envFile);
  const creds = getCredentials();
  if (!file && !url) throw new Error('usage: probe-batch.js <audio file> | --url <https url>');

  const payload = { EngineModelType: engine, ChannelNum: 1, ResTextFormat: 1, SourceType: url ? 0 : 1 };
  if (url) payload.Url = url;
  else {
    const buf = fs.readFileSync(file);
    if (buf.length > 5 * 1024 * 1024) throw new Error('inline data is capped at 5 MB; use --url for longer audio');
    payload.Data = buf.toString('base64');
    payload.DataLen = buf.length;
    console.log(`▶ CreateRecTask engine=${engine} inline ${buf.length} bytes (${path.basename(file)})`);
  }
  const t0 = Date.now();
  const created = await asr(creds, 'CreateRecTask', payload);
  const taskId = created.Data.TaskId;
  console.log(`◀ TaskId ${taskId} (RequestId ${created.RequestId})`);

  let status;
  for (;;) {
    await sleep(3000);
    const r = await asr(creds, 'DescribeTaskStatus', { TaskId: taskId });
    status = r.Data;
    process.stdout.write(`  … ${status.StatusStr} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
    if (status.Status === 2 || status.Status === 3) break;
  }
  if (status.Status === 3) throw new Error(`recognition failed: ${status.ErrorMsg}`);
  console.log(`✔ recognised ${status.AudioDuration ?? '?'} s of audio in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const sentences = status.ResultDetail || [];
  console.log(`  ${sentences.length} sentences, ResultDetail sample:`);
  for (const s of sentences.slice(0, 8)) {
    const words = (s.Words || []).length;
    console.log(`  ${ms(s.StartMs)} → ${ms(s.EndMs)}  [${words} words${s.SpeakerId != null ? `, spk ${s.SpeakerId}` : ''}]  ${s.FinalSentence}`);
  }
  if (sentences[0]?.Words?.[0]) console.log('  first word:', JSON.stringify(sentences[0].Words[0]));
  if (!sentences.length) console.log('  Result text:', status.Result);

  const texts = sentences.slice(0, 3).map((s) => s.FinalSentence).filter(Boolean);
  if (!texts.length) { console.log('nothing to translate'); return; }
  console.log(`▶ TextTranslateBatch ${tmtSource}→${target} (${texts.length} sentences)`);
  const t1 = Date.now();
  const tr = await tmt(creds, 'TextTranslateBatch', { Source: tmtSource, Target: target, ProjectId: 0, SourceTextList: texts });
  console.log(`◀ ${tr.Source}→${tr.Target} in ${Date.now() - t1} ms`);
  tr.TargetTextList.forEach((t, i) => console.log(`  ${texts[i]}\n    ⇒ ${t}`));
  console.log('✔ PROBE OK — batch ASR with timestamps + translation both work');
}

main().catch((err) => {
  console.error('✘', err.message);
  process.exit(1);
});
