'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {fromSrt,fromTexts,fromTsv}=require('../plain-text');
test('clean SRT export removes cue metadata and styling but preserves spoken numbers and times',()=>{
 const srt='\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\n<b>Meet at 12:34.</b>\r\nBring 123 items.\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n{\\an8}第二句。\r\n';
 assert.equal(fromSrt(srt),'Meet at 12:34. Bring 123 items.\n第二句。\n');
 assert.equal(fromSrt(''), '');
});
test('clean original and translation exports are separate and contain only text',()=>{
 const tsv='2026-09-06T00:00:00Z\t你好呀\tHello\n2026-09-06T00:00:01Z\t第二句\tSecond line\n';
 assert.equal(fromTsv(tsv),'你好呀\n第二句\n');
 assert.equal(fromTsv(tsv,'target'),'Hello\nSecond line\n');
 assert.equal(fromTexts(['a\n b','','c']),'a b\nc\n');
});
