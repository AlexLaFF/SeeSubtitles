'use strict';
// The split pipeline's choice of edge when a resolver answers with an overseas one — as every lookup does from
// Hong Kong once the mainland-subnet ones fail — where recognition would be billed 跨境.
const test = require('node:test');
const assert = require('node:assert/strict');
const tencent = require('../tencent');

const GUANGZHOU = '106.55.89.122';
const SINGAPORE = '43.156.86.206';
let answers = [];
const asked = [];
tencent.resolveMainland = async (o) => { asked.push({ ...o, avoid: [...o.avoid] }); if (!answers.length) throw new Error('no answer'); return answers.shift(); };
tencent.isMainlandEdge = async (ip) => ip === GUANGZHOU;
tencent.forgetMainland = () => {};
const { SplitStream } = require('../split-stream'); // after the stand-ins, which it takes when it loads

test('an overseas answer is skipped and the lookup asks again, avoiding it', async () => {
  answers = [SINGAPORE, GUANGZHOU];
  asked.length = 0;
  const s = new SplitStream(null, { tokenhubKey: 'k', edge: 'cn' });
  assert.equal(await s._edgeIp(), GUANGZHOU);
  assert.equal(s.status.edge, `mainland ${GUANGZHOU}`);
  assert.equal(asked.length, 2);
  assert.ok(asked[1].force && asked[1].avoid.includes(SINGAPORE), 'the second lookup is fresh and skips Singapore');
});

test('when no answer is a mainland edge, the connection says it goes overseas instead of calling it mainland', async () => {
  answers = [SINGAPORE, SINGAPORE, SINGAPORE];
  const s = new SplitStream(null, { tokenhubKey: 'k', edge: 'cn' });
  const logs = [];
  s.on('log', (t) => logs.push(t));
  assert.equal(await s._edgeIp(), null);
  assert.equal(s.status.edge, 'overseas');
  assert.ok(logs.some((t) => /no edge that serves the mainland/.test(t)), logs.join(' | '));
});
