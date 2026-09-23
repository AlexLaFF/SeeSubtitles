'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../lib/db');
const { UsageLedger } = require('../lib/usage-ledger');

test('usage detail separates accounts, modes and actual models, and does not recount a resumed file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-ledger-'));
  try {
    const db = openDb(dir);
    db.run("INSERT INTO users(id, email, pass_hash, created_at) VALUES (1, 'a@example.com', '', 0), (2, 'b@example.com', '', 0)");
    const ledger = new UsageLedger(db);
    const at = Date.parse('2026-09-23T12:00:00Z');
    ledger.record({ userId: 1, actionId: 'talk-a', action: 'live', operation: 'recognition', provider: 'tencent', pipeline: 'split', model: '16k_zh_large', source: 'yue', target: 'zh', seconds: 15, at });
    ledger.record({ userId: 1, actionId: 'talk-a', action: 'live', operation: 'recognition', provider: 'tencent', pipeline: 'split', model: '16k_zh_large', source: 'yue', target: 'zh', seconds: 10, at });
    ledger.record({ userId: 1, actionId: 'talk-a', action: 'live', operation: 'translation', provider: 'tokenhub', pipeline: 'split', model: 'hy-mt2-plus', calls: 1, inputTokens: 95, outputTokens: 14, at });
    const file = { eventKey: 'file:job-a:recognition:123', userId: 1, actionId: 'job-a', action: 'file', operation: 'recognition', provider: 'alibaba', pipeline: 'file', model: 'fun-asr', seconds: 70, calls: 1, at };
    ledger.record(file); ledger.record(file);
    ledger.record({ userId: 2, actionId: 'talk-b', action: 'live', operation: 'combined', provider: 'tencent', pipeline: 'combined', model: 'hunyuan-translation', seconds: 80, at });
    ledger.record({ userId: 1, actionId: 'older', action: 'live', operation: 'combined', provider: 'tencent', pipeline: 'combined', model: 'hunyuan-translation', seconds: 90, at: Date.parse('2026-08-31T23:00:00Z') });

    const rows = ledger.breakdown(1, '2026-09').rows;
    assert.equal(rows.length, 3);
    assert.equal(rows.find((r) => r.model === '16k_zh_large').seconds, 25);
    assert.equal(rows.find((r) => r.model === '16k_zh_large').actions, 1);
    assert.deepEqual([rows.find((r) => r.model === 'hy-mt2-plus').calls, rows.find((r) => r.model === 'hy-mt2-plus').inputTokens], [1, 95]);
    assert.equal(rows.find((r) => r.model === 'fun-asr').calls, 1);
    assert.equal(ledger.breakdown(2, '2026-09').rows[0].model, 'hunyuan-translation');
    assert.throws(() => ledger.breakdown(1, 'September'), /YYYY-MM/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
