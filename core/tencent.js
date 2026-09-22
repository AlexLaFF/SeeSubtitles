'use strict';
// Auth helpers for Tencent Cloud 实时语音翻译 (real-time speech translation) WebSocket API.
// Docs: https://cloud.tencent.com/document/product/1093/127565
//
// Signature recipe from the docs:
//   1. sort every query param except `signature` in byte order, then build
//      "<host><path>?<k1=v1&k2=v2...>"  (no scheme)
//   2. HMAC-SHA1 that string with the SecretKey, base64-encode the digest
//   3. URL-encode the base64 value and append it as `signature`
const crypto = require('node:crypto');
const path = require('node:path');

const HOST = 'asr.cloud.tencent.com';
const PATH_PREFIX = '/asr/speech_translate/';
const RECOGNIZE_PREFIX = '/asr/v2/';
const PLACEHOLDER = /^(your_|<)|^$/;

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  try {
    process.loadEnvFile(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function getCredentials(env = process.env) {
  const creds = {
    appid: (env.TENCENT_APPID || '').trim(),
    secretId: (env.TENCENT_SECRET_ID || '').trim(),
    secretKey: (env.TENCENT_SECRET_KEY || '').trim(),
  };
  const missing = [];
  if (PLACEHOLDER.test(creds.appid)) missing.push('TENCENT_APPID');
  if (PLACEHOLDER.test(creds.secretId)) missing.push('TENCENT_SECRET_ID');
  if (PLACEHOLDER.test(creds.secretKey)) missing.push('TENCENT_SECRET_KEY');
  if (missing.length) {
    throw new Error(`fill in ${missing.join(', ')} in .env (copy from .env.example)`);
  }
  if (!/^\d+$/.test(creds.appid)) {
    throw new Error(`TENCENT_APPID must be the numeric account id, got "${creds.appid}"`);
  }
  return creds;
}

// Keys sorted in byte order; values are used verbatim (every value we send is URL-safe).
function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

function hmacSha1Base64(secretKey, text) {
  return crypto.createHmac('sha1', secretKey).update(text, 'utf8').digest('base64');
}

/**
 * Build a signed WebSocket URL for one connection. Every connection needs a fresh voice_id.
 * @param {{appid:string, secretId:string, secretKey:string}} creds
 * @param {{source?:string, target?:string, transModel?:string, voiceId?:string, extra?:object}} [opts]
 */
function buildConnection(creds, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  const params = {
    secretid: creds.secretId,
    timestamp: now,
    expired: now + 24 * 3600, // must be > timestamp and < 90 days out
    nonce: 1 + Math.floor(Math.random() * 999_999_999), // positive, <= 10 digits
    voice_id: opts.voiceId || crypto.randomUUID(),
    voice_format: 1, // PCM
    source: opts.source || 'yue',
    target: opts.target || 'zh',
    trans_model: opts.transModel || 'hunyuan-translation-lite',
    ...(opts.extra || {}),
  };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') delete params[k];
  }
  // Values that are not URL-safe (hotword lists with Chinese, "|" and ",") are signed raw and sent
  // URL-encoded (opts.signEncoded flips that for experiments).
  const encoded = {};
  for (const [k, v] of Object.entries(params)) encoded[k] = /[^A-Za-z0-9_.~-]/.test(String(v)) ? encodeURIComponent(String(v)) : String(v);
  const query = canonicalQuery(opts.signEncoded ? encoded : params);
  const stringToSign = `${HOST}${PATH_PREFIX}${creds.appid}?${query}`;
  const signature = hmacSha1Base64(creds.secretKey, stringToSign);
  const url = `wss://${HOST}${PATH_PREFIX}${creds.appid}?${canonicalQuery(encoded)}&signature=${encodeURIComponent(signature)}`;
  return { url, params, stringToSign, signature, voiceId: params.voice_id };
}

/**
 * Sign one 实时语音识别 connection — the words only, which core/split-stream.js then translates itself.
 * Same recipe as buildConnection above; a different path, and the tuning parameters this endpoint honours.
 * @param {{appid:string, secretId:string, secretKey:string}} creds
 * @param {{engine?:string, voiceId?:string, hotwords?:string, vadSilenceTime?:number, maxSpeakTime?:number,
 *          noiseThreshold?:number, filterModal?:number, extra?:object}} [opts]
 */
function buildRecognition(creds, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  const hw = hotwordList(opts.hotwords);
  const params = {
    secretid: creds.secretId,
    timestamp: now,
    expired: now + 24 * 3600,
    nonce: 1 + Math.floor(Math.random() * 999_999_999),
    engine_model_type: opts.engine || '16k_zh_large',
    voice_id: opts.voiceId || crypto.randomUUID(),
    voice_format: 1, // PCM
    needvad: 1, // the service decides where a sentence ends, as 实时语音翻译 does
    filter_punc: 0,
    filter_dirty: 0,
    filter_modal: Number(opts.filterModal) || 0,
    convert_num_mode: 1,
    ...(hw ? { hotword_list: hw } : {}),
    ...(opts.vadSilenceTime ? { vad_silence_time: Math.round(Number(opts.vadSilenceTime)) } : {}),
    ...(opts.maxSpeakTime ? { max_speak_time: Math.round(Number(opts.maxSpeakTime) * 1000) } : {}),
    ...(Number(opts.noiseThreshold) ? { noise_threshold: Number(opts.noiseThreshold) } : {}),
    ...(opts.extra || {}),
  };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') delete params[k];
  }
  const encoded = {};
  for (const [k, v] of Object.entries(params)) encoded[k] = /[^A-Za-z0-9_.~-]/.test(String(v)) ? encodeURIComponent(String(v)) : String(v);
  const stringToSign = `${HOST}${RECOGNIZE_PREFIX}${creds.appid}?${canonicalQuery(params)}`;
  const signature = hmacSha1Base64(creds.secretKey, stringToSign);
  const url = `wss://${HOST}${RECOGNIZE_PREFIX}${creds.appid}?${canonicalQuery(encoded)}&signature=${encodeURIComponent(signature)}`;
  return { url, params, stringToSign, signature, voiceId: params.voice_id };
}

// --- mainland edge -------------------------------------------------------------------------
// Through a VPN, asr.cloud.tencent.com resolves to an overseas edge (e.g. Frankfurt) that has no
// route for /asr/speech_translate (nginx 404). Resolving through a mainland DoH server yields the
// Guangzhou edge, which serves it. We connect to that IP with SNI/Host still set to the hostname.
// Behind a VPN the resolvers geo-route by the VPN exit, so ask with an explicit mainland client
// subnet (EDNS Client Subnet) first; plain queries and a known-good edge are the fallbacks.
const MAINLAND_SUBNET = '113.108.0.0/24';
const DOH_URLS = [
  `https://dns.alidns.com/resolve?name=${HOST}&type=A&edns_client_subnet=${MAINLAND_SUBNET}`,
  `https://doh.pub/dns-query?name=${HOST}&type=A&edns_client_subnet=${MAINLAND_SUBNET}`,
  `https://dns.alidns.com/resolve?name=${HOST}&type=A`,
  `https://doh.pub/dns-query?name=${HOST}&type=A`,
];
const LAST_RESORT_EDGES = ['106.55.89.122']; // ap-guangzhou CLB seen serving /asr/speech_translate
let mainlandCache = { ip: null, at: 0 };

/**
 * Resolve the mainland edge via Chinese DoH resolvers. `avoid` lists IPs known not to work (e.g. the
 * overseas edge the system DNS returned, or an edge that just answered 404) so a resolver whose answer
 * is skewed by the VPN exit is skipped in favour of the next one. `force` bypasses the cache.
 */
async function resolveMainland({ ttlMs = 10 * 60_000, force = false, avoid = [] } = {}) {
  if (!force && mainlandCache.ip && !avoid.includes(mainlandCache.ip) && Date.now() - mainlandCache.at < ttlMs) return mainlandCache.ip;
  let lastErr = null;
  let fallback = null;
  for (const url of DOH_URLS) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000) });
      const json = await res.json();
      const ips = (json.Answer || []).filter((a) => a.type === 1).map((a) => a.data).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d));
      const good = ips.find((ip) => !avoid.includes(ip));
      if (good) {
        mainlandCache = { ip: good, at: Date.now() };
        return good;
      }
      if (ips[0] && !fallback) fallback = ips[0];
      lastErr = new Error(`no usable A record from ${url}`);
    } catch (err) {
      lastErr = err;
    }
  }
  const resort = LAST_RESORT_EDGES.find((ip) => !avoid.includes(ip));
  if (resort) { mainlandCache = { ip: resort, at: Date.now() }; return resort; }
  if (fallback) { mainlandCache = { ip: fallback, at: Date.now() }; return fallback; }
  throw new Error(`mainland DNS lookup failed: ${lastErr ? lastErr.message : 'unknown'}`);
}

function forgetMainland() { mainlandCache = { ip: null, at: 0 }; }

/**
 * Whether `ip` really is a mainland edge. A resolver can hand back an overseas one — every lookup above falls
 * through to plain DNS when the mainland-subnet ones fail, and from Hong Kong plain DNS answers with Singapore —
 * and recognition reached there is billed 跨境. Only the mainland serves 实时语音翻译: an overseas edge answers its
 * path with HTTP 404, a mainland one opens the socket and complains about the missing parameters. Nothing is
 * signed and no audio is sent, so nothing is billed.
 */
function isMainlandEdge(ip, { timeoutMs = 5000 } = {}) {
  const WebSocket = require('ws');
  return new Promise((resolve) => {
    let ws = null;
    const done = (yes) => { clearTimeout(timer); try { ws.terminate(); } catch { /* gone */ } resolve(yes); };
    const timer = setTimeout(() => done(false), timeoutMs);
    ws = new WebSocket(`wss://${HOST}${PATH_PREFIX}0?voice_id=edge-check`, { handshakeTimeout: timeoutMs, ...pinnedOptions(ip) });
    ws.on('unexpected-response', () => done(false));
    ws.on('message', () => done(true));
    ws.on('error', () => done(false));
    ws.on('close', () => done(false));
  });
}

/** hotwords text (one "词|权重" per line, or comma separated) → API hotword_list value, or '' if none. */
function hotwordList(text) {
  const items = [];
  for (const raw of String(text || '').split(/[\n,，]/)) {
    const t = raw.trim();
    if (!t) continue;
    const m = /^(.+?)\s*[|｜]\s*(\d{1,3})$/.exec(t);
    const word = (m ? m[1] : t).trim().replace(/[|,，]/g, '');
    let weight = m ? Number(m[2]) : 10;
    if (!word) continue;
    if (weight !== 100) weight = Math.min(11, Math.max(1, weight));
    items.push(`${word}|${weight}`);
    if (items.length >= 128) break;
  }
  return items.join(',');
}

/** Extra `ws` options that pin the TCP connection to `ip` while keeping TLS SNI + Host = asr.cloud.tencent.com. */
function pinnedOptions(ip) {
  if (!ip) return {};
  return {
    servername: HOST,
    lookup: (_host, opts, cb) => (opts && opts.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)),
  };
}

module.exports = {
  HOST,
  PATH_PREFIX,
  loadEnv,
  getCredentials,
  canonicalQuery,
  hmacSha1Base64,
  buildConnection,
  buildRecognition,
  resolveMainland,
  forgetMainland,
  isMainlandEdge,
  pinnedOptions,
  hotwordList,
};
