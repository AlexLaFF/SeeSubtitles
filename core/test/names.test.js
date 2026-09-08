'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const names=require('../names');
test('Chinese naming preserves complete sets, legacy discovery and same-minute uniqueness', t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'subtitle-names-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const base=names.baseFromDate(new Date(2026,8,6,14,3)); assert.equal(base,'9月6号14点03分');
 for(const style of ['cn','legacy']) for(const kind of names.KINDS) {
  const filename=names.fileName(base,kind,style); assert.deepEqual(names.parse(filename),{base,kind,style});
 }
 fs.writeFileSync(path.join(dir,names.fileName(base,'mp3')),'');
 assert.equal(names.uniqueBase(dir,base),base+'-2');
 const legacy='2026-09-05_14-33-05'; fs.writeFileSync(path.join(dir,legacy+'.mp3'),'');
 assert.equal(names.filePath(dir,legacy,'pdf'),path.join(dir,legacy+'.summary.pdf'));
 assert.equal(names.legacyToCn(legacy),'9月5号14点33分');
 assert.equal(names.parse('.hidden.mp3'),null); assert.equal(names.parse(base+'录音.mp3.part'),null);
});
