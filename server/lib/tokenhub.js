'use strict';
// Tencent 大模型服务平台 TokenHub: the successor of the standalone Hunyuan API (which stops on 2026-09-30).
// Translation endpoint (docs: TokenHub 混元调用指南 → 术语库):
//   POST https://tokenhub.tencentmaas.com/v1/api/translations   Authorization: Bearer <API key>
//   { model, text, target, source?, context?, references?, glossary_ids?, stream? }
//   → { choices: [{ message: { content }, finish_reason }], source, target, usage }
// Models: hy-mt2-pro (flagship, 30B-A3B), hy-mt2-plus (7B), hy-mt2-lite (1.8B); all 0.5 / 2 元 per M tokens.
// Language codes are the same as the old API (zh, zh-TR, en, ja, ko, …, yue for Cantonese).
const https = require('node:https');

const DEFAULT_BASE = 'https://tokenhub.tencentmaas.com';
const DEFAULT_MODEL = 'hy-mt2-pro';
// When the account may not use a model — its free trial quota is spent and postpaid billing is off, or it was
// never enabled — every call to it is refused the same way, and no retry will change that. The next model down
// still translates, less well, which beats a subtitle track with nothing in it. (hy-mt2-pro's trial ran out on
// 2026-09-17 during testing: `402 401008 The free trial quota for the service has been exhausted`.)
const NEXT_MODEL = { 'hy-mt2-pro': 'hy-mt2-plus', 'hy-mt2-plus': 'hy-mt2-lite' };
// hy-mt2-pro takes 60 requests a minute on the account and one live talk makes about 45, so a second talk — or a
// file translating while one runs — meets `429 The request rate exceeds the current model RPM limit 60`. That is a
// busy minute, not a refusal: the call goes to plus, which took 500+ a minute, and so does every call for the next
// RATE_COOLDOWN_MS, keeping a line's draft and its final on one model; then pro is asked again.
const RATE_FALLBACK = { 'hy-mt2-pro': 'hy-mt2-plus' };
const RATE_COOLDOWN_MS = 20_000;

class TokenHubError extends Error {
  constructor(status, message, body) {
    super(`TokenHub translations: HTTP ${status} ${message}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Translate one text. Resolves with the translated string ('' when the model refused it as sensitive).
 * @param {string} apiKey
 * @param {{model?:string, text:string, source?:string, target:string, context?:string}} req
 * @param {{baseUrl?:string, timeoutMs?:number, onUsage?:Function}} [opts]
 */
function translate(apiKey, { model = DEFAULT_MODEL, text, source, target, context }, { baseUrl = DEFAULT_BASE, timeoutMs = 120_000, onUsage = () => {} } = {}) {
  const url = new URL('/v1/api/translations', baseUrl);
  const body = JSON.stringify({ model, text, target, ...(source ? { source } : {}), ...(context ? { context } : {}), stream: false });
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch { /* non-JSON */ }
        if (res.statusCode !== 200) {
          const msg = (json && (json.error && json.error.message || json.message || json.msg)) || raw.slice(0, 200) || res.statusMessage;
          return reject(new TokenHubError(res.statusCode, msg, json));
        }
        if (!json) return reject(new TokenHubError(200, `non-JSON body: ${raw.slice(0, 200)}`));
        const choice = json.choices && json.choices[0];
        if (!choice) return reject(new TokenHubError(200, `no choices in response: ${raw.slice(0, 200)}`, json));
        const usage = json.usage || {};
        try { onUsage({ model: json.model || model, inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0 }); }
        catch { /* accounting must not fail a translation that succeeded */ }
        resolve(String((choice.message && choice.message.content) || '').trim());
      });
    });
    req.on('timeout', () => req.destroy(new Error(`TokenHub translations: timeout after ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

/** A refusal that says this account may not use the model at all, as opposed to a slow or busy moment. */
function isRefused(status, body, message = '') {
  const err = body && body.error;
  return status === 402 || status === 403
    || (err && /permission_error/.test(String(err.type || '')))
    || /postpaid billing|free trial quota|not enabled/i.test(String((err && err.message) || message));
}

/** The model to try when `model` is refused, or null when there is nothing below it. */
const nextModel = (model) => NEXT_MODEL[model] || null;

/** A model's per-minute limit, which clears by itself. */
function isRateLimited(status, body, message = '') {
  const err = body && body.error;
  return status === 429 || /RPM limit|request rate exceeds/i.test(String((err && err.message) || message));
}

/** The model to use while `model` is at its rate limit, or null when there is none. */
const rateFallback = (model) => RATE_FALLBACK[model] || null;

module.exports = { translate, TokenHubError, DEFAULT_MODEL, DEFAULT_BASE, NEXT_MODEL, RATE_FALLBACK, RATE_COOLDOWN_MS,
  isRefused, nextModel, isRateLimited, rateFallback };
