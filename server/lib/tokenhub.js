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
 * @param {{baseUrl?:string, timeoutMs?:number}} [opts]
 */
function translate(apiKey, { model = DEFAULT_MODEL, text, source, target, context }, { baseUrl = DEFAULT_BASE, timeoutMs = 120_000 } = {}) {
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
        resolve(String((choice.message && choice.message.content) || '').trim());
      });
    });
    req.on('timeout', () => req.destroy(new Error(`TokenHub translations: timeout after ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

module.exports = { translate, TokenHubError, DEFAULT_MODEL, DEFAULT_BASE };
