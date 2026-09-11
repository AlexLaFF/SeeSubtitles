#!/usr/bin/env node
'use strict';
// The release test: the app below its windows, end to end, with real recordings, real Tencent and real TokenHub,
// before any build ships. It starts a throwaway copy of the server (its own database, its own port, nothing shared
// with the running service), makes throwaway accounts in it, drives the app's own core against it exactly as the
// Mac app does, and checks what comes back. It runs in the image e2e/Dockerfile builds, on the server that holds
// the keys, so they never leave it (desktop/scripts/e2e-on-server.sh; `npm run e2e`).
//
//   node e2e/run.js [--fixtures /fixtures] [--only live,uploads,...]
//
// The recordings are the owner's own talks and live only on the server (~/e2e-fixtures, with manifest.json saying
// what each must contain). Exit status 0 only if every check passed. Costs about ¥0.5 of Tencent time a run.
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const { openDb } = require(path.join(ROOT, 'server/lib/db'));
const { createAuth } = require(path.join(ROOT, 'server/lib/auth'));
const totp = require(path.join(ROOT, 'server/lib/totp'));
const { createLocalServer } = require(path.join(ROOT, 'desktop/local-server'));
const { CloudLink } = require(path.join(ROOT, 'desktop/cloud'));
const { UploadQueue } = require(path.join(ROOT, 'desktop/lib/uploads'));
const { JobImporter } = require(path.join(ROOT, 'desktop/lib/import-job'));
const names = require('@subs/core/names');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const FIXTURES = flag('fixtures', '/fixtures');
const ONLY = String(flag('only', '')).split(',').filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const secs = (ms) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

function must(cond, message) { if (!cond) throw new Error(message); }
async function waitFor(what, pred, timeoutMs, stepMs = 250) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${secs(timeoutMs)} waiting for ${what}`);
    await sleep(stepMs);
  }
}

// ---------------------------------------------------------------- what "right" looks like for real speech

// Characters that exist only in Traditional Chinese. Subtitles are Simplified, always (CLAUDE.md).
const TRADITIONAL = new Set([...'們這說會為對還裡時從請讓過愛開關發國見聽麼個來後經學問題現應當樣點間聲無與將實體頭長麗萬風書車馬門東語認識讀寫買賣錢醫藥養營腦臟腸氣義導師飯雞魚鳥覺歲歡權務處態謝']);
const traditionalIn = (text) => [...String(text || '')].filter((c) => TRADITIONAL.has(c));
// Characters only written Cantonese has: proof the source line is what was said, not a Mandarin rewrite of it.
const CANTONESE = /[嘅嚟咩哋啲噉喺嘢咁佢冇乜嗰睇唔]/;
const srtCues = (text) => String(text || '').split(/\r?\n\r?\n/).map((b) => b.trim()).filter((b) => /-->/.test(b));
const ffprobe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file]).toString());

// ---------------------------------------------------------------- the keys must never come back out

const SECRETS = ['TENCENT_SECRET_KEY', 'TOKENHUB_API_KEY'].map((k) => String(process.env[k] || '').trim()).filter((v) => v.length >= 16);
const bodies = []; // every JSON / text response this run received, scanned for the keys at the end
const realFetch = globalThis.fetch;
globalThis.fetch = async (...a) => {
  const res = await realFetch(...a);
  const type = res.headers.get('content-type') || '';
  if (/json|text\/(plain|html)/.test(type) && bodies.length < 5000) res.clone().text().then((t) => bodies.push(t), () => {});
  return res;
};
async function http(url, { method = 'GET', token, body, cookie } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

// ---------------------------------------------------------------- results

const results = [];
async function check(name, fn) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) return;
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail: detail || '' });
    console.log(`  ✔ ${name} (${secs(Date.now() - t0)})${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: err.message });
    console.log(`  ✖ ${name} (${secs(Date.now() - t0)}) — ${err.message}`);
  }
}

// ---------------------------------------------------------------- a throwaway copy of the server

const ACCOUNTS = {
  owner: { email: 'owner@e2e.local', password: 'owner-password-e2e', role: 'admin' },
  member: { email: 'member@e2e.local', password: 'member-password-e2e', plan: 'business' },
  hobbyist: { email: 'hobbyist@e2e.local', password: 'hobbyist-password-e2e', plan: 'hobbyist' },
  boss: { email: 'boss@e2e.local', password: 'boss-password-e2e', plan: 'enterprise' },
  teammate: { email: 'teammate@e2e.local', password: 'teammate-password-e2e', plan: 'hobbyist' },
};

async function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-server-'));
  const db = openDb(root);
  const auth = createAuth(db);
  for (const a of Object.values(ACCOUNTS)) {
    auth.addUser(a.email, a.password);
    if (a.role) auth.setRole(a.email, a.role);
    if (a.plan) db.run('UPDATE users SET plan = ? WHERE email = ?', a.plan, a.email);
  }
  db.close();
  // an update feed with a build newer than anything real, which the version endpoint must report
  const updates = path.join(root, 'updates');
  fs.mkdirSync(updates, { recursive: true });
  for (const f of ['See Subtitles-9.9.9-arm64.dmg', 'See Subtitles-9.9.9-arm64-mac.zip']) fs.writeFileSync(path.join(updates, f), 'e2e');
  fs.writeFileSync(path.join(updates, 'latest-mac.yml'), [
    'version: 9.9.9', 'files:', '  - url: See Subtitles-9.9.9-arm64-mac.zip', '    sha512: e2e', '    size: 3',
    '  - url: See Subtitles-9.9.9-arm64.dmg', '    sha512: e2e', '    size: 3', 'path: See Subtitles-9.9.9-arm64-mac.zip', 'sha512: e2e',
    "releaseDate: '2026-01-01T00:00:00.000Z'", ''].join('\n'));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: root, BASE_URL: base, SIGNUP_MODE: 'closed', REQUEST_WEBHOOK_URL: '' };
  const proc = spawn(process.execPath, [path.join(ROOT, 'server/server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  await waitFor('the server copy to answer', async () => { try { return (await realFetch(`${base}/healthz`)).ok; } catch { return false; } }, 30_000);
  return { base, port, root, proc, log: () => log };
}

// ---------------------------------------------------------------- the app, as the Mac runs it

/** One app instance for one account, fed one recording in place of the microphone. */
async function openApp(server, who, token, clipFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-app-${who}-`));
  const rec = path.join(dir, 'recordings');
  fs.mkdirSync(rec, { recursive: true });
  const cloud = new CloudLink({ log: () => {} });
  cloud.cfg = { url: server.base, email: ACCOUNTS[who].email, token };
  const logs = [];
  const reported = [];
  const core = await createLocalServer({
    webDir: path.join(ROOT, 'web'), schemaFile: require.resolve('@subs/core/schema'),
    dataDir: path.join(dir, 'data'), recordingsDir: rec, transcriptsDir: path.join(dir, 'transcripts'),
    audioFile: clipFile, token: 'e2e', consoleLog: (level, text) => logs.push(`${level} ${text}`),
    // the app's MP4 renderer draws with a macOS-only helper, so it runs on the Mac (e2e/mac.js), not here
    env: { MP4_AUTO: '0', START_PAUSED: '1', SUMMARY_LANGUAGE: 'zh', SUMMARY_EFFORT: 'low' },
    cloudLive: { url: server.base, token },
    liveUrls: (req) => cloud.liveUrls(req),
    trusted: () => (cloud.plan && cloud.plan.limits ? !!cloud.plan.limits.directLive : null),
    onLiveUsage: (s) => { reported.push(s); return cloud.reportLive(s); },
    cloudStatus: () => cloud.status(),
    summary: { apiKey: 'sent-as-bearer', baseURL: `${server.base}/api/desktop/tokenhub`, headers: { authorization: `Bearer ${token}` }, model: 'deepseek-v4-flash' },
    pdfRenderer: async () => ({ bytes: 0 }), // printing needs Electron: the PDF is on the window checklist
  });
  core.emitter.on('event', (ev, data) => cloud.onEvent(ev, data)); // exactly as desktop/main.js wires it
  cloud.attach(core, cloud.cfg);
  cloud.onPlan = () => core.recheckRoute();
  await cloud.refreshPlan();
  return { who, dir, rec, core, cloud, logs, reported, token, close: async () => { cloud.detach(); await core.shutdown(); } };
}

/** A shared screen: subscribes to a session the way the display page does and keeps what arrives. */
function watchScreen(url) {
  const got = [];
  const ctl = new AbortController();
  const done = (async () => {
    const res = await realFetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`screen stream: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = (block.match(/^data: (.*)$/m) || [])[1];
        if (data) got.push(data);
      }
    }
  })().catch((e) => { if (e.name !== 'AbortError') got.error = e.message; });
  return { got, stop: async () => { ctl.abort(); await done; return got; } };
}

/** Play one recording through the app as a live talk; optionally record it and share it to a screen. */
async function talk(server, app, clip, { record = true, share = false } = {}) {
  const lines = new Map();
  app.core.emitter.on('event', (ev, d) => { if (ev === 'line' && d && d.id) lines.set(d.id, d); });
  let screen = null;
  if (share) {
    await app.cloud.startSession(`e2e ${clip.key}`);
    screen = watchScreen(`${server.base}/api/d/${app.cloud.session.code}/stream`);
  }
  app.core.applySettings({ source: clip.source, target: clip.target, hotwords: clip.hotwords || '' }, null);
  app.core.applySettings({ streaming: true }, null);
  const t0 = Date.now();
  await waitFor('the live stream to be ready', () => app.core.status().stream.state === 'ready', 30_000);
  const st = app.core.status().stream;
  if (record) app.core.startRecording(`e2e-${clip.key}`);
  await sleep(clip.seconds * 1000 + 6000); // the file loops, so this plays every part of it at least once
  let recording = null;
  if (record) {
    const stopped = new Promise((r) => app.core.emitter.once('recording', r));
    app.core.stopRecording();
    recording = await stopped;
  }
  app.core.applySettings({ streaming: false }, null);
  const streamedMs = Date.now() - t0;
  await sleep(3000); // the relay closes the talk and charges its last seconds
  let shared = null;
  if (share) { shared = await screen.stop(); await app.cloud.stopSession(); }
  const final = [...lines.values()].filter((l) => l.ended && (l.sourceText || l.targetText));
  return { route: st.route, keyless: st.keyless, lines: final, recording, shared, streamedMs, code: share ? app.cloud.session && app.cloud.session.code : null };
}

/** A WebSocket onto the relay, answered with its first message — enough to see who is let on and who is not. */
function relayAnswer(server, token, query = 'source=yue&target=zh') {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/desktop/live?${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const done = (r) => { try { ws.terminate(); } catch { /* gone */ } resolve(r); };
    ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.type === 'ready' || m.type === 'error') done(m.type === 'error' ? `error:${m.code}` : 'ready'); } catch { /* not ours */ } });
    ws.on('unexpected-response', (_q, res) => done(`HTTP ${res.statusCode}`));
    ws.on('error', () => done('error'));
    setTimeout(() => done('timeout'), 10_000);
  });
}

// ---------------------------------------------------------------- the run

async function main() {
  const started = Date.now();
  must(SECRETS.length === 2, 'TENCENT_SECRET_KEY and TOKENHUB_API_KEY must be in the environment (the server\'s deploy/.env)');
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8'));
  const clips = Object.fromEntries(Object.entries(manifest.clips).map(([key, c]) => [key, { ...c, key, path: path.join(FIXTURES, c.file) }]));
  for (const c of Object.values(clips)) must(fs.existsSync(c.path), `missing recording ${c.file} in ${FIXTURES}`);

  console.log(`\nSee Subtitles release test — ${new Date().toISOString()}`);
  const server = await startServer();
  console.log(`  a throwaway server is answering on ${server.base}\n`);
  const tokens = {};
  const apps = [];
  let memberTalk = null;
  let ownerTalk = null;
  let job = null;

  try {
    // ---- accounts ------------------------------------------------------------------------------------------------
    await check('accounts: every account logs in, and a wrong password does not', async () => {
      for (const [who, a] of Object.entries(ACCOUNTS)) {
        const r = await http(`${server.base}/api/login`, { method: 'POST', body: { email: a.email, password: a.password, kind: 'bearer', label: 'e2e' } });
        must(r.status === 200 && r.json && r.json.token, `${who} could not log in (HTTP ${r.status})`);
        tokens[who] = r.json.token;
      }
      const bad = await http(`${server.base}/api/login`, { method: 'POST', body: { email: ACCOUNTS.member.email, password: 'not-the-password', kind: 'bearer' } });
      must(bad.status >= 400 && !(bad.json && bad.json.token), 'a wrong password was accepted');
      const me = await http(`${server.base}/api/me`, { token: tokens.member });
      must(me.json && me.json.plan && me.json.plan.plan === 'business', 'the member account does not report its Business plan');
      must((await http(`${server.base}/api/me`, { token: 'not-a-token' })).status === 401, 'a made-up token was accepted');
      return `${Object.keys(ACCOUNTS).length} accounts`;
    });

    await check('accounts: two-factor sign-in turns on, is demanded, and turns off', async () => {
      const t = tokens.teammate;
      const begin = await http(`${server.base}/api/account/totp/begin`, { method: 'POST', token: t });
      must(begin.json && begin.json.secret, 'no secret was offered');
      const confirm = await http(`${server.base}/api/account/totp/confirm`, { method: 'POST', token: t, body: { code: totp.codeFor(begin.json.secret) } });
      must(confirm.json && Array.isArray(confirm.json.codes) && confirm.json.codes.length >= 8, 'confirming did not return recovery codes');
      const a = ACCOUNTS.teammate;
      const without = await http(`${server.base}/api/login`, { method: 'POST', body: { email: a.email, password: a.password, kind: 'bearer' } });
      must(without.json && without.json.code === 'totp_required', 'sign-in without a code was not refused');
      const next = totp.codeFor(begin.json.secret, Math.floor(Date.now() / 1000 / totp.STEP_SECONDS) + 1);
      const withCode = await http(`${server.base}/api/login`, { method: 'POST', body: { email: a.email, password: a.password, code: next, kind: 'bearer' } });
      must(withCode.status === 200 && withCode.json.token, 'sign-in with a valid code failed');
      const off = await http(`${server.base}/api/account/totp/disable`, { method: 'POST', token: t, body: { password: a.password } });
      must(off.status === 200, 'two-factor could not be turned off');
      const again = await http(`${server.base}/api/login`, { method: 'POST', body: { email: a.email, password: a.password, kind: 'bearer' } });
      must(again.status === 200 && again.json.token, 'sign-in after turning it off still asks for a code');
    });

    await check('plans: what a Hobbyist plan may not do, it cannot do', async () => {
      const t = tokens.hobbyist;
      const share = await http(`${server.base}/api/sessions`, { method: 'POST', token: t, body: { name: 'e2e' } });
      must(share.status === 403 && share.json.code === 'plan_sharing', `sharing to screens was not refused (HTTP ${share.status})`);
      const sum = await http(`${server.base}/api/desktop/tokenhub/v1/messages`, { method: 'POST', token: t, body: { model: 'deepseek-v4-flash', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] } });
      must(sum.status === 403 && sum.json.code === 'plan_summaries', `AI summaries were not refused (HTTP ${sum.status})`);
      const signed = await http(`${server.base}/api/desktop/live-url`, { method: 'POST', token: t, body: { source: 'yue', target: 'zh' } });
      must(signed.status === 403 && signed.json.code === 'not_trusted', 'a Hobbyist account was signed a direct connection');
      for (let i = 0; i < 10; i++) await http(`${server.base}/api/usage/live`, { method: 'POST', token: t, body: { seconds: 3600 } });
      must((await relayAnswer(server, t)) === 'error:plan_quota', 'the relay let a spent plan start a talk');
    });

    await check('languages: the server lists them and refuses a pair Tencent does not serve', async () => {
      const l = await http(`${server.base}/api/languages`, { token: tokens.member });
      must(l.json && l.json.sources && l.json.sources.yue && l.json.targets && l.json.targets.zh, 'Cantonese → Mandarin is missing from /api/languages');
      must((await relayAnswer(server, tokens.member, 'source=ru&target=ja')) === 'error:bad_language', 'the relay accepted ru → ja');
    });

    await check('updates: the server reports the newest build', async () => {
      const v = await http(`${server.base}/api/desktop/version`);
      must(v.json && v.json.version === '9.9.9' && /\.dmg$/.test(v.json.dmg || '') && /\.zip$/.test(v.json.zip || ''), `wrong answer: ${v.text.slice(0, 120)}`);
    });

    await check('requests: someone asks for an account and the owner sees it', async () => {
      const r = await http(`${server.base}/api/request-account`, { method: 'POST', body: { name: 'E2E Visitor', email: 'visitor@e2e.local', org: 'E2E', note: 'release test', plan: 'business' } });
      must(r.status === 200 && r.json.id, 'the request was not accepted');
      const pending = await http(`${server.base}/api/requests/pending`, { token: tokens.owner });
      must(pending.text.includes('visitor@e2e.local'), 'the owner does not see the request');
      must((await http(`${server.base}/api/requests/pending`, { token: tokens.member })).status === 403, 'an ordinary account can read requests');
    });

    await check('teams: an Enterprise owner adds a member, who sets a password from the link and shares the plan', async () => {
      const email = 'newhire@e2e.local';
      const add = await http(`${server.base}/api/org/members`, { method: 'POST', token: tokens.boss, body: { email } });
      must(add.status === 200 && add.json && add.json.member && add.json.member.email === email, `adding a member failed: ${add.text.slice(0, 120)}`);
      // a new member has no password yet: they set one from the reset link the owner is handed
      const link = add.json.reset && typeof add.json.reset === 'object' ? (add.json.reset.token || add.json.reset.url) : add.json.reset;
      const resetToken = String(link || '').split('/').pop().split('=').pop();
      must(resetToken, 'no reset link came back for the new member');
      const info = await http(`${server.base}/api/reset/${resetToken}`);
      // the reset page shows the address masked (n•••@e2e.local), so whoever holds a link does not learn whose it is
      must(info.status === 200 && info.json.ok && /^n\S*•\S*@e2e\.local$/.test(info.json.email || ''), `the reset link does not work: ${info.text.slice(0, 120)}`);
      must(info.json.email !== email, 'the reset page shows the full address to whoever has the link');
      const set = await http(`${server.base}/api/reset`, { method: 'POST', body: { token: resetToken, password: 'newhire-password-e2e' } });
      must(set.status === 200, `setting a password failed: ${set.text.slice(0, 120)}`);
      const login = await http(`${server.base}/api/login`, { method: 'POST', body: { email, password: 'newhire-password-e2e', kind: 'bearer' } });
      must(login.status === 200 && login.json.token, 'the new member cannot sign in with the password they set');
      const me = await http(`${server.base}/api/me`, { token: login.json.token });
      must(me.json && me.json.plan && me.json.plan.plan === 'enterprise', `the member is on ${me.json && me.json.plan && me.json.plan.plan}, not the team's plan`);
      const view = await http(`${server.base}/api/org`, { token: tokens.boss });
      must(view.text.includes(email), 'the member is not listed in the team');
      const existing = await http(`${server.base}/api/org/members`, { method: 'POST', token: tokens.boss, body: { email: ACCOUNTS.member.email } });
      must(existing.status >= 400, 'an address that already has an account was added to the team');
      return 'added, password set from the link, on the Enterprise plan';
    });

    // ---- the slow ones, side by side: an upload, and two live talks by the two routes -------------------------------
    const member = await openApp(server, 'member', tokens.member, clips.baseline.path);
    const owner = await openApp(server, 'owner', tokens.owner, clips.glossary.path);
    apps.push(member, owner);
    const uploads = new UploadQueue({ cloud: member.cloud, log: () => {} });

    await Promise.all([
      check('uploads: a recording uploaded from the app comes back as subtitles', async () => {
        uploads.add({ file: clips.upload.path, sourceLang: clips.upload.source, targetLang: clips.upload.target });
        const id = await waitFor('the upload to finish', () => uploads.last && (uploads.last.ok ? uploads.last.jobId : Promise.reject(new Error(uploads.last.error))), 120_000);
        job = await waitFor('the job to be subtitled', async () => {
          const j = await member.cloud.getJob(id);
          if (j.status === 'failed') throw new Error(`the job failed: ${j.error}`);
          return j.status === 'done' ? j : null;
        }, 15 * 60_000, 3000);
        const srt = job.files.find((f) => f.endsWith(`.${clips.upload.target}.srt`));
        must(srt, `no ${clips.upload.target} subtitles among ${job.files.join(', ')}`);
        const dest = path.join(member.dir, srt);
        await member.cloud.downloadJobFile(job.id, srt, dest);
        const cues = srtCues(fs.readFileSync(dest, 'utf8'));
        must(cues.length >= clips.upload.minCues, `only ${cues.length} subtitles for ${clips.upload.seconds} s of speech`);
        const trad = traditionalIn(cues.join(''));
        must(!trad.length, `Traditional characters in the subtitles: ${trad.slice(0, 8).join('')}`);
        const me = await http(`${server.base}/api/me`, { token: tokens.member });
        const charged = me.json.plan.used.fileSeconds;
        must(Math.abs(charged - clips.upload.seconds) <= 5, `charged ${charged} s of file time for ${clips.upload.seconds} s`);
        return `${cues.length} subtitles, ${charged} s charged`;
      }),
      check('live: an ordinary account goes through the server, is counted, and is seen on a shared screen', async () => {
        memberTalk = await talk(server, member, clips.baseline, { record: true, share: true });
        const t = memberTalk;
        must(t.route === 'viaServer', `it went ${t.route}`);
        must(t.lines.length >= clips.baseline.minLines, `only ${t.lines.length} subtitles for ${clips.baseline.seconds} s of speech`);
        const trad = traditionalIn(t.lines.map((l) => l.targetText).join(''));
        must(!trad.length, `Traditional characters in the subtitles: ${trad.slice(0, 8).join('')}`);
        must(t.lines.some((l) => CANTONESE.test(l.sourceText)), 'the source lines are not Cantonese');
        const me = await http(`${server.base}/api/me`, { token: tokens.member });
        const charged = me.json.plan.used.liveSeconds;
        const streamed = Math.round(t.streamedMs / 1000);
        must(Math.abs(charged - streamed) <= 4, `the server charged ${charged} s for ${streamed} s of streaming`);
        must(!member.reported.length, `the app reported ${member.reported.reduce((a, b) => a + b, 0)} s itself as well — every hour would be charged twice`);
        must(!t.shared.error, `the screen: ${t.shared.error}`);
        const seen = t.lines.filter((l) => l.targetText && t.shared.some((d) => d.includes(l.targetText))).length;
        must(seen >= Math.ceil(t.lines.length / 2), `the shared screen saw ${seen} of ${t.lines.length} subtitles`);
        return `${t.lines.length} subtitles, ${charged} s charged for ${streamed} s, screen saw ${seen}`;
      }),
      check('live: the owner goes straight to Tencent, holds no key, and the glossary is heard', async () => {
        ownerTalk = await talk(server, owner, clips.glossary, { record: true });
        const t = ownerTalk;
        must(t.route === 'direct', `it went ${t.route}`);
        must(t.keyless === true, 'the direct stream holds a key');
        must(t.lines.length >= clips.glossary.minLines, `only ${t.lines.length} subtitles for ${clips.glossary.seconds} s of speech`);
        const heard = t.lines.map((l) => l.sourceText).join('');
        const missing = clips.glossary.mustHear.filter((w) => !heard.includes(w));
        must(!missing.length, `the glossary terms were not heard: ${missing.join(', ')}`);
        const trad = traditionalIn(t.lines.map((l) => l.targetText).join(''));
        must(!trad.length, `Traditional characters in the subtitles: ${trad.slice(0, 8).join('')}`);
        return `${t.lines.length} subtitles, heard ${clips.glossary.mustHear.join(' and ')}`;
      }),
    ]);

    // ---- what a talk leaves behind -------------------------------------------------------------------------------
    for (const [who, app, t, clip] of [['member', member, memberTalk, clips.baseline], ['owner', owner, ownerTalk, clips.glossary]]) {
      await check(`recording: the ${who}'s talk is saved as audio, subtitles in both languages, and a manifest`, async () => {
        must(t && t.recording, 'no recording was made');
        const base = t.recording.base;
        const mp3 = path.join(app.rec, names.fileName(base, 'mp3'));
        must(fs.existsSync(mp3), `no ${path.basename(mp3)}`);
        const dur = Number(ffprobe(mp3).format.duration);
        must(Math.abs(dur * 1000 - t.recording.durationMs) < 3000, `the MP3 is ${dur.toFixed(1)} s for a ${secs(t.recording.durationMs)} recording`);
        const counts = {};
        for (const lang of [clip.source, clip.target]) {
          const srt = path.join(app.rec, names.srtName(base, lang));
          must(fs.existsSync(srt), `no ${path.basename(srt)}`);
          counts[lang] = srtCues(fs.readFileSync(srt, 'utf8')).length;
          must(counts[lang] >= Math.max(2, clip.minLines - 3), `${path.basename(srt)} has ${counts[lang]} subtitles`);
          must(fs.existsSync(srt.replace(/\.srt$/, '.plain.txt')), `no plain-text copy of ${path.basename(srt)}`);
        }
        const man = JSON.parse(fs.readFileSync(path.join(app.rec, names.fileName(base, 'manifest')), 'utf8'));
        must(man.source === clip.source && man.target === clip.target, `the manifest says ${man.source} → ${man.target}`);
        return `${dur.toFixed(0)} s of audio, ${counts[clip.source]} + ${counts[clip.target]} subtitles`;
      });
    }

    // The app burns subtitles into its MP4 with a native macOS renderer, which this Linux image cannot run: hand the
    // recording back, and e2e/mac.js renders it on the Mac exactly as the app does.
    const OUT = flag('out', '');
    if (OUT && memberTalk && memberTalk.recording) {
      const base = memberTalk.recording.base;
      for (const f of fs.readdirSync(member.rec).filter((n) => n.startsWith(base))) {
        fs.copyFileSync(path.join(member.rec, f), path.join(OUT, f));
        fs.chmodSync(path.join(OUT, f), 0o666);
      }
    }

    await check('summary: an AI summary of the talk comes back through the server', async () => {
      must(memberTalk && memberTalk.recording, 'no recording to summarise');
      const base = memberTalk.recording.base;
      const r = await http(`${member.core.base}/api/recordings/summary`, { method: 'POST', cookie: 'token=e2e', body: { base } });
      must(r.status === 200, `the app refused: ${r.text.slice(0, 160)}`);
      const md = path.join(member.rec, names.fileName(base, 'summary'));
      await waitFor('the summary', () => fs.existsSync(md) || member.logs.find((l) => /^error summary/.test(l)), 5 * 60_000, 1000);
      const err = member.logs.find((l) => /^error summary/.test(l));
      must(!err, err);
      const text = fs.readFileSync(md, 'utf8');
      must(text.length > 200 && /^#/m.test(text), `the summary is ${text.length} characters with no heading`);
      const trad = traditionalIn(text);
      must(!trad.length, `Traditional characters in the summary: ${trad.slice(0, 8).join('')}`);
      return `${text.length} characters`;
    });

    await check('import: a finished upload becomes a recording on the Mac', async () => {
      must(job, 'no finished upload to import');
      let map = {};
      const importer = new JobImporter({ cloud: member.cloud, dir: () => member.rec, getMap: () => map, setMap: (m) => { map = m; }, log: () => {} });
      importer.annotate([job]);
      const base = await waitFor('the import', () => map[job.id], 120_000, 500);
      for (const f of [names.fileName(base, 'mp3'), names.fileName(base, 'manifest'), names.srtName(base, job.target_lang)]) {
        must(fs.existsSync(path.join(member.rec, f)), `the import has no ${f}`);
      }
      return base;
    });

    await check('mp4: the server burns the subtitles into a video for an uploaded file', async () => {
      must(job, 'no finished upload to render');
      const r = await http(`${server.base}/api/jobs/${job.id}/mp4`, { method: 'POST', token: tokens.member, body: { which: 'trans' } });
      must(r.status === 200, `the server refused: ${r.text.slice(0, 160)}`);
      // The render only shows as running once the server has measured the audio, a moment after it answers, so "no
      // render and no video" means failure once it has had time to start — or as soon as the server logs why not.
      const askedAt = Date.now();
      let started = false;
      const name = await waitFor('the render', async () => {
        const j = await member.cloud.getJob(job.id);
        const mp4 = (j.files || []).find((f) => f.endsWith('.mp4'));
        if (j.render) started = true;
        if (mp4 && !j.render) return mp4;
        const why = server.log().split('\n').reverse().find((l) => l.includes(`job ${job.id} mp4`));
        if (why) throw new Error(why.trim());
        if (!j.render && (started || Date.now() - askedAt > 30_000)) throw new Error('the render stopped without a video');
        return null;
      }, 10 * 60_000, 2000);
      const dest = path.join(member.dir, name);
      await member.cloud.downloadJobFile(job.id, name, dest);
      const p = ffprobe(dest);
      const kinds = p.streams.map((st) => st.codec_type);
      must(kinds.includes('video') && kinds.includes('audio'), `the MP4 has ${kinds.join(' + ')}`);
      must(Math.abs(Number(p.format.duration) - clips.upload.seconds) < 3, `the MP4 is ${Number(p.format.duration).toFixed(1)} s for ${clips.upload.seconds} s of audio`);
      return `${Number(p.format.duration).toFixed(0)} s, ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`;
    });

    await check('pages: every page of the site and the shared screen loads', async () => {
      const pages = ['/', '/login', '/account', '/poster', '/healthz', '/schema.js'];
      if (memberTalk && memberTalk.code) pages.push(`/d/${memberTalk.code}`);
      const bad = [];
      for (const p of pages) { const r = await http(`${server.base}${p}`); if (r.status >= 400) bad.push(`${p} → ${r.status}`); }
      must(!bad.length, bad.join(', '));
      return `${pages.length} pages`;
    });

    // ---- last: the thing the whole design is for ------------------------------------------------------------------
    await check('keys: neither key appears in anything the server sent or the app wrote', async () => {
      const leaks = [];
      bodies.forEach((b, i) => { if (SECRETS.some((s) => b.includes(s))) leaks.push(`response #${i}`); });
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
      for (const app of apps) {
        for (const f of walk(app.dir)) {
          if (!/\.(srt|txt|md|json|log)$/i.test(f)) continue;
          if (SECRETS.some((s) => fs.readFileSync(f, 'utf8').includes(s))) leaks.push(path.relative(app.dir, f));
        }
      }
      must(!leaks.length, `a key was found in: ${leaks.slice(0, 5).join(', ')}`);
      return `${bodies.length} responses and every file the apps wrote`;
    });
  } finally {
    for (const app of apps) { try { await app.close(); } catch { /* going away */ } }
    server.proc.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} passed in ${secs(Date.now() - started)}.`);
  console.log('Not covered here — the window checklist: menus, the Settings window, printing the PDF, scanning the QR code, a real microphone.');
  if (failed.length) {
    console.log('\nThe throwaway server said, most recently:\n' + server.log().split('\n').slice(-25).join('\n'));
    process.exit(1);
  }
  process.exit(0);
}

const watchdog = setTimeout(() => { console.log('✖ the release test ran for 30 minutes and was stopped'); process.exit(2); }, 30 * 60_000);
watchdog.unref();
main().catch((err) => { console.log(`✖ the release test could not run: ${err.stack}`); process.exit(2); });
