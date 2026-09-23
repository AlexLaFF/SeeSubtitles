// Live comparison using the same rolling translation code as the app.
// Sends input audio to Alibaba and recognized text to TokenHub; incurs API charges.
// Run in an isolated environment with server-side credentials, never in the desktop app.
'use strict';
const fs=require('node:fs');
const {performance}=require('node:perf_hooks');
const {FunAsrStream}=require('./lib/dashscope-stream');
const {SplitStream}=require('../core/split-stream');
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
const path=require('node:path');
const [audioPath,outDir]=process.argv.slice(2);
if(!audioPath||!outDir){console.error('Usage: node server/probe-multilingual-live.js INPUT_16KHZ_MONO_S16LE.pcm OUTPUT_DIR');process.exit(2);}
fs.mkdirSync(outDir,{recursive:true});
const pcm=Buffer.concat([fs.readFileSync(audioPath),Buffer.alloc(32000*3)]);
const arms=[{id:'gummy400',model:'gummy-realtime-v1',lang:'auto',vadSilenceTime:400},{id:'fun400',model:'fun-asr-realtime',vadSilenceTime:400},{id:'funSemantic',model:'fun-asr-realtime',vadSilenceTime:400,semantic:true},{id:'qwen31',model:'qwen-audio-3.1-asr-flash-streaming',vadSilenceTime:400,keepDialect:true}];
(async()=>{
for(const arm of arms){
 const events=[],calls=[];let start=0,ready=false,finished=false;
 const tr=new SplitStream(null,{source:'auto',target:'en',tokenhubKey:process.env.TOKENHUB_API_KEY,fetchImpl:async(url,init)=>{
  const req=JSON.parse(init.body),at=performance.now()-start;
  try{const res=await fetch(url,{...init,signal:AbortSignal.timeout(15000)});const body=await res.clone().json();calls.push({at,done:performance.now()-start,model:req.model,text:req.text,context:req.context,status:res.status,usage:body.usage});return res;}catch(e){calls.push({at,error:e.message});throw e;}
 }});
 const asr=new FunAsrStream({key:process.env.DASHSCOPE_API_KEY,...arm});
 asr.on('usage',usage=>events.push({type:'usage',usage}));
 asr.on('error',e=>events.push({type:'error',message:e.message,at:performance.now()-start}));
 asr.on('ready',()=>{ready=true;});asr.on('finished',()=>{finished=true;});
 const row=r=>({...r,voiceId:arm.id});
 asr.on('partial',r=>{events.push({type:'partial',at:performance.now()-start,...r});tr._onPartial(row(r));});
 asr.on('sentence',r=>{events.push({type:'sentence',at:performance.now()-start,...r});tr._onSentence(row(r));});
 tr.on('result',r=>events.push({type:'caption',at:performance.now()-start,...r}));
 asr.start();for(let i=0;i<200&&!ready;i++)await sleep(100);
 if(!ready){asr.stop();throw Error(arm.id+' not ready '+JSON.stringify(events));}
 console.log('START '+arm.id);start=performance.now();let maxPacingError=0;
 for(let i=0;i<pcm.length;i+=6400){
  // A microphone chunk is available only after its 200 ms has been captured.
  const chunk=pcm.subarray(i,i+6400),due=(i+chunk.length)/32;
  await sleep(due-(performance.now()-start));maxPacingError=Math.max(maxPacingError,Math.abs(performance.now()-start-due));asr.push(chunk);
 }
 asr.end();for(let i=0;i<200&&!finished;i++)await sleep(100);
 await sleep(16000);asr.stop();
 const result={arm,events,calls,status:tr.status(),maxPacingError,sent:asr.sent,dropped:asr.dropped,finished};
 fs.writeFileSync(path.join(outDir,arm.id+'.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({id:arm.id,finals:events.filter(x=>x.type==='sentence').length,captions:events.filter(x=>x.type==='caption'&&x.sentenceEnd).length,calls:calls.length,failures:tr.failures,rateFallbacks:tr.rateFallbacks,maxPacingError}));
 // Avoid one arm's rate-limit bucket affecting the next.
 if(arm!==arms.at(-1)) await sleep(65000);
}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
