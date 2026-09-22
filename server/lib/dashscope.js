'use strict';
// 录音文件识别 on Alibaba 百炼 (DashScope): the file recogniser for the languages Tencent hears badly. Japanese
// first — on two Japanese recordings (2026-09-22, server/probe-file.js) Tencent's 16k_ja lost half the speech that
// fun-asr heard, and mangled a share of the rest. The flow is: put the audio in 百炼's temporary storage (48 h,
// bound to the model), submit an asynchronous transcription with the file's oss:// URL, poll, fetch the
// transcript. The result is reshaped into the sentence/word form Tencent returns, so cues, translation and
// exports never know which service listened.
const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://dashscope.aliyuncs.com';
const MODELS = { ja: 'fun-asr' }; // spoken language → 百炼 model; the rest stay with Tencent until compared
const isAlibaba = (engine) => /^(fun-asr|qwen)/.test(String(engine || ''));

class DashScopeError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function text(res, what) {
  const body = await res.text();
  if (!res.ok) throw new DashScopeError(`${what}: HTTP ${res.status} ${body.slice(0, 200)}`, res.status, body);
  return body;
}
async function json(res, what) {
  const body = await text(res, what);
  try { return JSON.parse(body); } catch { throw new DashScopeError(`${what}: not JSON: ${body.slice(0, 120)}`, res.status, body); }
}

/** A local file into 百炼's temporary storage; returns the oss:// URL the models read for 48 hours. */
async function upload(key, model, file, { baseUrl = BASE, fetchImpl = fetch } = {}) {
  const policy = (await json(await fetchImpl(`${baseUrl}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
    { headers: { Authorization: `Bearer ${key}` } }), 'upload policy')).data;
  const objectKey = `${policy.upload_dir}/${path.basename(file)}`;
  const form = new FormData();
  form.append('OSSAccessKeyId', policy.oss_access_key_id);
  form.append('Signature', policy.signature);
  form.append('policy', policy.policy);
  form.append('key', objectKey);
  form.append('x-oss-object-acl', policy.x_oss_object_acl);
  form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
  form.append('success_action_status', '200');
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const res = await fetchImpl(policy.upload_host, { method: 'POST', body: form });
  // 409 FileAlreadyExists: an earlier try landed and only its reply was lost — the object is there
  if (!res.ok && !(res.status === 409 && /FileAlreadyExists/.test(await res.clone().text()))) await text(res, 'upload');
  return `oss://${objectKey}`;
}

/** Submit one file for recognition; returns the task id to poll. */
async function submit(key, { model, url, lang, baseUrl = BASE, fetchImpl = fetch }) {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable' };
  const body = JSON.stringify({ model, input: { file_urls: [url] }, parameters: { ...(lang ? { language_hints: [lang] } : {}) } });
  const r = await json(await fetchImpl(`${baseUrl}/api/v1/services/audio/asr/transcription`, { method: 'POST', headers, body }), `${model} submit`);
  const taskId = r.output && r.output.task_id;
  if (!taskId) throw new DashScopeError(`${model} submit: no task id in ${JSON.stringify(r).slice(0, 200)}`, 200, r);
  return taskId;
}

/** Where the task stands: {status: 'PENDING'|'RUNNING'|'SUCCEEDED'|'FAILED'|..., sentences?: [...]} */
async function status(key, taskId, { baseUrl = BASE, fetchImpl = fetch } = {}) {
  const r = await json(await fetchImpl(`${baseUrl}/api/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` } }), 'poll');
  const out = r.output || {};
  if (out.task_status !== 'SUCCEEDED') return { status: out.task_status || 'PENDING', message: out.message || (out.results && out.results[0] && out.results[0].message) || '' };
  const first = out.results && out.results[0];
  if (!first || first.subtask_status !== 'SUCCEEDED' || !first.transcription_url) {
    throw new DashScopeError(`recognition failed: ${(first && (first.message || first.subtask_status)) || 'no result'}`, 200, out);
  }
  const t = await json(await fetchImpl(first.transcription_url), 'transcript');
  return { status: 'SUCCEEDED', sentences: (t.transcripts || []).flatMap((x) => x.sentences || []) };
}

/**
 * 百炼's sentences in the shape of Tencent 录音文件识别's ResultDetail, which buildCues reads:
 * {StartMs, EndMs, FinalSentence, Words: [{Word, OffsetStartMs, OffsetEndMs}], SpeakerId}. 百炼's words carry
 * the punctuation themselves, so FinalSentence is their join and every word is found in it.
 */
function toResultDetail(sentences) {
  return (sentences || []).map((s) => {
    const start = Number(s.begin_time) || 0;
    const words = (s.words || []).map((w) => ({ Word: String(w.text || ''), OffsetStartMs: (Number(w.begin_time) || start) - start, OffsetEndMs: (Number(w.end_time) || start) - start })).filter((w) => w.Word);
    const sentence = String(s.text || '').trim() || words.map((w) => w.Word).join('');
    return { StartMs: start, EndMs: Number(s.end_time) || start, FinalSentence: sentence, Words: words, SpeakerId: s.speaker_id ?? null };
  }).filter((s) => s.FinalSentence);
}

module.exports = { MODELS, BASE, isAlibaba, upload, submit, status, toResultDetail, DashScopeError };
