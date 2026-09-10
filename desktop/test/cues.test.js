'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const names = require('@subs/core/names');
const { readCues, writeCues, parseSrt } = require('../lib/cues');

test('cues round-trip through the two SRT sidecars, paired by start time', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cues-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = '9月5号14点02分';
  fs.writeFileSync(names.filePath(dir, base, 'mp3'), 'x');
  const cues = writeCues(dir, base, [
    { start: 800, end: 3500, target: '我就跟妈妈说这些药是她开的。', source: '我就同阿妈讲啲药系佢开嘅。' },
    { start: 12400, end: 14700, target: '后来我妈妈再也没去看医生。', source: '一直后来我阿妈冇再去睇医生。' },
    { start: 15900, end: 15900, target: '  ', source: '' }, // empty → dropped
  ]);
  assert.equal(cues.length, 2);
  const zh = fs.readFileSync(names.srtPath(dir, base, 'zh'), 'utf8');
  assert.equal(zh, '1\n00:00:00,800 --> 00:00:03,500\n我就跟妈妈说这些药是她开的。\n\n2\n00:00:12,400 --> 00:00:14,700\n后来我妈妈再也没去看医生。\n\n');
  assert.deepEqual(readCues(dir, base), [
    { start: 800, end: 3500, target: '我就跟妈妈说这些药是她开的。', source: '我就同阿妈讲啲药系佢开嘅。' },
    { start: 12400, end: 14700, target: '后来我妈妈再也没去看医生。', source: '一直后来我阿妈冇再去睇医生。' },
  ]);
  // a merge: one cue spanning both, the original file shrinks accordingly; an end before the start is repaired
  writeCues(dir, base, [{ start: 800, end: 14700, target: '合并', source: '' }, { start: 20000, end: 100, target: 'x', source: 'y' }]);
  assert.equal(parseSrt(fs.readFileSync(names.srtPath(dir, base, 'zh'), 'utf8')).length, 2);
  assert.equal(parseSrt(fs.readFileSync(names.srtPath(dir, base, 'yue'), 'utf8')).length, 1);
  assert.equal(readCues(dir, base)[1].end, 20500);
  assert.throws(() => writeCues(dir, base, 'nope'), /array/);
});
