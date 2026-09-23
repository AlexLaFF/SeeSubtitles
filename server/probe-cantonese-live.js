'use strict';
// Paced Cantonese -> Mandarin head-to-head using the app's actual rolling translation pipeline.
// Run on the server with its existing credentials; sends audio to Tencent/Alibaba and text to TokenHub.
// node server/probe-cantonese-live.js INPUT_16KHZ_MONO_S16LE.pcm OUTPUT_DIR
const fs=require('node:fs');
const {performance}=require('node:perf_hooks');
const path=require('node:path');
const {getCredentials}=require('../core');
const {SplitStream}=require('../core/split-stream');
const {MultilingualStream}=require('./lib/multilingual-stream');
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
const [audioPath,outDir]=process.argv.slice(2);
if(!audioPath||!outDir){console.error('Usage: node server/probe-cantonese-live.js INPUT.pcm OUTPUT_DIR');process.exit(2);}
fs.mkdirSync(outDir,{recursive:true});
const pcm=Buffer.concat([fs.readFileSync(audioPath),Buffer.alloc(32000*3)]);
async function run(id){
 const events=[],calls=[];let start=0;let pushed=0;
 const opts={source:'yue',target:'zh',model:'hy-mt2-pro',rollMs:900,contextLines:2,edge:'cn',
  vadSilenceTime:700,maxSpeakTime:6,tokenhubKey:process.env.TOKENHUB_API_KEY,
  fetchImpl:async(url,init)=>{
   const req=JSON.parse(init.body),at=performance.now()-start;
   try {const res=await fetch(url,{...init,signal:AbortSignal.timeout(15000)});const body=await res.clone().json();calls.push({at,done:performance.now()-start,model:req.model,text:req.text,context:req.context,status:res.status,usage:body.usage});return res;}
   catch(e){calls.push({at,error:e.message});throw e;}
  }};
 const stream=id==='tencent'?new SplitStream(getCredentials(),opts):new MultilingualStream({...opts,dashscopeKey:process.env.DASHSCOPE_API_KEY});
 // Both use the same declared source/target in Hunyuan; Fun recognition retains automatic detection at 400 ms.
 stream.opts.source='yue';
 for(const [method,type] of [['_onPartial','partial'],['_onSentence','sentence']]){
  const original=stream[method].bind(stream);
  stream[method]=r=>{events.push({type,at:performance.now()-start,...r});original(r);};
 }
 stream.on('result',r=>events.push({type:'caption',at:performance.now()-start,...r}));
 stream.on('status',r=>events.push({type:'status',at:performance.now()-start,...r}));
 stream.start();
 const readyDeadline=performance.now()+45000;
 while(stream.state!=='ready'&&performance.now()<readyDeadline)await sleep(100);
 if(stream.state!=='ready'){const status=stream.status();stream.stop();throw Error(id+' not ready '+JSON.stringify(status));}
 start=performance.now();let maxPacingError=0,lastProgress=0;
 console.log('START '+id+' '+new Date().toISOString());
 for(let i=0;i<pcm.length;i+=6400){
  const chunk=pcm.subarray(i,i+6400),due=(i+chunk.length)/32;
  await sleep(due-(performance.now()-start));maxPacingError=Math.max(maxPacingError,Math.abs(performance.now()-start-due));
  stream.push(chunk,{t0:Date.now()-chunk.length/32});pushed+=chunk.length;
  if(due-lastProgress>=60000){lastProgress=due;console.log(JSON.stringify({progress:id,seconds:Math.round(due/1000),finals:events.filter(e=>e.type==='sentence').length,calls:calls.length,status:stream.status().state}));}
 }
 await sleep(18000);
 const status=stream.status();stream.stop();
 const result={id,engine:status.engine,source:'yue',target:'zh',model:'hy-mt2-pro',events,calls,status,maxPacingError,pushed,inputSeconds:pcm.length/32000};
 fs.writeFileSync(path.join(outDir,id+'.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({id,finals:events.filter(e=>e.type==='sentence').length,translationCalls:calls.length,status,maxPacingError}));
}
(async()=>{await run('tencent');await sleep(65000);await run('fun400');})().catch(e=>{console.error(e.message);process.exitCode=1;});
