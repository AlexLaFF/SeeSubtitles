'use strict';
// Minimal Tencent Cloud API v3 client (TC3-HMAC-SHA256 signing), no SDK.
// Docs: https://cloud.tencent.com/document/api/213/30654
const crypto = require('node:crypto');
const https = require('node:https');

const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key, s, enc) => crypto.createHmac('sha256', key).update(s, 'utf8').digest(enc);

class TencentApiError extends Error {
  constructor(code, message, requestId, action) {
    super(`${action}: ${code} ${message} (RequestId ${requestId})`);
    this.code = code;
    this.requestId = requestId;
    this.action = action;
  }
}

/**
 * POST one API v3 action. Resolves with `Response` (Error already thrown as TencentApiError).
 * @param {{secretId:string, secretKey:string}} creds
 * @param {{service:string, version:string, action:string, region?:string, payload?:object, timeoutMs?:number}} req
 */
function call(creds, { service, version, action, region, payload, timeoutMs = 60_000 }) {
  const host = `${service}.tencentcloudapi.com`;
  const body = JSON.stringify(payload || {});
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(body)].join('\n');
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', ts, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac(`TC3${creds.secretKey}`, date);
  const kService = hmac(kDate, service);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  const headers = {
    Authorization: `TC3-HMAC-SHA256 Credential=${creds.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    Host: host,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(ts),
    'X-TC-Version': version,
  };
  if (region) headers['X-TC-Region'] = region;

  return new Promise((resolve, reject) => {
    const req = https.request({ host, path: '/', method: 'POST', headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { return reject(new Error(`${action}: HTTP ${res.statusCode} non-JSON body: ${text.slice(0, 300)}`)); }
        const r = json.Response || {};
        if (r.Error) return reject(new TencentApiError(r.Error.Code, r.Error.Message, r.RequestId, action));
        resolve(r);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${action}: timeout after ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

// 录音文件识别 (batch ASR). Region is not needed for this service.
const asr = (creds, action, payload) => call(creds, { service: 'asr', version: '2019-06-14', action, payload });
// 机器翻译 TMT. Region is required; Hong Kong keeps traffic close to the HK server.
const tmt = (creds, action, payload, region = 'ap-hongkong') => call(creds, { service: 'tmt', version: '2018-03-21', action, region, payload });

module.exports = { call, asr, tmt, TencentApiError };
